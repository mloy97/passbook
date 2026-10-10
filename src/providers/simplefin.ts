// SimpleFIN provider (protocol 2.0: https://www.simplefin.org/protocol.html).
// A window provider: each fetch asks for a date window per request and reports
// coverage for every account it got a full listing for (ADR 0002).

import {
	Coverage,
	FetchRequest,
	FetchResult,
	Http,
	HttpResponse,
	Provider,
	ProviderAccount,
	ProviderCapabilities,
	ProviderConnection,
	ProviderError,
	ProviderIssue,
	ProviderTransaction,
	SecretStore,
} from './types';
import { PAUSE_AFTER_429_MS, PAUSE_AFTER_WARNING_MS, RequestBudget } from './budget';

export const SIMPLEFIN_SECRET_ID = 'passbook-simplefin-access-url';

const DAY_MS = 24 * 60 * 60 * 1000;
/** SimpleFIN rejects windows longer than this. */
export const MAX_WINDOW_DAYS = 90;
/** SimpleFIN's guide recommends overlapping windows by about 5 days. */
export const OVERLAP_DAYS = 5;

export interface SimpleFinState {
	/** End of the last window fetched in full. */
	lastEnd?: string;
}

interface Credentials {
	/** Access URL with the credentials stripped, no trailing slash. */
	base: string;
	authorization: string;
}

// ---------------------------------------------------------------- setup token

/** Decodes a setup token to its claim URL. Throws ProviderError('setup-token'). */
export function decodeSetupToken(token: string): string {
	const trimmed = token.trim();
	let decoded: string;
	try {
		decoded = atob(trimmed).trim();
	} catch {
		throw new ProviderError('setup-token', 'That isn’t a SimpleFIN setup token. Copy the whole token from SimpleFIN Bridge and paste it again.');
	}
	let url: URL;
	try {
		url = new URL(decoded);
	} catch {
		throw new ProviderError('setup-token', 'That isn’t a SimpleFIN setup token. Copy the whole token from SimpleFIN Bridge and paste it again.');
	}
	if (url.protocol !== 'https:') {
		throw new ProviderError('setup-token', 'This setup token points at an insecure (non-HTTPS) address, so PassBook won’t use it.');
	}
	return url.toString();
}

/** Exchanges a one-time setup token for an access URL. */
export async function claimSetupToken(http: Http, token: string): Promise<string> {
	const claimUrl = decodeSetupToken(token);
	const res = await send(http, { url: claimUrl, method: 'POST' });
	if (res.status === 403) {
		throw new ProviderError(
			'setup-token',
			'SimpleFIN says this setup token doesn’t exist or was already used. Create a new one in SimpleFIN Bridge. If you didn’t use it yourself, someone else may have: disable it in SimpleFIN Bridge.',
		);
	}
	if (res.status !== 200) throw unexpectedStatus(res);
	const accessUrl = res.text.trim();
	parseAccessUrl(accessUrl); // reject garbage before it's stored
	return accessUrl;
}

export function parseAccessUrl(accessUrl: string): Credentials {
	let url: URL;
	try {
		url = new URL(accessUrl);
	} catch {
		throw new ProviderError('bad-response', 'SimpleFIN returned an access URL PassBook can’t read.');
	}
	if (url.protocol !== 'https:' || !url.username) {
		throw new ProviderError('bad-response', 'SimpleFIN returned an access URL PassBook can’t use.');
	}
	const user = decodeURIComponent(url.username);
	const pass = decodeURIComponent(url.password);
	url.username = '';
	url.password = '';
	return {
		base: url.toString().replace(/\/+$/, ''),
		authorization: 'Basic ' + btoa(`${user}:${pass}`),
	};
}

// ---------------------------------------------------------------- windows

export interface Window {
	start: Date;
	end: Date;
}

/**
 * The windows to fetch, oldest first, each at most MAX_WINDOW_DAYS long. A first sync
 * goes back `initialDays`; later syncs start OVERLAP_DAYS before the last window's end.
 */
export function planWindows(state: SimpleFinState | undefined, initialDays: number, now: Date): Window[] {
	const end = now.getTime();
	const lastEnd = state?.lastEnd ? Date.parse(state.lastEnd) : NaN;
	let start = Number.isNaN(lastEnd) ? end - initialDays * DAY_MS : lastEnd - OVERLAP_DAYS * DAY_MS;
	start = Math.min(start, end - OVERLAP_DAYS * DAY_MS);

	const windows: Window[] = [];
	for (let s = start; s < end; s += MAX_WINDOW_DAYS * DAY_MS) {
		windows.push({ start: new Date(s), end: new Date(Math.min(s + MAX_WINDOW_DAYS * DAY_MS, end)) });
	}
	return windows;
}

// ---------------------------------------------------------------- provider

export class SimpleFinProvider implements Provider {
	readonly id = 'simplefin' as const;
	readonly capabilities: ProviderCapabilities = {
		syncModel: 'window',
		pending: true,
		cardStatements: false,
		connectionRepair: false,
	};

	constructor(
		private readonly http: Http,
		private readonly secrets: SecretStore,
		/** Request limits (#14). Optional so tests of other behaviour can ignore it. */
		private readonly budget?: RequestBudget,
		private readonly clock: () => Date = () => new Date(),
	) {}

	/** Claims a setup token and stores the access URL, then checks it works. */
	async connect(setupToken: string): Promise<void> {
		const accessUrl = await claimSetupToken(this.http, setupToken);
		// Store before verifying: the setup token is spent now, so losing the access URL
		// to a transient failure would force the user to make a new token.
		this.secrets.set(SIMPLEFIN_SECRET_ID, accessUrl);
		await this.verify();
	}

	isConnected(): boolean {
		return !!this.secrets.get(SIMPLEFIN_SECRET_ID);
	}

	disconnect(): void {
		// SecretStorage has no delete; an empty value means not connected.
		this.secrets.set(SIMPLEFIN_SECRET_ID, '');
	}

	async verify(): Promise<void> {
		const body = await this.getAccounts({ 'balances-only': '1' }, this.clock());
		const auth = body.errlist.find((e) => e.code === 'gen.auth');
		if (auth && body.accounts.length === 0) throw new ProviderError('auth', authMessage(auth.msg));
	}

	async fetch(request: FetchRequest): Promise<FetchResult> {
		const state = isState(request.state) ? request.state : undefined;
		const windows = planWindows(state, request.initialDays, request.now);
		// All or nothing: a sync that stops halfway would leave a gap before lastEnd.
		this.budget?.check(windows.length, request.now);

		const connections = new Map<string, ProviderConnection>();
		const accounts = new Map<string, ProviderAccount>();
		const upserts = new Map<string, ProviderTransaction>();
		const coverage: Coverage[] = [];
		const issues = new Map<string, ProviderIssue>();

		for (const w of windows) {
			const body = await this.getAccounts({
				'start-date': String(Math.floor(w.start.getTime() / 1000)),
				'end-date': String(Math.floor(w.end.getTime() / 1000)),
				pending: '1',
			}, request.now);
			const parsed = parseAccountSet(body);
			if (parsed.issues.some((i) => i.kind === 'rate-limit-warning')) {
				this.budget?.pause(new Date(request.now.getTime() + PAUSE_AFTER_WARNING_MS));
			}
			if (parsed.fatalAuth) throw new ProviderError('auth', authMessage(parsed.fatalAuth));

			for (const c of parsed.connections) connections.set(c.id, c);
			// Windows run oldest first, so the newest balances win.
			for (const a of parsed.accounts) accounts.set(a.id, a);
			for (const t of parsed.transactions) upserts.set(`${t.accountId}\u0000${t.id}`, t);
			for (const i of parsed.issues) issues.set(`${i.kind}|${i.connectionId ?? ''}|${i.accountId ?? ''}|${i.message}`, i);
			for (const a of parsed.accounts) {
				if (parsed.incompleteAccounts.has(a.id)) continue;
				if (a.connectionId && parsed.failedConnections.has(a.connectionId)) continue;
				coverage.push({ accountId: a.id, start: w.start.toISOString(), end: w.end.toISOString() });
			}
		}

		const last = windows[windows.length - 1];
		const next: SimpleFinState = { lastEnd: last ? last.end.toISOString() : state?.lastEnd };
		return {
			connections: [...connections.values()],
			accounts: [...accounts.values()],
			upserts: [...upserts.values()],
			removed: [],
			coverage,
			issues: [...issues.values()],
			state: next,
		};
	}

	private credentials(): Credentials {
		const accessUrl = this.secrets.get(SIMPLEFIN_SECRET_ID);
		if (!accessUrl) throw new ProviderError('not-connected', 'SimpleFIN isn’t connected on this device.');
		return parseAccessUrl(accessUrl);
	}

	private async getAccounts(params: Record<string, string>, now: Date): Promise<RawAccountSet> {
		const { base, authorization } = this.credentials();
		this.budget?.check(1, now);
		this.budget?.record(now);
		const query = new URLSearchParams({ version: '2', ...params });
		const res = await send(this.http, {
			url: `${base}/accounts?${query.toString()}`,
			method: 'GET',
			headers: { Authorization: authorization },
		});
		if (res.status === 403) {
			throw new ProviderError('auth', 'SimpleFIN rejected PassBook’s access. It may have been disabled in SimpleFIN Bridge. Connect again with a new setup token.');
		}
		if (res.status === 402) {
			throw new ProviderError('payment-required', 'SimpleFIN says your SimpleFIN Bridge subscription needs payment.');
		}
		if (res.status === 429) {
			this.budget?.pause(new Date(now.getTime() + PAUSE_AFTER_429_MS));
			throw new ProviderError('rate-limit', 'SimpleFIN is limiting requests. Try again later; PassBook will sync less often.');
		}
		if (res.status !== 200) throw unexpectedStatus(res);
		return parseJson(res.text);
	}
}

// ---------------------------------------------------------------- parsing

interface RawError {
	code: string;
	msg: string;
	conn_id?: string;
	account_id?: string;
}

interface RawAccountSet {
	errlist: RawError[];
	errors: string[];
	connections: unknown[];
	accounts: unknown[];
}

interface ParsedAccountSet {
	connections: ProviderConnection[];
	accounts: ProviderAccount[];
	transactions: ProviderTransaction[];
	issues: ProviderIssue[];
	/** Accounts whose transaction listing can't be trusted to be complete. */
	incompleteAccounts: Set<string>;
	/** Connections that failed, whose accounts may be stale. */
	failedConnections: Set<string>;
	/** Set when SimpleFIN rejected the request as a whole. */
	fatalAuth?: string;
}

function parseJson(text: string): RawAccountSet {
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		throw new ProviderError('bad-response', 'SimpleFIN sent a response PassBook can’t read.');
	}
	if (!isObject(body) || !Array.isArray(body.accounts)) {
		throw new ProviderError('bad-response', 'SimpleFIN sent a response without an account list.');
	}
	return {
		errlist: Array.isArray(body.errlist) ? body.errlist.filter(isRawError) : [],
		errors: Array.isArray(body.errors) ? body.errors.filter((e): e is string => typeof e === 'string') : [],
		connections: Array.isArray(body.connections) ? body.connections : [],
		accounts: body.accounts,
	};
}

export function parseAccountSet(body: RawAccountSet): ParsedAccountSet {
	const out: ParsedAccountSet = {
		connections: [],
		accounts: [],
		transactions: [],
		issues: [],
		incompleteAccounts: new Set(),
		failedConnections: new Set(),
	};

	for (const raw of body.connections) {
		if (!isObject(raw)) continue;
		const id = str(raw.conn_id);
		if (!id) continue;
		out.connections.push({ id, name: str(raw.name) ?? id, institutionDomain: str(raw.org_url) });
	}

	for (const raw of body.accounts) {
		if (!isObject(raw)) continue;
		const account = parseAccount(raw, out);
		if (!account) continue;
		out.accounts.push(account);
		if (!Array.isArray(raw.transactions)) continue;
		for (const t of raw.transactions) {
			const tx = isObject(t) ? parseTransaction(t, account.id) : undefined;
			if (tx) out.transactions.push(tx);
			else out.incompleteAccounts.add(account.id);
		}
	}

	for (const e of body.errlist) {
		const prefix = e.code.split('.')[0];
		if (e.code === 'gen.auth') {
			out.fatalAuth = e.msg;
		} else if (prefix === 'con') {
			out.issues.push({ kind: e.code === 'con.auth' ? 'connection-auth' : 'connection', message: e.msg, connectionId: e.conn_id });
			if (e.conn_id) out.failedConnections.add(e.conn_id);
		} else if (prefix === 'act') {
			out.issues.push({ kind: 'account', message: e.msg, accountId: e.account_id });
			if (e.account_id) out.incompleteAccounts.add(e.account_id);
		} else {
			out.issues.push({ kind: looksLikeRateLimit(e.msg) ? 'rate-limit-warning' : 'other', message: e.msg });
		}
	}
	// The deprecated `errors` strings duplicate errlist on v2 servers; use them only
	// when errlist is empty (v1 servers, and rate-limit warnings per the developer guide).
	if (body.errlist.length === 0) {
		for (const msg of body.errors) {
			out.issues.push({ kind: looksLikeRateLimit(msg) ? 'rate-limit-warning' : 'other', message: msg });
		}
	}
	// A whole-request auth failure only counts as fatal when nothing came back.
	if (out.fatalAuth && out.accounts.length > 0) {
		out.issues.push({ kind: 'other', message: out.fatalAuth });
		out.fatalAuth = undefined;
	}
	return out;
}

function parseAccount(raw: Record<string, unknown>, out: ParsedAccountSet): ProviderAccount | undefined {
	const id = str(raw.id);
	const balance = num(raw.balance);
	const balanceDate = epoch(raw['balance-date']);
	if (!id || balance === undefined || !balanceDate) return undefined;

	let connectionId = str(raw.conn_id);
	// Protocol v1 servers send an `org` object instead of connections.
	if (!connectionId && isObject(raw.org)) {
		const org = raw.org;
		connectionId = str(org.id) ?? str(org.domain) ?? str(org['sfin-url']) ?? 'unknown';
		if (!out.connections.some((c) => c.id === connectionId)) {
			out.connections.push({ id: connectionId, name: str(org.name) ?? connectionId, institutionDomain: str(org.domain) });
		}
	}
	return {
		id,
		connectionId: connectionId ?? 'unknown',
		name: str(raw.name) ?? id,
		currency: str(raw.currency) ?? 'USD',
		balance,
		availableBalance: num(raw['available-balance']),
		balanceAsOf: balanceDate,
	};
}

function parseTransaction(raw: Record<string, unknown>, accountId: string): ProviderTransaction | undefined {
	const id = str(raw.id);
	const amount = num(raw.amount);
	if (!id || amount === undefined) return undefined;
	const posted = epoch(raw.posted);
	const pending = raw.pending === true || !posted;
	return {
		id,
		accountId,
		amount,
		description: str(raw.description) ?? '',
		pending,
		postedAt: pending ? null : posted ?? null,
		transactedAt: epoch(raw.transacted_at),
	};
}

// ---------------------------------------------------------------- helpers

async function send(http: Http, request: Parameters<Http>[0]): Promise<HttpResponse> {
	try {
		return await http(request);
	} catch {
		throw new ProviderError('network', 'Couldn’t reach SimpleFIN. Check your internet connection and try again.');
	}
}

function unexpectedStatus(res: HttpResponse): ProviderError {
	if (res.status >= 500) {
		return new ProviderError('network', `SimpleFIN is having trouble right now (HTTP ${res.status}). Try again later.`);
	}
	return new ProviderError('bad-response', `SimpleFIN answered with an unexpected HTTP ${res.status}.`);
}

function authMessage(msg: string): string {
	return `SimpleFIN rejected PassBook’s access: ${msg}`;
}

function looksLikeRateLimit(msg: string): boolean {
	return /rate|limit|quota|too many/i.test(msg);
}

function isState(v: unknown): v is SimpleFinState {
	return isObject(v) && (v.lastEnd === undefined || typeof v.lastEnd === 'string');
}

function isRawError(v: unknown): v is RawError {
	return isObject(v) && typeof v.code === 'string' && typeof v.msg === 'string';
}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
	return typeof v === 'string' && v !== '' ? v : undefined;
}

/** A numeric string as sent; numbers are accepted and stringified without float math. */
function num(v: unknown): string | undefined {
	if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return v.trim();
	if (typeof v === 'number' && Number.isFinite(v)) return String(v);
	return undefined;
}

function epoch(v: unknown): string | undefined {
	const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
	if (!Number.isFinite(n) || n <= 0) return undefined;
	return new Date(n * 1000).toISOString();
}

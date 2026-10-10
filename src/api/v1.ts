// api.v1: PassBook's public, versioned API (docs/api.md). Reached as
// app.plugins.plugins.passbook.api.v1. Breaking changes need api.v2; additions are fine.
//
// It reads the ledger files on every call, so it works the same on devices that sync
// and devices that only receive the synced files. It never exposes secrets: nothing
// here can reach the provider, SecretStorage or the HTTP function.

import { UserFacingError } from '../errors';
import { LedgerData } from '../ledger/ledger';
import { Account, Balance, LastSync, SCHEMA_VERSION, Transaction, TransactionStatus } from '../ledger/schema';
import { SyncSummary } from '../sync/sync-now';

export interface TransactionQuery {
	/** Earliest `date` to include: `YYYY-MM-DD`, an ISO time, or a Date (its UTC day). */
	since?: string | Date;
	/** Latest `date` to include, same formats. Inclusive. */
	until?: string | Date;
	accountId?: string;
	status?: TransactionStatus;
}

/** What a sync did. Passed to sync-completed listeners and returned by sync(). */
export interface SyncResult {
	at: string;
	accounts: number;
	newTransactions: number;
	updatedTransactions: number;
	removedTransactions: number;
	newTransactionIds: string[];
	/** Readable problems that didn't stop the sync, e.g. a bank needing sign-in. */
	problems: string[];
}

export interface PassBookApiV1 {
	readonly version: 1;
	readonly schemaVersion: typeof SCHEMA_VERSION;
	/** Syncs now. Rejects with a readable message if it can't (not connected, not the sync device, limits). */
	sync(): Promise<SyncResult>;
	getAccounts(): Promise<Account[]>;
	getBalances(): Promise<Balance[]>;
	/** Sorted by date, oldest first. */
	getTransactions(query?: TransactionQuery): Promise<Transaction[]>;
	/** Transactions first seen in the most recent sync, from any device. */
	getNewSinceLastSync(): Promise<Transaction[]>;
	getLastSync(): Promise<LastSync | null>;
	/** Calls `listener` after each successful sync on this device. Returns an unsubscribe function. */
	onSyncCompleted(listener: (result: SyncResult) => void): () => void;
}

export interface ApiDeps {
	load(): Promise<LedgerData>;
	sync(): Promise<SyncSummary>;
}

export class InvalidQueryError extends UserFacingError {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidQueryError';
	}
}

export function toSyncResult(s: SyncSummary): SyncResult {
	return {
		at: s.at,
		accounts: s.accounts,
		newTransactions: s.newTransactions,
		updatedTransactions: s.updatedTransactions,
		removedTransactions: s.removedTransactions,
		newTransactionIds: [...s.newTransactionIds],
		problems: s.issues.map((i) => i.message),
	};
}

/** Builds api.v1. `listeners` is shared with the plugin, which calls them after a sync. */
export function createApiV1(deps: ApiDeps, listeners: Set<(r: SyncResult) => void>): PassBookApiV1 {
	const api: PassBookApiV1 = {
		version: 1,
		schemaVersion: SCHEMA_VERSION,
		sync: async () => toSyncResult(await deps.sync()),
		getAccounts: async () => copy(sortAccounts([...(await deps.load()).accounts.values()])),
		getBalances: async () =>
			sortAccounts([...(await deps.load()).accounts.values()]).map((a) => ({
				accountId: a.id,
				balance: a.balance,
				availableBalance: a.availableBalance,
				currency: a.currency,
				asOf: a.balanceAsOf,
			})),
		getTransactions: async (query = {}) => {
			const since = query.since === undefined ? undefined : toDay(query.since, 'since');
			const until = query.until === undefined ? undefined : toDay(query.until, 'until');
			const list = [...(await deps.load()).transactions.values()].filter(
				(t) =>
					(since === undefined || t.date >= since) &&
					(until === undefined || t.date <= until) &&
					(query.accountId === undefined || t.accountId === query.accountId) &&
					(query.status === undefined || t.status === query.status),
			);
			return copy(sortTransactions(list));
		},
		getNewSinceLastSync: async () => {
			const data = await deps.load();
			const ids = data.lastSync?.newTransactionIds ?? [];
			const found = ids.map((id) => data.transactions.get(id)).filter((t): t is Transaction => t !== undefined);
			return copy(sortTransactions(found));
		},
		getLastSync: async () => copy((await deps.load()).lastSync),
		onSyncCompleted: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
	return Object.freeze(api);
}

function toDay(value: string | Date, name: string): string {
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) throw new InvalidQueryError(`${name} is an invalid Date.`);
		return value.toISOString().slice(0, 10);
	}
	if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
	throw new InvalidQueryError(`${name} must be a date like 2026-10-01, an ISO time, or a Date.`);
}

function sortAccounts(list: Account[]): Account[] {
	return list.sort((a, b) => a.institution.localeCompare(b.institution) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function sortTransactions(list: Transaction[]): Transaction[] {
	return list.sort((a, b) => a.date.localeCompare(b.date) || a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id));
}

/** Callers get their own objects, so changing them can't affect PassBook or other callers. */
function copy<T>(value: T): T {
	return value === null ? value : (JSON.parse(JSON.stringify(value)) as T);
}

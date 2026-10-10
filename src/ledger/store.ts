// Reads and writes the ledger in the data folder (docs/schema.md, "Files"): JSON as the
// source of truth, plus an optional CSV mirror, in one of three folder layouts.
// Every device reads these files; only the sync device writes or moves them.

import { UserFacingError } from '../errors';
import { accountsCsv, transactionsCsv } from '../export/csv';
import { dirs, isLayout, Layout, marker, MARKER } from './layout';
import { emptyLedger, LedgerData, monthOf } from './ledger';
import { Account, AccountsFile, SCHEMA_VERSION, SyncFile, Transaction, TransactionsFile } from './schema';

/** File access relative to the vault root. Obsidian's adapter in the plugin; a map in tests. */
export interface Files {
	read(path: string): Promise<string | null>;
	/** Must leave either the old or the new content, never a partial file. */
	write(path: string, data: string): Promise<void>;
	/** Files (not folders) directly inside `folder`; [] if it doesn't exist. */
	list(folder: string): Promise<string[]>;
	remove(path: string): Promise<void>;
	/** Removes `folder` if it exists and is empty; otherwise does nothing. */
	removeFolderIfEmpty(folder: string): Promise<void>;
}

export interface StoreOptions {
	layout: Layout;
	csv: boolean;
}

export class LedgerReadError extends UserFacingError {
	constructor(message: string) {
		super(message);
		this.name = 'LedgerReadError';
	}
}

const MONTH_FILE = /^(\d{4}-\d{2})\.(json|csv)$/;
type Kind = 'json' | 'csv';

/** Everywhere a file of each kind can live, across all layouts. */
const CANDIDATE_DIRS: Record<Kind, string[]> = { json: ['', 'json/'], csv: ['', 'csv/'] };

export class LedgerStore {
	constructor(
		private readonly files: Files,
		private readonly folder: () => string,
		/** The layout and CSV setting to write with. */
		private readonly options: () => StoreOptions,
	) {}

	private path(name: string): string {
		return `${this.folder()}/${name}`;
	}

	/**
	 * The layout the files are actually in: the marker's, else a pre-marker flat
	 * folder, else the setting. Readers use this, so they find files mid-move too.
	 */
	async currentLayout(): Promise<Layout> {
		const text = await this.files.read(this.path(MARKER));
		if (text !== null) {
			try {
				const m = JSON.parse(text) as { layout?: unknown };
				if (isLayout(m.layout)) return m.layout;
			} catch {
				// fall through: a damaged marker is rebuilt on the next save
			}
		}
		if ((await this.files.read(this.path('accounts.json'))) !== null) return 'flat';
		return this.options().layout;
	}

	async load(): Promise<LedgerData> {
		const base = dirs(await this.currentLayout()).json;
		const data = emptyLedger();
		const accounts = await this.readJson<AccountsFile>(`${base}accounts.json`);
		for (const a of accounts?.accounts ?? []) data.accounts.set(a.id, a);
		const sync = await this.readJson<SyncFile>(`${base}sync.json`);
		data.lastSync = sync?.lastSync ?? null;

		for (const name of await this.monthFiles(`${base}transactions`, 'json')) {
			const month = await this.readJson<TransactionsFile>(`${base}transactions/${name}`);
			for (const t of month?.transactions ?? []) data.transactions.set(t.id, t);
		}
		return data;
	}

	/**
	 * Moves PassBook's files into the configured layout and records it in the marker.
	 * Sweeps every place each kind of file can be, so it finishes an interrupted move
	 * and is a no-op when everything is already in place. Touches nothing else in the
	 * folder. Only the sync device may call this. Returns the number of files moved.
	 */
	async relayout(): Promise<number> {
		// Always sweep rather than trusting the marker: after an interrupted move and a
		// switch back, the marker can name the target while files sit elsewhere.
		let moved = 0;
		const target = dirs(this.options().layout);
		for (const kind of ['json', 'csv'] as const) {
			for (const from of CANDIDATE_DIRS[kind]) {
				if (from === target[kind]) continue;
				moved += await this.moveKind(kind, from, target[kind]);
			}
		}
		// Only when there's something to describe: a fresh install gets its marker on the
		// first save, so a failed first sync doesn't leave an empty data folder behind.
		if (moved > 0 || (await this.files.read(this.path(MARKER))) !== null) await this.writeMarker();
		return moved;
	}

	/** Writes the JSON for `months`, accounts and sync, plus their CSV when enabled. */
	async save(data: LedgerData, months: Iterable<string>): Promise<void> {
		const { layout, csv } = this.options();
		const d = dirs(layout);
		const byMonth = groupByMonth(data);
		for (const month of new Set(months)) {
			const transactions = byMonth.get(month) ?? [];
			await this.writeMonthJson(`${d.json}transactions/${month}.json`, month, transactions);
			if (csv) await this.writeMonthCsv(`${d.csv}transactions/${month}.csv`, transactions, data.accounts);
		}
		const accounts = sortedAccounts(data);
		const accountsFile: AccountsFile = { schemaVersion: SCHEMA_VERSION, accounts };
		await this.files.write(this.path(`${d.json}accounts.json`), json(accountsFile));
		if (csv) await this.files.write(this.path(`${d.csv}accounts.csv`), accountsCsv(accounts));
		// After the transactions, so a reader never sees a "last sync" whose data isn't written yet.
		const sync: SyncFile = { schemaVersion: SCHEMA_VERSION, lastSync: data.lastSync };
		await this.files.write(this.path(`${d.json}sync.json`), json(sync));
		await this.writeMarker();
	}

	/** Writes the whole CSV mirror from `data` (CSV just turned on). Returns months written. */
	async writeAllCsv(data: LedgerData): Promise<number> {
		const d = dirs(this.options().layout);
		const byMonth = groupByMonth(data);
		for (const [month, transactions] of byMonth) {
			await this.writeMonthCsv(`${d.csv}transactions/${month}.csv`, transactions, data.accounts);
		}
		await this.files.write(this.path(`${d.csv}accounts.csv`), accountsCsv(sortedAccounts(data)));
		await this.writeMarker();
		return byMonth.size;
	}

	private async writeMarker(): Promise<void> {
		const { layout, csv } = this.options();
		await this.files.write(this.path(MARKER), json(marker(layout, csv)));
	}

	private async writeMonthJson(rel: string, month: string, transactions: Transaction[]): Promise<void> {
		const path = this.path(rel);
		if (transactions.length === 0) {
			await this.removeIfExists(path);
			return;
		}
		const file: TransactionsFile = { schemaVersion: SCHEMA_VERSION, month, transactions: [...transactions].sort(compareTransactions) };
		await this.files.write(path, json(file));
	}

	private async writeMonthCsv(rel: string, transactions: Transaction[], accounts: Map<string, Account>): Promise<void> {
		const path = this.path(rel);
		if (transactions.length === 0) {
			await this.removeIfExists(path);
			return;
		}
		await this.files.write(path, transactionsCsv([...transactions].sort(compareTransactions), accounts));
	}

	private async moveKind(kind: Kind, from: string, to: string): Promise<number> {
		const names = kind === 'json' ? ['accounts.json', 'sync.json'] : ['accounts.csv'];
		const months = (await this.monthFiles(`${from}transactions`, kind)).map((n) => `transactions/${n}`);
		let moved = 0;
		for (const name of [...names, ...months]) {
			const content = await this.files.read(this.path(`${from}${name}`));
			if (content === null) continue;
			// Write before remove: an interruption leaves a copy, never a loss.
			await this.files.write(this.path(`${to}${name}`), content);
			await this.files.remove(this.path(`${from}${name}`));
			moved++;
		}
		if (moved > 0) {
			await this.files.removeFolderIfEmpty(this.path(`${from}transactions`));
			if (from) await this.files.removeFolderIfEmpty(this.path(from.slice(0, -1)));
		}
		return moved;
	}

	private async monthFiles(folder: string, kind: Kind): Promise<string[]> {
		return (await this.files.list(this.path(folder)))
			.map((f) => f.slice(f.lastIndexOf('/') + 1))
			.filter((name) => MONTH_FILE.exec(name)?.[2] === kind);
	}

	private async removeIfExists(path: string): Promise<void> {
		if ((await this.files.read(path)) !== null) await this.files.remove(path);
	}

	private async readJson<T extends { schemaVersion: number }>(rel: string): Promise<T | null> {
		const path = this.path(rel);
		const text = await this.files.read(path);
		if (text === null) return null;
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			throw new LedgerReadError(`${path} isn’t valid JSON. If you edited it, undo the edit; otherwise run Sync now again.`);
		}
		const version = typeof parsed === 'object' && parsed !== null ? (parsed as { schemaVersion?: unknown }).schemaVersion : undefined;
		if (version !== SCHEMA_VERSION) {
			throw new LedgerReadError(
				version === undefined
					? `${path} has no schemaVersion, so PassBook won’t read it.`
					: `${path} uses schema version ${JSON.stringify(version)}, which this version of PassBook doesn’t understand. Update PassBook.`,
			);
		}
		return parsed as T;
	}
}

function groupByMonth(data: LedgerData): Map<string, Transaction[]> {
	const byMonth = new Map<string, Transaction[]>();
	for (const t of data.transactions.values()) {
		const m = monthOf(t.date);
		const list = byMonth.get(m) ?? [];
		list.push(t);
		byMonth.set(m, list);
	}
	return byMonth;
}

function sortedAccounts(data: LedgerData): Account[] {
	return [...data.accounts.values()].sort(compareAccounts);
}

const json = (value: unknown): string => JSON.stringify(value, null, '\t') + '\n';

function compareTransactions(a: Transaction, b: Transaction): number {
	return a.date.localeCompare(b.date) || a.accountId.localeCompare(b.accountId) || a.id.localeCompare(b.id);
}

function compareAccounts(a: Account, b: Account): number {
	return a.institution.localeCompare(b.institution) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

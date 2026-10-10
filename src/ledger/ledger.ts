// The ledger: PassBook's own copy of accounts and transactions, kept correct across
// syncs. Pure logic; ledger/store.ts reads and writes it.
//
// apply() takes a provider's FetchResult (ADR 0002) and:
// - upserts accounts and transactions, keeping firstSeenAt;
// - deletes explicit removals (cursor providers);
// - deletes anything inside a covered window that the result no longer lists (window
//   providers). That covers pending charges that post under a new ID.

import { FetchResult, ProviderId } from '../providers/types';
import { Account, LastSync, Transaction } from './schema';

export interface LedgerData {
	accounts: Map<string, Account>;
	transactions: Map<string, Transaction>;
	lastSync: LastSync | null;
}

export interface ApplyOutcome {
	newIds: string[];
	updatedIds: string[];
	removedIds: string[];
	/** Months (YYYY-MM) whose transaction files need rewriting. */
	dirtyMonths: Set<string>;
}

export function emptyLedger(): LedgerData {
	return { accounts: new Map(), transactions: new Map(), lastSync: null };
}

export function accountId(provider: ProviderId, connectionId: string, providerAccountId: string): string {
	return `${provider}:${connectionId}:${providerAccountId}`;
}

export function transactionId(account: string, providerTransactionId: string): string {
	return `${account}:${providerTransactionId}`;
}

export const monthOf = (date: string): string => date.slice(0, 7);

/** Applies one fetch to `data` in place. */
export function apply(data: LedgerData, result: FetchResult, provider: ProviderId, now: Date): ApplyOutcome {
	const at = now.toISOString();
	const out: ApplyOutcome = { newIds: [], updatedIds: [], removedIds: [], dirtyMonths: new Set() };

	// Provider account ID -> ledger account ID, from this result's accounts.
	const connections = new Map(result.connections.map((c) => [c.id, c]));
	const accountIds = new Map<string, string>();
	for (const a of result.accounts) {
		const id = accountId(provider, a.connectionId, a.id);
		accountIds.set(a.id, id);
		const connection = connections.get(a.connectionId);
		const existing = data.accounts.get(id);
		data.accounts.set(id, {
			id,
			name: a.name,
			institution: connection?.name ?? existing?.institution ?? a.connectionId,
			institutionDomain: connection?.institutionDomain ?? existing?.institutionDomain ?? null,
			currency: a.currency,
			balance: a.balance,
			availableBalance: a.availableBalance ?? null,
			balanceAsOf: a.balanceAsOf,
			lastSyncedAt: at,
		});
	}

	const seen = new Set<string>();
	for (const t of result.upserts) {
		const account = accountIds.get(t.accountId);
		if (!account) continue; // a transaction for an account the result didn't describe
		const id = transactionId(account, t.id);
		seen.add(id);
		const existing = data.transactions.get(id);
		const firstSeenAt = existing?.firstSeenAt ?? at;
		const next: Transaction = {
			id,
			accountId: account,
			amount: t.amount,
			currency: data.accounts.get(account)?.currency ?? 'USD',
			description: t.description,
			status: t.pending ? 'pending' : 'posted',
			date: (t.postedAt ?? t.transactedAt ?? firstSeenAt).slice(0, 10),
			postedAt: t.postedAt,
			transactedAt: t.transactedAt ?? null,
			firstSeenAt,
			updatedAt: existing?.updatedAt ?? at,
		};
		if (!existing) {
			out.newIds.push(id);
		} else if (!sameContent(existing, next)) {
			next.updatedAt = at;
			out.updatedIds.push(id);
			out.dirtyMonths.add(monthOf(existing.date));
		} else {
			continue;
		}
		out.dirtyMonths.add(monthOf(next.date));
		data.transactions.set(id, next);
	}

	const remove = (id: string) => {
		const t = data.transactions.get(id);
		if (!t) return;
		data.transactions.delete(id);
		out.removedIds.push(id);
		out.dirtyMonths.add(monthOf(t.date));
	};

	for (const r of result.removed) {
		const account = accountIds.get(r.accountId) ?? findAccount(data, provider, r.accountId);
		if (account) remove(transactionId(account, r.id));
	}

	// Coverage: per account, every window fully listed, and the newest window's end.
	const windows = new Map<string, { start: number; end: number }[]>();
	for (const c of result.coverage) {
		const account = accountIds.get(c.accountId);
		if (!account) continue;
		const list = windows.get(account) ?? [];
		list.push({ start: Date.parse(c.start), end: Date.parse(c.end) });
		windows.set(account, list);
	}
	for (const t of [...data.transactions.values()]) {
		const list = windows.get(t.accountId);
		if (!list || seen.has(t.id)) continue;
		if (t.status === 'posted' && t.postedAt) {
			const posted = Date.parse(t.postedAt);
			if (list.some((w) => posted >= w.start && posted < w.end)) remove(t.id);
		} else if (t.status === 'pending') {
			// Pending charges aren't tied to a posted date; any listing that reaches the
			// present would include them, so the newest covered window decides.
			const newest = Math.max(...list.map((w) => w.end));
			if (newest >= Date.parse(t.firstSeenAt)) remove(t.id);
		}
	}

	data.lastSync = { at, newTransactionIds: out.newIds };
	return out;
}

/** Ledger accounts for this provider whose provider-level ID matches. */
function findAccount(data: LedgerData, provider: ProviderId, providerAccountId: string): string | undefined {
	for (const id of data.accounts.keys()) {
		if (id.startsWith(`${provider}:`) && id.endsWith(`:${providerAccountId}`)) return id;
	}
	return undefined;
}

function sameContent(a: Transaction, b: Transaction): boolean {
	return (
		a.amount === b.amount &&
		a.description === b.description &&
		a.status === b.status &&
		a.date === b.date &&
		a.postedAt === b.postedAt &&
		a.transactedAt === b.transactedAt &&
		a.currency === b.currency
	);
}

/** Whether the ledger holds anything from this provider (a first sync if not). */
export function hasProviderData(data: LedgerData, provider: ProviderId): boolean {
	for (const id of data.accounts.keys()) if (id.startsWith(`${provider}:`)) return true;
	return false;
}

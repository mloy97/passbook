import { describe, expect, it } from 'vitest';
import { accountId, apply, emptyLedger, hasProviderData, LedgerData, transactionId } from '../../src/ledger/ledger';
import { Coverage, FetchResult, ProviderTransaction } from '../../src/providers/types';

const T0 = new Date('2026-10-01T12:00:00Z');
const T1 = new Date('2026-10-02T12:00:00Z');
const T2 = new Date('2026-10-03T12:00:00Z');
const ACCOUNT = accountId('simplefin', 'C1', 'A1');
const id = (tx: string) => transactionId(ACCOUNT, tx);

function tx(txId: string, over: Partial<ProviderTransaction> = {}): ProviderTransaction {
	return {
		id: txId,
		accountId: 'A1',
		amount: '-10.00',
		description: `TX ${txId}`,
		pending: false,
		postedAt: '2026-09-30T12:00:00.000Z',
		...over,
	};
}

function result(upserts: ProviderTransaction[], coverage: Omit<Coverage, 'accountId'>[] = [], removed: FetchResult['removed'] = []): FetchResult {
	return {
		connections: [{ id: 'C1', name: 'First Example Bank', institutionDomain: 'bank.test' }],
		accounts: [
			{ id: 'A1', connectionId: 'C1', name: 'Checking', currency: 'USD', balance: '100.00', balanceAsOf: '2026-10-01T00:00:00.000Z' },
		],
		upserts,
		removed,
		coverage: coverage.map((c) => ({ accountId: 'A1', ...c })),
		issues: [],
		state: null,
	};
}

const window = (start: string, end: string) => ({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
const SEPT = window('2026-09-01T00:00:00Z', '2026-10-01T12:00:00Z');

function ids(data: LedgerData): string[] {
	return [...data.transactions.keys()].sort();
}

describe('apply', () => {
	it('adds accounts and transactions in the public shape', () => {
		const data = emptyLedger();
		const out = apply(data, result([tx('1', { transactedAt: '2026-09-29T08:00:00.000Z' })], [SEPT]), 'simplefin', T0);

		expect(data.accounts.get(ACCOUNT)).toEqual({
			id: ACCOUNT,
			name: 'Checking',
			institution: 'First Example Bank',
			institutionDomain: 'bank.test',
			currency: 'USD',
			balance: '100.00',
			availableBalance: null,
			balanceAsOf: '2026-10-01T00:00:00.000Z',
			lastSyncedAt: T0.toISOString(),
		});
		expect(data.transactions.get(id('1'))).toEqual({
			id: id('1'),
			accountId: ACCOUNT,
			amount: '-10.00',
			currency: 'USD',
			description: 'TX 1',
			status: 'posted',
			date: '2026-09-30',
			postedAt: '2026-09-30T12:00:00.000Z',
			transactedAt: '2026-09-29T08:00:00.000Z',
			firstSeenAt: T0.toISOString(),
			updatedAt: T0.toISOString(),
		});
		expect(out.newIds).toEqual([id('1')]);
		expect(out.dirtyMonths).toEqual(new Set(['2026-09']));
		expect(data.lastSync).toEqual({ at: T0.toISOString(), newTransactionIds: [id('1')] });
	});

	it('dates a pending transaction by when it happened, else when first seen', () => {
		const data = emptyLedger();
		apply(
			data,
			result([
				tx('p1', { pending: true, postedAt: null, transactedAt: '2026-09-29T08:00:00.000Z' }),
				tx('p2', { pending: true, postedAt: null }),
			]),
			'simplefin',
			T0,
		);
		expect(data.transactions.get(id('p1'))?.date).toBe('2026-09-29');
		expect(data.transactions.get(id('p2'))).toMatchObject({ date: '2026-10-01', status: 'pending', postedAt: null });
	});

	it('updates in place, keeping firstSeenAt, and reports nothing for unchanged transactions', () => {
		const data = emptyLedger();
		apply(data, result([tx('1'), tx('2')], [SEPT]), 'simplefin', T0);
		const out = apply(data, result([tx('1', { amount: '-12.00' }), tx('2')], [SEPT]), 'simplefin', T1);

		expect(out).toMatchObject({ newIds: [], updatedIds: [id('1')], removedIds: [] });
		expect(data.transactions.get(id('1'))).toMatchObject({ amount: '-12.00', firstSeenAt: T0.toISOString(), updatedAt: T1.toISOString() });
		expect(data.transactions.get(id('2'))?.updatedAt).toBe(T0.toISOString());
		expect(data.lastSync?.newTransactionIds).toEqual([]);
	});

	it('replaces a pending charge that posts under a new ID', () => {
		const data = emptyLedger();
		apply(data, result([tx('p1', { pending: true, postedAt: null })], [SEPT]), 'simplefin', T0);
		const out = apply(data, result([tx('posted-1', { postedAt: '2026-10-02T09:00:00.000Z' })], [window('2026-09-27T00:00:00Z', '2026-10-02T12:00:00Z')]), 'simplefin', T1);

		expect(ids(data)).toEqual([id('posted-1')]);
		expect(out.removedIds).toEqual([id('p1')]);
		expect(out.newIds).toEqual([id('posted-1')]);
		expect(out.dirtyMonths).toEqual(new Set(['2026-10']));
	});

	it('keeps a pending charge that is still pending', () => {
		const data = emptyLedger();
		const pending = tx('p1', { pending: true, postedAt: null });
		apply(data, result([pending], [SEPT]), 'simplefin', T0);
		apply(data, result([pending], [SEPT]), 'simplefin', T1);
		expect(ids(data)).toEqual([id('p1')]);
	});

	it('handles the same charge posting under the same ID', () => {
		const data = emptyLedger();
		apply(data, result([tx('1', { pending: true, postedAt: null })], [SEPT]), 'simplefin', T0);
		const out = apply(data, result([tx('1', { postedAt: '2026-10-02T09:00:00.000Z' })], [SEPT]), 'simplefin', T1);
		expect(out.updatedIds).toEqual([id('1')]);
		expect(data.transactions.get(id('1'))).toMatchObject({ status: 'posted', date: '2026-10-02', firstSeenAt: T0.toISOString() });
		expect(out.dirtyMonths).toEqual(new Set(['2026-10']));
	});

	it('removes a posted transaction that vanished from a covered window', () => {
		const data = emptyLedger();
		apply(data, result([tx('1'), tx('2')], [SEPT]), 'simplefin', T0);
		const out = apply(data, result([tx('1')], [SEPT]), 'simplefin', T1);
		expect(ids(data)).toEqual([id('1')]);
		expect(out.removedIds).toEqual([id('2')]);
	});

	it('never removes outside a covered window', () => {
		const data = emptyLedger();
		apply(data, result([tx('old', { postedAt: '2026-08-15T12:00:00.000Z' }), tx('1')], [window('2026-08-01T00:00:00Z', '2026-10-01T12:00:00Z')]), 'simplefin', T0);
		// A normal incremental sync covers only the last few days.
		apply(data, result([tx('1')], [window('2026-09-26T00:00:00Z', '2026-10-02T12:00:00Z')]), 'simplefin', T1);
		expect(ids(data)).toEqual([id('1'), id('old')]);
	});

	it('removes nothing for an account with no coverage (e.g. a failed connection)', () => {
		const data = emptyLedger();
		apply(data, result([tx('1'), tx('p', { pending: true, postedAt: null })], [SEPT]), 'simplefin', T0);
		apply(data, result([], []), 'simplefin', T1);
		expect(ids(data)).toEqual([id('1'), id('p')]);
	});

	it('never duplicates across overlapping windows', () => {
		const data = emptyLedger();
		apply(data, result([tx('1'), tx('2')], [SEPT]), 'simplefin', T0);
		const out = apply(data, result([tx('1'), tx('2'), tx('3', { postedAt: '2026-10-02T09:00:00.000Z' })], [window('2026-09-26T00:00:00Z', '2026-10-02T12:00:00Z')]), 'simplefin', T1);
		expect(ids(data)).toEqual([id('1'), id('2'), id('3')]);
		expect(out.newIds).toEqual([id('3')]);
	});

	it('picks up a late-posting charge dated inside an already-synced period', () => {
		const data = emptyLedger();
		apply(data, result([tx('1')], [SEPT]), 'simplefin', T0);
		// Posted on Sep 29 but only showed up after the Oct 1 sync; the 5-day overlap catches it.
		const late = tx('late', { postedAt: '2026-09-29T12:00:00.000Z' });
		const out = apply(data, result([tx('1'), late], [window('2026-09-26T12:00:00Z', '2026-10-02T12:00:00Z')]), 'simplefin', T1);
		expect(out.newIds).toEqual([id('late')]);
		expect(data.transactions.get(id('late'))?.date).toBe('2026-09-29');
	});

	it('applies explicit removals from cursor providers', () => {
		const data = emptyLedger();
		apply(data, result([tx('1'), tx('2')]), 'simplefin', T0);
		const out = apply(data, result([], [], [{ accountId: 'A1', id: '2' }]), 'simplefin', T1);
		expect(ids(data)).toEqual([id('1')]);
		expect(out.removedIds).toEqual([id('2')]);
	});

	it('keeps an account that disappears, with its last sync time', () => {
		const data = emptyLedger();
		apply(data, result([]), 'simplefin', T0);
		const empty = result([]);
		empty.accounts = [];
		apply(data, empty, 'simplefin', T2);
		expect(data.accounts.get(ACCOUNT)?.lastSyncedAt).toBe(T0.toISOString());
	});

	it('knows whether a provider has synced before', () => {
		const data = emptyLedger();
		expect(hasProviderData(data, 'simplefin')).toBe(false);
		apply(data, result([]), 'simplefin', T0);
		expect(hasProviderData(data, 'simplefin')).toBe(true);
		expect(hasProviderData(data, 'plaid')).toBe(false);
	});
});

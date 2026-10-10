import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createApiV1, InvalidQueryError, SyncResult } from '../../src/api/v1';
import { accountId, apply, emptyLedger, transactionId } from '../../src/ledger/ledger';
import PassBookPlugin from '../../src/main';
import { SIMPLEFIN_SECRET_ID } from '../../src/providers/simplefin';
import { FetchResult } from '../../src/providers/types';
import { fakeApp } from '../mocks/app';
import { fakeHttp, json } from '../providers/fakes';

const NOW = new Date('2026-10-09T12:00:00Z');
const CHK = accountId('simplefin', 'C1', 'A1');
const CARD = accountId('simplefin', 'C2', 'A2');

function seeded() {
	const data = emptyLedger();
	const result: FetchResult = {
		connections: [
			{ id: 'C1', name: 'Bank' },
			{ id: 'C2', name: 'Card Co' },
		],
		accounts: [
			{ id: 'A1', connectionId: 'C1', name: 'Checking', currency: 'USD', balance: '100.00', availableBalance: '90.00', balanceAsOf: NOW.toISOString() },
			{ id: 'A2', connectionId: 'C2', name: 'Card', currency: 'USD', balance: '-50.00', balanceAsOf: NOW.toISOString() },
		],
		upserts: [
			{ id: '3', accountId: 'A1', amount: '-3.00', description: 'three', pending: false, postedAt: '2026-10-03T12:00:00.000Z' },
			{ id: '1', accountId: 'A1', amount: '-1.00', description: 'one', pending: false, postedAt: '2026-10-01T12:00:00.000Z' },
			{ id: 'p', accountId: 'A2', amount: '-9.00', description: 'pending', pending: true, postedAt: null },
			{ id: '2', accountId: 'A2', amount: '-2.00', description: 'two', pending: false, postedAt: '2026-10-02T12:00:00.000Z' },
		],
		removed: [],
		coverage: [],
		issues: [],
		state: null,
	};
	apply(data, result, 'simplefin', new Date('2026-10-05T12:00:00Z'));
	// A later sync that only brought in one new transaction.
	apply(data, { ...result, upserts: [...result.upserts, { id: '4', accountId: 'A1', amount: '4.00', description: 'four', pending: false, postedAt: '2026-10-08T12:00:00.000Z' }] }, 'simplefin', NOW);
	return data;
}

function api(data = seeded()) {
	const listeners = new Set<(r: SyncResult) => void>();
	const v1 = createApiV1(
		{
			load: async () => data,
			sync: async () => ({ at: NOW.toISOString(), accounts: 2, newTransactions: 0, updatedTransactions: 0, removedTransactions: 0, newTransactionIds: [], issues: [] }),
		},
		listeners,
	);
	return { v1, listeners };
}

describe('api.v1', () => {
	it('says which versions it speaks', () => {
		const { v1 } = api();
		expect(v1.version).toBe(1);
		expect(v1.schemaVersion).toBe(1);
	});

	it('getAccounts returns every account, sorted by institution', async () => {
		const accounts = await api().v1.getAccounts();
		expect(accounts.map((a) => [a.institution, a.name])).toEqual([
			['Bank', 'Checking'],
			['Card Co', 'Card'],
		]);
	});

	it('getBalances returns one balance per account', async () => {
		expect(await api().v1.getBalances()).toEqual([
			{ accountId: CHK, balance: '100.00', availableBalance: '90.00', currency: 'USD', asOf: NOW.toISOString() },
			{ accountId: CARD, balance: '-50.00', availableBalance: null, currency: 'USD', asOf: NOW.toISOString() },
		]);
	});

	it('getTransactions returns everything oldest first', async () => {
		const all = await api().v1.getTransactions();
		expect(all.map((t) => t.description)).toEqual(['one', 'two', 'three', 'pending', 'four']);
	});

	it.each([
		['since and until, inclusive', { since: '2026-10-02', until: '2026-10-03' }, ['two', 'three']],
		['an ISO time as since', { since: '2026-10-03T23:59:00Z' }, ['three', 'pending', 'four']],
		['a Date as until', { until: new Date('2026-10-01T00:00:00Z') }, ['one']],
		['an account', { accountId: CARD }, ['two', 'pending']],
		['a status', { status: 'pending' as const }, ['pending']],
	])('getTransactions filters by %s', async (_, query, expected) => {
		expect((await api().v1.getTransactions(query)).map((t) => t.description)).toEqual(expected);
	});

	it.each([['yesterday'], [new Date('nope')]])('getTransactions rejects a bad date (%s)', async (since) => {
		await expect(api().v1.getTransactions({ since })).rejects.toThrow(InvalidQueryError);
	});

	it('getNewSinceLastSync returns what the last sync added', async () => {
		const fresh = await api().v1.getNewSinceLastSync();
		expect(fresh.map((t) => t.id)).toEqual([transactionId(CHK, '4')]);
	});

	it('getLastSync reports when and what', async () => {
		expect(await api().v1.getLastSync()).toEqual({ at: NOW.toISOString(), newTransactionIds: [transactionId(CHK, '4')] });
		expect(await api(emptyLedger()).v1.getLastSync()).toBeNull();
	});

	it('hands out copies, so callers can’t change PassBook’s data', async () => {
		const { v1 } = api();
		const [first] = await v1.getTransactions();
		if (first) first.amount = '999.00';
		expect((await v1.getTransactions())[0]?.amount).toBe('-1.00');
	});

	it('is frozen', () => {
		const { v1 } = api();
		expect(Object.isFrozen(v1)).toBe(true);
	});

	it('maps a sync to a public result, with problems as text', async () => {
		const listeners = new Set<(r: SyncResult) => void>();
		const v1 = createApiV1(
			{
				load: async () => emptyLedger(),
				sync: async () => ({
					at: NOW.toISOString(),
					accounts: 1,
					newTransactions: 2,
					updatedTransactions: 0,
					removedTransactions: 1,
					newTransactionIds: ['a', 'b'],
					issues: [{ kind: 'connection-auth', message: 'Sign in again.', connectionId: 'C1' }],
				}),
			},
			listeners,
		);
		expect(await v1.sync()).toEqual({
			at: NOW.toISOString(),
			accounts: 1,
			newTransactions: 2,
			updatedTransactions: 0,
			removedTransactions: 1,
			newTransactionIds: ['a', 'b'],
			problems: ['Sign in again.'],
		});
	});

	it('registers and unregisters sync listeners', () => {
		const { v1, listeners } = api();
		const off = v1.onSyncCompleted(() => {});
		expect(listeners.size).toBe(1);
		off();
		expect(listeners.size).toBe(0);
	});
});

describe('api.v1 on the plugin', () => {
	const fixture: unknown = JSON.parse(readFileSync(new URL('../fixtures/simplefin/accounts-v2.json', import.meta.url), 'utf8'));
	const ACCESS_URL = 'https://user123:s3cret@sfin.example.test/simplefin';

	async function plugin() {
		const app = fakeApp();
		const p = new PassBookPlugin(app as never, { dir: '.obsidian/plugins/passbook' } as never);
		await p.onload();
		app.secrets.set(SIMPLEFIN_SECRET_ID, ACCESS_URL);
		return { app, p };
	}

	it('syncs, fires the event and the listeners once, and reads the result back', async () => {
		const { app, p } = await plugin();
		p.http = fakeHttp(json(fixture));
		const heard: SyncResult[] = [];
		p.api.v1.onSyncCompleted((r) => heard.push(r));

		const result = await p.api.v1.sync();

		expect(result.newTransactions).toBe(4);
		expect(heard).toEqual([result]);
		expect(app.events).toEqual([{ name: 'passbook:sync-completed', data: [result] }]);
		expect(await p.api.v1.getAccounts()).toHaveLength(2);
		expect(await p.api.v1.getNewSinceLastSync()).toHaveLength(4);
	});

	it('shares one sync between overlapping calls', async () => {
		const { app, p } = await plugin();
		p.http = fakeHttp(json(fixture));
		const [a, b] = await Promise.all([p.api.v1.sync(), p.api.v1.sync()]);
		expect(a).toEqual(b);
		expect(app.events).toHaveLength(1);
	});

	it('rejects with a readable error and fires nothing when sync fails', async () => {
		const { app, p } = await plugin();
		p.http = fakeHttp(json('', 403));
		await expect(p.api.v1.sync()).rejects.toThrow(/rejected PassBook’s access/);
		expect(app.events).toHaveLength(0);
	});

	it('keeps going when a listener throws', async () => {
		const { app, p } = await plugin();
		p.http = fakeHttp(json(fixture));
		p.api.v1.onSyncCompleted(() => {
			throw new Error('listener bug');
		});
		const heard: unknown[] = [];
		p.api.v1.onSyncCompleted((r) => heard.push(r));
		const original = console.error;
		console.error = () => {};
		try {
			await p.api.v1.sync();
		} finally {
			console.error = original;
		}
		expect(heard).toHaveLength(1);
		expect(app.events).toHaveLength(1);
	});

	it('never returns a secret, and exposes nothing that could reach one', async () => {
		const { p } = await plugin();
		p.http = fakeHttp(json(fixture));
		const v1 = p.api.v1;
		const results = [await v1.sync(), await v1.getAccounts(), await v1.getBalances(), await v1.getTransactions(), await v1.getNewSinceLastSync(), await v1.getLastSync()];
		const text = JSON.stringify(results);
		expect(text).not.toContain('s3cret');
		expect(text).not.toContain('user123');
		expect(text).not.toContain('sfin.example.test');
		expect(Object.keys(v1).sort()).toEqual([
			'getAccounts',
			'getBalances',
			'getLastSync',
			'getNewSinceLastSync',
			'getTransactions',
			'onSyncCompleted',
			'schemaVersion',
			'sync',
			'version',
		]);
	});
});

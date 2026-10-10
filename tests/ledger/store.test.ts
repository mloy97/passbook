import { describe, expect, it } from 'vitest';
import { accountId, apply, emptyLedger } from '../../src/ledger/ledger';
import { SCHEMA_VERSION } from '../../src/ledger/schema';
import { LedgerReadError, LedgerStore } from '../../src/ledger/store';
import { FetchResult } from '../../src/providers/types';
import { memoryFiles } from '../mocks/files';

const FLAT = () => ({ layout: 'flat' as const, csv: false });
const NOW = new Date('2026-10-09T12:00:00Z');

function fetchResult(): FetchResult {
	return {
		connections: [{ id: 'C1', name: 'Bank' }],
		accounts: [{ id: 'A1', connectionId: 'C1', name: 'Checking', currency: 'USD', balance: '5.00', balanceAsOf: NOW.toISOString() }],
		upserts: [
			{ id: '1', accountId: 'A1', amount: '-1.00', description: 'one', pending: false, postedAt: '2026-09-30T12:00:00.000Z' },
			{ id: '2', accountId: 'A1', amount: '-2.00', description: 'two', pending: false, postedAt: '2026-10-01T12:00:00.000Z' },
		],
		removed: [],
		coverage: [],
		issues: [],
		state: null,
	};
}

describe('LedgerStore', () => {
	it('writes one file per month plus accounts and sync, and reads them back', async () => {
		const files = memoryFiles();
		const store = new LedgerStore(files, () => 'PassBook', FLAT);
		const data = emptyLedger();
		const out = apply(data, fetchResult(), 'simplefin', NOW);

		await store.save(data, out.dirtyMonths);

		expect([...files.data.keys()].sort()).toEqual([
			'PassBook/accounts.json',
			'PassBook/passbook.json',
			'PassBook/sync.json',
			'PassBook/transactions/2026-09.json',
			'PassBook/transactions/2026-10.json',
		]);
		const september = JSON.parse(files.data.get('PassBook/transactions/2026-09.json') ?? '') as { schemaVersion: number; month: string };
		expect(september).toMatchObject({ schemaVersion: SCHEMA_VERSION, month: '2026-09' });
		const back = await store.load();
		expect(back).toEqual(data);
	});

	it('rewrites only the months that changed', async () => {
		const files = memoryFiles();
		const store = new LedgerStore(files, () => 'PassBook', FLAT);
		const data = emptyLedger();
		await store.save(data, apply(data, fetchResult(), 'simplefin', NOW).dirtyMonths);
		files.writes.length = 0;

		const next = fetchResult();
		next.upserts[1] = { ...next.upserts[1]!, amount: '-3.00' };
		await store.save(data, apply(data, next, 'simplefin', NOW).dirtyMonths);

		expect(files.writes).toEqual(['PassBook/transactions/2026-10.json', 'PassBook/accounts.json', 'PassBook/sync.json', 'PassBook/passbook.json']);
	});

	it('deletes a month file once its last transaction is removed', async () => {
		const files = memoryFiles();
		const store = new LedgerStore(files, () => 'PassBook', FLAT);
		const data = emptyLedger();
		await store.save(data, apply(data, fetchResult(), 'simplefin', NOW).dirtyMonths);

		const next = fetchResult();
		next.upserts = [];
		next.removed = [{ accountId: 'A1', id: '1' }];
		await store.save(data, apply(data, next, 'simplefin', NOW).dirtyMonths);

		expect(files.data.has('PassBook/transactions/2026-09.json')).toBe(false);
		expect(files.data.has('PassBook/transactions/2026-10.json')).toBe(true);
	});

	it('reads an empty or missing folder as an empty ledger', async () => {
		const data = await new LedgerStore(memoryFiles(), () => 'PassBook', FLAT).load();
		expect(data).toEqual(emptyLedger());
	});

	it('follows the folder setting', async () => {
		let folder = 'Finance/PassBook';
		const files = memoryFiles();
		const store = new LedgerStore(files, () => folder, FLAT);
		await store.save(emptyLedger(), []);
		expect(files.data.has('Finance/PassBook/accounts.json')).toBe(true);
		folder = 'Elsewhere';
		expect((await store.load()).accounts.size).toBe(0);
	});

	it.each([
		['no schemaVersion', '{"accounts": []}', /has no schemaVersion/],
		['a newer schemaVersion', '{"schemaVersion": 2, "accounts": []}', /schema version 2/],
		['invalid JSON', '{"schemaVersion": 1,', /isn’t valid JSON/],
	])('refuses a file with %s', async (_, content, message) => {
		const files = memoryFiles({ 'PassBook/accounts.json': content });
		await expect(new LedgerStore(files, () => 'PassBook', FLAT).load()).rejects.toThrow(LedgerReadError);
		await expect(new LedgerStore(files, () => 'PassBook', FLAT).load()).rejects.toThrow(message);
	});

	it('ignores stray files in the transactions folder', async () => {
		const files = memoryFiles({ 'PassBook/transactions/notes.md': 'hello', 'PassBook/transactions/2026-10.json.tmp': '{' });
		await expect(new LedgerStore(files, () => 'PassBook', FLAT).load()).resolves.toEqual(emptyLedger());
	});

	it('uses stable account IDs', () => {
		expect(accountId('simplefin', 'C1', 'A1')).toBe('simplefin:C1:A1');
	});
});

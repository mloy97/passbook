import { describe, expect, it } from 'vitest';
import { Layout, LAYOUTS } from '../../src/ledger/layout';
import { apply, emptyLedger, LedgerData } from '../../src/ledger/ledger';
import { Files, LedgerStore, StoreOptions } from '../../src/ledger/store';
import { FetchResult } from '../../src/providers/types';
import { memoryFiles } from '../mocks/files';

const NOW = new Date('2026-10-09T12:00:00Z');

function seeded(): { data: LedgerData; months: Set<string> } {
	const data = emptyLedger();
	const result: FetchResult = {
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
	const out = apply(data, result, 'simplefin', NOW);
	return { data, months: out.dirtyMonths };
}

/** The PassBook files a layout should produce for the seeded data. */
function expected(layout: Layout, csv: boolean): string[] {
	const j = layout === 'split' ? 'json/' : '';
	const c = layout === 'flat' ? '' : 'csv/';
	const files = [`${j}accounts.json`, `${j}sync.json`, `${j}transactions/2026-09.json`, `${j}transactions/2026-10.json`, 'passbook.json'];
	if (csv) files.push(`${c}accounts.csv`, `${c}transactions/2026-09.csv`, `${c}transactions/2026-10.csv`);
	return files.map((f) => `PassBook/${f}`).sort();
}

const OTHER_FILES = { 'PassBook/notes.md': 'mine', 'PassBook/exports/transactions-2026-10-01.csv': 'export', 'PassBook/transactions/README.md': 'mine too' };

function setup(options: StoreOptions, initial: Record<string, string> = {}) {
	const files = memoryFiles(initial);
	const opts = { ...options };
	const store = new LedgerStore(files, () => 'PassBook', () => opts);
	const passbookFiles = () => [...files.data.keys()].filter((k) => !(k in OTHER_FILES)).sort();
	return { files, opts, store, passbookFiles };
}

describe('layouts', () => {
	for (const layout of LAYOUTS) {
		for (const csv of [false, true]) {
			it(`${layout}, CSV ${csv ? 'on' : 'off'}: writes the right files and reads them back`, async () => {
				const { store, passbookFiles } = setup({ layout, csv });
				const { data, months } = seeded();
				await store.save(data, months);
				expect(passbookFiles()).toEqual(expected(layout, csv));
				expect(await store.load()).toEqual(data);
			});
		}
	}

	it('records the layout in passbook.json', async () => {
		const { store, files } = setup({ layout: 'split', csv: true });
		const { data, months } = seeded();
		await store.save(data, months);
		expect(JSON.parse(files.data.get('PassBook/passbook.json') ?? '')).toEqual({ schemaVersion: 1, layout: 'split', json: 'json/', csv: 'csv/' });
	});

	it('writes CSV with every column, readable as a table', async () => {
		const { store, files } = setup({ layout: 'split', csv: true });
		const { data, months } = seeded();
		await store.save(data, months);
		const [header, row] = (files.data.get('PassBook/csv/transactions/2026-10.csv') ?? '').split('\r\n');
		expect(header).toBe('date,account,institution,description,amount,currency,status,posted_at,transacted_at,first_seen_at,updated_at,account_id,transaction_id');
		expect(row).toMatch(/^2026-10-01,Checking,Bank,two,-2\.00,USD,posted,/);
		expect(files.data.get('PassBook/csv/accounts.csv')?.split('\r\n')[0]).toBe(
			'institution,name,balance,available_balance,currency,balance_as_of,last_synced_at,institution_domain,account_id',
		);
	});

	it('rewrites only the CSV of months that changed, and removes an emptied month’s CSV', async () => {
		const { store, files } = setup({ layout: 'split', csv: true });
		const { data, months } = seeded();
		await store.save(data, months);
		files.writes.length = 0;

		data.transactions.delete('simplefin:C1:A1:1'); // September empties
		await store.save(data, ['2026-09']);

		expect(files.writes.filter((w) => w.includes('/transactions/'))).toEqual([]);
		expect(files.data.has('PassBook/json/transactions/2026-09.json')).toBe(false);
		expect(files.data.has('PassBook/csv/transactions/2026-09.csv')).toBe(false);
		expect(files.data.has('PassBook/csv/transactions/2026-10.csv')).toBe(true);
	});

	it('fills in CSV for all existing data when turned on', async () => {
		const { store, opts, passbookFiles } = setup({ layout: 'split', csv: false });
		const { data, months } = seeded();
		await store.save(data, months);
		opts.csv = true;
		expect(await store.writeAllCsv(data)).toBe(2);
		expect(passbookFiles()).toEqual(expected('split', true));
	});
});

describe('switching layouts', () => {
	for (const from of LAYOUTS) {
		for (const to of LAYOUTS) {
			if (from === to) continue;
			it(`${from} → ${to} moves every PassBook file, keeps all data, and leaves other files alone`, async () => {
				const { store, opts, files, passbookFiles } = setup({ layout: from, csv: true }, OTHER_FILES);
				const { data, months } = seeded();
				await store.save(data, months);

				opts.layout = to;
				const moved = await store.relayout();

				expect(moved).toBeGreaterThan(0);
				expect(passbookFiles()).toEqual(expected(to, true));
				expect(await store.load()).toEqual(data);
				for (const [k, v] of Object.entries(OTHER_FILES)) expect(files.data.get(k)).toBe(v);
				expect(await store.relayout()).toBe(0); // nothing left to move
			});
		}
	}

	it('finishes an interrupted move on the next run', async () => {
		const { store, opts, files, passbookFiles } = setup({ layout: 'flat', csv: true });
		const { data, months } = seeded();
		await store.save(data, months);

		opts.layout = 'split';
		const remove = files.remove.bind(files);
		let removes = 0;
		files.remove = async (path) => {
			if (++removes === 3) throw new Error('crash');
			await remove(path);
		};
		await expect(store.relayout()).rejects.toThrow('crash');
		files.remove = remove;

		await store.relayout();
		expect(passbookFiles()).toEqual(expected('split', true));
		expect(await store.load()).toEqual(data);
	});

	it('gathers everything back after an interrupted move and a switch back', async () => {
		const { store, opts, files, passbookFiles } = setup({ layout: 'split', csv: true });
		const { data, months } = seeded();
		await store.save(data, months);

		opts.layout = 'flat';
		const write = files.write.bind(files);
		let writes = 0;
		files.write = async (path, content) => {
			if (++writes === 4) throw new Error('crash');
			await write(path, content);
		};
		await expect(store.relayout()).rejects.toThrow('crash');
		files.write = write;

		opts.layout = 'split'; // the user changes their mind
		await store.relayout();
		expect(passbookFiles()).toEqual(expected('split', true));
		expect(await store.load()).toEqual(data);
	});

	it('reads a pre-marker flat folder, and moves it into the configured layout', async () => {
		const flat = setup({ layout: 'flat', csv: false });
		const { data, months } = seeded();
		await flat.store.save(data, months);
		flat.files.data.delete('PassBook/passbook.json'); // written before markers existed

		const { store, passbookFiles } = setup({ layout: 'split', csv: false }, Object.fromEntries(flat.files.data));
		expect(await store.currentLayout()).toBe('flat');
		expect(await store.load()).toEqual(data);
		await store.relayout();
		expect(passbookFiles()).toEqual(expected('split', false));
	});

	it('lets a device that doesn’t move files still read them where they are', async () => {
		const { store, opts } = setup({ layout: 'csv-subfolder', csv: false });
		const { data, months } = seeded();
		await store.save(data, months);
		opts.layout = 'split'; // changed on this device, but the move belongs to the sync device
		expect(await store.load()).toEqual(data);
	});

	it('writes nothing on a fresh install', async () => {
		const { store, files } = setup({ layout: 'split', csv: true });
		expect(await store.relayout()).toBe(0);
		expect(files.data.size).toBe(0);
	});

	it('removes folders a move leaves empty', async () => {
		const files = memoryFiles();
		const emptied: string[] = [];
		const tracked: Files = { ...files, removeFolderIfEmpty: async (f) => void emptied.push(f) };
		const opts: StoreOptions = { layout: 'split', csv: true };
		const store = new LedgerStore(tracked, () => 'PassBook', () => opts);
		const { data, months } = seeded();
		await store.save(data, months);
		opts.layout = 'flat';
		await store.relayout();
		expect(emptied).toEqual(['PassBook/json/transactions', 'PassBook/json', 'PassBook/csv/transactions', 'PassBook/csv']);
	});
});

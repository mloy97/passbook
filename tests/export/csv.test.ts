import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { exportCsv, openDataFolder, openSettings } from '../../src/commands';
import { transactionsCsv } from '../../src/export/csv';
import { Account, Transaction } from '../../src/ledger/schema';
import PassBookPlugin from '../../src/main';
import { SIMPLEFIN_SECRET_ID } from '../../src/providers/simplefin';
import { fakeApp } from '../mocks/app';
import { Notice, TFolder } from '../mocks/obsidian';
import { fakeHttp, json } from '../providers/fakes';

const account: Account = {
	id: 'simplefin:C1:A1',
	name: 'Checking, joint',
	institution: 'Bank "One"',
	institutionDomain: null,
	currency: 'USD',
	balance: '1.00',
	availableBalance: null,
	balanceAsOf: '2026-10-09T00:00:00.000Z',
	lastSyncedAt: '2026-10-09T00:00:00.000Z',
};

const base: Transaction = {
	id: 'simplefin:C1:A1:1',
	accountId: account.id,
	amount: '-42.50',
	currency: 'USD',
	description: 'GROCERY MART #12',
	status: 'posted',
	date: '2026-10-01',
	postedAt: '2026-10-01T12:00:00.000Z',
	transactedAt: null,
	firstSeenAt: '2026-10-02T00:00:00.000Z',
	updatedAt: '2026-10-02T00:00:00.000Z',
};

describe('transactionsCsv', () => {
	it('matches the golden file: quoting, escaping and formula guarding', () => {
		const csv = transactionsCsv(
			[
				base,
				{ ...base, id: 'simplefin:C1:A1:2', description: 'Line one\nline two, with "quotes"', amount: '100.00', transactedAt: '2026-09-30T08:00:00.000Z' },
				{ ...base, id: 'simplefin:C1:A1:3', description: '=HYPERLINK("http://evil.test")', status: 'pending', postedAt: null },
				{ ...base, id: 'simplefin:C1:A1:4', accountId: 'gone', description: '@SUM(A1)' },
			],
			new Map([[account.id, account]]),
		);
		const golden = readFileSync(new URL('../fixtures/export/transactions.csv', import.meta.url), 'utf8');
		expect(csv).toBe(golden);
	});

	it('writes just the header for no transactions', () => {
		expect(transactionsCsv([], new Map())).toBe(
			'date,account,institution,description,amount,currency,status,posted_at,transacted_at,first_seen_at,updated_at,account_id,transaction_id\r\n',
		);
	});
});

describe('commands', () => {
	const fixture: unknown = JSON.parse(readFileSync(new URL('../fixtures/simplefin/accounts-v2.json', import.meta.url), 'utf8'));

	beforeEach(() => {
		Notice.shown.length = 0;
	});

	async function plugin() {
		const app = fakeApp();
		const p = new PassBookPlugin(app as never, { id: 'passbook', dir: '.obsidian/plugins/passbook' } as never);
		await p.onload();
		return { app, p };
	}

	async function synced() {
		const ctx = await plugin();
		ctx.app.secrets.set(SIMPLEFIN_SECRET_ID, 'https://u:p@sfin.example.test/simplefin');
		ctx.p.http = fakeHttp(json(fixture));
		await ctx.p.syncNow();
		Notice.shown.length = 0;
		return ctx;
	}

	it('registers all five commands with stable IDs', async () => {
		const { p } = await plugin();
		const commands = (p as unknown as { commands: { id: string; name: string }[] }).commands;
		expect(commands.map((c) => [c.id, c.name])).toEqual([
			['sync-now', 'Sync now'],
			['connect', 'Connect provider'],
			['export-csv', 'Export transactions to CSV'],
			['open-data-folder', 'Open data folder'],
			['copy-diagnostics', 'Copy diagnostic summary'],
		]);
	});

	it('exports every transaction to the data folder', async () => {
		const { app, p } = await synced();
		const path = await exportCsv(p, new Date('2026-10-09T12:00:00Z'));
		expect(path).toBe('PassBook/exports/transactions-2026-10-09.csv');
		const csv = app.files.get(path ?? '') ?? '';
		expect(csv.split('\r\n').filter(Boolean)).toHaveLength(5); // header + 4
		expect(Notice.shown[0]?.message).toBe('Exported 4 transactions to PassBook/exports/transactions-2026-10-09.csv.');
	});

	it('says there is nothing to export before the first sync', async () => {
		const { app, p } = await plugin();
		expect(await exportCsv(p)).toBeUndefined();
		expect(app.files.size).toBe(0);
		expect(Notice.shown[0]?.message).toMatch(/no transactions to export/);
	});

	it('opens the data folder in the file explorer', async () => {
		const { app, p } = await synced();
		const revealed: unknown[] = [];
		app.leaves.push({ type: 'file-explorer', view: { revealInFolder: (f: unknown) => revealed.push(f) } });
		openDataFolder(p);
		expect(revealed).toEqual([new TFolder('PassBook')]);
	});

	it('names the folder when there is no file explorer', async () => {
		const { p } = await synced();
		openDataFolder(p);
		expect(Notice.shown[0]?.message).toBe('PassBook’s data is in PassBook.');
	});

	it('says the data folder does not exist before the first sync', async () => {
		const { p } = await plugin();
		openDataFolder(p);
		expect(Notice.shown[0]?.message).toMatch(/doesn’t exist yet/);
	});

	it('opens PassBook’s settings to connect', async () => {
		const { app, p } = await plugin();
		const calls: string[] = [];
		Object.assign(app, { setting: { open: () => calls.push('open'), openTabById: (id: string) => calls.push(id) } });
		openSettings(p);
		expect(calls).toEqual(['open', 'passbook']);
	});
});

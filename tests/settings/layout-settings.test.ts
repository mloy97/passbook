import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import PassBookPlugin from '../../src/main';
import { SIMPLEFIN_SECRET_ID } from '../../src/providers/simplefin';
import { fakeApp } from '../mocks/app';
import { fakeHttp, json } from '../providers/fakes';

const fixture: unknown = JSON.parse(readFileSync(new URL('../fixtures/simplefin/accounts-v2.json', import.meta.url), 'utf8'));

async function synced(saved?: object) {
	const app = fakeApp();
	const p = new PassBookPlugin(app as never, { id: 'passbook', dir: '.obsidian/plugins/passbook' } as never);
	(p as unknown as { saved: unknown }).saved = saved ?? null;
	await p.onload();
	app.secrets.set(SIMPLEFIN_SECRET_ID, 'https://u:p@sfin.example.test/simplefin');
	p.http = fakeHttp(json(fixture), json(fixture));
	await p.syncNow();
	const passbookFiles = () => [...app.files.keys()].filter((k) => k.startsWith('PassBook/')).sort();
	return { app, p, passbookFiles };
}

describe('layout and CSV settings', () => {
	it('defaults to separate json/ and csv/ folders, with CSV off', async () => {
		const { p, passbookFiles } = await synced();
		expect(p.settings).toMatchObject({ layout: 'split', csv: false });
		expect(passbookFiles()).toEqual(['PassBook/json/accounts.json', 'PassBook/json/sync.json', 'PassBook/json/transactions/2026-10.json', 'PassBook/passbook.json']);
	});

	it('turning CSV on writes CSV for existing data at once, and later syncs keep it current', async () => {
		const { app, p, passbookFiles } = await synced();
		expect(await p.setCsv(true)).toBe(1);
		expect(passbookFiles()).toContain('PassBook/csv/transactions/2026-10.csv');
		expect(passbookFiles()).toContain('PassBook/csv/accounts.csv');

		app.files.delete('PassBook/csv/accounts.csv');
		await p.syncNow();
		expect(app.files.has('PassBook/csv/accounts.csv')).toBe(true);
	});

	it('turning CSV off leaves existing CSV files alone and stops updating them', async () => {
		const { app, p } = await synced();
		await p.setCsv(true);
		await p.setCsv(false);
		const before = app.files.get('PassBook/csv/accounts.csv');
		await p.syncNow();
		expect(app.files.get('PassBook/csv/accounts.csv')).toBe(before);
		expect(JSON.parse(app.files.get('PassBook/passbook.json') ?? '')).toMatchObject({ csv: null });
	});

	it('changing the layout on the sync device moves the files', async () => {
		const { p, passbookFiles } = await synced({ csv: true });
		expect(await p.setLayout('flat')).toBeGreaterThan(0);
		expect(passbookFiles()).toEqual([
			'PassBook/accounts.csv',
			'PassBook/accounts.json',
			'PassBook/passbook.json',
			'PassBook/sync.json',
			'PassBook/transactions/2026-10.csv',
			'PassBook/transactions/2026-10.json',
		]);
		expect((await p.api.v1.getTransactions()).length).toBe(4);
	});

	it('on a device that doesn’t sync, saves the choice but leaves the move to the sync device', async () => {
		const { p, passbookFiles } = await synced();
		const before = passbookFiles();
		p.setSyncDevice(false);
		expect(await p.setLayout('flat')).toBeNull();
		expect(passbookFiles()).toEqual(before);
		expect(p.settings.layout).toBe('flat');
		expect((await p.api.v1.getTransactions()).length).toBe(4); // still readable where it is
	});

	it('the sync device finishes a layout change made elsewhere on its next sync', async () => {
		const { p, passbookFiles } = await synced();
		p.setSyncDevice(false);
		await p.setLayout('csv-subfolder');
		p.setSyncDevice(true);
		p.http = fakeHttp(json(fixture));
		await p.syncNow();
		expect(passbookFiles()).toContain('PassBook/accounts.json');
		expect(passbookFiles().some((f) => f.startsWith('PassBook/json/'))).toBe(false);
	});

	it('waits for a running sync before moving anything', async () => {
		const { p } = await synced();
		let release!: () => void;
		const requested = new Promise<void>((started) => {
			p.http = () =>
				new Promise((resolve) => {
					release = () => resolve(json(fixture));
					started();
				});
		});
		const sync = p.api.v1.sync();
		await requested; // the sync is mid-flight
		let moved = false;
		const change = p.setLayout('flat').then(() => (moved = true));
		await new Promise((r) => setTimeout(r, 10));
		expect(moved).toBe(false); // still waiting for the sync
		release();
		await sync;
		await change;
		expect((await p.api.v1.getTransactions()).length).toBe(4);
	});
});

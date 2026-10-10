import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { obsidianFiles } from '../../src/ledger/obsidian-files';
import { LedgerStore } from '../../src/ledger/store';
import PassBookPlugin from '../../src/main';
import { SIMPLEFIN_SECRET_ID, SimpleFinProvider } from '../../src/providers/simplefin';
import { ProviderError } from '../../src/providers/types';
import { describeSummary, NotSyncDeviceError, StateStore, syncNow } from '../../src/sync/sync-now';
import { fakeApp } from '../mocks/app';
import { memoryFiles } from '../mocks/files';
import { Notice } from '../mocks/obsidian';
import { fakeHttp, fakeSecrets, json } from '../providers/fakes';

const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(new URL(`../fixtures/simplefin/${name}`, import.meta.url), 'utf8'));

const FLAT = () => ({ layout: 'flat' as const, csv: false });
const ACCESS_URL = 'https://user123:s3cret@sfin.example.test/simplefin';
const NOW = new Date('2026-10-09T12:00:00Z');

function memoryState(initial?: unknown): StateStore & { value: unknown } {
	const s = {
		value: initial,
		load: async () => s.value,
		save: async (v: unknown) => {
			s.value = v;
		},
	};
	return s;
}

function deps(...responses: Parameters<typeof fakeHttp>) {
	const http = fakeHttp(...responses);
	const files = memoryFiles();
	return {
		http,
		files,
		state: memoryState(),
		provider: new SimpleFinProvider(http, fakeSecrets({ [SIMPLEFIN_SECRET_ID]: ACCESS_URL })),
		ledger: new LedgerStore(files, () => 'PassBook', FLAT),
		isSyncDevice: () => true,
		now: NOW,
	};
}

describe('syncNow', () => {
	it('fetches into the ledger, saves the provider state, and summarizes', async () => {
		const d = deps(json(fixture('accounts-v2.json')));

		const summary = await syncNow(d);

		expect(summary).toMatchObject({ at: NOW.toISOString(), accounts: 2, newTransactions: 4, updatedTransactions: 0, removedTransactions: 0, issues: [] });
		expect(summary.newTransactionIds).toHaveLength(4);
		const ledger = await d.ledger.load();
		expect(ledger.accounts.size).toBe(2);
		expect(ledger.transactions.size).toBe(4);
		expect(d.state.value).toEqual({ lastEnd: NOW.toISOString() });
	});

	it('reports nothing new on a repeat sync', async () => {
		const d = deps(json(fixture('accounts-v2.json')), json(fixture('accounts-v2.json')));
		await syncNow(d);
		const second = await syncNow({ ...d, now: new Date(NOW.getTime() + 3600_000) });
		expect(second).toMatchObject({ newTransactions: 0, removedTransactions: 0 });
	});

	it('continues from the saved state when the ledger has data', async () => {
		const d = deps(json(fixture('accounts-v2.json')), json(fixture('accounts-v2.json')));
		await syncNow(d);
		await syncNow({ ...d, now: new Date('2026-10-10T12:00:00Z') });
		const start = new URL(d.http.requests[1]?.url ?? '').searchParams.get('start-date');
		expect(Number(start) * 1000).toBe(Date.parse('2026-10-04T12:00:00.000Z'));
	});

	it('ignores saved state when the ledger is empty, so a new data folder gets a full first sync', async () => {
		const d = deps(json(fixture('accounts-v2.json')));
		d.state.value = { lastEnd: '2026-10-08T12:00:00.000Z' };
		await syncNow(d);
		const start = new URL(d.http.requests[0]?.url ?? '').searchParams.get('start-date');
		expect(Number(start) * 1000).toBe(NOW.getTime() - 90 * 24 * 3600_000);
	});

	it('refuses when not connected, without a network call', async () => {
		const d = deps();
		d.provider = new SimpleFinProvider(d.http, fakeSecrets());
		await expect(syncNow(d)).rejects.toThrow(ProviderError);
		expect(d.http.requests).toHaveLength(0);
	});

	it('refuses on a device set not to sync, without a network call', async () => {
		const d = deps();
		await expect(syncNow({ ...d, isSyncDevice: () => false })).rejects.toThrow(NotSyncDeviceError);
		expect(d.http.requests).toHaveLength(0);
	});

	it('saves nothing when the fetch fails', async () => {
		const d = deps(json('', 403));
		await expect(syncNow(d)).rejects.toThrow(/rejected/);
		expect(d.files.data.size).toBe(0);
		expect(d.state.value).toBeUndefined();
	});
});

describe('obsidianFiles', () => {
	it('writes through a temp file, replacing the old file, and creates folders', async () => {
		const app = fakeApp();
		const files = obsidianFiles(app.vault.adapter as never);
		await files.write('PassBook/transactions/2026-10.json', 'one');
		await files.write('PassBook/transactions/2026-10.json', 'two');
		expect(app.files.get('PassBook/transactions/2026-10.json')).toBe('two');
		expect([...app.files.keys()].some((k) => k.endsWith('.tmp'))).toBe(false);
		expect(await files.list('PassBook/transactions')).toEqual(['PassBook/transactions/2026-10.json']);
		expect(await files.list('Nope')).toEqual([]);
	});

	it('removes an empty folder, and never a folder with something in it', async () => {
		const app = fakeApp();
		const files = obsidianFiles(app.vault.adapter as never);
		await app.vault.adapter.mkdir('PassBook/json/transactions');
		await files.write('PassBook/keep/notes.md', 'mine');
		await files.removeFolderIfEmpty('PassBook/json/transactions');
		await files.removeFolderIfEmpty('PassBook/keep');
		expect(app.dirs.has('PassBook/json/transactions')).toBe(false);
		expect(app.files.get('PassBook/keep/notes.md')).toBe('mine');
	});

	it('recovers from a crash between removing the old file and the rename', async () => {
		const app = fakeApp();
		app.files.set('PassBook/accounts.json.tmp', 'new');
		expect(await obsidianFiles(app.vault.adapter as never).read('PassBook/accounts.json')).toBe('new');
	});
});

describe('describeSummary', () => {
	it('reads naturally', () => {
		expect(describeSummary({ accounts: 1, newTransactions: 1, issues: [] })).toBe('PassBook synced 1 account, 1 new transaction.');
		expect(describeSummary({ accounts: 3, newTransactions: 0, issues: [] })).toBe('PassBook synced 3 accounts, 0 new transactions.');
	});

	it('lists problems', () => {
		const text = describeSummary({
			accounts: 2,
			newTransactions: 5,
			issues: [{ kind: 'connection-auth', message: 'Bank needs you to sign in again.' }],
		});
		expect(text).toBe('PassBook synced 2 accounts, 5 new transactions.\nOne problem:\n• Bank needs you to sign in again.');
	});
});

describe('Sync now command', () => {
	beforeEach(() => {
		Notice.shown.length = 0;
	});

	async function plugin(saved?: unknown) {
		const app = fakeApp();
		const p = new PassBookPlugin(app as never, { dir: '.obsidian/plugins/passbook' } as never);
		(p as unknown as { saved: unknown }).saved = saved ?? null;
		await p.onload();
		return { app, p, saved: () => (p as unknown as { saved: unknown }).saved };
	}

	it('is registered without the plugin ID in its command ID', async () => {
		const { p } = await plugin();
		const commands = (p as unknown as { commands: { id: string; name: string }[] }).commands;
		expect(commands.map((c) => c.id)).toContain('sync-now');
		expect(commands.every((c) => !c.id.includes('passbook'))).toBe(true);
	});

	it('syncs into the data folder and keeps the access URL out of every file', async () => {
		const { app, p, saved } = await plugin();
		app.secrets.set(SIMPLEFIN_SECRET_ID, ACCESS_URL);
		p.http = fakeHttp(json(fixture('accounts-v2.json')));

		await p.syncNow();

		expect(Notice.shown.map((n) => n.message)).toEqual(['PassBook synced 2 accounts, 4 new transactions.']);
		expect([...app.files.keys()].sort()).toEqual([
			'PassBook/json/accounts.json',
			'PassBook/json/sync.json',
			'PassBook/json/transactions/2026-10.json',
			'PassBook/passbook.json',
		]);
		const everything = JSON.stringify(saved()) + [...app.files.values()].join('');
		expect(everything).not.toContain('s3cret');
		expect(everything).not.toContain('user123');
	});

	it('uses the configured data folder', async () => {
		const { app, p } = await plugin({ dataFolder: 'Finance/Bank/' });
		app.secrets.set(SIMPLEFIN_SECRET_ID, ACCESS_URL);
		p.http = fakeHttp(json(fixture('accounts-v2.json')));
		await p.syncNow();
		expect(app.files.has('Finance/Bank/json/accounts.json')).toBe(true);
	});

	it('removes the Phase 1 provisional cache on load', async () => {
		const app = fakeApp();
		app.files.set('.obsidian/plugins/passbook/sync-cache.json', '{}');
		const p = new PassBookPlugin(app as never, { dir: '.obsidian/plugins/passbook' } as never);
		await p.onload();
		await new Promise((r) => setTimeout(r, 0));
		expect(app.files.has('.obsidian/plugins/passbook/sync-cache.json')).toBe(false);
	});

	it('shows a lasting notice with the reason when sync fails', async () => {
		const { app, p } = await plugin();
		app.secrets.set(SIMPLEFIN_SECRET_ID, ACCESS_URL);
		p.http = fakeHttp(new Error('offline'));
		await p.syncNow();
		expect(Notice.shown).toHaveLength(1);
		expect(Notice.shown[0]?.message).toMatch(/^PassBook couldn’t sync\. Couldn’t reach SimpleFIN/);
		expect(Notice.shown[0]?.duration).toBe(0);
	});

	it('explains an unreadable data file', async () => {
		const { app, p } = await plugin();
		app.secrets.set(SIMPLEFIN_SECRET_ID, ACCESS_URL);
		app.files.set('PassBook/json/accounts.json', '{"accounts": []}');
		app.files.set('PassBook/passbook.json', '{"layout": "split"}');
		await p.syncNow();
		expect(Notice.shown[0]?.message).toMatch(/has no schemaVersion/);
	});

	it('tells you to connect first', async () => {
		const { p } = await plugin();
		await p.syncNow();
		expect(Notice.shown[0]?.message).toMatch(/Connect SimpleFIN/);
	});

	it('refuses on a device set not to sync, and keeps that setting out of data.json', async () => {
		const { app, p, saved } = await plugin();
		app.secrets.set(SIMPLEFIN_SECRET_ID, ACCESS_URL);
		const http = fakeHttp();
		p.http = http;
		expect(p.isSyncDevice()).toBe(true); // unset counts as yes

		p.setSyncDevice(false);
		await p.syncNow();

		expect(Notice.shown[0]?.message).toMatch(/set not to sync/);
		expect(http.requests).toHaveLength(0);
		expect(app.local.get('passbook-sync-device')).toBe('off');
		expect(JSON.stringify(saved())).not.toContain('sync-device');
		await expect(p.api.v1.sync()).rejects.toThrow(/set not to sync/);
	});

	it('syncs again once the device is turned back on', async () => {
		const { app, p } = await plugin();
		app.secrets.set(SIMPLEFIN_SECRET_ID, ACCESS_URL);
		p.setSyncDevice(false);
		p.setSyncDevice(true);
		p.http = fakeHttp(json(fixture('accounts-v2.json')));
		await p.syncNow();
		expect(Notice.shown[0]?.message).toMatch(/^PassBook synced/);
	});

	it('refuses to run twice at once', async () => {
		const { app, p } = await plugin();
		app.secrets.set(SIMPLEFIN_SECRET_ID, ACCESS_URL);
		p.http = fakeHttp(json(fixture('accounts-v2.json')));
		await Promise.all([p.syncNow(), p.syncNow()]);
		expect(Notice.shown.map((n) => n.message)).toContain('PassBook is already syncing.');
	});
});

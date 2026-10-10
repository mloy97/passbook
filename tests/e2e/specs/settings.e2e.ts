// Settings tab and "Sync now" in real Obsidian. The network is faked by replacing
// plugin.http inside Obsidian, so the real provider, controller and UI code all run.
// Screenshots go to screenshots/ (gitignored); look at them after a run.

import { browser, expect } from '@wdio/globals';
import { after, afterEach, before, describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';

const SHOTS = 'screenshots';

/** Distinguishes screenshots from each Obsidian version and the phone-width run. */
async function label(): Promise<string> {
	return browser.executeObsidian(({ obsidian }) => `${obsidian.apiVersion}${obsidian.Platform.isMobile ? '-mobile' : ''}`);
}

async function shot(name: string): Promise<void> {
	// Let Obsidian finish re-rendering the tab.
	await browser.pause(300);
	await browser.saveScreenshot(`${SHOTS}/${await label()}-${name}.png`);
}

/**
 * Fakes SimpleFIN. `mode` decides what GET /accounts returns; the claim always works.
 * Runs inside Obsidian, so everything it uses has to be passed in or defined inside.
 */
async function fakeSimpleFin(mode: 'ok' | 'revoked'): Promise<void> {
	await browser.executeObsidian(({ app }, mode) => {
		const plugin = (app as unknown as { plugins: { plugins: Record<string, { http: unknown }> } }).plugins.plugins.passbook;
		if (!plugin) throw new Error('PassBook is not loaded');
		const accounts = {
			errlist: [],
			connections: [{ conn_id: 'C1', name: 'First Example Bank', org_id: 'O1', sfin_url: 'https://sfin.example.test/simplefin' }],
			accounts: [
				{
					id: 'A1',
					name: 'Everyday Checking',
					conn_id: 'C1',
					currency: 'USD',
					balance: '1523.07',
					'balance-date': 1791460800,
					transactions: [{ id: 'T1', posted: 1791201600, amount: '-42.50', description: 'GROCERY MART' }],
				},
			],
		};
		plugin.http = async (req: { method: string }) => {
			if (req.method === 'POST') return { status: 200, text: 'https://user:pass@sfin.example.test/simplefin' };
			if (mode === 'revoked') return { status: 403, text: '' };
			return { status: 200, text: JSON.stringify(accounts) };
		};
	}, mode);
}

async function openSettings(): Promise<void> {
	await browser.executeObsidian(({ app }) => {
		const setting = (app as unknown as { setting: { open(): void; openTabById(id: string): void; shouldUsePopout?: () => boolean } })
			.setting;
		// Obsidian 1.14+ desktop opens settings in a pop-out window; keep it in this window
		// so WebDriver can see it. The tab renders the same either way.
		if (setting.shouldUsePopout) setting.shouldUsePopout = () => false;
		setting.open();
		setting.openTabById('passbook');
	});
	await expect(browser.$('.passbook-settings')).toBeDisplayed();
}

async function closeSettings(): Promise<void> {
	await browser.executeObsidian(({ app }) => {
		(app as unknown as { setting: { close(): void } }).setting.close();
	});
}

async function noticeText(): Promise<string> {
	return browser.execute(() => Array.from(document.querySelectorAll('.notice')).map((n) => n.textContent ?? '').join(' | '));
}

const tab = () => browser.$('.passbook-settings');
const button = (text: string) => tab().$(`button=${text}`);

describe('PassBook settings', function () {
	before(async function () {
		await obsidianPage.resetVault();
	});

	afterEach(async function () {
		if (this.currentTest?.state === 'failed') {
			const name = (this.currentTest.title || 'test').replace(/[^a-z0-9]+/gi, '-');
			await browser.saveScreenshot(`${SHOTS}/${await label()}-FAILED-${name}.png`);
		}
	});

	after(async function () {
		await closeSettings();
	});

	it('loads the plugin', async function () {
		const enabled = await browser.executeObsidian(({ app }) =>
			(app as unknown as { plugins: { enabledPlugins: Set<string> } }).plugins.enabledPlugins.has('passbook'),
		);
		expect(enabled).toBe(true);
	});

	it('shows the setup token form when not connected', async function () {
		await openSettings();
		await expect(tab().$('input[type=password]')).toBeDisplayed();
		await expect(button('Connect')).toBeDisplayed();
		await expect(tab().$('a=Create a setup token')).toBeDisplayed();
		await shot('1-not-connected');
	});

	it('asks for a token when Connect is pressed with none', async function () {
		await button('Connect').click();
		await expect(tab().$('.passbook-error')).toHaveText('Paste a setup token first.');
	});

	it('explains a token that is not a SimpleFIN token', async function () {
		await tab().$('input[type=password]').setValue('not-a-token');
		await button('Connect').click();
		await expect(tab().$('.passbook-error')).toHaveText(expect.stringContaining('isn’t a SimpleFIN setup token'));
		await shot('2-bad-token');
	});

	it('connects with a valid token', async function () {
		await fakeSimpleFin('ok');
		await tab().$('input[type=password]').setValue(btoa('https://sfin.example.test/simplefin/claim/DEMO'));
		await button('Connect').click();
		await expect(tab().$('.setting-item-description*=Connected on this device')).toBeDisplayed();
		await expect(button('Disconnect')).toBeDisplayed();
		await expect(tab().$('.passbook-error')).not.toBeExisting();
		await shot('3-connected');
	});

	it('has a This device syncs toggle, on by default, kept per device', async function () {
		const toggle = tab().$('.setting-item*=This device syncs').$('.checkbox-container');
		await expect(toggle).toHaveElementClass('is-enabled');
		await toggle.click();
		await expect(toggle).not.toHaveElementClass('is-enabled');
		await shot('3b-sync-device-off');
		const stored = await browser.executeObsidian(({ app }) => app.loadLocalStorage('passbook-sync-device') as unknown);
		expect(stored).toBe('off');
		await toggle.click();
		await expect(toggle).toHaveElementClass('is-enabled');
	});

	it('shows why a connection check failed, while staying connected', async function () {
		await fakeSimpleFin('revoked');
		await button('Check connection').click();
		await expect(tab().$('.passbook-error')).toHaveText(expect.stringContaining('rejected PassBook’s access'));
		await expect(button('Disconnect')).toBeDisplayed();
		await shot('4-check-failed');
	});

	it('syncs from the command', async function () {
		await fakeSimpleFin('ok');
		await closeSettings();
		await browser.execute(() => {
			const w = window as unknown as { passbookErrors: string[] };
			w.passbookErrors = [];
			const original = console.error.bind(console);
			console.error = (...args: unknown[]) => {
				w.passbookErrors.push(args.map((a) => (a instanceof Error ? `${a.message}
${a.stack ?? ''}` : String(a))).join(' '));
				original(...args);
			};
		});
		await browser.executeObsidianCommand('passbook:sync-now');
		await browser.waitUntil(async () => (await noticeText()).includes('PassBook'), { timeoutMsg: 'no PassBook notice' });
		const errors = await browser.execute(() => (window as unknown as { passbookErrors: string[] }).passbookErrors);
		expect({ notice: await noticeText(), errors }).toEqual({ notice: expect.stringContaining('PassBook synced 1 account, 1 new transaction.') as unknown, errors: [] });
		await shot('5-sync-notice');
	});

	it('writes the ledger to the data folder, and replaces it on the next sync', async function () {
		const read = () =>
			browser.executeObsidian(async ({ app }) => {
				const a = app.vault.adapter;
				const list = await a.list('PassBook/json/transactions');
				return {
					accounts: await a.exists('PassBook/json/accounts.json'),
					sync: JSON.parse(await a.read('PassBook/json/sync.json')) as { lastSync: { newTransactionIds: string[] } },
					months: list.files,
				};
			});
		const first = await read();
		expect(first.accounts).toBe(true);
		expect(first.months).toEqual(['PassBook/json/transactions/2026-10.json']);
		expect(first.sync.lastSync.newTransactionIds).toHaveLength(1);

		await browser.executeObsidianCommand('passbook:sync-now');
		await browser.waitUntil(async () => (await read()).sync.lastSync.newTransactionIds.length === 0, {
			timeoutMsg: 'second sync did not rewrite sync.json',
		});
		const second = await read();
		expect(second.months).toEqual(['PassBook/json/transactions/2026-10.json']);
		await openSettings();
	});

	it('serves api.v1 and fires passbook:sync-completed', async function () {
		const out = await browser.executeObsidian(async ({ app }) => {
			type Api = {
				sync(): Promise<{ newTransactions: number }>;
				getAccounts(): Promise<{ name: string }[]>;
				getTransactions(q?: object): Promise<{ description: string }[]>;
			};
			const api = (app as unknown as { plugins: { plugins: Record<string, { api: { v1: Api } }> } }).plugins.plugins.passbook?.api.v1;
			if (!api) throw new Error('no api.v1');
			const heard: unknown[] = [];
			const ref = app.workspace.on('passbook:sync-completed' as 'quit', (r: unknown) => heard.push(r));
			const result = await api.sync();
			app.workspace.offref(ref);
			return {
				accounts: (await api.getAccounts()).map((a) => a.name),
				transactions: (await api.getTransactions({ since: '2026-10-01' })).map((t) => t.description),
				result,
				heard: heard.length,
			};
		});
		expect(out.accounts).toEqual(['Everyday Checking']);
		expect(out.transactions).toEqual(['GROCERY MART']);
		expect(out.result.newTransactions).toBe(0);
		expect(out.heard).toBe(1);
	});

	it('lists all five commands in the command palette', async function () {
		await closeSettings();
		await browser.executeObsidianCommand('command-palette:open');
		await browser.keys('PassBook');
		await browser.waitUntil(async () => (await browser.$$('.suggestion-item').length) === 5, { timeoutMsg: 'expected 5 PassBook commands' });
		const names = await browser.$$('.suggestion-item').map((el) => el.getText());
		// The "PassBook:" prefix is a separate element, so its text runs into the name.
		expect(names.map((n) => n.replace(/^PassBook:?\s*/, '').trim()).sort()).toEqual([
			'Connect provider',
			'Copy diagnostic summary',
			'Export transactions to CSV',
			'Open data folder',
			'Sync now',
		]);
		await shot('6-command-palette');
		await browser.keys('Escape');
	});

	it('exports CSV and opens the data folder the ledger wrote', async function () {
		await browser.executeObsidianCommand('passbook:export-csv');
		await browser.waitUntil(async () => (await noticeText()).includes('Exported'), { timeoutMsg: 'no export notice' });
		const csv = await browser.executeObsidian(async ({ app }) => {
			const list = await app.vault.adapter.list('PassBook/exports');
			return list.files.length === 1 ? await app.vault.adapter.read(list.files[0] ?? '') : null;
		});
		expect(csv?.split('\r\n')[1]).toContain('GROCERY MART');

		await browser.executeObsidianCommand('passbook:open-data-folder');
		await browser.pause(500);
		expect(await noticeText()).not.toContain('doesn’t exist yet');
		await expect(browser.$('.nav-folder-title[data-path="PassBook"]')).toBeDisplayed();
		await shot('7-data-folder');
		await openSettings();
	});

	it('turns on CSV files and changes the folder layout, moving the files', async function () {
		const files = () =>
			browser.executeObsidian(async ({ app }) => {
				const out: string[] = [];
				const walk = async (dir: string): Promise<void> => {
					const l = await app.vault.adapter.list(dir);
					out.push(...l.files);
					for (const f of l.folders) if (!f.endsWith('/exports') && !f.endsWith('exports')) await walk(f);
				};
				await walk('PassBook');
				return out.filter((f) => !f.includes('/exports/')).sort();
			});

		const csvToggle = tab().$('.setting-item*=Also save CSV files').$('.checkbox-container');
		await csvToggle.scrollIntoView();
		await csvToggle.waitForClickable();
		await browser.pause(400); // let the scroll settle; on phone width an early click is lost
		await csvToggle.click();
		await browser.waitUntil(async () => (await files()).includes('PassBook/csv/accounts.csv'), { timeoutMsg: 'CSV not written' });
		// The tab re-renders after the change; it must keep its place, not jump to the top.
		await expect(tab().$('.setting-item*=Also save CSV files')).toBeDisplayedInViewport();
		expect(await files()).toEqual([
			'PassBook/csv/accounts.csv',
			'PassBook/csv/transactions/2026-10.csv',
			'PassBook/json/accounts.json',
			'PassBook/json/sync.json',
			'PassBook/json/transactions/2026-10.json',
			'PassBook/passbook.json',
		]);
		await shot('8-csv-on');

		const layout = tab().$('.setting-item*=Folder layout').$('select');
		await layout.selectByAttribute('value', 'flat');
		// The notice comes after the whole move; files appear one by one before it.
		await browser.waitUntil(async () => /moved \d+ files|couldn’t move/.test(await noticeText()), { timeoutMsg: 'files not moved' });
		expect(await files()).toEqual([
			'PassBook/accounts.csv',
			'PassBook/accounts.json',
			'PassBook/passbook.json',
			'PassBook/sync.json',
			'PassBook/transactions/2026-10.csv',
			'PassBook/transactions/2026-10.json',
		]);
		expect(await noticeText()).toMatch(/moved 5 files to the new layout/); // 3 JSON + 2 CSV; the marker stays
		const folders = await browser.executeObsidian(async ({ app }) => (await app.vault.adapter.list('PassBook')).folders.sort());
		expect(folders).toEqual(['PassBook/exports', 'PassBook/transactions']); // json/ and csv/ cleaned up
		await shot('9-layout-flat');

		// Back to the default, so the rest of the session sees it.
		await tab().$('.setting-item*=Folder layout').$('select').selectByAttribute('value', 'split');
		await browser.waitUntil(async () => (await files()).includes('PassBook/json/accounts.json'), { timeoutMsg: 'files not moved back' });
		const api = await browser.executeObsidian(async ({ app }) => {
			type Api = { getTransactions(): Promise<unknown[]> };
			return (await (app as unknown as { plugins: { plugins: Record<string, { api: { v1: Api } }> } }).plugins.plugins.passbook?.api.v1.getTransactions())?.length;
		});
		expect(api).toBe(1);
	});

	it('opens pre-filled feedback forms and copies the diagnostic summary', async function () {
		await browser.execute(() => {
			const w = window as unknown as { opened: string[]; copied: string[] };
			w.opened = [];
			w.copied = [];
			window.open = ((url?: string | URL) => {
				w.opened.push(String(url));
				return null;
			}) as typeof window.open;
			Object.defineProperty(navigator.clipboard, 'writeText', { value: async (t: string) => void w.copied.push(t), configurable: true });
		});
		const report = tab().$('button=Report a problem');
		await report.scrollIntoView();
		await report.waitForClickable();
		await browser.pause(400);
		await shot('10-feedback');
		await report.click();
		await tab().$('button=Suggest a feature').click();
		await browser.waitUntil(async () => (await browser.execute(() => (window as unknown as { opened: string[] }).opened.length)) === 2, {
			timeoutMsg: 'feedback links not opened',
		});
		const opened = await browser.execute(() => (window as unknown as { opened: string[] }).opened);
		const bug = new URL(opened[0] ?? '');
		expect(bug.pathname).toBe('/mloy97/passbook/issues/new');
		expect(bug.searchParams.get('template')).toBe('1-bug-report.yml');
		expect(bug.searchParams.get('diagnostics')).toMatch(/^PassBook 0\.1\.0 · Obsidian \d/);
		expect(bug.searchParams.get('diagnostics')).toContain('Data: 1 accounts · 1 transactions (0 pending)');
		expect(bug.searchParams.get('diagnostics')).not.toMatch(/GROCERY|Everyday Checking|42\.50|user:pass/);
		expect(new URL(opened[1] ?? '').searchParams.get('template')).toBe('2-feature-request.yml');

		// Without the summary.
		await tab().$('.setting-item*=Include diagnostic summary').$('.checkbox-container').click();
		await report.click();
		await browser.waitUntil(async () => (await browser.execute(() => (window as unknown as { opened: string[] }).opened.length)) === 3);
		const third = await browser.execute(() => (window as unknown as { opened: string[] }).opened[2]);
		expect(new URL(third ?? '').searchParams.has('diagnostics')).toBe(false);

		await tab().$('button=Support on Ko-fi').click();
		await browser.waitUntil(async () => (await browser.execute(() => (window as unknown as { opened: string[] }).opened.length)) === 4);
		expect(await browser.execute(() => (window as unknown as { opened: string[] }).opened[3])).toBe('https://ko-fi.com/devmilo');

		await browser.executeObsidianCommand('passbook:copy-diagnostics');
		await browser.waitUntil(async () => (await browser.execute(() => (window as unknown as { copied: string[] }).copied.length)) === 1);
		const copied = await browser.execute(() => (window as unknown as { copied: string[] }).copied[0]);
		expect(copied).toContain('Data source: SimpleFIN');
	});

	it('disconnects', async function () {
		// On phone width the settings sheet animates in; a click before it settles is lost.
		await button('Disconnect').waitForClickable();
		await browser.pause(500);
		await button('Disconnect').click();
		await expect(tab().$('input[type=password]')).toBeDisplayed();
		const secret = await browser.executeObsidian(({ app }) => app.secretStorage.getSecret('passbook-simplefin-access-url'));
		expect(secret).toBe('');
	});
});

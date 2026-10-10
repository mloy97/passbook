// Demo mode end to end: what a store reviewer or a new user without an account sees.
// Runs in its own Obsidian session, separate from settings.e2e.ts.

import { browser, expect } from '@wdio/globals';
import { afterEach, before, describe, it } from 'mocha';
import { obsidianPage } from 'wdio-obsidian-service';

const SHOTS = 'screenshots';

async function label(): Promise<string> {
	return browser.executeObsidian(({ obsidian }) => `${obsidian.apiVersion}${obsidian.Platform.isMobile ? '-mobile' : ''}`);
}

async function shot(name: string): Promise<void> {
	await browser.pause(300);
	await browser.saveScreenshot(`${SHOTS}/${await label()}-demo-${name}.png`);
}

async function openSettings(): Promise<void> {
	await browser.executeObsidian(({ app }) => {
		const setting = (app as unknown as { setting: { open(): void; openTabById(id: string): void; shouldUsePopout?: () => boolean } })
			.setting;
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

describe('Demo mode', function () {
	before(async function () {
		await obsidianPage.resetVault();
	});

	afterEach(async function () {
		if (this.currentTest?.state === 'failed') {
			const name = (this.currentTest.title || 'test').replace(/[^a-z0-9]+/gi, '-');
			await browser.saveScreenshot(`${SHOTS}/${await label()}-demo-FAILED-${name}.png`);
		}
	});

	it('switches to demo data from settings, hiding the SimpleFIN section', async function () {
		await openSettings();
		const dropdown = browser.$('.passbook-settings select.dropdown');
		await dropdown.waitForClickable();
		await dropdown.selectByAttribute('value', 'demo');
		await expect(browser.$('.passbook-settings').$('.setting-item-description*=made-up accounts')).toBeDisplayed();
		await expect(browser.$('.passbook-settings input[type=password]')).not.toBeExisting();
		expect(await browser.$('.passbook-settings').getText()).toContain('PassBook (demo)');
		await shot('1-settings');
		await closeSettings();
	});

	it('syncs made-up data with no account and no network', async function () {
		await browser.executeObsidian(({ app }) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { http: unknown }> } }).plugins.plugins.passbook;
			if (!plugin) throw new Error('PassBook is not loaded');
			plugin.http = () => Promise.reject(new Error('demo mode must not make requests'));
		});
		await browser.executeObsidianCommand('passbook:sync-now');
		await browser.waitUntil(async () => (await noticeText()).includes('PassBook'), { timeoutMsg: 'no PassBook notice' });
		expect(await noticeText()).toMatch(/PassBook synced 3 accounts, \d+ new transactions\./);
		await shot('2-synced');
	});

	it('writes to its own folder, readable through api.v1', async function () {
		const out = await browser.executeObsidian(async ({ app }) => {
			type Api = { getBalances(): Promise<{ balance: string }[]>; getTransactions(): Promise<unknown[]> };
			const api = (app as unknown as { plugins: { plugins: Record<string, { api: { v1: Api } }> } }).plugins.plugins.passbook?.api.v1;
			return {
				demoFolder: await app.vault.adapter.exists('PassBook (demo)/json/accounts.json'),
				realFolder: await app.vault.adapter.exists('PassBook'),
				balances: (await api?.getBalances())?.length,
				transactions: (await api?.getTransactions())?.length,
			};
		});
		expect(out).toMatchObject({ demoFolder: true, realFolder: false, balances: 3 });
		expect(out.transactions).toBeGreaterThan(60);
	});
});

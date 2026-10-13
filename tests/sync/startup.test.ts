import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import PassBookPlugin from '../../src/main';
import { SIMPLEFIN_SECRET_ID } from '../../src/providers/simplefin';
import { shouldSyncOnStartup } from '../../src/sync/startup';
import { fakeApp } from '../mocks/app';
import { Notice } from '../mocks/obsidian';
import { fakeHttp, json } from '../providers/fakes';

const NOW = new Date('2026-10-12T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

describe('shouldSyncOnStartup', () => {
	it.each([
		['off', { hours: 0, lastSyncAt: hoursAgo(100), canSync: true }, false],
		['on, never synced', { hours: 6, lastSyncAt: null, canSync: true }, true],
		['on, stale', { hours: 6, lastSyncAt: hoursAgo(7), canSync: true }, true],
		['on, exactly due', { hours: 6, lastSyncAt: hoursAgo(6), canSync: true }, true],
		['on, fresh', { hours: 6, lastSyncAt: hoursAgo(2), canSync: true }, false],
		['on, stale, but this device can’t sync', { hours: 1, lastSyncAt: hoursAgo(48), canSync: false }, false],
		['on, unreadable time', { hours: 6, lastSyncAt: 'garbage', canSync: true }, true],
	])('%s', (_, check, expected) => {
		expect(shouldSyncOnStartup({ ...check, now: NOW })).toBe(expected);
	});
});

describe('sync buttons in the plugin', () => {
	const fixture: unknown = JSON.parse(readFileSync(new URL('../fixtures/simplefin/accounts-v2.json', import.meta.url), 'utf8'));
	type Ribbon = { icon: string; title: string; onClick: () => unknown; attrs: Record<string, string> };

	beforeEach(() => {
		Notice.shown.length = 0;
	});

	async function plugin(saved?: object, connected = true) {
		const app = fakeApp();
		const p = new PassBookPlugin(app as never, { id: 'passbook', version: '0.1.0', dir: '.obsidian/plugins/passbook' } as never);
		(p as unknown as { saved: unknown }).saved = saved ?? null;
		if (connected) app.secrets.set(SIMPLEFIN_SECRET_ID, 'https://u:p@sfin.example.test/simplefin');
		await p.onload();
		await new Promise((r) => setTimeout(r, 0)); // let onLayoutReady work finish
		const ribbon = () => (p as unknown as { ribbons: Ribbon[] }).ribbons[0];
		return { app, p, ribbon };
	}

	it('adds a ribbon icon that syncs and then says when', async () => {
		const { p, ribbon } = await plugin();
		expect(ribbon()).toMatchObject({ icon: 'refresh-cw', title: 'PassBook: sync now' });
		expect(ribbon()?.attrs['aria-label']).toBe('PassBook: sync now (not synced yet)');

		p.http = fakeHttp(json(fixture));
		await ribbon()?.onClick();
		await new Promise((r) => setTimeout(r, 0));
		expect(Notice.shown[0]?.message).toMatch(/^PassBook synced 2 accounts/);
		expect(ribbon()?.attrs['aria-label']).toBe('PassBook: sync now (last synced just now)');
	});

	it('does not sync on startup by default', async () => {
		const { p } = await plugin();
		expect(p.settings.syncOnStartupHours).toBe(0);
		expect(Notice.shown).toHaveLength(0);
	});

	it('syncs on startup when on and due, and not again when fresh', async () => {
		const first = await plugin({ syncOnStartupHours: 6 }, false); // no secret yet: can't sync, nothing happens
		expect(Notice.shown).toHaveLength(0);

		const app = first.app;
		app.secrets.set(SIMPLEFIN_SECRET_ID, 'https://u:p@sfin.example.test/simplefin');
		first.p.http = fakeHttp(json(fixture));
		await first.p.maybeSyncOnStartup(NOW);
		expect(Notice.shown.map((n) => n.message)).toEqual(['PassBook synced 2 accounts, 4 new transactions.']);

		Notice.shown.length = 0;
		await first.p.maybeSyncOnStartup(new Date()); // just synced: fresh
		expect(Notice.shown).toHaveLength(0);
	});

	it('never syncs on startup on a device set not to sync', async () => {
		const { p } = await plugin({ syncOnStartupHours: 1 });
		Notice.shown.length = 0; // loading already tried a startup sync (never synced, so due)
		p.setSyncDevice(false);
		p.http = fakeHttp();
		await p.maybeSyncOnStartup(NOW);
		expect(Notice.shown).toHaveLength(0);
	});

	it('keeps only the offered startup choices', async () => {
		expect((await plugin({ syncOnStartupHours: 6 })).p.settings.syncOnStartupHours).toBe(6);
		expect((await plugin({ syncOnStartupHours: 5 })).p.settings.syncOnStartupHours).toBe(0);
		expect((await plugin({ syncOnStartupHours: 'often' })).p.settings.syncOnStartupHours).toBe(0);
	});
});

import { beforeEach, describe, expect, it } from 'vitest';
import { apply, emptyLedger } from '../../src/ledger/ledger';
import PassBookPlugin from '../../src/main';
import { DemoProvider } from '../../src/providers/demo';
import { fakeApp } from '../mocks/app';
import { Notice } from '../mocks/obsidian';
import { fakeHttp } from './fakes';

const DAY = 24 * 3600_000;
const NOW = new Date('2026-10-09T15:00:00Z');
const fetchAt = (now: Date, initialDays = 90) => new DemoProvider().fetch({ state: undefined, initialDays, now });

describe('DemoProvider', () => {
	it('has three accounts at two institutions, with balances', async () => {
		const r = await fetchAt(NOW);
		expect(r.connections.map((c) => c.name)).toEqual(['Demo Savings Bank', 'Demo Card Co']);
		expect(r.accounts.map((a) => a.name)).toEqual(['Everyday Checking', 'High Yield Savings', 'Rewards Card']);
		expect(Number(r.accounts.find((a) => a.id === 'card')?.balance)).toBeLessThan(0);
	});

	it('gives the same data for every sync on the same day', async () => {
		const a = await fetchAt(NOW);
		const b = await fetchAt(new Date(NOW.getTime() + 3600_000));
		expect(b.upserts).toEqual(a.upserts);
	});

	it('has a few months of varied history with some pending charges', async () => {
		const r = await fetchAt(NOW);
		expect(r.upserts.length).toBeGreaterThan(60);
		expect(r.upserts.some((t) => t.pending)).toBe(true);
		expect(new Set(r.upserts.map((t) => t.description)).size).toBeGreaterThan(8);
	});

	it('posts yesterday’s pending charges under new IDs the next day, and the ledger replaces them', async () => {
		const data = emptyLedger();
		apply(data, await fetchAt(NOW), 'demo', NOW);
		const pendingBefore = [...data.transactions.values()].filter((t) => t.status === 'pending');
		expect(pendingBefore.length).toBeGreaterThan(0);

		// Two days on, every one of those has posted under a new ID.
		const later = new Date(NOW.getTime() + 2 * DAY);
		const out = apply(data, await fetchAt(later), 'demo', later);

		for (const p of pendingBefore) {
			expect(data.transactions.has(p.id)).toBe(false);
			expect(out.removedIds).toContain(p.id);
			const posted = [...data.transactions.values()].filter(
				(t) => t.status === 'posted' && t.description === p.description && t.transactedAt === p.transactedAt,
			);
			expect(posted).toHaveLength(1);
			expect(posted[0]?.id).not.toBe(p.id);
		}
	});

	it('only returns transactions inside the requested window', async () => {
		const r = await fetchAt(NOW, 10);
		const start = NOW.getTime() - 10 * DAY;
		for (const t of r.upserts) expect(Date.parse(t.transactedAt ?? '')).toBeGreaterThanOrEqual(start);
	});
});

describe('demo mode in the plugin', () => {
	beforeEach(() => {
		Notice.shown.length = 0;
	});

	it('syncs made-up data into its own folder without any network call', async () => {
		const app = fakeApp();
		const p = new PassBookPlugin(app as never, { id: 'passbook', dir: '.obsidian/plugins/passbook' } as never);
		await p.onload();
		const http = fakeHttp();
		p.http = http;

		await p.setProvider('demo');
		await p.syncNow();

		expect(http.requests).toHaveLength(0);
		expect(Notice.shown[0]?.message).toMatch(/^PassBook synced 3 accounts/);
		expect(app.files.has('PassBook (demo)/json/accounts.json')).toBe(true);
		expect([...app.files.keys()].some((k) => k.startsWith('PassBook/'))).toBe(false);
		expect((await p.api.v1.getAccounts()).map((a) => a.institution)).toContain('Demo Savings Bank');
	});

	it('syncs even on a device set not to sync, since no bank is involved', async () => {
		const app = fakeApp();
		const p = new PassBookPlugin(app as never, { id: 'passbook', dir: '.obsidian/plugins/passbook' } as never);
		await p.onload();
		p.setSyncDevice(false);
		await p.setProvider('demo');
		await p.syncNow();
		expect(Notice.shown[0]?.message).toMatch(/^PassBook synced 3 accounts/);
	});

	it('goes back to the real data folder, untouched, when switched off', async () => {
		const app = fakeApp();
		const p = new PassBookPlugin(app as never, { id: 'passbook', dir: '.obsidian/plugins/passbook' } as never);
		await p.onload();
		await p.setProvider('demo');
		await p.syncNow();
		await p.setProvider('simplefin');
		expect(p.dataFolder()).toBe('PassBook');
		expect(await p.api.v1.getAccounts()).toEqual([]);
	});
});

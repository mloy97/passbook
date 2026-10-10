// The provider contract (ADR 0002), run against every provider. A new provider adds
// one entry to PROVIDERS and must pass all of it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DemoProvider } from '../../src/providers/demo';
import { SIMPLEFIN_SECRET_ID, SimpleFinProvider } from '../../src/providers/simplefin';
import { FetchResult, Provider } from '../../src/providers/types';
import { fakeHttp, fakeSecrets, json } from './fakes';

const NOW = new Date('2026-10-09T12:00:00Z');
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;
const fixture: unknown = JSON.parse(readFileSync(new URL('../fixtures/simplefin/accounts-v2.json', import.meta.url), 'utf8'));

const PROVIDERS: [string, () => Provider][] = [
	['SimpleFIN', () => new SimpleFinProvider(fakeHttp(json(fixture)), fakeSecrets({ [SIMPLEFIN_SECRET_ID]: 'https://u:p@sfin.example.test/simplefin' }))],
	['Demo', () => new DemoProvider()],
];

describe.each(PROVIDERS)('%s provider contract', (_, make) => {
	async function fetched(): Promise<FetchResult> {
		return make().fetch({ state: undefined, initialDays: 30, now: NOW });
	}

	it('is connected and identifies itself', () => {
		const p = make();
		expect(p.isConnected()).toBe(true);
		expect(['simplefin', 'plaid', 'demo']).toContain(p.id);
	});

	it('describes every account’s connection', async () => {
		const r = await fetched();
		expect(r.accounts.length).toBeGreaterThan(0);
		const connections = new Set(r.connections.map((c) => c.id));
		for (const a of r.accounts) expect(connections.has(a.connectionId)).toBe(true);
	});

	it('uses decimal strings and ISO times', async () => {
		const r = await fetched();
		for (const a of r.accounts) {
			expect(a.balance).toMatch(DECIMAL);
			if (a.availableBalance !== undefined) expect(a.availableBalance).toMatch(DECIMAL);
			expect(a.balanceAsOf).toMatch(ISO);
		}
		for (const t of r.upserts) {
			expect(t.amount).toMatch(DECIMAL);
			if (t.postedAt !== null) expect(t.postedAt).toMatch(ISO);
			if (t.transactedAt !== undefined) expect(t.transactedAt).toMatch(ISO);
		}
	});

	it('only lists transactions for accounts it returned', async () => {
		const r = await fetched();
		const accounts = new Set(r.accounts.map((a) => a.id));
		for (const t of r.upserts) expect(accounts.has(t.accountId)).toBe(true);
		for (const c of r.coverage) expect(accounts.has(c.accountId)).toBe(true);
	});

	it('marks pending transactions with no posted time', async () => {
		const r = await fetched();
		for (const t of r.upserts) if (t.pending) expect(t.postedAt).toBeNull();
		for (const t of r.upserts) if (!t.pending) expect(t.postedAt).not.toBeNull();
	});

	it('never repeats a transaction within an account', async () => {
		const r = await fetched();
		const keys = r.upserts.map((t) => `${t.accountId}/${t.id}`);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('claims coverage only for windows that end by now', async () => {
		const r = await fetched();
		for (const c of r.coverage) {
			expect(Date.parse(c.start)).toBeLessThan(Date.parse(c.end));
			expect(Date.parse(c.end)).toBeLessThanOrEqual(NOW.getTime());
		}
	});

	it('returns JSON-serializable state with no secrets', async () => {
		const r = await fetched();
		const state = JSON.stringify(r.state ?? null);
		expect(JSON.parse(state)).toEqual(r.state ?? null);
		expect(state).not.toMatch(/:\/\/[^@/]+@/);
	});
});

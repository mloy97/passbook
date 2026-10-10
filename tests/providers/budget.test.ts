import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RequestBudget, SIMPLEFIN_DAILY_LIMIT } from '../../src/providers/budget';
import { SIMPLEFIN_SECRET_ID, SimpleFinProvider } from '../../src/providers/simplefin';
import { ProviderError } from '../../src/providers/types';
import { fakeHttp, fakeSecrets, json } from './fakes';

const NOW = new Date('2026-10-09T12:00:00Z');
const HOUR = 3600_000;
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR);
const fixture: unknown = JSON.parse(readFileSync(new URL('../fixtures/simplefin/accounts-v2.json', import.meta.url), 'utf8'));

function memory() {
	let value: unknown = null;
	return { load: () => value, save: (v: unknown) => void (value = v), peek: () => value };
}

function rejection(fn: () => void): ProviderError {
	try {
		fn();
	} catch (e) {
		if (e instanceof ProviderError) return e;
		throw e;
	}
	throw new Error('expected a ProviderError');
}

describe('RequestBudget', () => {
	it('allows up to the limit in 24 hours, then refuses with when to retry', () => {
		const budget = new RequestBudget(memory(), 3);
		for (let i = 0; i < 3; i++) {
			budget.check(1, at(i));
			budget.record(at(i));
		}
		const err = rejection(() => budget.check(1, at(3)));
		expect(err.kind).toBe('rate-limit');
		expect(err.retryAfter).toEqual(at(24)); // when the first request ages out
		expect(err.message).toMatch(/made 3 of its 3 daily SimpleFIN requests/);
	});

	it('lets requests age out after 24 hours', () => {
		const budget = new RequestBudget(memory(), 2);
		budget.record(at(0));
		budget.record(at(1));
		expect(() => budget.check(1, at(23))).toThrow(ProviderError);
		expect(() => budget.check(1, at(24.1))).not.toThrow();
		expect(budget.used(at(24.1))).toBe(1);
	});

	it('refuses a multi-request sync that would cross the limit, naming when it fits', () => {
		const budget = new RequestBudget(memory(), 5);
		[0, 1, 2].forEach((h) => budget.record(at(h)));
		expect(() => budget.check(2, at(3))).not.toThrow();
		const err = rejection(() => budget.check(3, at(3)));
		expect(err.retryAfter).toEqual(at(24)); // one old request has to go
	});

	it('explains a sync that can never fit', () => {
		expect(rejection(() => new RequestBudget(memory(), 2).check(3, NOW)).message).toMatch(/needs 3 SimpleFIN requests, more than the 2/);
	});

	it('pauses, and a shorter pause never cuts a longer one short', () => {
		const budget = new RequestBudget(memory());
		budget.pause(at(6));
		budget.pause(at(1));
		expect(rejection(() => budget.check(1, at(5))).message).toMatch(/slow down/);
		expect(() => budget.check(1, at(6.1))).not.toThrow();
	});

	it('survives garbage in storage', () => {
		const store = memory();
		store.save({ requests: ['nonsense', 42], pausedUntil: 7 });
		expect(new RequestBudget(store).used(NOW)).toBe(0);
	});

	it('defaults below SimpleFIN’s ~24 a day', () => {
		expect(SIMPLEFIN_DAILY_LIMIT).toBeLessThan(24);
	});
});

describe('SimpleFIN with a budget', () => {
	const connected = (budget: RequestBudget, ...responses: Parameters<typeof fakeHttp>) => {
		const http = fakeHttp(...responses);
		return { http, provider: new SimpleFinProvider(http, fakeSecrets({ [SIMPLEFIN_SECRET_ID]: 'https://u:p@sfin.example.test/simplefin' }), budget, () => NOW) };
	};

	it('never sends the request after the limit', async () => {
		const store = memory();
		const budget = new RequestBudget(store, 24);
		for (let i = 23; i >= 0; i--) budget.record(at(-i * 0.5));
		const { http, provider } = connected(budget);
		await expect(provider.fetch({ state: undefined, initialDays: 30, now: NOW })).rejects.toMatchObject({ kind: 'rate-limit' });
		await expect(provider.verify()).rejects.toMatchObject({ kind: 'rate-limit' });
		expect(http.requests).toHaveLength(0);
	});

	it('counts every request, including connection checks', async () => {
		const budget = new RequestBudget(memory());
		const { provider } = connected(budget, json(fixture), json(fixture));
		await provider.verify();
		await provider.fetch({ state: undefined, initialDays: 30, now: NOW });
		expect(budget.used(NOW)).toBe(2);
	});

	it('refuses a whole backfill up front rather than stopping halfway', async () => {
		const budget = new RequestBudget(memory(), 2);
		const { http, provider } = connected(budget);
		// 200 days = three 90-day windows = three requests
		await expect(provider.fetch({ state: undefined, initialDays: 200, now: NOW })).rejects.toMatchObject({ kind: 'rate-limit' });
		expect(http.requests).toHaveLength(0);
	});

	it('pauses for an hour after a 429', async () => {
		const budget = new RequestBudget(memory());
		const { provider } = connected(budget, json('', 429));
		await expect(provider.fetch({ state: undefined, initialDays: 30, now: NOW })).rejects.toMatchObject({ kind: 'rate-limit' });
		expect(() => budget.check(1, at(0.9))).toThrow(/slow down/);
		expect(() => budget.check(1, at(1.1))).not.toThrow();
	});

	it('pauses after SimpleFIN warns about the request rate, but keeps the data', async () => {
		const budget = new RequestBudget(memory());
		const warning = { errors: ['You are approaching your daily request limit.'], connections: [], accounts: [] };
		const { provider } = connected(budget, json(warning));
		const result = await provider.fetch({ state: undefined, initialDays: 30, now: NOW });
		expect(result.issues.map((i) => i.kind)).toEqual(['rate-limit-warning']);
		expect(() => budget.check(1, at(5))).toThrow(/slow down/);
	});
});

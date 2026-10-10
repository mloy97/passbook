import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	claimSetupToken,
	decodeSetupToken,
	parseAccessUrl,
	planWindows,
	SIMPLEFIN_SECRET_ID,
	SimpleFinProvider,
} from '../../src/providers/simplefin';
import { ProviderError } from '../../src/providers/types';
import { fakeHttp, fakeSecrets, json } from './fakes';

const fixture = (name: string): unknown =>
	JSON.parse(readFileSync(new URL(`../fixtures/simplefin/${name}`, import.meta.url), 'utf8'));

const CLAIM_URL = 'https://sfin.example.test/simplefin/claim/TOKEN-123';
const SETUP_TOKEN = btoa(CLAIM_URL);
const ACCESS_URL = 'https://user123:s3cr%3At@sfin.example.test/simplefin';
const NOW = new Date('2026-10-09T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function connected(...responses: Parameters<typeof fakeHttp>) {
	const http = fakeHttp(...responses);
	const secrets = fakeSecrets({ [SIMPLEFIN_SECRET_ID]: ACCESS_URL });
	return { http, secrets, provider: new SimpleFinProvider(http, secrets) };
}

async function kindOf(p: Promise<unknown>): Promise<string> {
	try {
		await p;
	} catch (e) {
		if (e instanceof ProviderError) return e.kind;
		throw e;
	}
	throw new Error('expected a ProviderError');
}

describe('setup token', () => {
	it('decodes to the claim URL', () => {
		expect(decodeSetupToken(`  ${SETUP_TOKEN}\n`)).toBe(CLAIM_URL);
	});

	it.each([
		['not base64', '%%%'],
		['base64 of something that is not a URL', btoa('hello')],
		['a plain-HTTP claim URL', btoa('http://sfin.example.test/claim/x')],
	])('rejects %s', async (_, token) => {
		expect(await kindOf(Promise.resolve().then(() => decodeSetupToken(token)))).toBe('setup-token');
	});

	it('claims with a POST and returns the access URL', async () => {
		const http = fakeHttp({ status: 200, text: `${ACCESS_URL}\n` });
		await expect(claimSetupToken(http, SETUP_TOKEN)).resolves.toBe(ACCESS_URL);
		expect(http.requests).toEqual([{ url: CLAIM_URL, method: 'POST' }]);
	});

	it('explains a used or unknown token (403)', async () => {
		const http = fakeHttp({ status: 403, text: '' });
		const err = await claimSetupToken(http, SETUP_TOKEN).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ProviderError);
		expect((err as ProviderError).kind).toBe('setup-token');
		expect((err as ProviderError).message).toMatch(/already used/);
	});

	it.each([
		['a server error', { status: 503, text: '' }, 'network'],
		['an unexpected status', { status: 418, text: '' }, 'bad-response'],
		['a body that is not an access URL', { status: 200, text: '<html>' }, 'bad-response'],
		['no response at all', new Error('offline'), 'network'],
	] as const)('maps %s', async (_, response, kind) => {
		expect(await kindOf(claimSetupToken(fakeHttp(response), SETUP_TOKEN))).toBe(kind);
	});
});

describe('access URL', () => {
	it('moves the credentials into a Basic auth header', () => {
		const { base, authorization } = parseAccessUrl(ACCESS_URL);
		expect(base).toBe('https://sfin.example.test/simplefin');
		expect(authorization).toBe('Basic ' + btoa('user123:s3cr:t'));
	});
});

describe('connect', () => {
	it('stores the access URL and verifies it', async () => {
		const http = fakeHttp({ status: 200, text: ACCESS_URL }, json(fixture('accounts-v2.json')));
		const secrets = fakeSecrets();
		const provider = new SimpleFinProvider(http, secrets);
		expect(provider.isConnected()).toBe(false);

		await provider.connect(SETUP_TOKEN);

		expect(secrets.get(SIMPLEFIN_SECRET_ID)).toBe(ACCESS_URL);
		expect(provider.isConnected()).toBe(true);
		const verify = http.requests[1];
		expect(verify?.url).toBe('https://sfin.example.test/simplefin/accounts?version=2&balances-only=1');
		expect(verify?.url).not.toContain('s3cr');
		expect(verify?.headers?.Authorization).toMatch(/^Basic /);
	});

	it('keeps the access URL when verification fails, since the token is spent', async () => {
		const http = fakeHttp({ status: 200, text: ACCESS_URL }, new Error('offline'));
		const secrets = fakeSecrets();
		expect(await kindOf(new SimpleFinProvider(http, secrets).connect(SETUP_TOKEN))).toBe('network');
		expect(secrets.get(SIMPLEFIN_SECRET_ID)).toBe(ACCESS_URL);
	});

	it('disconnect blanks the secret', () => {
		const { provider, secrets } = connected();
		provider.disconnect();
		expect(secrets.get(SIMPLEFIN_SECRET_ID)).toBe('');
		expect(provider.isConnected()).toBe(false);
	});
});

describe('fetch', () => {
	const request = { state: undefined, initialDays: 30, now: NOW };

	it('maps accounts, balances and transactions', async () => {
		const { provider } = connected(json(fixture('accounts-v2.json')));
		const result = await provider.fetch(request);

		expect(result.connections.map((c) => c.id)).toEqual(['CON-1', 'CON-2']);
		expect(result.connections[0]?.institutionDomain).toBe('example-bank.test');
		expect(result.accounts[0]).toEqual({
			id: 'ACT-CHK',
			connectionId: 'CON-1',
			name: 'Everyday Checking',
			currency: 'USD',
			balance: '1523.07',
			availableBalance: '1473.07',
			balanceAsOf: '2026-10-08T12:00:00.000Z',
		});
		expect(result.accounts[1]?.availableBalance).toBeUndefined();

		expect(result.upserts).toHaveLength(4);
		const pending = result.upserts.find((t) => t.id === 'TRN-P1');
		expect(pending).toMatchObject({ pending: true, postedAt: null, amount: '-50.00' });
		const posted = result.upserts.find((t) => t.id === 'TRN-1' && t.accountId === 'ACT-CHK');
		expect(posted).toMatchObject({ pending: false, postedAt: '2026-10-05T12:00:00.000Z', transactedAt: '2026-10-04T12:00:00.000Z' });
		// The same transaction ID in two accounts is two transactions.
		expect(result.upserts.filter((t) => t.id === 'TRN-1')).toHaveLength(2);

		expect(result.removed).toEqual([]);
		expect(result.issues).toEqual([]);
		expect(result.state).toEqual({ lastEnd: NOW.toISOString() });
	});

	it('asks for one window with pending transactions', async () => {
		const { provider, http } = connected(json(fixture('accounts-v2.json')));
		await provider.fetch(request);
		const url = new URL(http.requests[0]?.url ?? '');
		expect(url.pathname).toBe('/simplefin/accounts');
		expect(url.searchParams.get('version')).toBe('2');
		expect(url.searchParams.get('pending')).toBe('1');
		expect(Number(url.searchParams.get('end-date'))).toBe(NOW.getTime() / 1000);
		expect(Number(url.searchParams.get('start-date'))).toBe((NOW.getTime() - 30 * DAY) / 1000);
	});

	it('claims coverage for every account it got in full', async () => {
		const { provider } = connected(json(fixture('accounts-v2.json')));
		const { coverage } = await provider.fetch(request);
		expect(coverage).toEqual([
			{ accountId: 'ACT-CHK', start: new Date(NOW.getTime() - 30 * DAY).toISOString(), end: NOW.toISOString() },
			{ accountId: 'ACT-CARD', start: new Date(NOW.getTime() - 30 * DAY).toISOString(), end: NOW.toISOString() },
		]);
	});

	it('reports connection and account errors as issues, and claims no coverage for them', async () => {
		const { provider } = connected(json(fixture('accounts-v2-errors.json')));
		const result = await provider.fetch(request);

		expect(result.issues).toEqual([
			{ kind: 'connection-auth', message: 'First Example Bank needs you to sign in again.', connectionId: 'CON-1' },
			{ kind: 'account', message: 'Some transactions for Rewards Card could not be retrieved.', accountId: 'ACT-CARD' },
		]);
		expect(result.coverage.map((c) => c.accountId)).toEqual(['ACT-SAV']);
		// Balances still come through for the accounts with problems.
		expect(result.accounts.map((a) => a.id)).toEqual(['ACT-CHK', 'ACT-CARD', 'ACT-SAV']);
	});

	it('reads protocol v1 responses', async () => {
		const { provider } = connected(json(fixture('accounts-v1.json')));
		const result = await provider.fetch(request);
		expect(result.connections).toEqual([{ id: 'example-bank.test', name: 'First Example Bank', institutionDomain: 'example-bank.test' }]);
		expect(result.accounts[0]?.connectionId).toBe('example-bank.test');
		expect(result.upserts).toHaveLength(1);
	});

	it('flags rate-limit warnings from the deprecated errors list', async () => {
		const body = { errors: ['You are approaching your daily request limit.'], connections: [], accounts: [] };
		const { provider } = connected(json(body));
		const { issues } = await provider.fetch(request);
		expect(issues).toEqual([{ kind: 'rate-limit-warning', message: 'You are approaching your daily request limit.' }]);
	});

	it('does not claim coverage for an account with an unreadable transaction', async () => {
		const body = fixture('accounts-v2.json') as { accounts: { transactions: unknown[] }[] };
		body.accounts[0]?.transactions.push({ id: 'BROKEN', posted: 1791201600 });
		const { provider } = connected(json(body));
		const { coverage, upserts } = await provider.fetch(request);
		expect(coverage.map((c) => c.accountId)).toEqual(['ACT-CARD']);
		expect(upserts.some((t) => t.id === 'BROKEN')).toBe(false);
	});

	it.each([
		['revoked access (403)', json('', 403), 'auth'],
		['payment required (402)', json('', 402), 'payment-required'],
		['rate limited (429)', json('', 429), 'rate-limit'],
		['a server error', json('', 502), 'network'],
		['invalid JSON', json('{not json'), 'bad-response'],
		['JSON without accounts', json({ errlist: [] }), 'bad-response'],
		['gen.auth with no accounts', json({ errlist: [{ code: 'gen.auth', msg: 'Bad credentials' }], connections: [], accounts: [] }), 'auth'],
		['no response', new Error('offline'), 'network'],
	] as const)('maps %s', async (_, response, kind) => {
		const { provider } = connected(response);
		expect(await kindOf(provider.fetch(request))).toBe(kind);
	});

	it('refuses to fetch when not connected', async () => {
		const provider = new SimpleFinProvider(fakeHttp(), fakeSecrets());
		expect(await kindOf(provider.fetch(request))).toBe('not-connected');
	});

	it('never puts the access URL in its result or state', async () => {
		const { provider } = connected(json(fixture('accounts-v2.json')));
		const serialized = JSON.stringify(await provider.fetch(request));
		expect(serialized).not.toContain('s3cr');
		expect(serialized).not.toContain('user123');
	});

	it('splits a long first sync into 90-day windows, newest balances winning', async () => {
		const older = fixture('accounts-v2.json') as { accounts: { balance: string }[] };
		const newer = fixture('accounts-v2.json') as { accounts: { balance: string }[] };
		if (older.accounts[0]) older.accounts[0].balance = '1.00';
		const { provider, http } = connected(json(older), json(older), json(newer));

		const result = await provider.fetch({ ...request, initialDays: 200 });

		expect(http.requests).toHaveLength(3);
		expect(result.accounts[0]?.balance).toBe('1523.07');
		expect(result.coverage).toHaveLength(6);
		expect(result.upserts).toHaveLength(4); // de-duplicated across windows
	});
});

describe('planWindows', () => {
	const span = (w: { start: Date; end: Date }) => (w.end.getTime() - w.start.getTime()) / DAY;

	it('goes back initialDays on the first sync', () => {
		const windows = planWindows(undefined, 30, NOW);
		expect(windows).toHaveLength(1);
		expect(windows[0]?.end).toEqual(NOW);
		expect(windows[0] && span(windows[0])).toBe(30);
	});

	it('caps each window at 90 days, oldest first, with no gaps', () => {
		const windows = planWindows(undefined, 200, NOW);
		expect(windows.map(span)).toEqual([90, 90, 20]);
		expect(windows[1]?.start).toEqual(windows[0]?.end);
		expect(windows[2]?.end).toEqual(NOW);
	});

	it('overlaps the previous sync by 5 days', () => {
		const lastEnd = new Date(NOW.getTime() - 2 * DAY);
		const windows = planWindows({ lastEnd: lastEnd.toISOString() }, 30, NOW);
		expect(windows).toHaveLength(1);
		expect(windows[0]?.start).toEqual(new Date(lastEnd.getTime() - 5 * DAY));
	});

	it('still covers the last 5 days when synced moments ago', () => {
		const windows = planWindows({ lastEnd: NOW.toISOString() }, 30, NOW);
		expect(windows[0] && span(windows[0])).toBe(5);
	});

	it('ignores unreadable state', () => {
		expect(planWindows({ lastEnd: 'garbage' }, 30, NOW)[0]?.start).toEqual(new Date(NOW.getTime() - 30 * DAY));
	});
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { apply, emptyLedger } from '../../src/ledger/ledger';
import { SIMPLEFIN_SECRET_ID, SimpleFinProvider } from '../../src/providers/simplefin';
import { fakeHttp, fakeSecrets, json } from '../providers/fakes';

// Every field in docs/schema.md, with its runtime type. Keep in step with the doc.
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^-?\d+(\.\d+)?$/;

const ACCOUNT_FIELDS: Record<string, (v: unknown) => boolean> = {
	id: (v) => typeof v === 'string' && v.length > 0,
	name: (v) => typeof v === 'string',
	institution: (v) => typeof v === 'string',
	institutionDomain: (v) => v === null || typeof v === 'string',
	currency: (v) => typeof v === 'string' && v.length > 0,
	balance: (v) => typeof v === 'string' && DECIMAL.test(v),
	availableBalance: (v) => v === null || (typeof v === 'string' && DECIMAL.test(v)),
	balanceAsOf: (v) => typeof v === 'string' && ISO_TIME.test(v),
	lastSyncedAt: (v) => typeof v === 'string' && ISO_TIME.test(v),
};

const TRANSACTION_FIELDS: Record<string, (v: unknown) => boolean> = {
	id: (v) => typeof v === 'string' && v.length > 0,
	accountId: (v) => typeof v === 'string',
	amount: (v) => typeof v === 'string' && DECIMAL.test(v),
	currency: (v) => typeof v === 'string',
	description: (v) => typeof v === 'string',
	status: (v) => v === 'pending' || v === 'posted',
	date: (v) => typeof v === 'string' && DATE.test(v),
	postedAt: (v) => v === null || (typeof v === 'string' && ISO_TIME.test(v)),
	transactedAt: (v) => v === null || (typeof v === 'string' && ISO_TIME.test(v)),
	firstSeenAt: (v) => typeof v === 'string' && ISO_TIME.test(v),
	updatedAt: (v) => typeof v === 'string' && ISO_TIME.test(v),
};

function conforms(value: object, fields: Record<string, (v: unknown) => boolean>): string[] {
	const problems: string[] = [];
	const record = value as Record<string, unknown>;
	for (const [key, ok] of Object.entries(fields)) if (!(key in record) || !ok(record[key])) problems.push(key);
	for (const key of Object.keys(record)) if (!(key in fields)) problems.push(`unexpected ${key}`);
	return problems;
}

describe('schema v1', () => {
	it.each(['accounts-v2.json', 'accounts-v2-errors.json', 'accounts-v1.json'])('holds for SimpleFIN %s', async (name) => {
		const body: unknown = JSON.parse(readFileSync(new URL(`../fixtures/simplefin/${name}`, import.meta.url), 'utf8'));
		const provider = new SimpleFinProvider(fakeHttp(json(body)), fakeSecrets({ [SIMPLEFIN_SECRET_ID]: 'https://u:p@sfin.example.test/simplefin' }));
		const result = await provider.fetch({ state: undefined, initialDays: 30, now: new Date('2026-10-09T12:00:00Z') });

		const data = emptyLedger();
		apply(data, result, 'simplefin', new Date('2026-10-09T12:00:00Z'));

		expect(data.accounts.size).toBeGreaterThan(0);
		for (const a of data.accounts.values()) expect(conforms(a, ACCOUNT_FIELDS)).toEqual([]);
		for (const t of data.transactions.values()) {
			expect(conforms(t, TRANSACTION_FIELDS)).toEqual([]);
			expect(data.accounts.has(t.accountId)).toBe(true);
		}
	});
});

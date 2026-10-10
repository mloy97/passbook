import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { createApiV1, PassBookApiV1 } from '../../src/api/v1';
import { apply, emptyLedger, LedgerData } from '../../src/ledger/ledger';
import { FetchResult } from '../../src/providers/types';

// The example is the real file users copy, loaded the way Templater loads it (CommonJS).
const passbookDaily = createRequire(import.meta.url)('../../examples/templater/passbook_daily.js') as (api?: PassBookApiV1) => Promise<string>;

const NOW = new Date('2026-10-09T12:00:00Z');

function apiOver(data: LedgerData): PassBookApiV1 {
	return createApiV1({ load: async () => data, sync: () => Promise.reject(new Error('not in this test')) }, new Set());
}

function seeded(): LedgerData {
	const data = emptyLedger();
	const base: FetchResult = {
		connections: [{ id: 'C1', name: 'First Bank' }],
		accounts: [
			{ id: 'A1', connectionId: 'C1', name: 'Checking', currency: 'USD', balance: '12523.5', availableBalance: '12473.07', balanceAsOf: NOW.toISOString() },
			{ id: 'A2', connectionId: 'C1', name: 'Card | Rewards', currency: 'USD', balance: '-312.99', balanceAsOf: NOW.toISOString() },
		],
		upserts: [{ id: 'old', accountId: 'A1', amount: '-1.00', description: 'OLD', pending: false, postedAt: '2026-10-01T12:00:00.000Z' }],
		removed: [],
		coverage: [],
		issues: [],
		state: null,
	};
	apply(data, base, 'simplefin', new Date('2026-10-08T12:00:00Z'));
	apply(
		data,
		{
			...base,
			upserts: [
				...base.upserts,
				{ id: 'n1', accountId: 'A2', amount: '-42.5', description: 'GROCERY | MART', pending: false, postedAt: '2026-10-09T08:00:00.000Z' },
				{ id: 'n2', accountId: 'A1', amount: '2100.00', description: 'PAYROLL', pending: true, postedAt: null },
			],
		},
		'simplefin',
		NOW,
	);
	return data;
}

describe('examples/templater/passbook_daily.js', () => {
	it('renders balances and what is new since the last sync', async () => {
		const out = await passbookDaily(apiOver(seeded()));
		const lines = out.split('\n');
		expect(lines.slice(0, 6)).toEqual([
			'## Balances',
			'',
			'| Account | Balance | Available |',
			'|---|---:|---:|',
			'| First Bank · Card \\| Rewards | -312.99 USD |  |',
			'| First Bank · Checking | 12,523.50 USD | 12,473.07 |',
		]);
		expect(out).toContain('## New since last sync (2)');
		expect(out).toContain('| 2026-10-09 | Card \\| Rewards | GROCERY \\| MART | -42.50 |');
		expect(out).toContain('| 2026-10-09 | Checking | PAYROLL *(pending)* | 2,100.00 |');
		expect(out).not.toContain('OLD');
		expect(out).toMatch(/\*Last synced .+\.\*$/);
	});

	it('says so when there is no data yet', async () => {
		expect(await passbookDaily(apiOver(emptyLedger()))).toMatch(/No bank data yet/);
	});

	it('says so when PassBook is missing', async () => {
		expect(await passbookDaily(undefined)).toMatch(/isn’t installed or enabled/);
	});
});

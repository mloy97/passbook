// Demo provider: made-up accounts and transactions, so anyone (store reviewers
// included) can try every feature without a bank or an account. No network calls.
//
// The data is a pure function of the date, so every sync on the same day agrees and
// each day adds a little. It behaves like a real bank where it matters: charges from
// the last two days are pending under one ID and post under another, so the ledger's
// pending-to-posted handling gets exercised exactly as with SimpleFIN.

import { FetchRequest, FetchResult, Provider, ProviderAccount, ProviderCapabilities, ProviderTransaction } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;
const PENDING_DAYS = 2;

interface DemoAccount {
	id: string;
	connectionId: string;
	name: string;
	opening: number; // cents, 365 days before the epoch below
	merchants: [string, number, number][]; // name, cents (negative = spend), every N days
}

const CONNECTIONS = [
	{ id: 'demo-bank', name: 'Demo Savings Bank', institutionDomain: 'bank.example' },
	{ id: 'demo-card', name: 'Demo Card Co', institutionDomain: 'card.example' },
];

const ACCOUNTS: DemoAccount[] = [
	{
		id: 'checking',
		connectionId: 'demo-bank',
		name: 'Everyday Checking',
		opening: 250_000,
		merchants: [
			['PAYROLL DEPOSIT', 285_000, 14],
			['RENT PAYMENT', -165_000, 30],
			['CORNER GROCERY', -6_843, 3],
			['CITY POWER & LIGHT', -9_420, 30],
			['COFFEE ROASTERS', -575, 2],
			['TRANSFER TO SAVINGS', -20_000, 14],
		],
	},
	{
		id: 'savings',
		connectionId: 'demo-bank',
		name: 'High Yield Savings',
		opening: 1_000_000,
		merchants: [
			['TRANSFER FROM CHECKING', 20_000, 14],
			['INTEREST PAID', 312, 30],
		],
	},
	{
		id: 'card',
		connectionId: 'demo-card',
		name: 'Rewards Card',
		opening: -42_000,
		merchants: [
			['STREAMING SERVICE', -1_599, 30],
			['BOOKSHOP', -2_450, 9],
			['GAS STATION', -4_210, 6],
			['RESTAURANT', -5_833, 5],
			['PAYMENT - THANK YOU', 60_000, 30],
		],
	},
];

/** Days since 2000-01-01 UTC. The schedule hangs off this, so it never shifts. */
const dayNumber = (time: number) => Math.floor(time / DAY_MS) - 10957;

export class DemoProvider implements Provider {
	readonly id = 'demo' as const;
	readonly capabilities: ProviderCapabilities = {
		syncModel: 'window',
		pending: true,
		cardStatements: false,
		connectionRepair: false,
	};

	isConnected(): boolean {
		return true;
	}

	async verify(): Promise<void> {}

	disconnect(): void {}

	async fetch(request: FetchRequest): Promise<FetchResult> {
		const end = request.now.getTime();
		const start = end - request.initialDays * DAY_MS;
		const today = dayNumber(end);

		const accounts: ProviderAccount[] = [];
		const upserts: ProviderTransaction[] = [];
		for (const a of ACCOUNTS) {
			let balance = a.opening;
			for (let day = today - 365; day <= today; day++) {
				const midday = (day + 10957) * DAY_MS + 12 * 3600 * 1000;
				for (const [index, [description, cents, every]] of a.merchants.entries()) {
					// Stagger merchants so they don't all land on the same day.
					if ((day + index * 7) % every !== 0) continue;
					const amount = vary(cents, day, index);
					balance += amount;
					if (midday < start || midday > end) continue;
					const pending = today - day < PENDING_DAYS;
					upserts.push({
						// A different ID once posted, like many real banks.
						id: `${pending ? 'p' : 't'}-${day}-${index}`,
						accountId: a.id,
						amount: format(amount),
						description,
						pending,
						postedAt: pending ? null : new Date(midday + DAY_MS).toISOString(),
						transactedAt: new Date(midday).toISOString(),
					});
				}
			}
			accounts.push({
				id: a.id,
				connectionId: a.connectionId,
				name: a.name,
				currency: 'USD',
				balance: format(balance),
				availableBalance: a.id === 'checking' ? format(balance - 2_500) : undefined,
				balanceAsOf: new Date(end).toISOString(),
			});
		}

		return {
			connections: CONNECTIONS,
			accounts,
			upserts,
			removed: [],
			coverage: accounts.map((a) => ({ accountId: a.id, start: new Date(start).toISOString(), end: new Date(end).toISOString() })),
			issues: [],
			state: null,
		};
	}
}

/** The same amount, nudged a little day to day so the data doesn't look stamped out. */
function vary(cents: number, day: number, index: number): number {
	if (Math.abs(cents) >= 20_000) return cents; // pay, rent, transfers stay exact
	const wobble = ((day * 31 + index * 17) % 21) - 10; // -10..10 percent
	return Math.round(cents * (1 + wobble / 100));
}

function format(cents: number): string {
	const sign = cents < 0 ? '-' : '';
	const abs = Math.abs(cents);
	return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

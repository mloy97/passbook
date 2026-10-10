// Accounts and transactions as CSV (RFC 4180), for spreadsheets. Used by the CSV
// mirror in the data folder and by the Export command. Columns are part of the
// public schema (docs/schema.md): add new ones at the end only.

import { Account, Transaction } from '../ledger/schema';

export const TRANSACTION_COLUMNS = [
	'date',
	'account',
	'institution',
	'description',
	'amount',
	'currency',
	'status',
	'posted_at',
	'transacted_at',
	'first_seen_at',
	'updated_at',
	'account_id',
	'transaction_id',
] as const;

export const ACCOUNT_COLUMNS = [
	'institution',
	'name',
	'balance',
	'available_balance',
	'currency',
	'balance_as_of',
	'last_synced_at',
	'institution_domain',
	'account_id',
] as const;

export function transactionsCsv(transactions: Transaction[], accounts: Map<string, Account>): string {
	return table(
		TRANSACTION_COLUMNS,
		transactions.map((t) => {
			const a = accounts.get(t.accountId);
			return [
				t.date,
				text(a?.name ?? ''),
				text(a?.institution ?? ''),
				text(t.description),
				t.amount,
				t.currency,
				t.status,
				t.postedAt ?? '',
				t.transactedAt ?? '',
				t.firstSeenAt,
				t.updatedAt,
				t.accountId,
				t.id,
			];
		}),
	);
}

export function accountsCsv(accounts: Account[]): string {
	return table(
		ACCOUNT_COLUMNS,
		accounts.map((a) => [
			text(a.institution),
			text(a.name),
			a.balance,
			a.availableBalance ?? '',
			a.currency,
			a.balanceAsOf,
			a.lastSyncedAt,
			a.institutionDomain ?? '',
			a.id,
		]),
	);
}

function table(columns: readonly string[], rows: string[][]): string {
	return [columns.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n') + '\r\n';
}

/**
 * Text that came from a bank. A leading = + - @ (or tab/CR) would make a spreadsheet
 * run it as a formula, so prefix a quote. Amounts aren't passed through here: they're
 * validated numbers and must stay numeric.
 */
function text(value: string): string {
	return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function cell(value: string): string {
	return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

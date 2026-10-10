// Public schema v1 (docs/schema.md). These types are part of api.v1: change them only
// additively, or bump SCHEMA_VERSION with a migration.

export const SCHEMA_VERSION = 1;

export interface Account {
	id: string;
	name: string;
	institution: string;
	institutionDomain: string | null;
	currency: string;
	balance: string;
	availableBalance: string | null;
	balanceAsOf: string;
	lastSyncedAt: string;
}

export interface Balance {
	accountId: string;
	balance: string;
	availableBalance: string | null;
	currency: string;
	asOf: string;
}

export type TransactionStatus = 'pending' | 'posted';

export interface Transaction {
	id: string;
	accountId: string;
	amount: string;
	currency: string;
	description: string;
	status: TransactionStatus;
	date: string;
	postedAt: string | null;
	transactedAt: string | null;
	firstSeenAt: string;
	updatedAt: string;
}

export interface LastSync {
	at: string;
	newTransactionIds: string[];
}

export interface AccountsFile {
	schemaVersion: typeof SCHEMA_VERSION;
	accounts: Account[];
}

export interface TransactionsFile {
	schemaVersion: typeof SCHEMA_VERSION;
	month: string;
	transactions: Transaction[];
}

export interface SyncFile {
	schemaVersion: typeof SCHEMA_VERSION;
	lastSync: LastSync | null;
}

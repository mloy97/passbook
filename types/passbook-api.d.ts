// Type definitions for PassBook's public API (api.v1, schema v1).
// Copy this file into your plugin or script project. Reach the API with:
//   const api = app.plugins.plugins.passbook?.api.v1;
// tests/api/types.test.ts keeps it in step with the source.

export interface PassBookAccount {
	id: string;
	name: string;
	institution: string;
	institutionDomain: string | null;
	currency: string;
	/** Decimal string. Positive is money in the account; credit cards are usually negative. */
	balance: string;
	availableBalance: string | null;
	balanceAsOf: string;
	lastSyncedAt: string;
}

export interface PassBookBalance {
	accountId: string;
	balance: string;
	availableBalance: string | null;
	currency: string;
	asOf: string;
}

export type PassBookTransactionStatus = 'pending' | 'posted';

export interface PassBookTransaction {
	id: string;
	accountId: string;
	/** Decimal string. Positive is money into the account. */
	amount: string;
	currency: string;
	description: string;
	status: PassBookTransactionStatus;
	/** YYYY-MM-DD (UTC): posted date, else transaction date, else first seen. */
	date: string;
	postedAt: string | null;
	transactedAt: string | null;
	firstSeenAt: string;
	updatedAt: string;
}

export interface PassBookLastSync {
	at: string;
	newTransactionIds: string[];
}

export interface PassBookTransactionQuery {
	since?: string | Date;
	until?: string | Date;
	accountId?: string;
	status?: PassBookTransactionStatus;
}

export interface PassBookSyncResult {
	at: string;
	accounts: number;
	newTransactions: number;
	updatedTransactions: number;
	removedTransactions: number;
	newTransactionIds: string[];
	problems: string[];
}

export interface PassBookApiV1 {
	readonly version: 1;
	readonly schemaVersion: 1;
	sync(): Promise<PassBookSyncResult>;
	getAccounts(): Promise<PassBookAccount[]>;
	getBalances(): Promise<PassBookBalance[]>;
	getTransactions(query?: PassBookTransactionQuery): Promise<PassBookTransaction[]>;
	getNewSinceLastSync(): Promise<PassBookTransaction[]>;
	getLastSync(): Promise<PassBookLastSync | null>;
	onSyncCompleted(listener: (result: PassBookSyncResult) => void): () => void;
}

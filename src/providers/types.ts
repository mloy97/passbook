// The provider interface (ADR 0002). Everything downstream of src/providers/ talks to
// this, never to a specific provider.
//
// Conventions at this boundary:
// - Amounts are decimal strings exactly as the provider sent them; positive is money
//   into the account. No floats.
// - Times are ISO 8601 strings in UTC.
// - IDs are the provider's own. Account IDs are unique within a connection,
//   transaction IDs within an account. The sync engine namespaces them.

import { UserFacingError } from '../errors';

export type ProviderId = 'simplefin' | 'plaid' | 'demo';

export interface ProviderConnection {
	id: string;
	/** Human-friendly; usually the institution name. */
	name: string;
	institutionDomain?: string;
}

export interface ProviderAccount {
	id: string;
	connectionId: string;
	name: string;
	/** ISO 4217 code, or a URL for a custom currency (SimpleFIN allows both). */
	currency: string;
	balance: string;
	availableBalance?: string;
	/** When the balance values took their current state. */
	balanceAsOf: string;
}

export interface ProviderTransaction {
	id: string;
	accountId: string;
	amount: string;
	description: string;
	pending: boolean;
	/** When it posted; null while pending. */
	postedAt: string | null;
	/** When it happened, if the provider says. */
	transactedAt?: string;
	/** The pending transaction this one replaces, if the provider links them (Plaid does). */
	replacesId?: string;
}

/**
 * A stretch of one account's history that this result fully lists. Any transaction
 * the ledger holds for that account inside [start, end) that's missing from the result
 * no longer exists. That is how window providers report removals, including a pending
 * transaction that posts under a new ID.
 */
export interface Coverage {
	accountId: string;
	start: string;
	end: string;
}

/** A problem that didn't stop the fetch, e.g. one connection needing re-authentication. */
export interface ProviderIssue {
	kind: 'connection-auth' | 'connection' | 'account' | 'rate-limit-warning' | 'other';
	message: string;
	connectionId?: string;
	accountId?: string;
}

export interface FetchResult {
	connections: ProviderConnection[];
	accounts: ProviderAccount[];
	/** New or changed transactions. */
	upserts: ProviderTransaction[];
	/** Explicit removals, for cursor providers. */
	removed: { accountId: string; id: string }[];
	/** Complete windows, for window providers. */
	coverage: Coverage[];
	issues: ProviderIssue[];
	/** Provider-owned, JSON-serializable, never secret. Passed back on the next fetch. */
	state: unknown;
}

export interface FetchRequest {
	/** What the last successful fetch returned; undefined on the first sync. */
	state: unknown;
	/** How far back to go on a first sync. */
	initialDays: number;
	now: Date;
}

export interface ProviderCapabilities {
	/** How the provider reports changes. */
	syncModel: 'window' | 'cursor';
	pending: boolean;
	/** Statement balance, minimum payment, due date and APR (Plaid Liabilities). */
	cardStatements: boolean;
	/** Re-authenticate a broken connection without re-linking. */
	connectionRepair: boolean;
}

export interface CardStatement {
	accountId: string;
	statementBalance?: string;
	minimumPayment?: string;
	dueDate?: string;
	apr?: string;
}

export interface Provider {
	readonly id: ProviderId;
	readonly capabilities: ProviderCapabilities;
	/** Whether this device holds what the provider needs to fetch. Makes no network call. */
	isConnected(): boolean;
	/** Checks the stored credentials with one cheap request. Throws ProviderError. */
	verify(): Promise<void>;
	/** Throws ProviderError when nothing usable came back; partial problems go in `issues`. */
	fetch(request: FetchRequest): Promise<FetchResult>;
	/** Forgets this device's credentials. */
	disconnect(): void;
	getCardStatements?(): Promise<CardStatement[]>;
	repairConnection?(connectionId: string): Promise<void>;
}

export type ProviderErrorKind =
	/** Setup token malformed, unknown or already used. */
	| 'setup-token'
	/** Stored credentials rejected or revoked. */
	| 'auth'
	/** The provider's account needs payment. */
	| 'payment-required'
	/** Over a request limit; `retryAfter` when known. */
	| 'rate-limit'
	/** No response: offline, DNS, timeout. */
	| 'network'
	/** A response we can't parse or that breaks the protocol. */
	| 'bad-response'
	/** Not connected on this device. */
	| 'not-connected';

export class ProviderError extends UserFacingError {
	constructor(
		readonly kind: ProviderErrorKind,
		message: string,
		readonly retryAfter?: Date,
	) {
		super(message);
		this.name = 'ProviderError';
	}
}

/**
 * The only way a provider touches secrets: its own entries in Obsidian SecretStorage.
 * IDs must be lowercase alphanumeric with dashes.
 */
export interface SecretStore {
	get(id: string): string | null;
	set(id: string, value: string): void;
}

export interface HttpRequest {
	url: string;
	method: 'GET' | 'POST';
	headers?: Record<string, string>;
	body?: string;
}

export interface HttpResponse {
	status: number;
	text: string;
}

/**
 * Providers make every network call through this, so tests can replace it and the
 * README disclosure has one place to check. Must resolve on any HTTP status and
 * reject only when there's no response.
 */
export type Http = (request: HttpRequest) => Promise<HttpResponse>;

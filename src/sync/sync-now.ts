// "Sync now": one provider fetch, applied to the ledger and saved.

import { UserFacingError } from '../errors';
import { apply, hasProviderData } from '../ledger/ledger';
import { LedgerStore } from '../ledger/store';
import { Provider, ProviderError, ProviderIssue } from '../providers/types';

/** First sync goes back this far. SimpleFIN allows at most 90 days per request. */
export const INITIAL_DAYS = 90;

/** Provider sync state, kept in data.json. Never secret (ADR 0002). */
export interface StateStore {
	load(): Promise<unknown>;
	save(state: unknown): Promise<void>;
}

export interface SyncDeps {
	provider: Provider;
	ledger: LedgerStore;
	state: StateStore;
	/** False on devices set not to sync (#17). */
	isSyncDevice: () => boolean;
	now: Date;
}

export interface SyncSummary {
	at: string;
	accounts: number;
	newTransactions: number;
	updatedTransactions: number;
	removedTransactions: number;
	newTransactionIds: string[];
	issues: ProviderIssue[];
}

export class NotSyncDeviceError extends UserFacingError {
	constructor() {
		super('This device is set not to sync. Turn on “This device syncs” in PassBook’s settings to sync from here.');
		this.name = 'NotSyncDeviceError';
	}
}

export async function syncNow({ provider, ledger, state, isSyncDevice, now }: SyncDeps): Promise<SyncSummary> {
	if (!provider.isConnected()) {
		throw new ProviderError('not-connected', 'Connect SimpleFIN in PassBook’s settings first.');
	}
	if (!isSyncDevice()) throw new NotSyncDeviceError();

	// Finish any layout change first, so the ledger is read from and written to one place.
	await ledger.relayout();
	const data = await ledger.load();
	// Saved state only means something alongside the data it was saved with. Without it
	// (first sync, a new data folder, data deleted), start over with a full first sync.
	const saved = hasProviderData(data, provider.id) ? await state.load() : undefined;
	const result = await provider.fetch({ state: saved, initialDays: INITIAL_DAYS, now });
	const outcome = apply(data, result, provider.id, now);

	// Ledger first: if saving state then fails, the next sync re-fetches the same
	// window, which is harmless. The other order could skip a window.
	await ledger.save(data, outcome.dirtyMonths);
	await state.save(result.state);

	return {
		at: now.toISOString(),
		accounts: result.accounts.length,
		newTransactions: outcome.newIds.length,
		updatedTransactions: outcome.updatedIds.length,
		removedTransactions: outcome.removedIds.length,
		newTransactionIds: outcome.newIds,
		issues: result.issues,
	};
}

export function describeSummary(s: Pick<SyncSummary, 'accounts' | 'newTransactions' | 'issues'>): string {
	const accounts = `${s.accounts} account${s.accounts === 1 ? '' : 's'}`;
	const tx = `${s.newTransactions} new transaction${s.newTransactions === 1 ? '' : 's'}`;
	let text = `PassBook synced ${accounts}, ${tx}.`;
	if (s.issues.length > 0) {
		text += `\n${s.issues.length === 1 ? 'One problem' : `${s.issues.length} problems`}:`;
		for (const i of s.issues) text += `\n• ${i.message}`;
	}
	return text;
}

// A rolling 24-hour request budget, so PassBook never gets a SimpleFIN token disabled.
// SimpleFIN expects at most about 24 requests a day and disables tokens that keep
// going past its warnings (https://beta-bridge.simplefin.org/info/developers).

import { ProviderError } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Below SimpleFIN's ~24, leaving room for connection checks and retries. */
export const SIMPLEFIN_DAILY_LIMIT = 20;
/** After a 429: how long to stop asking. */
export const PAUSE_AFTER_429_MS = 60 * 60 * 1000;
/** After SimpleFIN warns about the request rate: how long to stop asking. */
export const PAUSE_AFTER_WARNING_MS = 6 * 60 * 60 * 1000;

interface BudgetState {
	/** ISO times of requests in the last 24 hours. */
	requests: string[];
	pausedUntil?: string;
}

/** Where the budget persists. Per device: only the sync device spends it. */
export interface BudgetStore {
	load(): unknown;
	save(value: unknown): void;
}

export class RequestBudget {
	constructor(
		private readonly store: BudgetStore,
		private readonly limit = SIMPLEFIN_DAILY_LIMIT,
	) {}

	/** Requests made in the 24 hours before `now`. */
	used(now: Date): number {
		return this.recent(now).length;
	}

	/** Throws ProviderError('rate-limit') unless `count` more requests fit right now. */
	check(count: number, now: Date): void {
		const state = this.state();
		if (state.pausedUntil && Date.parse(state.pausedUntil) > now.getTime()) {
			const until = new Date(state.pausedUntil);
			throw new ProviderError('rate-limit', `SimpleFIN asked PassBook to slow down. Try again after ${formatTime(until)}.`, until);
		}
		const recent = this.recent(now);
		if (recent.length + count <= this.limit) return;
		// The request that has to age out before `count` more fit.
		const blocking = recent[recent.length + count - this.limit - 1] ?? recent[0] ?? now.getTime();
		const until = new Date(blocking + DAY_MS);
		throw new ProviderError(
			'rate-limit',
			count > this.limit
				? `This sync needs ${count} SimpleFIN requests, more than the ${this.limit} PassBook allows in a day.`
				: `PassBook has made ${recent.length} of its ${this.limit} daily SimpleFIN requests, and this needs ${count}. Try again after ${formatTime(until)}.`,
			until,
		);
	}

	record(now: Date): void {
		const state = this.state();
		const recent = this.recent(now).map((t) => new Date(t).toISOString());
		this.store.save({ ...state, requests: [...recent, now.toISOString()] });
	}

	pause(until: Date): void {
		const state = this.state();
		if (state.pausedUntil && Date.parse(state.pausedUntil) >= until.getTime()) return;
		this.store.save({ ...state, pausedUntil: until.toISOString() });
	}

	private recent(now: Date): number[] {
		const since = now.getTime() - DAY_MS;
		return this.state()
			.requests.map((t) => Date.parse(t))
			.filter((t) => Number.isFinite(t) && t > since && t <= now.getTime())
			.sort((a, b) => a - b);
	}

	private state(): BudgetState {
		const raw = this.store.load();
		if (typeof raw !== 'object' || raw === null) return { requests: [] };
		const r = raw as Partial<BudgetState>;
		return {
			requests: Array.isArray(r.requests) ? r.requests.filter((t): t is string => typeof t === 'string') : [],
			pausedUntil: typeof r.pausedUntil === 'string' ? r.pausedUntil : undefined,
		};
	}
}

function formatTime(d: Date): string {
	return d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

// Connection state for a provider's settings UI: what to show, and the actions behind
// the buttons. No Obsidian imports, so it's unit-tested directly.

import { UserFacingError } from '../errors';

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'checking';

export interface ConnectionState {
	status: ConnectionStatus;
	/** When this device last confirmed the connection works. */
	lastVerified?: string;
	/** Readable message from the last failed action. */
	error?: string;
}

/** What the controller needs from a provider. */
export interface Connectable {
	isConnected(): boolean;
	connect(token: string): Promise<void>;
	verify(): Promise<void>;
	disconnect(): void;
}

/** Per-device storage (Obsidian's vault-scoped localStorage), so nothing here syncs. */
export interface LocalStore {
	load(key: string): unknown;
	save(key: string, value: unknown): void;
}

export class ConnectionController {
	private state: ConnectionState;
	private readonly listeners = new Set<(s: ConnectionState) => void>();

	constructor(
		private readonly provider: Connectable,
		private readonly local: LocalStore,
		private readonly key: string,
		private readonly now: () => Date = () => new Date(),
	) {
		const saved = local.load(key);
		this.state = {
			status: provider.isConnected() ? 'connected' : 'disconnected',
			lastVerified: provider.isConnected() && typeof saved === 'string' ? saved : undefined,
		};
	}

	get current(): ConnectionState {
		return this.state;
	}

	onChange(listener: (s: ConnectionState) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async connect(token: string): Promise<void> {
		if (this.busy) return;
		if (!token.trim()) {
			this.set({ status: 'disconnected', error: 'Paste a setup token first.' });
			return;
		}
		this.set({ status: 'connecting' });
		try {
			await this.provider.connect(token);
			this.verified();
		} catch (e) {
			// A spent token can still leave a stored, working access URL behind.
			this.set({ status: this.provider.isConnected() ? 'connected' : 'disconnected', error: message(e) });
		}
	}

	async check(): Promise<void> {
		if (this.busy || !this.provider.isConnected()) return;
		this.set({ ...this.state, status: 'checking', error: undefined });
		try {
			await this.provider.verify();
			this.verified();
		} catch (e) {
			this.set({ status: 'connected', lastVerified: this.state.lastVerified, error: message(e) });
		}
	}

	disconnect(): void {
		this.provider.disconnect();
		this.local.save(this.key, null);
		this.set({ status: 'disconnected' });
	}

	private get busy(): boolean {
		return this.state.status === 'connecting' || this.state.status === 'checking';
	}

	private verified(): void {
		const at = this.now().toISOString();
		this.local.save(this.key, at);
		this.set({ status: 'connected', lastVerified: at });
	}

	private set(state: ConnectionState): void {
		this.state = state;
		for (const l of this.listeners) l(state);
	}
}

export function message(e: unknown): string {
	if (e instanceof UserFacingError) return e.message;
	return 'Something went wrong. Try again.';
}

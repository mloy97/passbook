import { apiVersion, normalizePath, Notice, Platform, Plugin } from 'obsidian';
import { UserFacingError } from './errors';
import { DEFAULT_DATA_FOLDER } from './ledger/defaults';
import { DEFAULT_LAYOUT, isLayout, Layout } from './ledger/layout';
import { obsidianFiles } from './ledger/obsidian-files';
import { LedgerStore } from './ledger/store';
import { RequestBudget } from './providers/budget';
import { obsidianHttp, obsidianSecrets } from './providers/obsidian-adapters';
import { SimpleFinProvider } from './providers/simplefin';
import { Http, Provider, ProviderId } from './providers/types';
import { DemoProvider } from './providers/demo';
import { ConnectionController, LocalStore, message } from './settings/connection';
import { PassBookSettingTab } from './settings/tab';
import { describeSummary, StateStore, SyncSummary, syncNow } from './sync/sync-now';
import { registerCommands } from './commands';
import { DiagnosticInfo } from './feedback/feedback';
import { createApiV1, PassBookApiV1, SyncResult, toSyncResult } from './api/v1';

const SYNC_DEVICE_KEY = 'passbook-sync-device';

/** What PassBook keeps in data.json. Synced between devices, so never anything secret. */
export interface PluginData {
	dataFolder: string;
	/** Where data comes from. Demo uses made-up data and its own folder. */
	provider: 'simplefin' | 'demo';
	/** Folder layout inside the data folder (docs/schema.md). */
	layout: Layout;
	/** Also write a CSV mirror of the JSON. */
	csv: boolean;
	providerState?: Partial<Record<ProviderId, unknown>>;
}

export default class PassBookPlugin extends Plugin {
	/**
	 * Every request goes through here. End-to-end tests replace it with a fake from
	 * inside Obsidian, so it's read on each call rather than captured.
	 */
	http: Http = obsidianHttp;
	settings: PluginData = { dataFolder: DEFAULT_DATA_FOLDER, provider: 'simplefin', layout: DEFAULT_LAYOUT, csv: false };
	simplefin!: SimpleFinProvider;
	readonly demo = new DemoProvider();
	simplefinConnection!: ConnectionController;
	ledger!: LedgerStore;
	/** The public API (docs/api.md): `app.plugins.plugins.passbook.api.v1`. */
	api!: { readonly v1: PassBookApiV1 };
	private inFlight?: Promise<SyncSummary>;
	/** Why the last sync failed, for the diagnostic summary. Cleared by a successful sync. */
	private lastSyncError?: string;
	private readonly syncListeners = new Set<(r: SyncResult) => void>();

	async onload(): Promise<void> {
		this.settings = await this.loadSettings();
		const budget = new RequestBudget({
			load: (): unknown => this.app.loadLocalStorage('passbook-simplefin-requests') as unknown,
			save: (v) => this.app.saveLocalStorage('passbook-simplefin-requests', v),
		});
		this.simplefin = new SimpleFinProvider((req) => this.http(req), obsidianSecrets(this.app), budget);
		this.simplefinConnection = new ConnectionController(this.simplefin, this.localStore(), 'passbook-simplefin-last-verified');
		this.ledger = new LedgerStore(
			obsidianFiles(this.app.vault.adapter),
			() => this.dataFolder(),
			() => ({ layout: this.settings.layout, csv: this.settings.csv }),
		);
		this.api = Object.freeze({
			v1: createApiV1({ load: () => this.ledger.load(), sync: () => this.runSync() }, this.syncListeners),
		});
		this.addSettingTab(new PassBookSettingTab(this.app, this));
		this.addCommand({ id: 'sync-now', name: 'Sync now', callback: () => void this.syncNow() });
		registerCommands(this);
		this.app.workspace.onLayoutReady(() => void this.removeProvisionalCache());
	}

	/** The folder the active data source reads and writes. Demo data never mixes with real data. */
	dataFolder(): string {
		const base = normalizePath(this.settings.dataFolder.trim() || DEFAULT_DATA_FOLDER);
		return this.settings.provider === 'demo' ? `${base} (demo)` : base;
	}

	activeProvider(): Provider {
		return this.settings.provider === 'demo' ? this.demo : this.simplefin;
	}

	async setProvider(provider: PluginData['provider']): Promise<void> {
		this.settings.provider = provider;
		await this.saveData(this.settings);
	}

	/**
	 * Whether this device pulls from the bank. Per device (localStorage), because
	 * data.json syncs. Unset counts as yes, so a single-device setup needs no action.
	 */
	isSyncDevice(): boolean {
		return this.app.loadLocalStorage(SYNC_DEVICE_KEY) !== 'off';
	}

	setSyncDevice(on: boolean): void {
		// A string: saveLocalStorage clears the entry for any falsy value, including false.
		this.app.saveLocalStorage(SYNC_DEVICE_KEY, on ? 'on' : 'off');
	}

	/** Whether this device may write the data folder: it syncs, or it's in demo mode (no bank involved). */
	canWrite(): boolean {
		return this.settings.provider === 'demo' || this.isSyncDevice();
	}

	/**
	 * Changes the folder layout and, on the device that syncs, moves PassBook's files to
	 * match. Other devices leave the move to the sync device, so two devices never move
	 * the same files at once. Returns files moved, or null when the move was left to it.
	 */
	async setLayout(layout: Layout): Promise<number | null> {
		await this.whenIdle();
		this.settings.layout = layout;
		await this.saveData(this.settings);
		if (!this.canWrite()) return null;
		return this.ledger.relayout();
	}

	/** Turns the CSV mirror on or off. Turning it on writes CSV for all existing data. */
	async setCsv(on: boolean): Promise<number> {
		await this.whenIdle();
		this.settings.csv = on;
		await this.saveData(this.settings);
		if (!on || !this.canWrite()) return 0;
		await this.ledger.relayout();
		return this.ledger.writeAllCsv(await this.ledger.load());
	}

	/** Waits for a running sync, so settings changes never interleave with its writes. */
	private async whenIdle(): Promise<void> {
		if (this.inFlight) await this.inFlight.catch(() => undefined);
	}

	async setDataFolder(folder: string): Promise<void> {
		this.settings.dataFolder = folder;
		await this.saveData(this.settings);
	}

	onunload(): void {
		this.syncListeners.clear();
	}

	/** The "Sync now" command: a sync with notices. */
	async syncNow(): Promise<void> {
		if (this.inFlight) {
			new Notice('PassBook is already syncing.');
			return;
		}
		try {
			const summary = await this.runSync();
			new Notice(describeSummary(summary), summary.issues.length > 0 ? 0 : undefined);
		} catch (e) {
			// Expected failures carry a readable message; anything else is a bug, so keep
			// the details where a bug report can find them.
			if (!(e instanceof UserFacingError)) console.error('PassBook: sync failed', e);
			new Notice(`PassBook couldn’t sync. ${message(e)}`, 0);
		}
	}

	/** One sync at a time: a call during a sync gets that sync's result. */
	runSync(): Promise<SyncSummary> {
		this.inFlight ??= syncNow({
			provider: this.activeProvider(),
			ledger: this.ledger,
			state: this.stateStore(),
			isSyncDevice: () => this.canWrite(),
			now: new Date(),
		})
			.then((summary) => {
				this.lastSyncError = undefined;
				this.announce(toSyncResult(summary));
				return summary;
			})
			.catch((e: unknown) => {
				this.lastSyncError = message(e);
				throw e;
			})
			.finally(() => {
				this.inFlight = undefined;
			});
		return this.inFlight;
	}

	/** Everything the feedback form's diagnostic summary may include (docs: #37). */
	async diagnostics(): Promise<DiagnosticInfo> {
		const info: DiagnosticInfo = {
			pluginVersion: this.manifest.version,
			obsidianVersion: apiVersion,
			platform: platformName(),
			provider: this.settings.provider,
			connected: this.simplefin.isConnected(),
			syncDevice: this.isSyncDevice(),
			layout: this.settings.layout,
			csv: this.settings.csv,
			lastSyncAt: null,
			accounts: null,
			transactions: null,
			pending: null,
			lastSyncError: this.lastSyncError,
		};
		try {
			const data = await this.ledger.load();
			info.lastSyncAt = data.lastSync?.at ?? null;
			info.accounts = data.accounts.size;
			info.transactions = data.transactions.size;
			info.pending = [...data.transactions.values()].filter((t) => t.status === 'pending').length;
		} catch (e) {
			info.readError = message(e);
		}
		return info;
	}

	/** Tells listeners and the workspace (`passbook:sync-completed`) a sync finished. */
	private announce(result: SyncResult): void {
		for (const listener of this.syncListeners) {
			try {
				listener(result);
			} catch (e) {
				console.error('PassBook: a sync-completed listener threw', e);
			}
		}
		this.app.workspace.trigger('passbook:sync-completed', result);
	}

	private async loadSettings(): Promise<PluginData> {
		const data: unknown = await this.loadData();
		const saved = typeof data === 'object' && data !== null ? (data as Partial<PluginData>) : {};
		return {
			...saved,
			dataFolder: typeof saved.dataFolder === 'string' ? saved.dataFolder : DEFAULT_DATA_FOLDER,
			provider: saved.provider === 'demo' ? 'demo' : 'simplefin',
			layout: isLayout(saved.layout) ? saved.layout : DEFAULT_LAYOUT,
			csv: saved.csv === true,
		};
	}

	private localStore(): LocalStore {
		return {
			load: (key): unknown => this.app.loadLocalStorage(key) as unknown,
			save: (key, value) => this.app.saveLocalStorage(key, value),
		};
	}

	private stateStore(): StateStore {
		return {
			load: async () => this.settings.providerState?.[this.activeProvider().id],
			save: async (state) => {
				this.settings.providerState = { ...this.settings.providerState, [this.activeProvider().id]: state };
				await this.saveData(this.settings);
			},
		};
	}

	/** Phase 1 kept fetched data in sync-cache.json; the ledger replaces it. */
	private async removeProvisionalCache(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const path = normalizePath(`${this.manifest.dir ?? `${this.app.vault.configDir}/plugins/passbook`}/sync-cache.json`);
		if (await adapter.exists(path)) await adapter.remove(path);
	}
}

function platformName(): string {
	const os = Platform.isMacOS ? 'macOS' : Platform.isWin ? 'Windows' : Platform.isLinux ? 'Linux' : Platform.isIosApp ? 'iOS' : Platform.isAndroidApp ? 'Android' : 'unknown OS';
	return `${os} ${Platform.isMobile ? 'mobile' : 'desktop'}`;
}

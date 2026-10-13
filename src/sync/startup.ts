// "Sync when Obsidian starts": whether a sync is due when the app opens.

/** Choices offered in settings, in hours. 0 means off. */
export const STARTUP_SYNC_CHOICES = [0, 1, 6, 12, 24] as const;

export interface StartupCheck {
	/** The setting: sync if the last sync is older than this many hours; 0 is off. */
	hours: number;
	/** When the last sync finished, from the ledger; null if never. */
	lastSyncAt: string | null;
	/** Whether this device may sync at all (connected and the sync device, or demo). */
	canSync: boolean;
	now: Date;
}

export function shouldSyncOnStartup({ hours, lastSyncAt, canSync, now }: StartupCheck): boolean {
	if (hours <= 0 || !canSync) return false;
	if (!lastSyncAt) return true;
	const last = Date.parse(lastSyncAt);
	if (!Number.isFinite(last)) return true;
	return now.getTime() - last >= hours * 60 * 60 * 1000;
}

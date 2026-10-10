// Feedback from inside PassBook: a diagnostic summary and links to GitHub's pre-filled
// issue forms (.github/ISSUE_TEMPLATE/*.yml). PassBook never sends anything itself;
// the user reviews the form on GitHub and submits it with their own account.

/** The public repository, where releases are published and user reports go. */
export const REPO = 'mloy97/passbook';

/** GitHub rejects very long URLs; stay well under its ~8 KB limit. */
export const MAX_URL_LENGTH = 6000;

export type FeedbackKind = 'bug' | 'feature';

const FORMS: Record<FeedbackKind, string> = {
	bug: '1-bug-report.yml',
	feature: '2-feature-request.yml',
};

/** What the summary may say. Deliberately no names, descriptions, amounts or IDs. */
export interface DiagnosticInfo {
	pluginVersion: string;
	obsidianVersion: string;
	platform: string;
	provider: 'simplefin' | 'demo';
	connected: boolean;
	syncDevice: boolean;
	layout: string;
	csv: boolean;
	lastSyncAt: string | null;
	accounts: number | null;
	transactions: number | null;
	pending: number | null;
	/** Why the data folder couldn't be read, if it couldn't. */
	readError?: string;
	/** The last sync's error message, if it failed. */
	lastSyncError?: string;
}

export function diagnosticSummary(info: DiagnosticInfo, now = new Date()): string {
	const yes = (b: boolean) => (b ? 'yes' : 'no');
	const lines = [
		`PassBook ${info.pluginVersion} · Obsidian ${info.obsidianVersion} · ${info.platform}`,
		`Data source: ${info.provider === 'demo' ? 'Demo' : 'SimpleFIN'} · Connected: ${yes(info.provider === 'demo' || info.connected)} · This device syncs: ${yes(info.syncDevice)}`,
		`Layout: ${info.layout} · CSV: ${info.csv ? 'on' : 'off'}`,
		`Last sync: ${info.lastSyncAt ? age(info.lastSyncAt, now) : 'never'}`,
	];
	if (info.accounts !== null) {
		lines.push(`Data: ${info.accounts} accounts · ${info.transactions ?? 0} transactions (${info.pending ?? 0} pending)`);
	}
	if (info.readError) lines.push(`Data folder error: ${scrub(info.readError)}`);
	if (info.lastSyncError) lines.push(`Last sync error: ${scrub(info.lastSyncError)}`);
	return lines.join('\n');
}

/** A link to GitHub's issue form for `kind`, with the summary in its own field when given. */
export function feedbackUrl(kind: FeedbackKind, summary?: string): string {
	const params = new URLSearchParams({ template: FORMS[kind] });
	const base = `https://github.com/${REPO}/issues/new?`;
	if (summary) {
		params.set('diagnostics', summary);
		// Trim from the end rather than produce a link GitHub refuses.
		let text = summary;
		while (base.length + params.toString().length > MAX_URL_LENGTH && text.length > 0) {
			text = text.slice(0, Math.max(0, text.length - 200));
			params.set('diagnostics', `${text}\n…(trimmed)`);
		}
	}
	return base + params.toString();
}

function age(iso: string, now: Date): string {
	const minutes = Math.round((now.getTime() - Date.parse(iso)) / 60000);
	if (!Number.isFinite(minutes)) return 'unknown';
	if (minutes < 60) return `${Math.max(0, minutes)} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return `${hours} h ago`;
	return `${Math.round(hours / 24)} days ago`;
}

/**
 * Error messages are written by PassBook and shouldn't hold secrets, but a URL or a
 * long token-like string could slip in from a provider. Remove both, to be safe.
 */
export function scrub(message: string): string {
	return message
		.replace(/https?:\/\/\S+/g, '[link removed]')
		.replace(/[A-Za-z0-9+/=_-]{32,}/g, '[removed]')
		.slice(0, 300);
}

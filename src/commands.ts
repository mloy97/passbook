// Commands other than "Sync now": Connect provider, Export CSV, Open data folder.

import { normalizePath, Notice, TFile, TFolder } from 'obsidian';
import { UserFacingError } from './errors';
import { transactionsCsv } from './export/csv';
import { diagnosticSummary, FeedbackKind, feedbackUrl } from './feedback/feedback';
import type PassBookPlugin from './main';
import { message } from './settings/connection';

/** Obsidian internals these commands use. Not in the public API, so each use is guarded. */
interface AppInternals {
	setting?: { open(): void; openTabById(id: string): void };
}
interface FileExplorerView {
	revealInFolder?(file: TFolder | TFile): void;
}

export function registerCommands(plugin: PassBookPlugin): void {
	plugin.addCommand({ id: 'connect', name: 'Connect provider', callback: () => openSettings(plugin) });
	plugin.addCommand({ id: 'export-csv', name: 'Export transactions to CSV', callback: () => void exportCsv(plugin) });
	plugin.addCommand({ id: 'open-data-folder', name: 'Open data folder', callback: () => openDataFolder(plugin) });
	plugin.addCommand({ id: 'copy-diagnostics', name: 'Copy diagnostic summary', callback: () => void copyDiagnostics(plugin) });
}

export function openSettings(plugin: PassBookPlugin): void {
	const setting = (plugin.app as unknown as AppInternals).setting;
	if (!setting) {
		new Notice('Open settings, then PassBook, to connect.');
		return;
	}
	setting.open();
	setting.openTabById(plugin.manifest.id);
}

/** Writes `<data folder>/exports/transactions-YYYY-MM-DD.csv`. Returns its path. */
export async function exportCsv(plugin: PassBookPlugin, now = new Date()): Promise<string | undefined> {
	try {
		const data = await plugin.ledger.load();
		if (data.transactions.size === 0) {
			new Notice('There are no transactions to export yet. Run PassBook: Sync now first.');
			return undefined;
		}
		const transactions = [...data.transactions.values()].sort(
			(a, b) => a.date.localeCompare(b.date) || a.accountId.localeCompare(b.accountId) || a.id.localeCompare(b.id),
		);
		const folder = normalizePath(`${plugin.dataFolder()}/exports`);
		const path = normalizePath(`${folder}/transactions-${now.toISOString().slice(0, 10)}.csv`);
		const csv = transactionsCsv(transactions, data.accounts);
		// The adapter, like the ledger: the vault's file index can lag behind files
		// PassBook just wrote, and createFolder fails on a folder it hasn't indexed yet.
		const adapter = plugin.app.vault.adapter;
		if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
		await adapter.write(path, csv);
		new Notice(`Exported ${transactions.length} transaction${transactions.length === 1 ? '' : 's'} to ${path}.`);
		return path;
	} catch (e) {
		if (!(e instanceof UserFacingError)) console.error('PassBook: export failed', e);
		new Notice(`PassBook couldn’t export. ${message(e)}`, 0);
		return undefined;
	}
}

export function openDataFolder(plugin: PassBookPlugin): void {
	const folder = plugin.app.vault.getAbstractFileByPath(plugin.dataFolder());
	if (!(folder instanceof TFolder)) {
		new Notice(`The data folder (${plugin.dataFolder()}) doesn’t exist yet. Run PassBook: Sync now first.`);
		return;
	}
	const leaf = plugin.app.workspace.getLeavesOfType('file-explorer')[0];
	const view = leaf?.view as FileExplorerView | undefined;
	if (!leaf || !view?.revealInFolder) {
		new Notice(`PassBook’s data is in ${folder.path}.`);
		return;
	}
	void plugin.app.workspace.revealLeaf(leaf);
	view.revealInFolder(folder);
}

/** Copies the feedback form's diagnostic summary, for pasting into a report anywhere. */
export async function copyDiagnostics(plugin: PassBookPlugin): Promise<void> {
	const summary = diagnosticSummary(await plugin.diagnostics());
	await navigator.clipboard.writeText(summary);
	new Notice('PassBook copied its diagnostic summary. It has versions, settings and counts, never names or amounts.');
}

/** Opens GitHub's pre-filled issue form in the browser. Nothing is sent until the user submits there. */
export async function openFeedback(plugin: PassBookPlugin, kind: FeedbackKind, includeDiagnostics: boolean): Promise<void> {
	const summary = includeDiagnostics ? diagnosticSummary(await plugin.diagnostics()) : undefined;
	window.open(feedbackUrl(kind, summary));
}

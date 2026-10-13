import { App, ButtonComponent, Notice, PluginSettingTab, Setting } from 'obsidian';
import type PassBookPlugin from '../main';
import { DEFAULT_DATA_FOLDER } from '../ledger/defaults';
import { DEFAULT_LAYOUT, dirs, isLayout, Layout } from '../ledger/layout';
import { STARTUP_SYNC_CHOICES } from '../sync/startup';
import { openFeedback } from '../commands';
import { UserFacingError } from '../errors';
import { ConnectionController, ConnectionState, message } from './connection';

const SIMPLEFIN_CREATE_URL = 'https://bridge.simplefin.org/simplefin/create';

// Renders imperatively: the declarative settings API (getSettingDefinitions) needs
// Obsidian 1.13 and minAppVersion is 1.11.5, so lint warns about settings search.
export class PassBookSettingTab extends PluginSettingTab {
	private unsubscribe?: () => void;

	constructor(
		app: App,
		private readonly plugin: PassBookPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		this.unsubscribe?.();
		const connection = this.plugin.simplefinConnection;
		this.unsubscribe = connection.onChange(() => this.render(connection));
		this.render(connection);
	}

	/** Runs a settings action, reports failure in a notice, and re-renders either way. */
	private async attempt(what: string, action: () => Promise<void>): Promise<void> {
		try {
			await action();
		} catch (e) {
			if (!(e instanceof UserFacingError)) console.error(`PassBook: couldn’t ${what}`, e);
			new Notice(`PassBook couldn’t ${what}. ${message(e)}`, 0);
		}
		this.rerender();
	}

	private rerender(): void {
		this.render(this.plugin.simplefinConnection);
	}

	hide(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
	}

	private render(connection: ConnectionController): void {
		const { containerEl } = this;
		// Re-rendering empties the tab, which would jump it back to the top; keep the
		// place of whichever element scrolls (the tab on desktop, its parent on mobile).
		const scrollers = [containerEl, containerEl.parentElement].filter((el): el is HTMLElement => el !== null);
		const tops = scrollers.map((el) => el.scrollTop);
		this.build(containerEl, connection);
		scrollers.forEach((el, i) => (el.scrollTop = tops[i] ?? 0));
	}

	private build(containerEl: HTMLElement, connection: ConnectionController): void {
		containerEl.empty();
		containerEl.addClass('passbook-settings');
		const state = connection.current;
		const demo = this.plugin.settings.provider === 'demo';

		this.renderSupport(containerEl);

		new Setting(containerEl)
			.setName('Data source')
			.setDesc(
				demo
					? 'Demo: made-up accounts and transactions, so you can try PassBook without a bank account. Nothing leaves this device.'
					: 'Where PassBook gets your accounts and transactions.',
			)
			.addDropdown((d) =>
				d
					.addOption('simplefin', 'SimpleFIN Bridge')
					.addOption('demo', 'Demo (made-up data)')
					.setValue(this.plugin.settings.provider)
					.onChange(async (v) => {
						await this.plugin.setProvider(v === 'demo' ? 'demo' : 'simplefin');
						this.render(connection);
					}),
			);

		if (!demo) {
			new Setting(containerEl).setName('SimpleFIN').setHeading();

			if (state.status === 'disconnected' || state.status === 'connecting') {
				this.renderConnect(containerEl, connection, state);
			} else {
				this.renderConnected(containerEl, connection, state);
			}

			if (state.error) {
				containerEl.createDiv({ cls: 'passbook-error', text: state.error, attr: { role: 'alert' } });
			}
		}

		new Setting(containerEl).setName('Sync').setHeading();
		this.renderSync(containerEl);

		new Setting(containerEl).setName('Data').setHeading();
		this.renderDataFolder(containerEl, demo);

		new Setting(containerEl).setName('Feedback').setHeading();
		this.renderFeedback(containerEl);
	}

	private renderSync(el: HTMLElement): void {
		if (this.plugin.canSync()) {
			const row = new Setting(el)
				.setName('Last synced')
				.setDesc('Checking…')
				.addButton((b) =>
					b
						.setButtonText('Sync now')
						.setCta()
						.onClick(async () => {
							b.setDisabled(true).setButtonText('Syncing…');
							await this.plugin.syncNow();
							this.rerender();
						}),
				);
			void this.plugin.lastSyncAt().then((last) => {
				const when = last ? relativeTime(new Date(last), new Date()) : '';
				row.setDesc(last ? `${when.charAt(0).toUpperCase()}${when.slice(1)}.` : 'Never. Select Sync now to fetch your accounts.');
			});
		}
		new Setting(el)
			.setName('Sync when Obsidian starts')
			.setDesc('On the device that syncs, sync automatically when you open Obsidian if the last sync is older than this.')
			.addDropdown((d) => {
				for (const hours of STARTUP_SYNC_CHOICES) d.addOption(String(hours), hours === 0 ? 'Off' : `If older than ${hours} hour${hours === 1 ? '' : 's'}`);
				d.setValue(String(this.plugin.settings.syncOnStartupHours)).onChange((v) => void this.plugin.setSyncOnStartupHours(Number(v)));
			});
	}

	/** Whether to attach the diagnostic summary. Per visit; on by default. */
	private includeDiagnostics = true;

	private renderFeedback(el: HTMLElement): void {
		new Setting(el)
			.setName('Report a problem or suggest a feature')
			.setDesc('Opens a pre-filled form on GitHub in your browser. You need a GitHub account, and nothing is sent until you submit it there.')
			.addButton((b) => b.setButtonText('Report a problem').onClick(() => void openFeedback(this.plugin, 'bug', this.includeDiagnostics)))
			.addButton((b) => b.setButtonText('Suggest a feature').onClick(() => void openFeedback(this.plugin, 'feature', this.includeDiagnostics)));
		new Setting(el)
			.setName('Include diagnostic summary')
			.setDesc('Adds PassBook and Obsidian versions, your PassBook settings, and how many accounts and transactions you have. Never names, descriptions or amounts. You can read and edit it on GitHub before submitting.')
			.addToggle((t) => t.setValue(this.includeDiagnostics).onChange((on) => (this.includeDiagnostics = on)));
	}

	/**
	 * A small support card at the top. Shown only while the manifest has a fundingUrl.
	 * The Ko-fi cup is bundled (no request to Ko-fi), and the card never nags: no popups,
	 * no counters, per Obsidian's policies.
	 */
	private renderSupport(el: HTMLElement): void {
		// fundingUrl is a documented manifest field, but missing from PluginManifest's types.
		const funding = fundingUrl((this.plugin.manifest as { fundingUrl?: string | Record<string, string> }).fundingUrl);
		if (!funding) return;
		const card = el.createDiv({ cls: 'passbook-support' });
		card.appendChild(kofiCup());
		const text = card.createDiv({ cls: 'passbook-support-text' });
		text.createDiv({ cls: 'passbook-support-title', text: 'Enjoying PassBook?' });
		text.createDiv({ cls: 'passbook-support-desc', text: 'It’s free and made by one person. A coffee helps keep it going.' });
		const button = card.createEl('button', { cls: 'passbook-kofi-button', text: 'Buy me a coffee', attr: { 'aria-label': 'Support PassBook on Ko-fi' } });
		button.addEventListener('click', () => window.open(funding));
	}

	private renderDataFolder(el: HTMLElement, demo: boolean): void {
		new Setting(el)
			.setName('Data folder')
			.setDesc(
				demo
					? `Demo data goes in “${this.plugin.dataFolder()}”, apart from real data. Delete that folder when you’re done.`
					: 'Where PassBook keeps your accounts and transactions in the vault. Changing it doesn’t move existing files.',
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_DATA_FOLDER)
					.setValue(this.plugin.settings.dataFolder)
					.onChange((v) => void this.plugin.setDataFolder(v.trim())),
			);

		const folder = this.plugin.dataFolder();
		new Setting(el)
			.setName('Folder layout')
			.setDesc(layoutDescription(this.plugin.settings.layout, folder))
			.addDropdown((d) =>
				d
					.addOption('split', 'Separate JSON and CSV folders')
					.addOption('flat', 'Everything in one folder')
					.addOption('csv-subfolder', 'CSV in a subfolder')
					.setValue(this.plugin.settings.layout)
					.onChange((v) =>
						this.attempt('move its files', async () => {
							const moved = await this.plugin.setLayout(isLayout(v) ? v : DEFAULT_LAYOUT);
							new Notice(
								moved === null
									? 'PassBook will move its files to the new layout on the device that syncs.'
									: moved > 0
										? `PassBook moved ${moved} file${moved === 1 ? '' : 's'} to the new layout.`
										: 'Folder layout changed.',
							);
						}),
					),
			);

		new Setting(el)
			.setName('Also save CSV files')
			.setDesc(
				'Write spreadsheet-friendly copies of your accounts and transactions on every sync. JSON stays the main copy, and edits to the CSV files are overwritten. Turning this off leaves existing CSV files in place.',
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.csv).onChange((on) =>
					this.attempt('write CSV files', async () => {
						const months = await this.plugin.setCsv(on);
						if (on) new Notice(months > 0 ? `PassBook wrote CSV files for ${months} month${months === 1 ? '' : 's'}.` : 'PassBook will write CSV files on the next sync.');
					}),
				),
			);
	}

	private renderConnect(el: HTMLElement, connection: ConnectionController, state: ConnectionState): void {
		const desc = createFragment((f) => {
			f.appendText('Link your banks in SimpleFIN Bridge, create a setup token, and paste it here. ');
			f.createEl('a', { text: 'Create a setup token', href: SIMPLEFIN_CREATE_URL });
			f.appendText('. The token works once.');
		});
		let token = '';
		const connecting = state.status === 'connecting';
		new Setting(el)
			.setName('Setup token')
			.setDesc(desc)
			.addText((text) => {
				text.inputEl.type = 'password';
				text.inputEl.autocomplete = 'off';
				text.setPlaceholder('Paste setup token').setDisabled(connecting).onChange((v) => (token = v));
			})
			.addButton((b) =>
				b
					.setButtonText(connecting ? 'Connecting…' : 'Connect')
					.setCta()
					.setDisabled(connecting)
					.onClick(() => void connection.connect(token)),
			);
	}

	private renderConnected(el: HTMLElement, connection: ConnectionController, state: ConnectionState): void {
		const checking = state.status === 'checking';
		new Setting(el)
			.setName('Status')
			.setDesc(checking ? 'Checking the connection…' : describeConnected(state))
			.addButton((b) => b.setButtonText('Check connection').setDisabled(checking).onClick(() => void connection.check()))
			.addButton((b) => {
				b.setButtonText('Disconnect').setDisabled(checking).onClick(() => connection.disconnect());
				destructive(b);
			});
		new Setting(el)
			.setName('This device syncs')
			.setDesc(
				'Pull from your bank on this device. If another device also has a SimpleFIN connection, turn this off on one of them so they don’t both sync. Devices without a connection always just read the synced data.',
			)
			.addToggle((t) => t.setValue(this.plugin.isSyncDevice()).onChange((on) => this.plugin.setSyncDevice(on)));
	}
}

export function describeConnected(state: ConnectionState, now = new Date()): string {
	if (!state.lastVerified) return 'Connected on this device.';
	return `Connected on this device. Last confirmed working ${relativeTime(new Date(state.lastVerified), now)}.`;
}

export function relativeTime(then: Date, now: Date): string {
	const minutes = Math.round((now.getTime() - then.getTime()) / 60000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
	const days = Math.round(hours / 24);
	return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Styles a button as dangerous. setWarning() is deprecated and setDestructive() needs
 * Obsidian 1.13, above minAppVersion, so this adds the class setWarning() added.
 */
function destructive(b: ButtonComponent): void {
	b.buttonEl.addClass('mod-warning');
}

/** Says where the files go, using the actual folder name. */
export function layoutDescription(layout: Layout, folder: string): string {
	const d = dirs(layout);
	const where = (sub: string) => (sub ? `${folder}/${sub.slice(0, -1)}` : folder);
	return `JSON goes in ${where(d.json)}, CSV (if on) in ${where(d.csv)}. Changing this moves PassBook’s files; nothing else in the folder is touched.`;
}

/** The manifest's donation link: a URL, or the first of several labelled ones. */
export function fundingUrl(value: string | Record<string, string> | undefined): string | undefined {
	if (typeof value === 'string') return value || undefined;
	if (value) return Object.values(value)[0];
	return undefined;
}

/** Ko-fi's cup mark (Simple Icons, CC0; Ko-fi permits it for promoting your page). */
const KOFI_CUP =
	'M11.351 2.715c-2.7 0-4.986.025-6.83.26C2.078 3.285 0 5.154 0 8.61c0 3.506.182 6.13 1.585 8.493 1.584 2.701 4.233 4.182 7.662 4.182h.83c4.209 0 6.494-2.234 7.637-4a9.5 9.5 0 0 0 1.091-2.338C21.792 14.688 24 12.22 24 9.208v-.415c0-3.247-2.13-5.507-5.792-5.87-1.558-.156-2.65-.208-6.857-.208m0 1.947c4.208 0 5.09.052 6.571.182 2.624.311 4.13 1.584 4.13 4v.39c0 2.156-1.792 3.844-3.87 3.844h-.935l-.156.649c-.208 1.013-.597 1.818-1.039 2.546-.909 1.428-2.545 3.064-5.922 3.064h-.805c-2.571 0-4.831-.883-6.078-3.195-1.09-2-1.298-4.155-1.298-7.506 0-2.181.857-3.402 3.012-3.714 1.533-.233 3.559-.26 6.39-.26m6.547 2.287c-.416 0-.65.234-.65.546v2.935c0 .311.234.545.65.545 1.324 0 2.051-.754 2.051-2s-.727-2.026-2.052-2.026m-10.39.182c-1.818 0-3.013 1.48-3.013 3.142 0 1.533.858 2.857 1.949 3.897.727.701 1.87 1.429 2.649 1.896a1.47 1.47 0 0 0 1.507 0c.78-.467 1.922-1.195 2.623-1.896 1.117-1.039 1.974-2.364 1.974-3.897 0-1.662-1.247-3.142-3.039-3.142-1.065 0-1.792.545-2.338 1.298-.493-.753-1.246-1.298-2.312-1.298';

function kofiCup(): SVGSVGElement {
	const ns = 'http://www.w3.org/2000/svg';
	const svg = document.createElementNS(ns, 'svg');
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('aria-hidden', 'true');
	svg.classList.add('passbook-support-icon');
	const path = document.createElementNS(ns, 'path');
	path.setAttribute('d', KOFI_CUP);
	svg.appendChild(path);
	return svg;
}

import { App, ButtonComponent, Notice, PluginSettingTab, Setting } from 'obsidian';
import type PassBookPlugin from '../main';
import { DEFAULT_DATA_FOLDER } from '../ledger/defaults';
import { DEFAULT_LAYOUT, dirs, isLayout, Layout } from '../ledger/layout';
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

		new Setting(containerEl).setName('Data').setHeading();
		this.renderDataFolder(containerEl, demo);

		new Setting(containerEl).setName('Feedback').setHeading();
		this.renderFeedback(containerEl);
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

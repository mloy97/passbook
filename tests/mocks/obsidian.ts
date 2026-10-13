// Runtime stand-in for the `obsidian` package, which ships types only.
// vitest.config.ts aliases `obsidian` here. Add to it as tests need more of the API.

export class Plugin {
	app: unknown;
	manifest: unknown;
	settingTabs: unknown[] = [];
	commands: { id: string; name: string; callback?: () => unknown }[] = [];
	constructor(app?: unknown, manifest?: unknown) {
		this.app = app;
		this.manifest = manifest;
	}
	/** What saveData last wrote: data.json. */
	saved: unknown = null;
	async loadData(): Promise<unknown> {
		return this.saved === null ? null : JSON.parse(JSON.stringify(this.saved));
	}
	async saveData(data: unknown): Promise<void> {
		this.saved = JSON.parse(JSON.stringify(data));
	}
	addSettingTab(tab: unknown): void {
		this.settingTabs.push(tab);
	}
	ribbons: { icon: string; title: string; onClick: () => unknown; attrs: Record<string, string> }[] = [];
	addRibbonIcon(icon: string, title: string, onClick: () => unknown): { setAttribute(k: string, v: string): void } {
		const ribbon = { icon, title, onClick, attrs: {} as Record<string, string> };
		this.ribbons.push(ribbon);
		return { setAttribute: (k: string, v: string) => void (ribbon.attrs[k] = v) };
	}
	addCommand(command: { id: string; name: string; callback?: () => unknown }): unknown {
		this.commands.push(command);
		return command;
	}
}

export class PluginSettingTab {
	constructor(
		public app: unknown,
		public plugin: unknown,
	) {}
}

export class Setting {}

export class Notice {
	static shown: { message: string; duration?: number }[] = [];
	constructor(message: string, duration?: number) {
		Notice.shown.push({ message, duration });
	}
}

export async function requestUrl(): Promise<never> {
	throw new Error('requestUrl is not available in unit tests; inject a fake Http');
}

export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

export class TAbstractFile {
	constructor(public path: string) {}
}
export class TFile extends TAbstractFile {}
export class TFolder extends TAbstractFile {}

export const apiVersion = '1.14.4';

export const Platform = {
	isMobile: false,
	isDesktopApp: true,
	isMacOS: false,
	isWin: true,
	isLinux: false,
	isIosApp: false,
	isAndroidApp: false,
};

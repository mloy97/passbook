// End-to-end tests: launches real Obsidian with PassBook loaded (wdio-obsidian-service).
// Run with `npm run test:e2e`. Obsidian builds download to .obsidian-cache/, which is
// gitignored.
import * as path from 'node:path';
import { env } from 'node:process';
import { parseObsidianVersions } from 'wdio-obsidian-service';

const cacheDir = path.resolve('.obsidian-cache');
const vault = 'tests/e2e/vaults/simple';

// "earliest" is manifest.json's minAppVersion. Override with OBSIDIAN_VERSIONS.
const desktopVersions = await parseObsidianVersions(env.OBSIDIAN_VERSIONS ?? 'earliest/earliest latest/latest', { cacheDir });
const mobileVersions = await parseObsidianVersions(env.OBSIDIAN_MOBILE_VERSIONS ?? 'latest/latest', { cacheDir });

export const config: WebdriverIO.Config = {
	runner: 'local',
	framework: 'mocha',
	specs: ['./tests/e2e/specs/**/*.e2e.ts'],
	maxInstances: Number(env.WDIO_MAX_INSTANCES ?? 2),

	capabilities: [
		...desktopVersions.map<WebdriverIO.Capabilities>(([appVersion, installerVersion]) => ({
			browserName: 'obsidian',
			'wdio:obsidianOptions': { appVersion, installerVersion, plugins: ['.'], vault },
		})),
		// Phone-width layout check on desktop Obsidian's mobile emulation.
		...mobileVersions.map<WebdriverIO.Capabilities>(([appVersion, installerVersion]) => ({
			browserName: 'obsidian',
			'wdio:obsidianOptions': { appVersion, installerVersion, emulateMobile: true, plugins: ['.'], vault },
			'goog:chromeOptions': { mobileEmulation: { deviceMetrics: { width: 390, height: 844 } } },
		})),
	],

	services: ['obsidian'],
	reporters: ['obsidian'],
	mochaOpts: { ui: 'bdd', timeout: 60 * 1000 },
	waitforInterval: 250,
	waitforTimeout: 5 * 1000,
	logLevel: 'warn',
	cacheDir,
	injectGlobals: false,
};

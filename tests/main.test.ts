import { describe, expect, it } from 'vitest';
import PassBookPlugin from '../src/main';
import { fakeApp } from './mocks/app';

describe('PassBookPlugin', () => {
	it('loads with SimpleFIN disconnected and a settings tab', async () => {
		const plugin = new PassBookPlugin(fakeApp() as never, {} as never);
		await plugin.onload();
		expect(plugin.simplefinConnection.current.status).toBe('disconnected');
		expect((plugin as unknown as { settingTabs: unknown[] }).settingTabs).toHaveLength(1);
	});
});

import { describe, expect, it, vi } from 'vitest';
import { ProviderError } from '../../src/providers/types';
import { ConnectionController, ConnectionState } from '../../src/settings/connection';
import { describeConnected, relativeTime } from '../../src/settings/tab';

const NOW = new Date('2026-10-09T12:00:00Z');

function setup(opts: { connected?: boolean; saved?: string } = {}) {
	let connected = opts.connected ?? false;
	const provider = {
		isConnected: vi.fn(() => connected),
		connect: vi.fn(async (_token: string) => {
			connected = true;
		}),
		verify: vi.fn(async () => {}),
		disconnect: vi.fn(() => {
			connected = false;
		}),
	};
	const local = new Map<string, unknown>(opts.saved ? [['k', opts.saved]] : []);
	const store = { load: (k: string) => local.get(k) ?? null, save: (k: string, v: unknown) => void local.set(k, v) };
	const controller = new ConnectionController(provider, store, 'k', () => NOW);
	const seen: ConnectionState[] = [];
	controller.onChange((s) => seen.push(s));
	return { provider, controller, local, seen, setConnected: (v: boolean) => (connected = v) };
}

describe('ConnectionController', () => {
	it('starts disconnected when the provider has no credentials', () => {
		expect(setup().controller.current).toEqual({ status: 'disconnected', lastVerified: undefined });
	});

	it('starts connected, with the saved check time, when credentials exist', () => {
		const { controller } = setup({ connected: true, saved: '2026-10-08T00:00:00.000Z' });
		expect(controller.current).toEqual({ status: 'connected', lastVerified: '2026-10-08T00:00:00.000Z' });
	});

	it('connects: connecting, then connected with the check time saved locally', async () => {
		const { controller, provider, local, seen } = setup();
		await controller.connect(' token ');
		expect(provider.connect).toHaveBeenCalledWith(' token ');
		expect(seen.map((s) => s.status)).toEqual(['connecting', 'connected']);
		expect(controller.current).toEqual({ status: 'connected', lastVerified: NOW.toISOString() });
		expect(local.get('k')).toBe(NOW.toISOString());
	});

	it('asks for a token instead of calling the provider with an empty one', async () => {
		const { controller, provider } = setup();
		await controller.connect('   ');
		expect(provider.connect).not.toHaveBeenCalled();
		expect(controller.current.error).toBe('Paste a setup token first.');
	});

	it('shows the provider message when connecting fails', async () => {
		const { controller, provider } = setup();
		provider.connect.mockRejectedValueOnce(new ProviderError('setup-token', 'Token already used.'));
		await controller.connect('t');
		expect(controller.current).toEqual({ status: 'disconnected', error: 'Token already used.' });
	});

	it('stays connected when the claim worked but the check failed', async () => {
		const { controller, provider, setConnected } = setup();
		provider.connect.mockImplementationOnce(async () => {
			setConnected(true);
			throw new ProviderError('network', 'Offline.');
		});
		await controller.connect('t');
		expect(controller.current).toEqual({ status: 'connected', error: 'Offline.' });
	});

	it('hides unexpected errors behind a generic message', async () => {
		const { controller, provider } = setup();
		provider.connect.mockRejectedValueOnce(new TypeError('x is undefined'));
		await controller.connect('t');
		expect(controller.current.error).toBe('Something went wrong. Try again.');
	});

	it('ignores a second connect while one is running', async () => {
		const { controller, provider } = setup();
		const first = controller.connect('t');
		await controller.connect('t');
		await first;
		expect(provider.connect).toHaveBeenCalledTimes(1);
	});

	it('checks the connection and keeps the old check time on failure', async () => {
		const { controller, provider, seen } = setup({ connected: true, saved: '2026-10-08T00:00:00.000Z' });
		provider.verify.mockRejectedValueOnce(new ProviderError('auth', 'Access revoked.'));
		await controller.check();
		expect(seen.map((s) => s.status)).toEqual(['checking', 'connected']);
		expect(controller.current).toEqual({
			status: 'connected',
			lastVerified: '2026-10-08T00:00:00.000Z',
			error: 'Access revoked.',
		});
		await controller.check();
		expect(controller.current).toEqual({ status: 'connected', lastVerified: NOW.toISOString() });
	});

	it('disconnects and forgets the check time', () => {
		const { controller, provider, local } = setup({ connected: true, saved: 'x' });
		controller.disconnect();
		expect(provider.disconnect).toHaveBeenCalled();
		expect(local.get('k')).toBeNull();
		expect(controller.current).toEqual({ status: 'disconnected' });
	});
});

describe('status text', () => {
	it.each([
		[0.2, 'just now'],
		[1, '1 minute ago'],
		[59, '59 minutes ago'],
		[60, '1 hour ago'],
		[60 * 30, '1 day ago'],
		[60 * 24 * 3, '3 days ago'],
	])('%d minutes ago reads %s', (minutes, text) => {
		expect(relativeTime(new Date(NOW.getTime() - minutes * 60000), NOW)).toBe(text);
	});

	it('describes a connection with and without a check time', () => {
		expect(describeConnected({ status: 'connected' }, NOW)).toBe('Connected on this device.');
		expect(describeConnected({ status: 'connected', lastVerified: '2026-10-09T10:00:00Z' }, NOW)).toBe(
			'Connected on this device. Last confirmed working 2 hours ago.',
		);
	});
});

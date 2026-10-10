// Store policies and our own rules, checked against the source.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const src = join(root, 'src');

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
	});
}

const sources = files(src).map((path) => ({ path: relative(root, path).replace(/\\/g, '/'), text: readFileSync(path, 'utf8') }));

describe('policy', () => {
	it('makes network calls only from the one disclosed adapter', () => {
		// Calls to the global fetch, not the provider method or its declaration.
		const network = /\brequestUrl\s*\(|(?:[=(,!&|?]|\b(?:await|return|void))\s*fetch\s*\(|\b(?:window|globalThis|self)\.fetch\b|XMLHttpRequest|WebSocket|\bnavigator\.sendBeacon|\brequire\(['"](https?|net|tls)['"]\)/;
		const offenders = sources.filter((f) => network.test(f.text)).map((f) => f.path);
		expect(offenders).toEqual(['src/providers/obsidian-adapters.ts']);
	});

	it('never logs anything that could hold a secret', () => {
		const offenders = sources
			.flatMap((f) => f.text.split('\n').map((line, i) => ({ f: f.path, i: i + 1, line })))
			.filter(({ line }) => /console\.(log|info|debug|warn|error)/.test(line) && /secret|access|url|token|authorization/i.test(line));
		expect(offenders).toEqual([]);
	});

	it('never renders text as HTML', () => {
		const offenders = sources.filter((f) => /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML/.test(f.text)).map((f) => f.path);
		expect(offenders).toEqual([]);
	});

	it('has no runtime dependencies to bundle', () => {
		const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
		expect(pkg.dependencies ?? {}).toEqual({});
	});

	it('discloses SimpleFIN, the paid account and no telemetry in the README', () => {
		const readme = readFileSync(join(root, 'README.md'), 'utf8');
		expect(readme).toMatch(/## Network use/);
		expect(readme).toMatch(/SimpleFIN Bridge/);
		expect(readme).toMatch(/paid/i);
		expect(readme).toMatch(/no telemetry/i);
	});
	it('keeps the manifest within Obsidian’s submission requirements', () => {
		const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as Record<string, unknown>;
		const description = String(manifest.description);
		expect(String(manifest.id)).toMatch(/^[a-z0-9-]+$/);
		expect(String(manifest.id)).not.toMatch(/obsidian/i);
		expect(String(manifest.name)).not.toMatch(/obsidian/i);
		expect(description.length).toBeLessThanOrEqual(250);
		expect(description).toMatch(/\.$/);
		expect(description).not.toMatch(/^this (is a )?plugin/i);
		expect(description).not.toMatch(/\p{Extended_Pictographic}/u);
		expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
		expect(manifest.isDesktopOnly).toBe(false);
		const funding = manifest.fundingUrl;
		const urls = typeof funding === 'string' ? [funding] : funding && typeof funding === 'object' ? Object.values(funding as Record<string, string>) : [];
		for (const url of urls) expect(url).toMatch(/^https:\/\//);
	});

	it('uses no Node or Electron modules, so it can run on mobile', () => {
		const offenders = sources.filter((f) => /from ['"](node:|fs|path|os|crypto|child_process|electron)['"]|require\(['"](fs|path|os|crypto|child_process|electron)['"]\)/.test(f.text)).map((f) => f.path);
		expect(offenders).toEqual([]);
	});
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fundingUrl } from '../../src/settings/tab';

describe('donation link', () => {
	it('is the developer’s Ko-fi page, over HTTPS (store rule: it must point to the developer)', () => {
		const manifest = JSON.parse(readFileSync(new URL('../../manifest.json', import.meta.url), 'utf8')) as { fundingUrl?: string };
		expect(manifest.fundingUrl).toBe('https://ko-fi.com/devmilo');
	});

	it('reads a single URL or the first of several labelled ones', () => {
		expect(fundingUrl('https://ko-fi.com/x')).toBe('https://ko-fi.com/x');
		expect(fundingUrl({ 'Ko-fi': 'https://ko-fi.com/x', Other: 'https://example.test' })).toBe('https://ko-fi.com/x');
		expect(fundingUrl(undefined)).toBeUndefined();
		expect(fundingUrl('')).toBeUndefined();
	});
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DiagnosticInfo, diagnosticSummary, feedbackUrl, MAX_URL_LENGTH, REPO, scrub } from '../../src/feedback/feedback';
import PassBookPlugin from '../../src/main';
import { SIMPLEFIN_SECRET_ID } from '../../src/providers/simplefin';
import { fakeApp } from '../mocks/app';
import { fakeHttp, json } from '../providers/fakes';

const NOW = new Date('2026-10-10T12:00:00Z');
const info: DiagnosticInfo = {
	pluginVersion: '0.1.0',
	obsidianVersion: '1.14.4',
	platform: 'Windows desktop',
	provider: 'simplefin',
	connected: true,
	syncDevice: true,
	layout: 'split',
	csv: true,
	lastSyncAt: '2026-10-10T09:00:00Z',
	accounts: 5,
	transactions: 494,
	pending: 0,
};

describe('diagnosticSummary', () => {
	it('reads at a glance', () => {
		expect(diagnosticSummary(info, NOW)).toBe(
			[
				'PassBook 0.1.0 · Obsidian 1.14.4 · Windows desktop',
				'Data source: SimpleFIN · Connected: yes · This device syncs: yes',
				'Layout: split · CSV: on',
				'Last sync: 3 h ago',
				'Data: 5 accounts · 494 transactions (0 pending)',
			].join('\n'),
		);
	});

	it('handles never synced, a read error and a failed sync', () => {
		const text = diagnosticSummary(
			{ ...info, lastSyncAt: null, accounts: null, readError: 'PassBook/json/accounts.json isn’t valid JSON.', lastSyncError: 'Couldn’t reach SimpleFIN.' },
			NOW,
		);
		expect(text).toContain('Last sync: never');
		expect(text).not.toContain('Data:');
		expect(text).toContain('Data folder error: PassBook/json/accounts.json isn’t valid JSON.');
		expect(text).toContain('Last sync error: Couldn’t reach SimpleFIN.');
	});

	it('scrubs links and token-like strings out of error messages', () => {
		expect(scrub('Failed at https://user:pass@bridge.example/simplefin/accounts')).toBe('Failed at [link removed]');
		expect(scrub(`token aHR0cHM6Ly9iZXRhLWJyaWRnZS5zaW1wbGVmaW4ub3Jn rejected`)).toBe('token [removed] rejected');
		expect(scrub('x'.repeat(10) + ' ' + 'y '.repeat(400)).length).toBeLessThanOrEqual(300);
	});
});

describe('feedbackUrl', () => {
	it('opens the right issue form, pre-filling the summary field', () => {
		const url = new URL(feedbackUrl('bug', 'line one\nline two & more'));
		expect(url.origin + url.pathname).toBe(`https://github.com/${REPO}/issues/new`);
		expect(url.searchParams.get('template')).toBe('1-bug-report.yml');
		expect(url.searchParams.get('diagnostics')).toBe('line one\nline two & more');
		expect(new URL(feedbackUrl('feature')).searchParams.get('template')).toBe('2-feature-request.yml');
		expect(new URL(feedbackUrl('feature')).searchParams.has('diagnostics')).toBe(false);
	});

	it('trims an oversized summary instead of making a link GitHub refuses', () => {
		const url = feedbackUrl('bug', 'é'.repeat(5000));
		expect(url.length).toBeLessThanOrEqual(MAX_URL_LENGTH);
		expect(new URL(url).searchParams.get('diagnostics')).toMatch(/…\(trimmed\)$/);
	});

	it('points at forms that exist and carry the right labels', () => {
		for (const [kind, file, label] of [
			['bug', '1-bug-report.yml', 'bug'],
			['feature', '2-feature-request.yml', 'feature'],
		] as const) {
			expect(new URL(feedbackUrl(kind)).searchParams.get('template')).toBe(file);
			const form = readFileSync(new URL(`../../.github/ISSUE_TEMPLATE/${file}`, import.meta.url), 'utf8');
			expect(form).toContain(`labels: [${label}, user-report]`);
			expect(form).toMatch(/id: diagnostics/);
		}
	});
});

describe('diagnostics from the plugin', () => {
	const fixture: unknown = JSON.parse(readFileSync(new URL('../fixtures/simplefin/accounts-v2.json', import.meta.url), 'utf8'));
	const ACCESS_URL = 'https://user123:s3cret@sfin.example.test/simplefin';

	async function plugin() {
		const app = fakeApp();
		const p = new PassBookPlugin(app as never, { id: 'passbook', version: '0.1.0', dir: '.obsidian/plugins/passbook' } as never);
		await p.onload();
		app.secrets.set(SIMPLEFIN_SECRET_ID, ACCESS_URL);
		return { app, p };
	}

	it('counts the data and never includes names, descriptions, amounts, IDs or secrets', async () => {
		const { p } = await plugin();
		p.http = fakeHttp(json(fixture));
		await p.api.v1.sync();

		const summary = diagnosticSummary(await p.diagnostics());

		expect(summary).toContain('Data: 2 accounts · 4 transactions (1 pending)');
		expect(summary).toContain('Obsidian 1.14.4 · Windows desktop');
		for (const leak of ['Everyday Checking', 'Rewards Card', 'First Example Bank', 'GROCERY', 'PAYROLL', '1523.07', '-42.50', 'ACT-CHK', 'TRN-', 's3cret', 'user123', 'sfin.example.test']) {
			expect(summary).not.toContain(leak);
		}
	});

	it('reports the last sync error, and clears it after a good sync', async () => {
		const { p } = await plugin();
		p.http = fakeHttp(json('', 403));
		await expect(p.api.v1.sync()).rejects.toThrow();
		expect((await p.diagnostics()).lastSyncError).toMatch(/rejected PassBook’s access/);

		p.http = fakeHttp(json(fixture));
		await p.api.v1.sync();
		expect((await p.diagnostics()).lastSyncError).toBeUndefined();
	});
});

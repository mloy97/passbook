import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { changelogSection, checkRelease } from '../../scripts/release.mjs';

const CHANGELOG = `# Changelog

## [Unreleased]

- Next thing.

## [0.2.0] - 2026-11-01

### Added

- A feature.

## [0.1.0] - 2026-10-20

- First.
`;

const good = {
	pkg: { version: '0.2.0' },
	manifest: { version: '0.2.0', minAppVersion: '1.11.5' },
	versions: { '0.1.0': '1.11.5', '0.2.0': '1.11.5' },
	changelog: CHANGELOG,
};

describe('changelogSection', () => {
	it('returns one version’s notes', () => {
		expect(changelogSection(CHANGELOG, '0.2.0')).toBe('### Added\n\n- A feature.');
		expect(changelogSection(CHANGELOG, '0.1.0')).toBe('- First.');
		expect(changelogSection(CHANGELOG, '0.3.0')).toBeNull();
	});

	it('does not confuse 0.1.0 with 0.1.01 or 0x1y0', () => {
		expect(changelogSection('## [0x1y0]\n\nno\n', '0.1.0')).toBeNull();
	});
});

describe('checkRelease', () => {
	it('passes when everything agrees', () => {
		expect(checkRelease('0.2.0', good)).toEqual([]);
	});

	it.each([
		['a v-prefixed tag', 'v0.2.0', good, /isn't x\.y\.z/],
		['package.json behind', '0.2.0', { ...good, pkg: { version: '0.1.0' } }, /package\.json is 0\.1\.0/],
		['manifest behind', '0.2.0', { ...good, manifest: { ...good.manifest, version: '0.1.0' } }, /manifest\.json is 0\.1\.0/],
		['versions.json missing the version', '0.2.0', { ...good, versions: { '0.1.0': '1.11.5' } }, /versions\.json should map 0\.2\.0/],
		['no changelog section', '0.2.0', { ...good, changelog: '# Changelog\n' }, /no "## \[0\.2\.0\]" section/],
	])('reports %s', (_, tag, files, problem) => {
		expect(checkRelease(tag, files).join('\n')).toMatch(problem);
	});
});

describe('the script itself', () => {
	it('refuses the current repo for a version that was never prepared', () => {
		expect(() => execFileSync('node', ['scripts/release.mjs', 'check', '9.9.9'], { stdio: 'pipe' })).toThrow(/CHANGELOG\.md has no/);
	});
});

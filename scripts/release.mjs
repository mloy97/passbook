// Release helpers for .github/workflows/release.yml (and humans).
//
//   node scripts/release.mjs check <tag>   versions agree with the tag, and the changelog has it
//   node scripts/release.mjs notes <tag>   prints that version's changelog section
//
// Obsidian requires the tag to equal manifest.json's version exactly (no leading "v").

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

export function changelogSection(changelog, version) {
	const lines = changelog.split(/\r?\n/);
	const start = lines.findIndex((l) => new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`).test(l));
	if (start === -1) return null;
	const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
	return lines
		.slice(start + 1, end === -1 ? undefined : end)
		.join('\n')
		.trim();
}

/** Returns a list of problems; empty means ready to release. */
export function checkRelease(tag, { pkg, manifest, versions, changelog }) {
	const problems = [];
	if (!/^\d+\.\d+\.\d+$/.test(tag)) problems.push(`Tag "${tag}" isn't x.y.z (Obsidian wants no "v" prefix).`);
	if (pkg.version !== tag) problems.push(`package.json is ${pkg.version}, tag is ${tag}.`);
	if (manifest.version !== tag) problems.push(`manifest.json is ${manifest.version}, tag is ${tag}.`);
	if (versions[tag] !== manifest.minAppVersion) {
		problems.push(`versions.json should map ${tag} to minAppVersion ${manifest.minAppVersion}, has ${versions[tag] ?? 'nothing'}.`);
	}
	const section = changelogSection(changelog, tag);
	if (!section) problems.push(`CHANGELOG.md has no "## [${tag}]" section.`);
	return problems;
}

function main([command, tag]) {
	if (!tag) {
		console.error('usage: node scripts/release.mjs check|notes <tag>');
		process.exit(2);
	}
	const files = {
		pkg: JSON.parse(read('package.json')),
		manifest: JSON.parse(read('manifest.json')),
		versions: JSON.parse(read('versions.json')),
		changelog: read('CHANGELOG.md'),
	};
	if (command === 'check') {
		const problems = checkRelease(tag, files);
		for (const p of problems) console.error(p);
		process.exit(problems.length ? 1 : 0);
	}
	if (command === 'notes') {
		console.log(changelogSection(files.changelog, tag) ?? '');
		return;
	}
	console.error(`unknown command ${command}`);
	process.exit(2);
}

// Run main only when executed directly, not when imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main(process.argv.slice(2));
}

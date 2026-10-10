import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'scripts',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
		'vitest.config.ts',
		'wdio.conf.mts',
		// Type-checked by tests/e2e/tsconfig.json in npm run test:e2e.
		'tests/e2e',
		// Plain JavaScript for users to copy; tested by tests/examples.
		'examples',
		'coverage',
		'.obsidian-cache',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		rules: {
			'obsidianmd/ui/sentence-case': ['warn', { brands: ['PassBook', 'SimpleFIN', 'SimpleFIN Bridge', 'Plaid', 'Obsidian', 'GitHub'] }],
		},
	},
	{
		// Tests run in Node, never on mobile.
		files: ['tests/**'],
		rules: { 'obsidianmd/no-nodejs-modules': 'off', 'obsidianmd/hardcoded-config-path': 'off', 'obsidianmd/prefer-window-timers': 'off' },
	},
);

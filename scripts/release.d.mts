export function changelogSection(changelog: string, version: string): string | null;
export function checkRelease(
	tag: string,
	files: {
		pkg: { version: string };
		manifest: { version: string; minAppVersion: string };
		versions: Record<string, string>;
		changelog: string;
	},
): string[];

import { TFile, TFolder } from './obsidian';

/** The parts of Obsidian's `App` that PassBook uses, backed by maps. */
export function fakeApp() {
	const local = new Map<string, unknown>();
	const secrets = new Map<string, string>();
	const files = new Map<string, string>();
	const dirs = new Set<string>();
	const events: { name: string; data: unknown[] }[] = [];
	const leaves: { type: string; view: unknown }[] = [];
	const parent = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
	const adapter = {
		exists: async (path: string): Promise<boolean> => files.has(path) || dirs.has(path),
		read: async (path: string): Promise<string> => {
			const f = files.get(path);
			if (f === undefined) throw new Error(`ENOENT: ${path}`);
			return f;
		},
		// Like the real adapter: writing into a folder that doesn't exist fails.
		write: async (path: string, data: string): Promise<void> => {
			const dir = parent(path);
			if (dir && !dirs.has(dir)) throw new Error(`ENOENT: ${dir}`);
			files.set(path, data);
		},
		// Like the real adapter: creates parent folders too.
		mkdir: async (path: string): Promise<void> => {
			for (let p = path; p; p = parent(p)) dirs.add(p);
		},
		remove: async (path: string): Promise<void> => {
			if (!files.delete(path)) throw new Error(`ENOENT: ${path}`);
		},
		rename: async (from: string, to: string): Promise<void> => {
			const f = files.get(from);
			if (f === undefined) throw new Error(`ENOENT: ${from}`);
			if (files.has(to)) throw new Error('Destination file already exists!');
			files.delete(from);
			files.set(to, f);
		},
		// Like Obsidian 1.14: rmdir(path, false) fails with EISDIR even on an empty folder.
		rmdir: async (path: string, recursive: boolean): Promise<void> => {
			if (!recursive) throw new Error(`EISDIR: ${path}`);
			for (const f of [...files.keys()]) if (f.startsWith(`${path}/`)) files.delete(f);
			for (const d of [...dirs]) if (d === path || d.startsWith(`${path}/`)) dirs.delete(d);
		},
		list: async (folder: string): Promise<{ files: string[]; folders: string[] }> => ({
			files: [...files.keys()].filter((p) => parent(p) === folder),
			folders: [...dirs].filter((p) => parent(p) === folder),
		}),
	};
	return {
		vault: {
			configDir: '.obsidian',
			adapter,
			/** Folders that exist on "disk" show up as TFolder, like Obsidian's index. */
			getAbstractFileByPath: (path: string): unknown => (dirs.has(path) ? new TFolder(path) : files.has(path) ? new TFile(path) : null),
		},
		workspace: {
			onLayoutReady: (cb: () => void): void => cb(),
			getLeavesOfType: (type: string): unknown[] => leaves.filter((l) => l.type === type),
			revealLeaf: async (): Promise<void> => {},
			trigger: (name: string, ...data: unknown[]): void => void events.push({ name, data }),
		},
		files,
		dirs,
		events,
		leaves,
		loadLocalStorage: (k: string): unknown => local.get(k) ?? null,
		// Like Obsidian: any falsy value (false, 0, '') clears the entry.
		saveLocalStorage: (k: string, v: unknown): void => void (v ? local.set(k, v) : local.delete(k)),
		secretStorage: {
			getSecret: (id: string): string | null => secrets.get(id) ?? null,
			setSecret: (id: string, v: string): void => void secrets.set(id, v),
		},
		local,
		secrets,
	};
}

import { Files } from '../../src/ledger/store';

/** In-memory Files. `writes` records every write path in order. */
export function memoryFiles(initial: Record<string, string> = {}): Files & { data: Map<string, string>; writes: string[] } {
	const data = new Map(Object.entries(initial));
	const writes: string[] = [];
	return {
		data,
		writes,
		read: async (path) => data.get(path) ?? null,
		write: async (path, content) => {
			writes.push(path);
			data.set(path, content);
		},
		list: async (folder) => [...data.keys()].filter((p) => p.startsWith(`${folder}/`) && !p.slice(folder.length + 1).includes('/')),
		remove: async (path) => void data.delete(path),
		// Folders are implicit in this map, so an empty one simply doesn't exist.
		removeFolderIfEmpty: async () => {},
	};
}

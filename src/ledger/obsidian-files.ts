import { DataAdapter, normalizePath } from 'obsidian';
import { Files } from './store';

const TMP = '.tmp';

/**
 * Files over Obsidian's adapter. Writes go to `<path>.tmp` first and are then renamed
 * into place, so a crash or a sync client mid-upload never sees half a file. If a crash
 * lands between removing the old file and the rename, read() falls back to the .tmp.
 */
export function obsidianFiles(adapter: DataAdapter): Files {
	return {
		async read(path) {
			const p = normalizePath(path);
			if (await adapter.exists(p)) return adapter.read(p);
			if (await adapter.exists(p + TMP)) return adapter.read(p + TMP);
			return null;
		},
		async write(path, data) {
			const p = normalizePath(path);
			const folder = p.slice(0, p.lastIndexOf('/'));
			if (folder && !(await adapter.exists(folder))) await adapter.mkdir(folder);
			await adapter.write(p + TMP, data);
			if (await adapter.exists(p)) await adapter.remove(p);
			await adapter.rename(p + TMP, p);
		},
		async list(folder) {
			const f = normalizePath(folder);
			if (!(await adapter.exists(f))) return [];
			return (await adapter.list(f)).files;
		},
		async remove(path) {
			const p = normalizePath(path);
			if (await adapter.exists(p)) await adapter.remove(p);
		},
		async removeFolderIfEmpty(folder) {
			const f = normalizePath(folder);
			if (!(await adapter.exists(f))) return;
			const { files, folders } = await adapter.list(f);
			// recursive: true is safe because the folder was just checked to be empty, and it's
			// needed: on Obsidian 1.14, rmdir(f, false) fails with EISDIR even on an empty folder.
			if (files.length === 0 && folders.length === 0) await adapter.rmdir(f, true);
		},
	};
}

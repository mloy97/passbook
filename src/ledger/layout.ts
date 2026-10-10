// Where each ledger file lives inside the data folder, per layout (docs/schema.md).
// A marker file, passbook.json, records the layout in use so scripts and PassBook
// itself can always find the files, and so an interrupted move can be finished.

export type Layout = 'split' | 'flat' | 'csv-subfolder';

export const DEFAULT_LAYOUT: Layout = 'split';
export const LAYOUTS: Layout[] = ['split', 'flat', 'csv-subfolder'];
export const MARKER = 'passbook.json';

/** Folder prefixes (relative to the data folder, '' or ending in '/') per layout. */
export function dirs(layout: Layout): { json: string; csv: string } {
	switch (layout) {
		case 'split':
			return { json: 'json/', csv: 'csv/' };
		case 'csv-subfolder':
			return { json: '', csv: 'csv/' };
		case 'flat':
			return { json: '', csv: '' };
	}
}

export interface Marker {
	schemaVersion: 1;
	layout: Layout;
	/** Where the JSON files are, relative to the data folder. */
	json: string;
	/** Where the CSV files are, or null when CSV is off. */
	csv: string | null;
}

export function marker(layout: Layout, csv: boolean): Marker {
	const d = dirs(layout);
	return { schemaVersion: 1, layout, json: d.json, csv: csv ? d.csv : null };
}

export function isLayout(v: unknown): v is Layout {
	return typeof v === 'string' && (LAYOUTS as string[]).includes(v);
}

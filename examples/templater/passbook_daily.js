// PassBook daily bank note: a Templater user script.
//
// Put this file in your Templater "user scripts" folder, then in a daily-note template:
//
//   <% await tp.user.passbook_daily() %>
//
// It prints a balance per account and the transactions PassBook has seen since the last
// sync, as Markdown. It only reads; run "PassBook: Sync now" (or call
// passbook.sync()) to fetch new data. Uses api.v1, documented in PassBook's docs/api.md.

/** Formats a decimal string like "-1523.5" as "-1,523.50" without float rounding. */
function money(amount) {
	const negative = amount.startsWith('-');
	const [whole, cents = ''] = amount.replace(/^[-+]/, '').split('.');
	const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
	return `${negative ? '-' : ''}${grouped}.${(cents + '00').slice(0, 2)}`;
}

/** Escapes characters that would break a Markdown table cell. */
function cell(text) {
	return String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

async function passbookDaily(api = globalThis.app?.plugins?.plugins?.passbook?.api?.v1) {
	if (!api) return '> [!warning] PassBook isn’t installed or enabled.';

	const accounts = await api.getAccounts();
	if (accounts.length === 0) return '> [!info] No bank data yet. Run **PassBook: Sync now**.';
	const byId = new Map(accounts.map((a) => [a.id, a]));
	const lastSync = await api.getLastSync();

	const lines = [];
	lines.push('## Balances', '');
	lines.push('| Account | Balance | Available |', '|---|---:|---:|');
	for (const b of await api.getBalances()) {
		const a = byId.get(b.accountId);
		const available = b.availableBalance === null ? '' : money(b.availableBalance);
		lines.push(`| ${cell(`${a.institution} · ${a.name}`)} | ${money(b.balance)} ${b.currency} | ${available} |`);
	}

	const fresh = await api.getNewSinceLastSync();
	lines.push('', `## New since last sync (${fresh.length})`, '');
	if (fresh.length === 0) {
		lines.push('Nothing new.');
	} else {
		lines.push('| Date | Account | Description | Amount |', '|---|---|---|---:|');
		for (const t of fresh) {
			const status = t.status === 'pending' ? ' *(pending)*' : '';
			lines.push(`| ${t.date} | ${cell(byId.get(t.accountId)?.name ?? '')} | ${cell(t.description)}${status} | ${money(t.amount)} |`);
		}
	}

	if (lastSync) lines.push('', `*Last synced ${new Date(lastSync.at).toLocaleString()}.*`);
	return lines.join('\n');
}

module.exports = passbookDaily;

import { nodeAt, type DocTree } from "./model";

export interface DocHit {
	path: string;
	unit: number;
	node?: string;
	title?: string;
	snippet: string;
	score: number;
}

/** Words of a query; quoted phrases stay whole. Case-insensitive. */
export function queryTerms(q: string): string[] {
	const out: string[] = [];
	for (const m of q.matchAll(/"([^"]+)"|(\S+)/g)) {
		const t = (m[1] ?? m[2]).trim().toLowerCase();
		if (t) out.push(t);
	}
	return out;
}

function count(hay: string, needle: string): number {
	let n = 0;
	for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) n++;
	return n;
}

/** Units where every term appears, best first, each with a snippet around its first match. */
export function searchUnits(path: string, tree: DocTree, units: string[], terms: string[], limit = 20): DocHit[] {
	if (!terms.length) return [];
	const hits: DocHit[] = [];
	units.forEach((text, i) => {
		const low = text.toLowerCase();
		let score = 0;
		for (const t of terms) {
			const c = count(low, t);
			if (!c) return;
			score += Math.log2(1 + c);
		}
		const at = low.indexOf(terms[0]);
		const from = Math.max(0, at - 120);
		const snippet = (from > 0 ? "…" : "") + text.slice(from, at + terms[0].length + 180).replace(/\s+/g, " ").trim() + (at + terms[0].length + 180 < text.length ? "…" : "");
		const node = nodeAt(tree, i + 1);
		hits.push({ path, unit: i + 1, node: node?.node_id, title: node?.title, snippet, score });
	});
	return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

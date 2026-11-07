import { walkNodes, type DocNode, type DocTree } from "./model";

/**
 * Node summaries (opt-in, settings → Documents): one sentence per node, written once when a document
 * is first read and kept in its cached tree. Each batch is one model call; leaves are summarized from
 * their text, parents from their opening text and their children's titles, and the document from
 * its top-level summaries. Pure: the runtime runs the prompts.
 */

/** Characters of a node's own text sent with it. */
const NODE_CHARS = 3000;
/** Characters of node text per call. */
const BATCH_CHARS = 48000;

function nodeText(n: DocNode, units: string[]): string {
	const until = n.nodes?.length ? Math.max(n.start, n.nodes[0].start - 1) : n.end;
	let s = "";
	for (let u = n.start; u <= until && s.length < NODE_CHARS; u++) s += (units[u - 1] ?? "") + "\n";
	s = s.replace(/\s+/g, " ").trim().slice(0, NODE_CHARS);
	if (n.nodes?.length) s += `\n[contains: ${n.nodes.map((c) => c.title).join("; ")}]`;
	return s;
}

export interface SummaryBatch {
	ids: string[];
	prompt: string;
}

const INSTRUCTIONS = `Summarize each section of a document for a table of contents. For each one, write ONE sentence (at most 30 words) saying what it covers — its key ideas, not "this section discusses". Write in the language of the section's text. Sections with no meaningful text (blank pages, front matter) get "".
Reply with ONLY a JSON object mapping each section id to its sentence, e.g. {"0001": "…", "0002": "…"}. No other text.`;

export function summaryBatches(tree: DocTree, units: string[]): SummaryBatch[] {
	const batches: SummaryBatch[] = [];
	let ids: string[] = [];
	let parts: string[] = [];
	let size = 0;
	const flush = () => {
		if (!ids.length) return;
		batches.push({ ids, prompt: `${INSTRUCTIONS}\n\nDocument: ${tree.title}\n\n${parts.join("\n\n")}` });
		ids = [];
		parts = [];
		size = 0;
	};
	for (const { node } of walkNodes(tree.structure)) {
		if (node.summary !== undefined) continue;
		const text = nodeText(node, units);
		const part = `<section id="${node.node_id}" title="${node.title.replace(/"/g, "'")}">\n${text}\n</section>`;
		if (size + part.length > BATCH_CHARS) flush();
		ids.push(node.node_id);
		parts.push(part);
		size += part.length;
	}
	flush();
	return batches;
}

/** The prompt for the whole document's summary, from its top-level nodes. */
export function documentPrompt(tree: DocTree): string {
	const lines = tree.structure.map((n) => `- ${n.title}${n.summary ? `: ${n.summary}` : ""}`).join("\n");
	return `Here is the table of contents of "${tree.title}" with a one-sentence summary per part:\n${lines}\n\nWrite 2–3 sentences saying what this document is and what it covers, for someone deciding whether to read it. Write in the document's language. Reply with only those sentences.`;
}

/** A model's reply → summaries by id (tolerates a code fence or text around the JSON). */
export function parseSummaries(reply: string, ids: string[]): Map<string, string> {
	const out = new Map<string, string>();
	const m = reply.match(/\{[\s\S]*\}/);
	if (!m) return out;
	try {
		const obj = JSON.parse(m[0]) as Record<string, unknown>;
		for (const id of ids) {
			const v = obj[id] ?? obj[String(Number(id))];
			if (typeof v === "string") out.set(id, v.replace(/\s+/g, " ").trim());
		}
	} catch {
		/* nothing usable */
	}
	return out;
}

export function applySummaries(tree: DocTree, found: Map<string, string>) {
	for (const { node } of walkNodes(tree.structure)) {
		const s = found.get(node.node_id);
		if (s !== undefined) node.summary = s;
	}
}

/** A document parsed again (a newer parser): summaries of parts that are unchanged carry over. */
export function carrySummaries(from: DocTree, to: DocTree) {
	const key = (n: { title: string; start: number; end: number }) => `${n.title}\u0000${n.start}\u0000${n.end}`;
	const known = new Map<string, string>();
	for (const { node } of walkNodes(from.structure)) if (node.summary !== undefined) known.set(key(node), node.summary);
	if (!known.size) return;
	let all = true;
	for (const { node } of walkNodes(to.structure)) {
		const s = known.get(key(node));
		if (s !== undefined) node.summary = s;
		else all = false;
	}
	if (all && from.summary !== undefined) {
		to.summary = from.summary;
		to.summarized_by = from.summarized_by;
	}
}

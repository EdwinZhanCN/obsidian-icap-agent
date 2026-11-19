/**
 * Session notes (FORMAT.md 7): a note whose body is one request block that writes its record as it goes.
 * The record, a `[!request]` callout directly above the block's fence, is the conversation: each finished
 * round is added to it, and what the agent is told of the earlier rounds is read back from it. Pure.
 */
import { calloutBlock, findAskBlock, quotedRound, requestTitle, serializeAsk } from "./blocks";
import type { Splice } from "./doc-ops";
import { requestRounds, type RequestRound } from "./records";

/** The value of the `icap` property on a session note. */
export const SESSION_MARK = "session";
/** The fence header line of a block whose record is written as it goes. */
export const LIVE_RECORD = "live";

const pad = (n: number) => String(n).padStart(2, "0");

/** What a session note is called until its first request names it: `Session 2026-11-12 1432`. */
export function sessionName(at: Date): string {
	return `Session ${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}${pad(at.getMinutes())}`;
}

/** Is this still the name the plugin gave (so the first request may rename it)? */
export function isSessionName(basename: string): boolean {
	return /^Session \d{4}-\d{2}-\d{2} \d{4}(?: \d+)?$/.test(basename);
}

/**
 * A file name from a request: its first 40 characters, links as their text, without the characters a
 * file name cannot hold. "" when nothing readable is left (a request that is only a command or an image).
 */
export function sessionTitle(request: string): string {
	if (request.trim().startsWith("/")) return "";
	const plain = request
		.replace(/!\[\[[^\]]*\]\]/g, " ")
		.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
		.replace(/[\\/:*?"<>|#^[\]]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (!plain) return "";
	const chars = Array.from(plain);
	return (chars.length > 40 ? chars.slice(0, 40).join("") : plain).replace(/[. ]+$/, "").trim();
}

/** A new session note's text: the two properties, then the block. */
export function sessionNote(id: string, label: string): string {
	return `---\nicap: ${SESSION_MARK}\nicap-id: ${id}\n---\n\n${serializeAsk({ id, kind: "request", body: label, header: { record: LIVE_RECORD } })}\n`;
}

export interface LiveRecord {
	/** The block's fence. */
	fence: { from: number; to: number };
	/** The `[!request]` callout directly above it; null before the first round is written. */
	record: { from: number; to: number; title: string; rounds: (RequestRound & { from: number })[] } | null;
}

/** The block's fence and the record directly above it (only blank lines between). Null when the block is not in the text. */
export function findLiveRecord(text: string, blockId: string): LiveRecord | null {
	const fence = findAskBlock(text, blockId);
	if (!fence) return null;
	// Lines above the fence, with where each starts.
	const above = text.slice(0, fence.from);
	const lines = above.split("\n");
	const starts: number[] = [];
	let at = 0;
	for (const l of lines) {
		starts.push(at);
		at += l.length + 1;
	}
	let end = lines.length - 1;
	while (end >= 0 && !lines[end].trim()) end--;
	let first = end;
	while (first >= 0 && /^>/.test(lines[first])) first--;
	first++;
	const title = first <= end ? lines[first].match(/^>\s*\[!request\][+-]?[ \t]*(.*)$/i) : null;
	if (!title) return { fence, record: null };
	const body = lines.slice(first + 1, end + 1).map((l) => l.replace(/^> ?/, ""));
	const rounds = requestRounds(body).map(({ line, ...r }) => ({ ...r, from: starts[first + 1 + line] }));
	return { fence, record: { from: starts[first], to: starts[end] + lines[end].length, title: title[1].trim(), rounds } };
}

/** The earlier rounds as the agent is told them: the same lines a block's own turns give (runtime/transcript.ts). */
export function roundsTranscript(rounds: RequestRound[]): string {
	const out: string[] = [];
	for (const r of rounds) {
		out.push(`L: ${r.request}`);
		if (r.reply) out.push(`R: ${r.reply}`);
	}
	return out.join("\n");
}

/**
 * Add finished rounds to the block's record: to the end of the callout above the fence, or as a new
 * callout there when this is the first. Nothing already written is touched, so what the learner
 * changed in the record stays as they left it. `files`: what the agent created or changed in these rounds.
 */
export function appendRounds(text: string, blockId: string, topic: string, rounds: { request: string; reply: string }[], files: { kind: string; path: string }[]): Splice | null {
	const found = findLiveRecord(text, blockId);
	if (!found || !rounds.length) return null;
	const added = rounds.map((r, i) => quotedRound(r, i === rounds.length - 1 ? files : [])).join("\n>\n");
	if (found.record) return { from: found.record.to, to: found.record.to, insert: `\n>\n${added}` };
	const callout = `${calloutBlock("request", requestTitle(topic), "x").split("\n")[0]}\n${added}`;
	// The record is its own block, one blank line above the fence and one below what was there.
	let from = found.fence.from;
	while (from > 0 && text[from - 1] === "\n") from--;
	return { from, to: found.fence.from, insert: `${from === 0 ? "" : "\n\n"}${callout}\n\n` };
}

/**
 * Take the last round out of the record (it is asked again, or asked differently): the round that was
 * removed, and the change. The record goes with its only round.
 */
export function dropLastRound(text: string, blockId: string): { splice: Splice; round: RequestRound } | null {
	const record = findLiveRecord(text, blockId)?.record;
	const last = record?.rounds.at(-1);
	if (!record || !last) return null;
	const { from: _from, ...round } = last;
	if (record.rounds.length === 1) {
		let to = record.to;
		while (to < text.length && text[to] === "\n") to++;
		return { splice: { from: record.from, to, insert: "" }, round };
	}
	// From the end of what stood before the round: the quoted blank line between them goes too.
	let from = last.from;
	while (from > record.from) {
		const lineStart = text.lastIndexOf("\n", from - 2) + 1;
		if (text.slice(lineStart, from - 1).replace(/^>/, "").trim()) break;
		from = lineStart;
	}
	return { splice: { from: from - 1, to: record.to, insert: "" }, round };
}

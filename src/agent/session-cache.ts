import { existsSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { hashText } from "../dsl/commands";

/**
 * A request block's Pi session, kept as a cache — never as the source of truth.
 *
 * The note is what the conversation *is*: the agent's context is the block's visible turns. Without
 * a cache, every follow-up replays them as a prompt to a fresh Pi. With one, a follow-up resumes
 * the Pi session that produced the last reply (tool results, files already read, prompt cache),
 * but only while that session still covers exactly what the block shows. Anything else — an
 * interrupted run, a changed agent setup, a missing file — falls back to replaying the note.
 *
 * Pi stores a session as `<dir>/<timestamp>_<sessionId>.jsonl`, created by `--session-id` +
 * `--session-dir` and written once the first assistant message lands.
 */

export interface BlockSession {
	/** Pi session id: `icap-<blockId>-<n>` (`icpa-…` for sessions from before the plugin was renamed). */
	id: string;
	/** Fingerprint of what the session covers: agent setup + the block's transcript up to its last reply. */
	sig: string;
}

export function sessionId(blockId: string, n: number): string {
	return `icap-${blockId}-${n}`;
}

export function sessionSig(setup: string, transcript: string): string {
	return `${hashText(setup)}${hashText(transcript)}:${transcript.length}`;
}

/** Can a follow-up resume this session? Only if it covers exactly the block's history. */
export function reusable(s: BlockSession | null, setup: string, history: string): s is BlockSession {
	return !!s && s.sig === sessionSig(setup, history);
}

export function ensureDir(dir: string): string {
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

function files(dir: string): string[] {
	try {
		return readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
	} catch {
		return [];
	}
}

export function sessionExists(dir: string, id: string): boolean {
	return files(dir).some((f) => f.endsWith(`_${id}.jsonl`));
}

/** The block id a session file belongs to, or null if it is not one of ours. */
export function blockOfFile(name: string): string | null {
	const m = name.match(/_(?:icap|icpa)-([A-Za-z0-9]+)-\d+\.jsonl$/);
	return m ? m[1] : null;
}

/** Remove a block's sessions (all generations), or every session whose block is not in `keep`. */
export function removeSessions(dir: string, match: { block: string } | { keep: Set<string> }): number {
	let n = 0;
	for (const f of files(dir)) {
		const b = blockOfFile(f);
		if (!b) continue;
		const drop = "block" in match ? b === match.block : !match.keep.has(b);
		if (!drop) continue;
		try {
			unlinkSync(join(dir, f));
			n++;
		} catch {
			/* already gone */
		}
	}
	return n;
}

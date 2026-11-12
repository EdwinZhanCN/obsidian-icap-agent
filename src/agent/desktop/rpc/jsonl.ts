import { StringDecoder } from "string_decoder";

/**
 * Strict JSONL framing, as Pi's RPC mode asks: records end with LF only (an optional CR before it is
 * dropped). Node's `readline` is not used: it also splits on U+2028 and U+2029, which are valid inside
 * a JSON string. Bytes are decoded across chunk boundaries, so a character cut in two arrives whole.
 */
export class Lines {
	private decoder = new StringDecoder("utf8");
	private rest = "";

	/** The complete lines `chunk` ends; what follows the last LF waits for the next chunk. Empty lines are dropped. */
	push(chunk: Uint8Array | string): string[] {
		this.rest += typeof chunk === "string" ? chunk : this.decoder.write(chunk as Buffer);
		const out: string[] = [];
		let from = 0;
		for (;;) {
			const i = this.rest.indexOf("\n", from);
			if (i < 0) break;
			const line = this.rest.charCodeAt(i - 1) === 13 ? this.rest.slice(from, i - 1) : this.rest.slice(from, i);
			if (line) out.push(line);
			from = i + 1;
		}
		if (from) this.rest = this.rest.slice(from);
		return out;
	}
}

/** One record as its line. JSON.stringify escapes every LF inside strings, so the line holds exactly one. */
export function record(value: unknown): string {
	return JSON.stringify(value) + "\n";
}

/** A line as a record; null when it is not a JSON object (a stray line is skipped, never fatal). */
export function parseRecord(line: string): Record<string, unknown> | null {
	try {
		const v: unknown = JSON.parse(line);
		return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

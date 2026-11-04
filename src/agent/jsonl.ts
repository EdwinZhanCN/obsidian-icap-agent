/**
 * Strict JSONL framing for Pi RPC: records are split on LF only (never on U+2028/U+2029,
 * which are legal inside JSON strings), an optional trailing CR is stripped.
 */
export class JsonlSplitter {
	private buffer = "";

	push(chunk: string): unknown[] {
		this.buffer += chunk;
		const out: unknown[] = [];
		let nl = this.buffer.indexOf("\n");
		while (nl !== -1) {
			let line = this.buffer.slice(0, nl);
			this.buffer = this.buffer.slice(nl + 1);
			if (line.endsWith("\r")) line = line.slice(0, -1);
			if (line.trim()) {
				try {
					out.push(JSON.parse(line));
				} catch {
					// Stdout is reserved for protocol records; a malformed line is dropped.
				}
			}
			nl = this.buffer.indexOf("\n");
		}
		return out;
	}
}

export function encodeRecord(record: unknown): string {
	return JSON.stringify(record) + "\n";
}

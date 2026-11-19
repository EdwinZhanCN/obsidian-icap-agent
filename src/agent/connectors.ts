/** Pure: connector names and command lines, for the settings and the desktop backend. */

/** Letters, digits, `_` and `-`: what tool names are built from (pi-mcp's rule). */
export const CONNECTOR_NAME = /^[A-Za-z0-9_-]+$/;

/** A command line as the program and its arguments: spaces separate, quotes keep, a backslash escapes. Pure. */
export function splitCommand(line: string): string[] {
	const out: string[] = [];
	let cur = "";
	let quote: string | null = null;
	let started = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (c === "\\" && i + 1 < line.length && quote !== "'") {
			cur += line[++i];
			started = true;
		} else if (quote) {
			if (c === quote) quote = null;
			else cur += c;
		} else if (c === '"' || c === "'") {
			quote = c;
			started = true;
		} else if (/\s/.test(c)) {
			if (started) out.push(cur);
			cur = "";
			started = false;
		} else {
			cur += c;
			started = true;
		}
	}
	if (started) out.push(cur);
	return out;
}

/** The command line a stdio server runs, for display: arguments with spaces quoted. Pure. */
export function joinCommand(command: string, args: readonly string[] = []): string {
	return [command, ...args].map((a) => (/[\s"']/.test(a) || !a ? JSON.stringify(a) : a)).join(" ");
}

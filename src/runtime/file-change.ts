/**
 * A file as the agent's edit or write tool wants it, turned into the one change the learner reviews.
 * Pure: text in, text out.
 *
 * The tools give the whole new file. What the learner is shown, and what is applied to the note they
 * may be typing in, is the part that differs: from the first changed line to the last (`hunk`). It is
 * applied to the note as it is *now* (`locate`), so what the learner wrote elsewhere in the meantime
 * stays; when the changed lines themselves are no longer there, the change is not applied.
 */

export interface Hunk {
	/** The lines being replaced, as they are in the file; "" when the file is empty or new. */
	find: string;
	/** What replaces them. */
	replace: string;
	/** Where `find` starts in the text the tool read. */
	at: number;
}

/** The changed lines between two versions of a file: everything from the first differing line to the last. */
export function hunk(before: string, after: string): Hunk {
	const max = Math.min(before.length, after.length);
	let head = 0;
	while (head < max && before.charCodeAt(head) === after.charCodeAt(head)) head++;
	let tail = 0;
	while (tail < max - head && before.charCodeAt(before.length - 1 - tail) === after.charCodeAt(after.length - 1 - tail)) tail++;
	// Whole lines: back to the start of the first changed line, on to the end of the last.
	let from = before.lastIndexOf("\n", head - 1) + 1;
	let endBefore = before.length - tail;
	let endAfter = after.length - tail;
	const lineEnd = before.indexOf("\n", endBefore);
	const rest = (lineEnd === -1 ? before.length : lineEnd) - endBefore;
	endBefore += rest;
	endAfter += rest;
	// Lines added between two others replace nothing: take the line before them (else the one after) as the anchor.
	if (endBefore <= from && before.length > 0) {
		if (from > 0) from = before.lastIndexOf("\n", from - 2) + 1;
		else {
			const next = before.indexOf("\n", endBefore);
			const grow = (next === -1 ? before.length : next + 1) - endBefore;
			endBefore += grow;
			endAfter += grow;
		}
	}
	return { find: before.slice(from, endBefore), replace: after.slice(from, endAfter), at: from };
}

/**
 * Where a hunk goes in the text as it is now: where the tool saw it when the lines are still there,
 * else their only other occurrence. Null: the lines are gone or stand in several places, so applying
 * the change could land on the wrong one.
 */
export function locate(text: string, h: Hunk): { from: number; to: number } | null {
	if (!h.find) return text.length === 0 ? { from: 0, to: 0 } : null;
	if (text.startsWith(h.find, h.at)) return { from: h.at, to: h.at + h.find.length };
	const first = text.indexOf(h.find);
	if (first === -1 || text.indexOf(h.find, first + 1) !== -1) return null;
	return { from: first, to: first + h.find.length };
}

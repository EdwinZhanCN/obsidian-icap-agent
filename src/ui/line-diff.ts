/**
 * A proposed edit as the learner reads it: the lines that change, with a little context, and the
 * unchanged stretches between them folded. Pure: no DOM, no Obsidian.
 */

export type DiffLine = { t: "same" | "del" | "add"; text: string };
export type DiffItem = DiffLine | { t: "gap"; lines: DiffLine[] };

/** Lines above which the LCS table is skipped and the edit shown as a plain replacement. */
const MAX_CELLS = 250_000;

/** Line diff of `a` → `b` (longest common subsequence). Deletions come before additions in a change. */
export function lineDiff(a: string, b: string): DiffLine[] {
	const x = a ? a.split("\n") : [];
	const y = b ? b.split("\n") : [];
	// Common head and tail first: most edits touch a few lines in the middle.
	let head = 0;
	while (head < x.length && head < y.length && x[head] === y[head]) head++;
	let tail = 0;
	while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
	const xs = x.slice(head, x.length - tail);
	const ys = y.slice(head, y.length - tail);
	const out: DiffLine[] = x.slice(0, head).map((text) => ({ t: "same", text }));
	if (xs.length * ys.length > MAX_CELLS) {
		for (const text of xs) out.push({ t: "del", text });
		for (const text of ys) out.push({ t: "add", text });
	} else {
		const n = xs.length;
		const m = ys.length;
		// lcs[i][j]: length of the LCS of xs[i..] and ys[j..], flattened.
		const lcs = new Uint32Array((n + 1) * (m + 1));
		for (let i = n - 1; i >= 0; i--)
			for (let j = m - 1; j >= 0; j--)
				lcs[i * (m + 1) + j] = xs[i] === ys[j] ? lcs[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1]);
		let i = 0;
		let j = 0;
		while (i < n || j < m) {
			if (i < n && j < m && xs[i] === ys[j]) {
				out.push({ t: "same", text: xs[i++] });
				j++;
			} else if (j >= m || (i < n && lcs[(i + 1) * (m + 1) + j] >= lcs[i * (m + 1) + j + 1])) {
				out.push({ t: "del", text: xs[i++] });
			} else {
				out.push({ t: "add", text: ys[j++] });
			}
		}
	}
	for (const text of x.slice(x.length - tail)) out.push({ t: "same", text });
	return out;
}

/**
 * Changed lines with `context` unchanged lines around each change; longer unchanged stretches
 * become one gap the learner can open. A gap that would hide only a line or two is shown instead.
 */
export function foldDiff(lines: DiffLine[], context = 2): DiffItem[] {
	const keep = lines.map(() => false);
	lines.forEach((l, i) => {
		if (l.t === "same") return;
		for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
	});
	const out: DiffItem[] = [];
	let i = 0;
	while (i < lines.length) {
		if (keep[i]) {
			out.push(lines[i++]);
			continue;
		}
		const start = i;
		while (i < lines.length && !keep[i]) i++;
		const run = lines.slice(start, i);
		if (run.length <= 2) out.push(...run);
		else out.push({ t: "gap", lines: run });
	}
	return out;
}

export function diffStats(lines: DiffLine[]): { add: number; del: number } {
	let add = 0;
	let del = 0;
	for (const l of lines) {
		if (l.t === "add") add++;
		else if (l.t === "del") del++;
	}
	return { add, del };
}

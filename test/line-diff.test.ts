import { describe, expect, it } from "vitest";
import { diffStats, foldDiff, lineDiff } from "../src/ui/line-diff";

const marks = (s: string, t: string) => lineDiff(s, t).map((l) => `${l.t === "same" ? " " : l.t === "del" ? "-" : "+"}${l.text}`);

describe("lineDiff", () => {
	it("keeps unchanged lines and marks the changed ones", () => {
		expect(marks("a\nb\nc", "a\nB\nc")).toEqual([" a", "-b", "+B", " c"]);
	});
	it("an empty original is all additions", () => {
		expect(marks("", "x\ny")).toEqual(["+x", "+y"]);
	});
	it("an insertion in the middle leaves the rest alone", () => {
		expect(marks("1\n2\n3\n4", "1\n2\nnew\n3\n4")).toEqual([" 1", " 2", "+new", " 3", " 4"]);
	});
	it("a removal", () => {
		expect(marks("1\n2\n3", "1\n3")).toEqual([" 1", "-2", " 3"]);
	});
	it("counts additions and deletions", () => {
		expect(diffStats(lineDiff("a\nb\nc", "a\nB\nc\nd"))).toEqual({ add: 2, del: 1 });
	});
});

describe("foldDiff", () => {
	const long = Array.from({ length: 20 }, (_, i) => `line ${i}`);
	it("folds the unchanged stretch between two changes", () => {
		const b = [...long];
		b[1] = "changed 1";
		b[18] = "changed 18";
		const items = foldDiff(lineDiff(long.join("\n"), b.join("\n")));
		const gaps = items.filter((x) => x.t === "gap");
		expect(gaps).toHaveLength(1);
		expect(gaps[0].t === "gap" && gaps[0].lines.length).toBe(12);
		// Two lines of context on each side of each change survive.
		expect(items.filter((x) => x.t === "same").map((x) => x.t !== "gap" && x.text)).toEqual(["line 0", "line 2", "line 3", "line 16", "line 17", "line 19"]);
	});
	it("does not fold a stretch of one or two lines", () => {
		const a = "a\nb\nc\nd\ne\nf\ng";
		const b = "A\nb\nc\nd\ne\nf\nG";
		expect(foldDiff(lineDiff(a, b)).some((x) => x.t === "gap")).toBe(false);
	});
	it("an all-new passage has nothing to fold", () => {
		expect(foldDiff(lineDiff("", "x\ny\nz")).map((x) => x.t)).toEqual(["add", "add", "add"]);
	});
});

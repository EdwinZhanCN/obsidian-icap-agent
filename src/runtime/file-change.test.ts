import { describe, expect, it } from "vite-plus/test";
import { hunk, locate } from "./file-change";

/** Applying a hunk where `locate` puts it must give the new file. */
function apply(text: string, before: string, after: string): string | null {
	const h = hunk(before, after);
	const at = locate(text, h);
	return at ? text.slice(0, at.from) + h.replace + text.slice(at.to) : null;
}

describe("the change the learner reviews", () => {
	it("is the changed lines, whole, not the whole file", () => {
		const before = "# Title\n\nfirst line\nsecond line\nthird line\n";
		const after = "# Title\n\nfirst line\nsecond line, changed\nthird line\n";
		expect(hunk(before, after)).toEqual({ find: "second line", replace: "second line, changed", at: 20 });
	});

	it("spans from the first changed line to the last when several change", () => {
		const before = "a\nb\nc\nd\ne\n";
		const after = "a\nB\nc\nD\ne\n";
		expect(hunk(before, after)).toMatchObject({ find: "b\nc\nd", replace: "B\nc\nD" });
	});

	it("lines added between two others take the line before them as their anchor", () => {
		const before = "one\ntwo\n";
		const after = "one\nnew\ntwo\n";
		const h = hunk(before, after);
		expect(h.find).not.toBe("");
		expect(apply(before, before, after)).toBe(after);
	});

	it("lines added at the very start anchor on the first line", () => {
		const before = "one\ntwo\n";
		const after = "zero\none\ntwo\n";
		expect(hunk(before, after).find).not.toBe("");
		expect(apply(before, before, after)).toBe(after);
	});

	it("a new or empty file is all replacement", () => {
		expect(hunk("", "hello\n")).toEqual({ find: "", replace: "hello\n", at: 0 });
		expect(apply("", "", "hello\n")).toBe("hello\n");
	});

	it("round-trips: appended lines, removed lines, a changed last line without a newline", () => {
		for (const [before, after] of [
			["a\nb\n", "a\nb\nc\n"],
			["a\nb\nc\n", "a\nc\n"],
			["a\nb", "a\nB"],
			["x", "y"],
			["a\n\n\nb\n", "a\n\nb\n"],
			["repeat\nrepeat\nrepeat\n", "repeat\nchanged\nrepeat\n"],
		]) {
			expect(apply(before, before, after)).toBe(after);
		}
	});
});

describe("applying it to the note as it is now", () => {
	const before = "# Title\n\nfirst\nsecond\nthird\n";
	const after = "# Title\n\nfirst\nSECOND\nthird\n";

	it("keeps what the learner wrote elsewhere in the meantime", () => {
		const now = "# Title\n\nA line the learner just added.\n\nfirst\nsecond\nthird\n";
		expect(apply(now, before, after)).toBe("# Title\n\nA line the learner just added.\n\nfirst\nSECOND\nthird\n");
	});

	it("is refused when the changed lines are gone", () => {
		expect(apply("# Title\n\nfirst\nrewritten by the learner\nthird\n", before, after)).toBeNull();
	});

	it("is refused when the lines moved and now stand in two places", () => {
		expect(apply("second\n# Title\n\nfirst\nx\nsecond\n", before, after)).toBeNull();
	});

	it("a new file is not written over a note that has text", () => {
		expect(locate("something", hunk("", "new\n"))).toBeNull();
	});
});

import { describe, expect, it } from "vite-plus/test";
import { cap, parsePages, MAX_PAGES } from "./doc-pages";
import { hasTag, parseQuery } from "./doc-pages";



describe("read_document helpers", () => {
	it("parses page selections against the page count", () => {
		expect(parsePages("12", 40).pages).toEqual([12]);
		expect(parsePages("3-5", 40).pages).toEqual([3, 4, 5]);
		expect(parsePages("38-", 40).pages).toEqual([38, 39, 40]);
		expect(parsePages("1,4,9-10,4", 40).pages).toEqual([1, 4, 9, 10]);
		expect(parsePages("39-45", 40).pages).toEqual([39, 40]);
		expect(parsePages(undefined, 3).pages).toEqual([1, 2, 3]);
	});
	it("caps one call and says more follow", () => {
		const r = parsePages("", 100);
		expect(r.pages.length).toBe(MAX_PAGES);
		expect(r.more).toBe(true);
		expect(parsePages("1-5", 100).more).toBe(false);
	});
	it("rejects nonsense", () => {
		expect(() => parsePages("chapter 2", 10)).toThrow(/Invalid page selection/);
	});
	it("caps long text", () => {
		expect(cap("abcdef", 3)).toEqual({ text: "abc\n…(truncated)", truncated: true });
		expect(cap("ab", 3)).toEqual({ text: "ab", truncated: false });
	});
});

describe("obsidian search query", () => {
	it("splits operators from words", () => {
		expect(parseQuery('pointer tag:#cpp path:"Learning/C++" file:notes heap')).toEqual({
			text: "pointer heap",
			paths: ["learning/c++"],
			files: ["notes"],
			tags: ["cpp"],
		});
		expect(parseQuery('"exact phrase" x')).toEqual({ text: "exact phrase x", paths: [], files: [], tags: [] });
		expect(parseQuery("tag:ml").text).toBe("");
	});
	it("matches nested tags", () => {
		expect(hasTag(["#ml/optim"], "ml")).toBe(true);
		expect(hasTag(["#ML"], "ml")).toBe(true);
		expect(hasTag(["#mlops"], "ml")).toBe(false);
	});
});

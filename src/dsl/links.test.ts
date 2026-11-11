import { describe, expect, it } from "vite-plus/test";
import { headingTrail } from "./text";
import { extractLinks, insertLink, linkTrigger } from "./links";
import { requestPrompt } from "../agent/prompts";



describe("[[ links in a request", () => {
	it("sees a link being typed", () => {
		expect(linkTrigger("基于 [[Poin", 10)).toEqual({ start: 3, query: "Poin" });
		expect(linkTrigger("[[", 2)).toEqual({ start: 0, query: "" });
		expect(linkTrigger("[[A]] and", 9)).toBeNull();
		expect(linkTrigger("[[A|alias", 9)).toBeNull();
	});
	it("treats @ at a word start as the same shortcut, but not e-mail", () => {
		expect(linkTrigger("基于@资料", 5)).toEqual({ start: 2, query: "资料" });
		expect(linkTrigger("see @book", 9)).toEqual({ start: 4, query: "book" });
		expect(linkTrigger("me@x.com", 8)).toBeNull();
		expect(linkTrigger("@a b", 4)).toBeNull();
	});
	it("inserts the finished link", () => {
		expect(insertLink("用 @bo 讲", 5, { start: 2, query: "bo" }, "Sources/book.pdf")).toEqual({ text: "用 [[Sources/book.pdf]] 讲", caret: 22 });
		expect(insertLink("[[Po]]", 4, { start: 0, query: "Po" }, "Pointers")).toEqual({ text: "[[Pointers]]", caret: 12 });
	});
	it("extracts targets without headings or aliases", () => {
		expect(extractLinks("用 [[A]]、[[B#Intro|b]] 和 ![[c.pdf]]，再看 [[A]]")).toEqual(["A", "B", "c.pdf"]);
	});
	it("lists the pointed files in the request prompt, not their content", () => {
		const ctx = { title: "T", path: "T.md", headingTrail: [] } as any;
		const p = requestPrompt(ctx, undefined, "", "基于 [[book.pdf]] 和 [[Missing]]", [
			{ link: "book.pdf", path: "Sources/book.pdf" },
			{ link: "Missing", path: null },
		]);
		expect(p).toContain("- [[book.pdf]] → Sources/book.pdf");
		expect(p).toContain("- [[Missing]] → no such file (yet)");
	});
});

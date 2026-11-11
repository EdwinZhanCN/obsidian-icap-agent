import { describe, expect, it } from "vite-plus/test";
import { glossAnchor, headingTrail, paragraphBounds, sectionBounds, shortTitle } from "./text";

const NOTE = `---
tags: [cpp]
---
# C++ Memory

Intro paragraph about memory.
It spans two lines with RAII here.

## RAII

RAII ties resource lifetime to object lifetime.
- first item mentions destructor
  continued line
- second item

\`\`\`cpp
std::lock_guard<std::mutex> g(m);
\`\`\`

## Smart pointers

unique_ptr owns.
`;

describe("structure", () => {
	it("finds the heading trail", () => {
		const off = NOTE.indexOf("ties resource");
		expect(headingTrail(NOTE, off)).toEqual(["C++ Memory", "RAII"]);
	});
	it("anchors a gloss after the paragraph", () => {
		const off = NOTE.indexOf("RAII here");
		const anchor = glossAnchor(NOTE, off);
		expect(NOTE.slice(anchor - 10, anchor)).toBe("RAII here.");
	});
	it("anchors a gloss after a list item with continuation", () => {
		const off = NOTE.indexOf("destructor");
		const anchor = glossAnchor(NOTE, off);
		expect(NOTE.slice(anchor - 14, anchor)).toBe("continued line");
	});
	it("anchors a gloss after a code fence", () => {
		const off = NOTE.indexOf("lock_guard");
		const anchor = glossAnchor(NOTE, off);
		expect(NOTE.slice(anchor - 3, anchor)).toBe("```");
	});
	it("bounds the section", () => {
		const s = sectionBounds(NOTE, NOTE.indexOf("ties resource"));
		expect(s.title).toBe("RAII");
		expect(NOTE.slice(s.from, s.to).endsWith("```")).toBe(true);
	});
	it("bounds a paragraph", () => {
		const p = paragraphBounds(NOTE, NOTE.indexOf("two lines"));
		expect(NOTE.slice(p.from, p.to)).toBe("Intro paragraph about memory.\nIt spans two lines with RAII here.");
	});
});

describe("shortTitle", () => {
	it("keeps short text and cuts long text at about 40 characters", () => {
		expect(shortTitle("What is the heap?")).toBe("What is the heap?");
		expect(shortTitle("a".repeat(50))).toBe(`${"a".repeat(38)}…`);
	});

	it("never cuts a link in two", () => {
		// the link ends soon after the cut: it stays whole
		expect(shortTitle("Now connect the lift with [[Bernoulli's principle]] and the wing")).toBe("Now connect the lift with [[Bernoulli's principle]]…");
		// a very long link: the title ends before it
		expect(shortTitle(`Compare this with [[${"x".repeat(80)}]] please`)).toBe("Compare this with…");
		// an unclosed link: the title ends before it
		expect(shortTitle("Explain the second paragraph of [[Bernoulli's principle")).toBe("Explain the second paragraph of…");
	});
});

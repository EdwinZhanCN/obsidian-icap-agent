import { describe, expect, it } from "vite-plus/test";
import { findNode, nodeAt, outlineText, treeFromHeadings, type DocTree } from "./model";

const tree = (structure: DocTree["structure"], units: number, unit: DocTree["unit"] = "page"): DocTree => ({ version: 1, parser: 1, format: "pdf", hash: "h", title: "T", unit, units, toc_source: "bookmarks", structure });

describe("document tree", () => {
	it("covers every unit, nests by level, and adds a preface before the first heading", () => {
		const t = treeFromHeadings(
			[
				{ level: 1, title: "Intro", unit: 3 },
				{ level: 2, title: "Why", unit: 3 },
				{ level: 2, title: "How", unit: 5 },
				{ level: 1, title: "Body", unit: 8 },
			],
			10,
		);
		expect(t.map((n) => [n.node_id, n.title, n.start, n.end])).toEqual([
			["0001", "Preface", 1, 2],
			["0002", "Intro", 3, 7],
			["0005", "Body", 8, 10],
		]);
		expect(t[1].nodes!.map((n) => [n.node_id, n.start, n.end])).toEqual([
			["0003", 3, 4],
			["0004", 5, 7],
		]);
		const d = tree(t, 10);
		expect(findNode(d, "4")?.title).toBe("How");
		expect(nodeAt(d, 6)?.title).toBe("How");
		expect(outlineText(d)).toContain("  0004 How (p.5–7)");
		expect(outlineText(d, { maxDepth: 0 })).toContain("0002 Intro (p.3–7) (+2 below)");
	});
	it("keeps headings in order even when a bookmark points back", () => {
		const t = treeFromHeadings([{ level: 1, title: "A", unit: 4 }, { level: 1, title: "B", unit: 2 }], 6);
		expect(t.slice(1).map((n) => [n.title, n.start, n.end])).toEqual([["A", 4, 4], ["B", 4, 6]]);
	});
});

describe("shared pages", () => {
	it("keeps a parent around a child that sits on the page where the next part begins", () => {
		const t = treeFromHeadings(
			[
				{ level: 1, title: "Segments", unit: 4 },
				{ level: 2, title: "Sports", unit: 7 },
				{ level: 2, title: "Experiences", unit: 9 },
				{ level: 1, title: "Other", unit: 9 },
			],
			12,
		);
		expect(t.slice(1).map((n) => [n.title, n.start, n.end])).toEqual([["Segments", 4, 9], ["Other", 9, 12]]);
		expect(t[1].nodes!.map((n) => [n.title, n.start, n.end])).toEqual([["Sports", 7, 8], ["Experiences", 9, 9]]);
	});
});

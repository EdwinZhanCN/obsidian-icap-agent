import { describe, expect, it } from "vite-plus/test";
import { treeFromHeadings, type DocTree } from "./model";
import { queryTerms, searchUnits } from "./search";
import { applySummaries, carrySummaries, parseSummaries, summaryBatches } from "./summaries";

const tree = (structure: DocTree["structure"], units: number, unit: DocTree["unit"] = "page"): DocTree => ({ version: 1, parser: 1, format: "pdf", hash: "h", title: "T", unit, units, toc_source: "bookmarks", structure });

describe("search and summaries", () => {
	const t = tree(treeFromHeadings([{ level: 1, title: "Gradients", unit: 1 }, { level: 1, title: "Backprop", unit: 2 }], 2), 2);
	const units = ["The gradient points uphill.", "Backpropagation applies the chain rule to compute the gradient."];
	it("finds units with every term and labels them with their node", () => {
		expect(queryTerms('chain "the gradient"')).toEqual(["chain", "the gradient"]);
		const hits = searchUnits("b.pdf", t, units, queryTerms("gradient chain"));
		expect(hits).toHaveLength(1);
		expect(hits[0]).toMatchObject({ unit: 2, node: "0002", title: "Backprop" });
		expect(hits[0].snippet).toContain("chain rule");
	});
	it("batches every node once and reads the model's JSON back", () => {
		const batches = summaryBatches(t, units);
		expect(batches).toHaveLength(1);
		expect(batches[0].ids).toEqual(["0001", "0002"]);
		expect(batches[0].prompt).toContain('<section id="0002" title="Backprop">');
		const found = parseSummaries('Sure:\n```json\n{"0001": "Gradients point uphill.", "2": "Backprop is the chain rule."}\n```', batches[0].ids);
		applySummaries(t, found);
		expect(t.structure.map((n) => n.summary)).toEqual(["Gradients point uphill.", "Backprop is the chain rule."]);
		expect(summaryBatches(t, units)).toEqual([]);
	});
});

describe("re-parsing", () => {
	it("keeps the summaries of parts that did not change, and the document's only if all did", () => {
		const old = tree(treeFromHeadings([{ level: 1, title: "A", unit: 1 }, { level: 1, title: "B", unit: 3 }], 4), 4);
		old.structure[0].summary = "about A";
		old.structure[1].summary = "about B";
		old.summary = "whole";
		const same = tree(treeFromHeadings([{ level: 1, title: "A", unit: 1 }, { level: 1, title: "B", unit: 3 }], 4), 4);
		carrySummaries(old, same);
		expect([same.structure.map((n) => n.summary), same.summary]).toEqual([["about A", "about B"], "whole"]);
		const moved = tree(treeFromHeadings([{ level: 1, title: "A", unit: 1 }, { level: 1, title: "B2", unit: 2 }], 4), 4);
		carrySummaries(old, moved);
		expect([moved.structure[0].summary, moved.structure[1].summary, moved.summary]).toEqual([undefined, undefined, undefined]);
	});
});

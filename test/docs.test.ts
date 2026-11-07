import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { detectHeadings, detectTitle, junkTitle, linesOfItems, numberingLevel, type PdfLine } from "../src/docs/detect";
import { parseDocx } from "../src/docs/docx";
import { parseEpub, resolveHref } from "../src/docs/epub";
import { htmlToText } from "../src/docs/html";
import { findNode, nodeAt, outlineText, treeFromHeadings, type DocTree } from "../src/docs/model";
import { queryTerms, searchUnits } from "../src/docs/search";
import { applySummaries, carrySummaries, parseSummaries, summaryBatches } from "../src/docs/summaries";

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

describe("XHTML to text", () => {
	it("keeps headings, lists, tables and entities readable", () => {
		const t = htmlToText(`<html><head><style>p{}</style></head><body><h2>Title <em>here</em></h2><p>A&amp;B&#160;&#x4e2d;</p><ul><li>one</li><li>two</li></ul><table><tr><td>x</td><td>y</td></tr></table></body></html>`);
		expect(t).toBe("## Title here\n\nA&B 中\n\n- one\n- two\n\nx | y");
	});
});

function epub(files: Record<string, string>): Uint8Array {
	return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

describe("EPUB", () => {
	it("resolves hrefs against the file that holds them", () => {
		expect(resolveHref("OEBPS/nav/toc.xhtml", "../text/ch%201.xhtml#s2")).toEqual({ file: "OEBPS/text/ch 1.xhtml", fragment: "s2" });
	});
	it("reads the EPUB 3 nav and splits a chapter where the table of contents points inside it", () => {
		const data = epub({
			"META-INF/container.xml": `<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`,
			"OEBPS/content.opf": `<package><metadata><dc:title>深度学习</dc:title></metadata><manifest>
				<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
				<item id="c1" href="text/c1.xhtml" media-type="application/xhtml+xml"/>
				<item id="c2" href="text/c2.xhtml" media-type="application/xhtml+xml"/>
				<item id="img" href="img/a.png" media-type="image/png"/></manifest>
				<spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
			"OEBPS/nav.xhtml": `<html><body><nav epub:type="toc"><ol>
				<li><a href="text/c1.xhtml">第一章 引言</a><ol><li><a href="text/c1.xhtml#s2">1.2 背景</a></li></ol></li>
				<li><a href="text/c2.xhtml">第二章 方法</a></li></ol></nav></body></html>`,
			"OEBPS/text/c1.xhtml": `<html><body><h1>第一章 引言</h1><p>开头。</p><h2 id="s2">1.2 背景</h2><p>背景内容。</p></body></html>`,
			"OEBPS/text/c2.xhtml": `<html><body><h1>第二章 方法</h1><p>方法内容。</p></body></html>`,
		});
		const p = parseEpub(data);
		expect(p.title).toBe("深度学习");
		expect(p.toc_source).toBe("nav");
		expect(p.units).toEqual(["# 第一章 引言\n\n开头。", "## 1.2 背景\n\n背景内容。", "# 第二章 方法\n\n方法内容。"]);
		expect(p.headings).toEqual([
			{ level: 1, title: "第一章 引言", unit: 1 },
			{ level: 2, title: "1.2 背景", unit: 2 },
			{ level: 1, title: "第二章 方法", unit: 3 },
		]);
	});
	it("falls back to the NCX of EPUB 2", () => {
		const data = epub({
			"META-INF/container.xml": `<rootfile full-path="book.opf"/>`,
			"book.opf": `<package><manifest><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="a" href="a.html" media-type="application/xhtml+xml"/></manifest><spine toc="ncx"><itemref idref="a"/></spine></package>`,
			"toc.ncx": `<ncx><navMap><navPoint><navLabel><text>Only chapter</text></navLabel><content src="a.html"/></navPoint></navMap></ncx>`,
			"a.html": `<html><body><p>Text.</p></body></html>`,
		});
		const p = parseEpub(data);
		expect(p.headings).toEqual([{ level: 1, title: "Only chapter", unit: 1 }]);
		expect(p.toc_source).toBe("nav");
	});
});

const W = (body: string, styles = "") =>
	zipSync({
		"word/document.xml": strToU8(`<w:document><w:body>${body}</w:body></w:document>`),
		"word/styles.xml": strToU8(`<w:styles>${styles}</w:styles>`),
	});
const para = (text: string, style?: string, extra = "") => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extra}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

describe("DOCX", () => {
	it("finds headings by style (name, outline level, basedOn), keeps the title apart, reads tables and lists", () => {
		const styles = `
			<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>
			<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
			<w:style w:type="paragraph" w:styleId="MyH2"><w:name w:val="Custom"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
			<w:style w:type="paragraph" w:styleId="MyH2b"><w:name w:val="Derived"/><w:basedOn w:val="MyH2"/></w:style>`;
		const body =
			para("Report") +
			para("Intro", "Heading1") +
			para("Hello &amp; welcome.") +
			para("Details", "MyH2") +
			para("item", undefined, `<w:numPr><w:ilvl w:val="0"/></w:numPr>`) +
			`<w:tbl><w:tr><w:tc>${para("a")}</w:tc><w:tc>${para("b")}</w:tc></w:tr></w:tbl>` +
			para("More", "MyH2b");
		const p = parseDocx(W(body.replace(para("Report"), para("Report", "Title")), styles));
		expect(p.title).toBe("Report");
		expect(p.headings).toEqual([
			{ level: 1, title: "Intro", unit: 1 },
			{ level: 2, title: "Details", unit: 2 },
			{ level: 2, title: "More", unit: 3 },
		]);
		expect(p.units[0]).toBe("# Intro\n\nHello & welcome.");
		expect(p.units[1]).toBe("## Details\n\n- item\n\na | b");
		expect(p.toc_source).toBe("headings");
	});
	it("detects headings from formatting when the document has no heading styles (big bold text)", () => {
		const run = (t: string, sz: number, b = false) => `<w:p><w:r><w:rPr>${b ? "<w:b/>" : ""}<w:sz w:val="${sz}"/></w:rPr><w:t>${t}</w:t></w:r></w:p>`;
		const body = (t: string) => run(t + " is a paragraph of ordinary body text that goes on for a while.", 24);
		const p = parseDocx(W(run("第一章 向量", 48, true) + body("A") + body("B") + run("1.1 加法", 36, true) + body("C") + run("第二章 矩阵", 48, true) + body("D")));
		expect(p.toc_source).toBe("detected");
		expect(p.headings).toEqual([
			{ level: 1, title: "第一章 向量", unit: 1 },
			{ level: 2, title: "1.1 加法", unit: 2 },
			{ level: 1, title: "第二章 矩阵", unit: 3 },
		]);
	});
	it("cuts a document without headings into sections for paging", () => {
		const long = Array.from({ length: 30 }, (_, i) => para(`Paragraph ${i} ${"x".repeat(400)}`)).join("");
		const p = parseDocx(W(long));
		expect(p.headings).toEqual([]);
		expect(p.toc_source).toBe("pages");
		expect(p.units.length).toBeGreaterThan(1);
	});
});

describe("PDF headings from the layout", () => {
	const L = (page: number, text: string, size: number, top = 0.5, bold = false): PdfLine => ({ page, text, size, top, bold });
	const body = (page: number, n = 6) => Array.from({ length: n }, (_, i) => L(page, `Body sentence number ${i} on this page goes on for a while.`, 10, 0.2 + i * 0.1));

	it("reads numbering", () => {
		expect(numberingLevel("第三章 线性模型")).toBe(1);
		expect(numberingLevel("第2节 梯度")).toBe(2);
		expect(numberingLevel("2.3.1 Lemma")).toBe(3);
		expect(numberingLevel("Chapter 4 Trees")).toBe(1);
		expect(numberingLevel("12 apples were sold")).toBe(1);
		expect(numberingLevel("Plain text")).toBeUndefined();
	});
	it("ranks larger lines into levels, skipping running headers, the title and TOC entries", () => {
		const lines: PdfLine[] = [
			L(1, "A Book About Things", 24, 0.3),
			L(1, "Contents", 14, 0.5),
			L(1, "1 Introduction ........ 3", 10, 0.6),
			...[2, 3, 4, 5, 6].flatMap((p) => [L(p, "A Book About Things — draft", 8, 0.03), ...body(p), L(p, String(p), 8, 0.97)]),
			L(3, "1 Introduction", 16, 0.1),
			L(3, "1.1 Motivation", 12, 0.4),
			L(5, "2 Methods", 16, 0.1),
		];
		const h = detectHeadings(lines, 6);
		expect(h).toEqual([
			{ level: 2, title: "Contents", unit: 1 },
			{ level: 1, title: "1 Introduction", unit: 3 },
			{ level: 2, title: "1.1 Motivation", unit: 3 },
			{ level: 1, title: "2 Methods", unit: 5 },
		]);
	});
	it("joins a heading broken over two lines, and gives up on pages full of large text", () => {
		const lines = [...body(1), L(2, "A Very Long Chapter Title That", 16, 0.1), L(2, "Wraps Onto Two Lines", 16, 0.15), ...body(2), L(4, "Next Chapter", 16, 0.1), ...body(4)];
		expect(detectHeadings(lines, 4).map((h) => h.title)).toEqual(["A Very Long Chapter Title That Wraps Onto Two Lines", "Next Chapter"]);
		const slides = Array.from({ length: 30 }, (_, i) => L(1 + (i % 3), `Big slide text ${i}`, 28, 0.5));
		expect(detectHeadings([...slides, ...body(1, 2)], 3)).toEqual([]);
	});
	it("splits a row into its two columns where PDF.js ends a line, and reads the left column first", () => {
		const item = (str: string, x: number, y: number, width: number, hasEOL = false) => ({ str, transform: [12, 0, 0, 12, x, y], width, height: 12, hasEOL });
		const lines = linesOfItems(
			1,
			[
				item("Left one", 50, 700, 200, true),
				item("Right one", 260, 700, 200, true),
				item("Left two", 50, 686, 200, true),
				item("Right two", 260, 686, 200, true),
				item("Left three", 50, 672, 200, true),
				item("Right three", 260, 672, 200, true),
			],
			792,
			undefined,
			520,
		);
		expect(lines.map((l) => [l.text, l.column])).toEqual([
			["Left one", 0],
			["Left two", 0],
			["Left three", 0],
			["Right one", 1],
			["Right two", 1],
			["Right three", 1],
		]);
	});
	it("takes bold lines set apart as headings, capitals above mixed case (reports without larger type)", () => {
		const B = (page: number, text: string, top: number): PdfLine => ({ page, text, size: 10, top, bold: true, alone: true });
		const lines = [B(1, "QUARTERLY RESULTS", 0.1), ...body(1), B(1, "Key Points", 0.5), ...body(2), B(2, "OUTLOOK", 0.1), B(2, "Guidance", 0.3)];
		expect(detectHeadings(lines, 2)).toEqual([
			{ level: 1, title: "QUARTERLY RESULTS", unit: 1 },
			{ level: 2, title: "Key Points", unit: 1 },
			{ level: 1, title: "OUTLOOK", unit: 2 },
			{ level: 2, title: "Guidance", unit: 2 },
		]);
	});
	it("groups PDF.js items into lines, left to right, top to bottom", () => {
		const lines = linesOfItems(
			1,
			[
				{ str: "world", transform: [12, 0, 0, 12, 60, 700], height: 12 },
				{ str: "Hello ", transform: [12, 0, 0, 12, 20, 700.5], height: 12 },
				{ str: "Below", transform: [10, 0, 0, 10, 20, 650], height: 10 },
			],
			800,
		);
		expect(lines.map((l) => [l.text, l.size])).toEqual([
			["Hello world", 12],
			["Below", 10],
		]);
	});
});

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

describe("PDF titles", () => {
	it("prefers the first page's largest text over a file name in the metadata", () => {
		const L = (page: number, text: string, size: number, top: number): PdfLine => ({ page, text, size, top });
		const lines = [L(1, "Earth Mover's Distance based", 18, 0.1), L(1, "Similarity Search at Scale", 18, 0.13), L(1, "Yu Tang, Leong Hou U", 12, 0.2), ...Array.from({ length: 8 }, (_, i) => L(1, "Body text of the paper that runs along.", 10, 0.3 + i * 0.03))];
		expect(detectTitle(lines)).toBe("Earth Mover's Distance based Similarity Search at Scale");
		expect(junkTitle("four-lectures.dvi")).toBe(true);
		expect(junkTitle("Microsoft Word - draft3")).toBe(true);
		expect(junkTitle("Deep Learning")).toBe(false);
	});
});

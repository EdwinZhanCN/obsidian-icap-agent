import { describe, expect, it } from "vite-plus/test";
import { detectHeadings, detectTitle, junkTitle, linesOfItems, numberingLevel, type PdfLine } from "./detect";



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

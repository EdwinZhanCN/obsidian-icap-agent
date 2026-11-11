import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vite-plus/test";
import { parseDocx } from "./docx";

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

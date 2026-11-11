import { strFromU8, unzipSync } from "fflate";
import { decodeEntities } from "./html";
import type { Parsed } from "./epub";
import { detectHeadings } from "./detect";
import type { Heading, TocSource } from "./model";

/** A document without headings is cut into sections of about this many characters, for paging. */
const SECTION_CHARS = 6000;

function val(xml: string, tag: string): string | undefined {
	const m = xml.match(new RegExp(`<${tag}\\b[^>]*\\bw:val\\s*=\\s*"([^"]*)"`, "i"));
	return m ? decodeEntities(m[1]) : undefined;
}

/** Paragraph styles → heading level (1-based), following basedOn; "Title" is the document's title. */
export function headingStyles(styles: string): { levels: Map<string, number>; title: Set<string> } {
	const raw = new Map<string, { name: string; basedOn?: string; outline?: number }>();
	for (const m of styles.matchAll(/<w:style\b([^>]*)>([\s\S]*?)<\/w:style>/gi)) {
		if (!/w:type\s*=\s*"paragraph"/i.test(m[1])) continue;
		const id = m[1].match(/w:styleId\s*=\s*"([^"]*)"/i)?.[1];
		if (!id) continue;
		const outline = val(m[2], "w:outlineLvl");
		raw.set(id, { name: (val(m[2], "w:name") ?? id).toLowerCase(), basedOn: val(m[2], "w:basedOn"), outline: outline !== undefined ? Number(outline) : undefined });
	}
	const levels = new Map<string, number>();
	const title = new Set<string>();
	const levelOf = (id: string, seen = new Set<string>()): number | undefined => {
		const s = raw.get(id);
		if (!s || seen.has(id)) return undefined;
		seen.add(id);
		if (s.outline !== undefined && s.outline < 9) return s.outline + 1;
		const named = s.name.match(/^heading\s*(\d)$/);
		if (named) return Number(named[1]);
		return s.basedOn ? levelOf(s.basedOn, seen) : undefined;
	};
	for (const [id, s] of raw) {
		if (s.name === "title") title.add(id);
		const l = levelOf(id);
		if (l) levels.set(id, l);
	}
	return { levels, title };
}

function runsText(p: string): string {
	let out = "";
	for (const m of p.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:(?:br|cr)\b[^>]*\/>/gi)) {
		if (m[1] !== undefined) out += decodeEntities(m[1]);
		else if (/^<w:tab/i.test(m[0])) out += "\t";
		else out += "\n";
	}
	return out.replace(/[ \t]+/g, " ").trim();
}

export function parseDocx(data: Uint8Array): Parsed {
	const files = unzipSync(data);
	const read = (p: string) => (files[p] ? strFromU8(files[p]) : undefined);
	const doc = read("word/document.xml");
	if (!doc) throw new Error("Not a readable Word document: no word/document.xml.");
	const styles = read("word/styles.xml") ?? "";
	const { levels, title: titleStyles } = headingStyles(styles);
	const body = doc.match(/<w:body\b[^>]*>([\s\S]*)<\/w:body>/i)?.[1] ?? doc;

	// Pass 1: the blocks in order, with what decides whether one is a heading.
	type Block = { text: string; level?: number; list?: boolean; size: number; bold: boolean; table?: boolean };
	const blocks: Block[] = [];
	let docTitle = "";
	const defaultSize = Number(val(styles.match(/<w:rPrDefault\b[\s\S]*?<\/w:rPrDefault>/i)?.[0] ?? "", "w:sz") ?? 22) || 22;
	for (const m of body.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[\s\S]*?<\/w:p>/gi)) {
		const block = m[0];
		if (/^<w:tbl/i.test(block)) {
			const rows = [...block.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/gi)].map((r) =>
				[...r[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/gi)].map((c) => [...c[0].matchAll(/<w:p\b[\s\S]*?<\/w:p>/gi)].map((p) => runsText(p[0])).join(" ").trim()).join(" | "),
			);
			const t = rows.filter((r) => r.replace(/[ |]/g, "")).join("\n");
			if (t) blocks.push({ text: t, size: defaultSize, bold: false, table: true });
			continue;
		}
		const pPr = block.match(/<w:pPr\b[\s\S]*?<\/w:pPr>/i)?.[0] ?? "";
		const style = val(pPr, "w:pStyle");
		const direct = val(pPr, "w:outlineLvl");
		const level = direct !== undefined && Number(direct) < 9 ? Number(direct) + 1 : style ? levels.get(style) : undefined;
		const text = runsText(block);
		if (!text) continue;
		if (style && titleStyles.has(style) && !docTitle) {
			docTitle = text;
			continue;
		}
		// Direct formatting of the runs: size (half-points) and bold, weighted by their text.
		let chars = 0;
		let sizeSum = 0;
		let boldChars = 0;
		for (const r of block.matchAll(/<w:r\b[\s\S]*?<\/w:r>/gi)) {
			const n = runsText(r[0]).length;
			if (!n) continue;
			const rPr = r[0].match(/<w:rPr\b[\s\S]*?<\/w:rPr>/i)?.[0] ?? "";
			sizeSum += (Number(val(rPr, "w:sz")) || defaultSize) * n;
			if (/<w:b\s*\/>|<w:b\s+w:val\s*=\s*"(?:1|true|on)"/i.test(rPr)) boldChars += n;
			chars += n;
		}
		blocks.push({ text, level, list: /<w:numPr\b/i.test(pPr), size: chars ? Math.round(sizeSum / chars) / 2 : defaultSize / 2, bold: chars > 0 && boldChars / chars > 0.6 });
	}

	// Pass 2: headings — from styles; when the document has none, from its formatting, like a PDF.
	let toc: TocSource = "headings";
	if (!blocks.some((b) => b.level)) {
		const found = detectHeadings(
			blocks.map((b, i) => ({ page: i + 1, text: b.table ? "" : b.text, size: b.size, top: 0.5, bold: b.bold })).filter((l) => l.text),
			Math.max(1, blocks.length),
		);
		for (const h of found) blocks[h.unit - 1].level = h.level;
		toc = "detected";
	}
	const units: string[] = [];
	const headings: Heading[] = [];
	let current: string[] = [];
	let size = 0;
	const flush = () => {
		const text = current.join("\n\n").trim();
		if (text) units.push(text);
		current = [];
		size = 0;
	};
	for (const b of blocks) {
		if (b.level) {
			flush();
			headings.push({ level: b.level, title: b.text, unit: units.length + 1 });
			current.push(`${"#".repeat(Math.min(b.level, 6))} ${b.text}`);
			continue;
		}
		const line = b.list ? `- ${b.text}` : b.text;
		if (!headings.length && size + line.length > SECTION_CHARS && current.length) flush();
		current.push(line);
		size += line.length;
	}
	flush();
	// A heading with nothing after it before the next one still gets its unit.
	for (const h of headings) h.unit = Math.min(h.unit, Math.max(1, units.length));
	const core = read("docProps/core.xml");
	const coreTitle = core?.match(/<dc:title>([\s\S]*?)<\/dc:title>/i)?.[1];
	return {
		title: decodeEntities(coreTitle ?? "").trim() || docTitle || headings[0]?.title || "",
		units,
		headings,
		toc_source: !units.length ? "unreadable" : headings.length ? toc : "pages",
	};
}

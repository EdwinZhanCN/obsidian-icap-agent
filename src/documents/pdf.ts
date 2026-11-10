import { loadPdfJs } from "obsidian";
import { detectHeadings, detectTitle, junkTitle, linesOfItems, pageText, type PdfItem, type PdfLine } from "./detect";
import type { Parsed } from "./epub";
import type { Heading } from "./model";

/* eslint-disable @typescript-eslint/no-explicit-any -- PDF.js ships no types through Obsidian. */

/** The PDF's bookmarks as headings (level = nesting depth). */
async function bookmarks(doc: any): Promise<Heading[]> {
	const items = (await doc.getOutline().catch(() => null)) ?? [];
	const out: Heading[] = [];
	const walk = async (list: any[], depth: number) => {
		for (const it of list) {
			if (out.length >= 2000) return;
			let unit = 0;
			try {
				const dest = typeof it.dest === "string" ? await doc.getDestination(it.dest) : it.dest;
				if (Array.isArray(dest) && dest[0]) unit = (await doc.getPageIndex(dest[0])) + 1;
			} catch {
				unit = 0;
			}
			const title = String(it.title ?? "").trim();
			if (title && unit > 0) out.push({ level: depth, title, unit });
			if (it.items?.length) await walk(it.items, depth + 1);
		}
	};
	await walk(items, 1);
	return out;
}

/**
 * A PDF → page texts and headings: the bookmarks when it has them, else headings detected from the
 * layout. `onPage` reports progress for long books.
 */
export async function parsePdf(data: Uint8Array, onPage?: (n: number, total: number) => void): Promise<Parsed> {
	const pdfjs = await loadPdfJs();
	const doc = await pdfjs.getDocument({ data }).promise;
	try {
		const total: number = doc.numPages;
		const marks = await bookmarks(doc);
		const units: string[] = [];
		const lines: PdfLine[] = [];
		for (let n = 1; n <= total; n++) {
			const page = await doc.getPage(n);
			const content = await page.getTextContent();
			const items = (content.items as PdfItem[]).filter((i) => typeof i.str === "string");
			units.push(pageText(items));
			// Page 1 always (the title when the metadata has none), every page when there are no bookmarks.
			if (!marks.length || n === 1) {
				// Font names (and so bold) are known only once the page's fonts are loaded.
				await page.getOperatorList().catch(() => undefined);
				const { width, height } = page.getViewport({ scale: 1 });
				const isBold = (fontName: string) => {
					try {
						const name = String(page.commonObjs.has?.(fontName) ? (page.commonObjs.get(fontName)?.name ?? "") : "");
						return /bold|black|heavy|semibold|demi/i.test(name);
					} catch {
						return false;
					}
				};
				lines.push(...linesOfItems(n, items, height, isBold, width));
			}
			page.cleanup?.();
			onPage?.(n, total);
			// Let Obsidian breathe on long books.
			if (n % 20 === 0) await new Promise((r) => setTimeout(r, 0));
		}
		let title = "";
		try {
			const meta = await doc.getMetadata();
			title = String(meta?.info?.Title ?? "").trim();
		} catch {
			title = "";
		}
		if (junkTitle(title)) title = detectTitle(lines) || "";
		const readable = units.some((u) => u.length > 0);
		if (marks.length) return { title, units, headings: marks, toc_source: "bookmarks" };
		const detected = readable ? detectHeadings(lines, total) : [];
		if (!title && detected[0]?.unit === 1 && detected[0].level === 1) title = detected[0].title;
		return { title, units, headings: detected, toc_source: !readable ? "unreadable" : detected.length ? "detected" : "pages" };
	} finally {
		void doc.destroy?.();
	}
}

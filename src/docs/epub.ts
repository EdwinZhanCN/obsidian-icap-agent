import { strFromU8, unzipSync } from "fflate";
import { decodeEntities, firstHeading, htmlToText } from "./html";
import type { Heading, Parsed, TocSource } from "./model";

export type { Parsed } from "./model";

/** `a/b/../c.xhtml#x` → `a/c.xhtml`, `x`. */
export function resolveHref(base: string, href: string): { file: string; fragment: string } {
	const [rawPath, fragment = ""] = href.split("#");
	let path = rawPath;
	try {
		path = decodeURIComponent(rawPath);
	} catch {
		/* keep it as written */
	}
	const parts = (path.startsWith("/") ? [] : base.split("/").slice(0, -1)).concat(path.split("/"));
	const out: string[] = [];
	for (const p of parts) {
		if (!p || p === ".") continue;
		if (p === "..") out.pop();
		else out.push(p);
	}
	return { file: out.join("/"), fragment };
}

function attr(tag: string, name: string): string | undefined {
	const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
	return m ? decodeEntities(m[1] ?? m[2]) : undefined;
}

function textOf(xml: string): string {
	return decodeEntities(xml.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

interface NavEntry {
	level: number;
	title: string;
	file: string;
	fragment: string;
}

/** EPUB 3: the <nav epub:type="toc"> list, nested <ol>/<li>/<a>. */
function navEntries(xhtml: string, navPath: string): NavEntry[] {
	const nav = xhtml.match(/<nav\b[^>]*epub:type\s*=\s*["'][^"']*\btoc\b[^"']*["'][^>]*>([\s\S]*?)<\/nav>/i)?.[1] ?? xhtml.match(/<nav\b[^>]*>([\s\S]*?)<\/nav>/i)?.[1];
	if (!nav) return [];
	const out: NavEntry[] = [];
	let depth = 0;
	const re = /<(\/?)(ol|ul)\b[^>]*>|<a\b([^>]*)>([\s\S]*?)<\/a>|<span\b[^>]*>([\s\S]*?)<\/span>/gi;
	for (const m of nav.matchAll(re)) {
		if (m[2]) depth += m[1] ? -1 : 1;
		else if (m[3] !== undefined) {
			const href = attr(`<a ${m[3]}>`, "href");
			const title = textOf(m[4]);
			if (href && title) out.push({ level: Math.max(1, depth), title, ...resolveHref(navPath, href) });
		}
	}
	return out;
}

/** EPUB 2: the NCX navMap, nested <navPoint>s. */
function ncxEntries(ncx: string, ncxPath: string): NavEntry[] {
	const out: NavEntry[] = [];
	let depth = 0;
	const re = /<navPoint\b[^>]*>|<\/navPoint>|<navLabel\b[^>]*>([\s\S]*?)<\/navLabel>|<content\b([^>]*)\/?>/gi;
	let label = "";
	for (const m of ncx.matchAll(re)) {
		const tag = m[0];
		if (/^<navPoint/i.test(tag)) depth++;
		else if (/^<\/navPoint/i.test(tag)) depth--;
		else if (m[1] !== undefined) label = textOf(m[1]);
		else if (m[2] !== undefined) {
			const src = attr(`<content ${m[2]}>`, "src");
			if (src && label) out.push({ level: Math.max(1, depth), title: label, ...resolveHref(ncxPath, src) });
			label = "";
		}
	}
	return out;
}

/** Where an element with this id starts (its `<`), or -1. */
function idPosition(html: string, id: string): number {
	const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const m = new RegExp(`\\b(?:id|name)\\s*=\\s*["']${esc}["']`).exec(html);
	return m ? html.lastIndexOf("<", m.index) : -1;
}

export function parseEpub(data: Uint8Array): Parsed {
	const files = unzipSync(data);
	const read = (p: string) => (files[p] ? strFromU8(files[p]) : undefined);
	const container = read("META-INF/container.xml");
	const opfPath = container ? attr(container.match(/<rootfile\b[^>]*>/i)?.[0] ?? "", "full-path") : Object.keys(files).find((f) => f.endsWith(".opf"));
	const opf = opfPath ? read(opfPath) : undefined;
	if (!opfPath || !opf) throw new Error("Not a readable EPUB: no package document (.opf).");

	const manifest = new Map<string, { href: string; type: string; props: string }>();
	for (const m of opf.matchAll(/<item\b[^>]*>/gi)) {
		const id = attr(m[0], "id");
		const href = attr(m[0], "href");
		if (id && href) manifest.set(id, { href: resolveHref(opfPath, href).file, type: attr(m[0], "media-type") ?? "", props: attr(m[0], "properties") ?? "" });
	}
	const spine = [...opf.matchAll(/<itemref\b[^>]*>/gi)]
		.map((m) => manifest.get(attr(m[0], "idref") ?? ""))
		.filter((x): x is { href: string; type: string; props: string } => !!x && /html/i.test(x.type) && !!files[x.href]);

	let entries: NavEntry[] = [];
	let toc_source: TocSource = "nav";
	const navItem = [...manifest.values()].find((x) => /\bnav\b/.test(x.props));
	if (navItem && read(navItem.href)) entries = navEntries(read(navItem.href)!, navItem.href);
	if (!entries.length) {
		const tocId = attr(opf.match(/<spine\b[^>]*>/i)?.[0] ?? "", "toc");
		const ncx = (tocId && manifest.get(tocId)) || [...manifest.values()].find((x) => /ncx/i.test(x.type));
		if (ncx && read(ncx.href)) entries = ncxEntries(read(ncx.href)!, ncx.href);
	}

	// Units: each spine document, split where the table of contents points inside it.
	const units: string[] = [];
	const unitOf = new Map<string, number>();
	for (const item of spine) {
		const raw = read(item.href)!;
		const body = raw.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? raw;
		const cuts = entries
			.filter((e) => e.file === item.href && e.fragment)
			.map((e) => ({ fragment: e.fragment, at: idPosition(body, e.fragment) }))
			.filter((c) => c.at >= 0)
			.sort((a, b) => a.at - b.at);
		let from = 0;
		const pieces: { html: string; anchors: string[] }[] = [{ html: "", anchors: [""] }];
		for (const c of cuts) {
			if (c.at <= from) {
				pieces[pieces.length - 1].anchors.push(c.fragment);
				continue;
			}
			pieces[pieces.length - 1].html = body.slice(from, c.at);
			pieces.push({ html: "", anchors: [c.fragment] });
			from = c.at;
		}
		pieces[pieces.length - 1].html = body.slice(from);
		let pending: string[] = [];
		for (const piece of pieces) {
			const text = htmlToText(piece.html);
			pending.push(...piece.anchors);
			if (!text) continue;
			units.push(text);
			for (const a of pending) unitOf.set(`${item.href}#${a}`, units.length);
			pending = [];
		}
		// A chapter with no text (an image page) points at the next unit.
		for (const a of pending) unitOf.set(`${item.href}#${a}`, units.length + 1);
	}

	const title = textOf(opf.match(/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i)?.[1] ?? "") || "";
	let headings: Heading[] = entries
		.map((e) => ({ level: e.level, title: e.title, unit: unitOf.get(`${e.file}#${e.fragment}`) ?? unitOf.get(`${e.file}#`) ?? 0 }))
		.filter((h) => h.unit > 0 && h.unit <= units.length);
	if (!headings.length) {
		toc_source = "headings";
		headings = [];
		for (const item of spine) {
			const u = unitOf.get(`${item.href}#`);
			if (!u || u > units.length) continue;
			const t = firstHeading(read(item.href)!);
			if (t && !headings.some((h) => h.unit === u)) headings.push({ level: 1, title: t, unit: u });
		}
	}
	return { title, units, headings, toc_source: units.length ? (headings.length ? toc_source : "pages") : "unreadable" };
}

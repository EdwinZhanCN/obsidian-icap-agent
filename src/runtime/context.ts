import type { App, TFile } from "obsidian";
import { headingTrail, paragraphBounds, sectionBounds, stripFrontmatter, window } from "../dsl/text";

export interface NoteContext {
	path: string;
	title: string;
	headingTrail: string[];
	frontmatter: string;
	background: string;
	links: string[];
	/** Paragraphs around the focus. */
	passage: string;
	/** The heading section containing the focus. */
	section: string;
	/** The whole note, windowed around the focus. */
	note: string;
}

export function buildContext(app: App, file: TFile, text: string, from: number, to: number, background: string): NoteContext {
	const { frontmatter } = stripFrontmatter(text);
	const p = paragraphBounds(text, from);
	const sec = sectionBounds(text, from);
	const cache = app.metadataCache.getFileCache(file);
	const links = Array.from(new Set((cache?.links ?? []).map((l) => l.link.split("#")[0]).filter(Boolean))).slice(0, 30);
	return {
		path: file.path,
		title: file.basename,
		headingTrail: headingTrail(text, from),
		frontmatter: frontmatter.trim(),
		background,
		links,
		passage: window(text, p.from, p.to, 2400),
		section: window(text.slice(sec.from, sec.to), from - sec.from, to - sec.from, 6000),
		note: window(text, from, to, 9000),
	};
}

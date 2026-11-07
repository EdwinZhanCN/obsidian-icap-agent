/**
 * XHTML (an EPUB chapter) → readable text with light Markdown: headings as `#`, list items as `- `,
 * paragraphs separated by blank lines, table cells by ` | `. Pure and regex-based, so it runs the same
 * in Obsidian and in tests; EPUB content is well-formed XHTML, which keeps this honest.
 */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ensp: " ", emsp: " ", thinsp: " ", mdash: "—", ndash: "–", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", shy: "", zwj: "", zwnj: "" };

export function decodeEntities(s: string): string {
	return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
		if (e[0] === "#") {
			const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
		}
		return ENTITIES[e.toLowerCase()] ?? m;
	});
}

const BLOCK = "p|div|section|article|aside|header|footer|blockquote|pre|figure|figcaption|table|tr|ul|ol|dl|dt|dd|nav|main|hr";

export function htmlToText(html: string): string {
	let s = html;
	// Only the body, without what is never read.
	const body = s.match(/<body[^>]*>([\s\S]*)<\/body>/i);
	if (body) s = body[1];
	s = s.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|head|svg|math)\b[\s\S]*?<\/\1>/gi, "");
	s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n: string, inner: string) => `\n\n${"#".repeat(Number(n))} ${inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()}\n\n`);
	s = s.replace(/<li\b[^>]*>/gi, "\n- ");
	s = s.replace(/<\/(td|th)>/gi, " | ");
	s = s.replace(/<br\s*\/?>/gi, "\n");
	s = s.replace(/<img\b[^>]*\balt="([^"]+)"[^>]*>/gi, " [image: $1] ");
	s = s.replace(new RegExp(`</?(${BLOCK})\\b[^>]*>`, "gi"), "\n\n");
	s = s.replace(/<[^>]+>/g, "");
	s = decodeEntities(s);
	return s
		.split("\n")
		.map((l) => l.replace(/[ \t ]+/g, " ").trim())
		.join("\n")
		.replace(/ \|\s*$/gm, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** The first heading's text in an XHTML document, if any. */
export function firstHeading(html: string): string | undefined {
	const m = html.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i);
	return m ? decodeEntities(m[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim() || undefined : undefined;
}

/**
 * Interface language: English or Chinese, following Obsidian's own language (set once on load).
 *
 * Every string carries both languages at its call site — `L("Explain", "解释")` — so a change to
 * the interface can't forget one of them. Markers stored in notes (callout types, `kind:`,
 * "Plainly." / "Deeper." headings the agent reads back) stay English on purpose: notes written
 * in one language keep working in the other.
 */
let zh = false;

export function setLocale(language: string) {
	zh = language.toLowerCase().startsWith("zh");
}

export function isZh(): boolean {
	return zh;
}

export function L(en: string, chinese: string): string {
	return zh ? chinese : en;
}

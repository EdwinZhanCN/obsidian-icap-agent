/**
 * [[links]] typed into a request: what is being typed at the caret, and what was pointed to.
 * Pure helpers (no Obsidian imports).
 */

export interface LinkTrigger {
	/** Where the trigger ("[[" or "@") starts; everything from here to the caret is replaced. */
	start: number;
	/** What has been typed after the trigger so far. */
	query: string;
}

/**
 * Is the learner typing a link at `caret`? "[[name" (not yet closed), or "@name" as a shorthand
 * that also becomes "[[name]]". "@" only counts at the start of a word, so e-mail addresses don't trigger.
 */
export function linkTrigger(text: string, caret: number): LinkTrigger | null {
	const before = text.slice(0, caret);
	const open = before.lastIndexOf("[[");
	if (open >= 0) {
		const query = before.slice(open + 2);
		if (!/[\]\n|#]/.test(query)) return { start: open, query };
	}
	const at = before.match(/(?:^|[^A-Za-z0-9._%+-])@([^\s@[\]|#]*)$/);
	if (at) return { start: caret - at[1].length - 1, query: at[1] };
	return null;
}

/** Replace the trigger with a finished link; returns the new text and the caret after the link. */
export function insertLink(text: string, caret: number, trigger: LinkTrigger, linktext: string): { text: string; caret: number } {
	const rest = text.slice(caret).replace(/^\]\]/, "");
	const link = `[[${linktext}]]`;
	return { text: text.slice(0, trigger.start) + link + rest, caret: trigger.start + link.length };
}

/** The link targets in a text, in order, without headings/aliases, each once. */
export function extractLinks(text: string): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(/!?\[\[([^\]|#\n]*)(?:[#|][^\]\n]*)?\]\]/g)) {
		const t = m[1].trim();
		if (t && !out.includes(t)) out.push(t);
	}
	return out;
}

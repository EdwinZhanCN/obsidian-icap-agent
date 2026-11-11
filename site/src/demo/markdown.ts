import { renderMarkdown } from "./obsidian";

/** `use:markdown={text}`: the element shows `text` rendered as a note renders it. */
export function markdown(node: HTMLElement, text: string) {
	renderMarkdown(text, node);
	return { update: (next: string) => renderMarkdown(next, node) };
}

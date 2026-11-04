import { MarkdownView, TFile, normalizePath, type App, type Editor } from "obsidian";
import { askReplacement } from "./blocks";

export { askReplacement };

/** An open editor for this path, if any (preferring the active one). */
export function editorFor(app: App, path: string): Editor | null {
	const active = app.workspace.getActiveViewOfType(MarkdownView);
	if (active?.file?.path === path) return active.editor;
	for (const leaf of app.workspace.getLeavesOfType("markdown")) {
		const v = leaf.view;
		if (v instanceof MarkdownView && v.file?.path === path) return v.editor;
	}
	return null;
}

export interface Splice {
	from: number;
	to: number;
	insert: string;
}

/**
 * Apply one splice computed from the current text. Through the editor when the note is open
 * (keeps cursor, scroll and undo coherent), otherwise through the vault.
 */
export async function spliceFile(app: App, path: string, compute: (text: string) => Splice | null): Promise<boolean> {
	const editor = editorFor(app, path);
	if (editor) {
		const s = compute(editor.getValue());
		if (!s) return false;
		editor.replaceRange(s.insert, editor.offsetToPos(s.from), editor.offsetToPos(s.to));
		return true;
	}
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) return false;
	let applied = false;
	await app.vault.process(file, (text) => {
		const s = compute(text);
		if (!s) return text;
		applied = true;
		return text.slice(0, s.from) + s.insert + text.slice(s.to);
	});
	return applied;
}

/** Insert a standalone Markdown block after `offset`, with exactly one blank line on each side. */
export function blockInsertion(text: string, offset: number, block: string): Splice {
	const before = text.slice(0, offset);
	const after = text.slice(offset);
	const lead = before.length === 0 ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
	const trail = after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : after.length ? "\n\n" : "\n";
	return { from: offset, to: offset, insert: lead + block + trail };
}

export async function uniqueNotePath(app: App, folder: string, title: string): Promise<string> {
	const clean = title.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim() || "Untitled";
	const dir = folder ? normalizePath(folder) : "";
	if (dir && !app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir).catch(() => undefined);
	let n = 0;
	for (;;) {
		const name = n === 0 ? clean : `${clean} ${n + 1}`;
		const path = normalizePath(dir ? `${dir}/${name}.md` : `${name}.md`);
		if (!app.vault.getAbstractFileByPath(path)) return path;
		n++;
	}
}

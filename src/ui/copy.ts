import { Notice } from "obsidian";
import { L } from "../i18n";

/** Put text on the clipboard and say so, or say that it could not be done. */
export async function copyText(text: string, said = L("Copied.", "已复制。")): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		new Notice(said, 1500);
	} catch {
		new Notice(L("Could not copy.", "无法复制。"));
	}
}

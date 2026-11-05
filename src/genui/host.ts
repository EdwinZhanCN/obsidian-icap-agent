import { MarkdownRenderChild, Notice, type MarkdownPostProcessorContext, type Plugin } from "obsidian";
import { L } from "../i18n";
import { MAX_SOURCE, THEME_VARS, UI_LANG, parseUiMessage, widgetDocument, type UiTheme } from "./widget";

/**
 * Where a visual's `icap.ask` goes. Inside a request block it is a follow-up there; in a note it
 * starts a new request block right below the visual.
 */
export interface UiRoutes {
	/** The request block with this id took the text as a follow-up; false = not a request block. */
	followUp(blockId: string, text: string): boolean;
	/** Start a request below `line` (0-based) of the note at `path`. */
	requestBelow(path: string, line: number, text: string): Promise<void>;
}

/** The note's theme as the frame needs it. */
export function currentTheme(): UiTheme {
	const cs = getComputedStyle(document.body);
	const vars: Record<string, string> = {};
	for (const k of THEME_VARS) {
		const v = cs.getPropertyValue(`--${k}`).trim();
		if (v) vars[k] = v;
	}
	return { dark: document.body.classList.contains("theme-dark"), vars };
}

class UiFrame extends MarkdownRenderChild {
	frame: HTMLIFrameElement | null = null;
	private error: HTMLElement | null = null;

	constructor(
		el: HTMLElement,
		private source: string,
		private host: UiHost,
		readonly sourcePath: string,
		private ctx: MarkdownPostProcessorContext,
	) {
		super(el);
	}

	onload() {
		const el = this.containerEl;
		el.addClass("icap-ui");
		if (this.source.length > MAX_SOURCE) {
			el.createDiv({ cls: "icap-ui-note", text: L("This visual is too large to show.", "这个图示太大，无法显示。") });
			return;
		}
		const f = el.createEl("iframe", { cls: "icap-ui-frame" });
		this.frame = f;
		// Scripts only: no same-origin (so no access to the note, Obsidian or storage), no popups,
		// no navigation of the note, no forms. The document's CSP blocks all network access.
		f.setAttribute("sandbox", "allow-scripts");
		f.setAttribute("referrerpolicy", "no-referrer");
		f.setAttribute("title", L("Interactive visual", "交互式图示"));
		const theme = currentTheme();
		this.setScheme(theme.dark);
		f.srcdoc = widgetDocument(this.source, theme);
		this.host.frames.add(this);
	}

	onunload() {
		this.host.frames.delete(this);
		this.frame = null;
	}

	/**
	 * The frame element's color-scheme must equal its document's, or Chromium paints an opaque
	 * backdrop behind the (transparent) visual.
	 */
	setScheme(dark: boolean) {
		if (this.frame) this.frame.style.colorScheme = dark ? "dark" : "light";
	}

	resize(height: number) {
		if (this.frame) this.frame.style.height = `${Math.max(24, height)}px`;
	}

	showError(message: string) {
		if (this.error) return;
		this.error = this.containerEl.createDiv({ cls: "icap-ui-note mod-warning", text: L("The visual hit an error: ", "图示出错：") + message });
	}

	/** The note line this visual's block ends on, when it is rendered from a note. */
	endLine(): number | null {
		return this.ctx.getSectionInfo(this.containerEl)?.lineEnd ?? null;
	}

	/** The request block this visual is shown in, if any. */
	blockId(): string | null {
		return this.frame?.closest<HTMLElement>("[data-ask]")?.dataset.ask ?? null;
	}
}

/** Renders ```icap-ui blocks and answers what their frames post. One per plugin. */
export class UiHost {
	readonly frames = new Set<UiFrame>();

	constructor(
		private plugin: Plugin,
		private routes: UiRoutes,
	) {}

	register() {
		const { plugin } = this;
		plugin.registerMarkdownCodeBlockProcessor(UI_LANG, (source, el, ctx) => {
			ctx.addChild(new UiFrame(el, source, this, ctx.sourcePath, ctx));
		});
		plugin.registerDomEvent(window, "message", (e) => this.onMessage(e));
		// A theme or appearance change reaches open visuals without reloading them.
		plugin.registerEvent(plugin.app.workspace.on("css-change", () => this.broadcastTheme()));
	}

	private broadcastTheme() {
		const t = currentTheme();
		for (const f of this.frames) {
			f.setScheme(t.dark);
			f.frame?.contentWindow?.postMessage({ icap: "ui", type: "theme", dark: t.dark, vars: t.vars }, "*");
		}
	}

	private onMessage(e: MessageEvent) {
		// A sandboxed frame's origin is "null": who sent it is decided by the window, not the origin.
		let from: UiFrame | undefined;
		for (const f of this.frames) if (f.frame && e.source === f.frame.contentWindow) from = f;
		if (!from) return;
		const m = parseUiMessage(e.data);
		if (!m) return;
		switch (m.type) {
			case "size":
				return from.resize(m.height);
			case "error":
				return from.showError(m.message);
			case "ask":
			case "open":
				// Only after the learner used this visual: a visual cannot talk to the agent (or open
				// notes) on its own, on load or on a timer.
				if (document.activeElement !== from.frame) return;
				if (m.type === "open") return this.open(from, m.link);
				return void this.ask(from, m.text);
		}
	}

	private open(from: UiFrame, link: string) {
		const app = this.plugin.app;
		const target = link.split(/[#|]/)[0].trim();
		if (!app.metadataCache.getFirstLinkpathDest(target, from.sourcePath)) {
			new Notice(L(`No note “${target}” in this vault.`, `库里没有笔记“${target}”。`));
			return;
		}
		void app.workspace.openLinkText(link, from.sourcePath);
	}

	private async ask(from: UiFrame, text: string) {
		const block = from.blockId();
		if (block && this.routes.followUp(block, text)) return;
		const line = from.endLine();
		if (!block && line !== null) return this.routes.requestBelow(from.sourcePath, line, text);
		new Notice(L("This visual cannot send a request from here.", "这里的图示不能发送请求。"));
	}
}

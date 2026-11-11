/**
 * What the plugin's components take from the `obsidian` module, for a web page: the site aliases
 * `obsidian` to this file. Only what the views shown on the site use, and only as much of it as a
 * demonstration needs. On import it only adds Obsidian's DOM helpers, and only in a browser (Astro
 * evaluates components on the server).
 */
import { Marked } from "marked";
import { THEME_VARS, UI_LANG, parseUiMessage, widgetDocument, type UiTheme } from "@plugin/genui/widget";
import { L } from "@plugin/i18n";

const nav = () => (typeof navigator === "undefined" ? null : navigator);

export const Platform = {
	isMobile: false,
	isDesktop: true,
	get isMacOS() {
		return /Mac|iPhone|iPad/.test(nav()?.platform ?? nav()?.userAgent ?? "Mac");
	},
};

export class Component {
	private cleanups: (() => void)[] = [];
	load() {}
	unload() {
		for (const f of this.cleanups.splice(0)) f();
	}
	register(f: () => void) {
		this.cleanups.push(f);
	}
	addChild<T>(c: T): T {
		return c;
	}
}

export const Keymap = {
	isModEvent: (e?: MouseEvent | KeyboardEvent | null) => !!e && (e.metaKey || e.ctrlKey),
};

export type Modifier = "Mod" | "Ctrl" | "Meta" | "Shift" | "Alt";
type Handler = (e: KeyboardEvent) => boolean | void;

export class Scope {
	keys: { mods: Modifier[]; key: string; fn: Handler }[] = [];
	constructor(public parent?: Scope) {}
	register(mods: Modifier[], key: string, fn: Handler) {
		const k = { mods, key, fn };
		this.keys.push(k);
		return k;
	}
	unregister(k: unknown) {
		this.keys = this.keys.filter((x) => x !== k);
	}
}

export class TFile {
	path: string;
	name: string;
	basename: string;
	extension: string;
	parent = null;
	/** The link list of a request shows the most recent files first. */
	stat: { mtime: number };
	constructor(path: string, mtime = 0) {
		this.path = path;
		const name = path.split("/").pop() ?? path;
		this.name = name;
		const dot = name.lastIndexOf(".");
		this.basename = dot > 0 ? name.slice(0, dot) : name;
		this.extension = dot > 0 ? name.slice(dot + 1) : "";
		this.stat = { mtime };
	}
}

export class Notice {
	constructor(message: string) {
		console.info(message);
	}
}

export function prepareFuzzySearch(query: string) {
	const q = query.toLowerCase();
	return (text: string) => {
		const t = text.toLowerCase();
		let i = 0;
		for (const ch of t) if (ch === q[i]) i++;
		return i === q.length ? { score: -t.length, matches: [] } : null;
	};
}

/* ───────────── Markdown, the way a note renders it ───────────── */

// Obsidian keeps single line breaks by default ("Strict line breaks" off).
const marked = new Marked({ gfm: true, breaks: true });

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** [[target|alias]] → an internal link, as Obsidian renders it. */
function wikilinks(md: string): string {
	return md.replace(/(!?)\[\[([^\]|#\n]+)(#[^\]|\n]*)?(?:\|([^\]\n]+))?\]\]/g, (_m, _embed, target: string, sub: string | undefined, alias?: string) => {
		const t = target.trim();
		// [[Wing.pdf#page=41]] reads "Wing.pdf > page=41", as Obsidian shows a link into a file
		const shown = alias ?? t.split("/").pop()!.replace(/\.md$/, "") + (sub ? ` > ${sub.slice(1)}` : "");
		return `<a class="internal-link" data-href="${escapeHtml(t + (sub ?? ""))}" href="${escapeHtml(t)}">${escapeHtml(shown)}</a>`;
	});
}

/** `> [!type] title` blockquotes → Obsidian's callout markup. */
function callouts(root: HTMLElement) {
	for (const bq of Array.from(root.querySelectorAll("blockquote"))) {
		const first = bq.firstElementChild;
		if (!first || first.tagName !== "P") continue;
		// the title ends at the first line break (a <br> while single breaks are kept)
		const m = /^\[!([\w-]+)\]([+-]?)[ \t]*(.*?)(?:<br\s*\/?>\s*|\n|$)/s.exec(first.innerHTML);
		if (!m) continue;
		const type = m[1].toLowerCase();
		first.innerHTML = first.innerHTML.slice(m[0].length);
		if (!first.innerHTML.trim()) first.remove();
		const callout = document.createElement("div");
		callout.className = "callout";
		callout.dataset.callout = type;
		const title = document.createElement("div");
		title.className = "callout-title";
		const inner = document.createElement("div");
		inner.className = "callout-title-inner";
		inner.innerHTML = m[3] || type[0].toUpperCase() + type.slice(1);
		title.append(inner);
		const content = document.createElement("div");
		content.className = "callout-content";
		content.append(...Array.from(bq.childNodes));
		callout.append(title, content);
		bq.replaceWith(callout);
		callouts(content);
	}
}

export function renderMarkdown(md: string, el: HTMLElement) {
	// a visual's source is code: links in it are not links
	const parts = md.replace(/<!--[\s\S]*?-->/g, "").split(/(^```icap-ui[\s\S]*?^```)/m);
	const html = marked.parse(parts.map((p, i) => (i % 2 ? p : wikilinks(p))).join(""), { async: false }) as string;
	el.innerHTML = html;
	callouts(el);
	visuals(el);
}

/* ───────────── interactive visuals: the plugin's own frame document (genui/widget.ts) ───────────── */

/** The page's colours, as the frame takes Obsidian's (genui/host.ts currentTheme). */
function demoTheme(): UiTheme {
	const cs = getComputedStyle(document.body);
	const vars: Record<string, string> = {};
	for (const k of THEME_VARS) {
		const v = cs.getPropertyValue(`--${k}`).trim();
		if (v) vars[k] = v;
	}
	// what the site does not define: the page's own font, and Obsidian's default colours
	const fallback: Record<string, string> = {
		"font-interface": cs.fontFamily,
		"font-text": cs.fontFamily,
		"font-monospace": "ui-monospace, SFMono-Regular, Menlo, monospace",
		"color-red": "#e93147",
		"color-orange": "#ec7500",
		"color-yellow": "#e0ac00",
		"color-green": "#08b94e",
		"color-cyan": "#00bfbc",
		"color-blue": "#086ddd",
		"color-purple": "#7852ee",
		"color-pink": "#d53984",
	};
	for (const [k, v] of Object.entries(fallback)) if (!vars[k]) vars[k] = v;
	return { dark: document.documentElement.dataset.theme === "dark", vars };
}

/** ```icap-ui fences → sandboxed frames, as the plugin's code block processor makes them. */
function visuals(root: HTMLElement) {
	const codes = Array.from(root.querySelectorAll<HTMLElement>(`pre > code.language-${UI_LANG}`));
	if (!codes.length) return;
	listenToFrames();
	const theme = demoTheme();
	for (const code of codes) {
		const box = document.createElement("div");
		box.className = "icap-ui";
		const f = document.createElement("iframe");
		f.className = "icap-ui-frame";
		f.setAttribute("sandbox", "allow-scripts");
		f.setAttribute("referrerpolicy", "no-referrer");
		f.setAttribute("title", L("Interactive visual", "交互式图示"));
		f.style.colorScheme = theme.dark ? "dark" : "light";
		f.srcdoc = widgetDocument(code.textContent ?? "", theme);
		box.append(f);
		code.parentElement!.replaceWith(box);
	}
}

const frames = () => Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe.icap-ui-frame"));
let listening = false;

/**
 * What the frames post, answered as genui/host.ts answers it: their height, an error, and `icap.ask`,
 * which the demo that shows the frame receives as an `icap-demo-ask` event (the reader does not use
 * the visual: the demo's player does).
 */
function listenToFrames() {
	if (listening) return;
	listening = true;
	window.addEventListener("message", (e) => {
		const from = frames().find((f) => f.contentWindow === e.source);
		if (!from) return;
		const m = parseUiMessage(e.data);
		if (!m) return;
		if (m.type === "size") from.style.height = `${Math.max(24, m.height)}px`;
		else if (m.type === "error") console.warn("visual:", m.message);
		else if (m.type === "ask") window.dispatchEvent(new CustomEvent("icap-demo-ask", { detail: { block: from.closest<HTMLElement>("[data-ask]")?.dataset.ask ?? null, text: m.text } }));
	});
	// the site's light / dark switch reaches open visuals without reloading them
	new MutationObserver(() => {
		const t = demoTheme();
		for (const f of frames()) {
			f.style.colorScheme = t.dark ? "dark" : "light";
			f.contentWindow?.postMessage({ icap: "ui", type: "theme", dark: t.dark, vars: t.vars }, "*");
		}
	}).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

export const MarkdownRenderer = {
	async render(_app: unknown, md: string, el: HTMLElement, _sourcePath: string, _component: Component) {
		renderMarkdown(md, el);
	},
};

/* ───────────── an App with what the views reach for ───────────── */

export type App = ReturnType<typeof demoApp>;

const MOD: Record<string, (e: KeyboardEvent) => boolean> = {
	Mod: (e) => (Platform.isMacOS ? e.metaKey : e.ctrlKey),
	Ctrl: (e) => e.ctrlKey,
	Meta: (e) => e.metaKey,
	Shift: (e) => e.shiftKey,
	Alt: (e) => e.altKey,
};

/** One App per page: the key scopes the writing line pushes are honoured like Obsidian's keymap. */
export function demoApp(files: string[] = []) {
	const stack: Scope[] = [];
	const onKey = (e: KeyboardEvent) => {
		const scope = stack[stack.length - 1];
		if (!scope) return;
		for (const k of scope.keys) {
			if (k.key.toLowerCase() !== e.key.toLowerCase()) continue;
			const want = new Set(k.mods);
			if (!(["Mod", "Shift", "Alt"] as Modifier[]).every((m) => want.has(m) === MOD[m](e))) continue;
			if (k.fn(e) === false) {
				e.preventDefault();
				e.stopPropagation();
			}
			return;
		}
	};
	const tfiles = files.map((p, i) => new TFile(p, files.length - i));
	return {
		scope: new Scope(),
		keymap: {
			pushScope(s: Scope) {
				if (!stack.length) document.addEventListener("keydown", onKey, true);
				stack.push(s);
			},
			popScope(s: Scope) {
				const i = stack.lastIndexOf(s);
				if (i >= 0) stack.splice(i, 1);
				if (!stack.length) document.removeEventListener("keydown", onKey, true);
			},
		},
		workspace: {
			activeEditor: null as null | { editor?: { focus(): void } },
			openLinkText: async (_href: string, _sourcePath?: string, _newLeaf?: boolean) => {},
			trigger: () => {},
			getActiveViewOfType: () => null,
		},
		vault: { getFiles: () => tfiles, getMarkdownFiles: () => tfiles.filter((f) => f.extension === "md") },
		metadataCache: { fileToLinktext: (f: TFile) => f.path.replace(/\.md$/, "") },
	};
}

/* ───────────── the DOM helpers Obsidian adds to every element ───────────── */

type ElInfo = { cls?: string | string[]; text?: string; attr?: Record<string, string> };

/** Obsidian extends HTMLElement with these; the plugin's views call them. Run once, in the browser. */
export function installDomHelpers() {
	if (typeof HTMLElement === "undefined") return;
	const p = HTMLElement.prototype as unknown as Record<string, unknown>;
	if (p.setCssStyles) return;
	const make = function (this: HTMLElement, tag: string, o?: ElInfo | string) {
		const el = document.createElement(tag);
		const info: ElInfo = typeof o === "string" ? { cls: o } : (o ?? {});
		if (info.cls) el.className = Array.isArray(info.cls) ? info.cls.join(" ") : info.cls;
		if (info.text) el.textContent = info.text;
		for (const [k, v] of Object.entries(info.attr ?? {})) el.setAttribute(k, v);
		this.append(el);
		return el;
	};
	Object.assign(p, {
		setCssStyles(this: HTMLElement, s: Partial<CSSStyleDeclaration>) {
			Object.assign(this.style, s);
		},
		setCssProps(this: HTMLElement, props: Record<string, string>) {
			for (const [k, v] of Object.entries(props)) this.style.setProperty(k, v);
		},
		addClass(this: HTMLElement, ...c: string[]) {
			this.classList.add(...c);
		},
		removeClass(this: HTMLElement, ...c: string[]) {
			this.classList.remove(...c);
		},
		toggleClass(this: HTMLElement, c: string, on: boolean) {
			this.classList.toggle(c, on);
		},
		empty(this: HTMLElement) {
			this.replaceChildren();
		},
		createEl: make,
		createDiv(this: HTMLElement, o?: ElInfo | string) {
			return make.call(this, "div", o);
		},
		createSpan(this: HTMLElement, o?: ElInfo | string) {
			return make.call(this, "span", o);
		},
		setText(this: HTMLElement, t: string) {
			this.textContent = t;
		},
	});
}
installDomHelpers();

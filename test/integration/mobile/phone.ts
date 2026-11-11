import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { builtinModules } from "node:module";
import vm from "node:vm";
import { Window } from "happy-dom";

/**
 * A phone, as far as main.js can tell: a WebView (happy-dom) with Obsidian's DOM helpers, an `obsidian`
 * module whose Platform says mobile, and no Node. Its `require` serves `obsidian`, `@codemirror/*` and
 * `@lezer/*` only; asking for a Node built-in throws, exactly as it would on an iPhone. `process`,
 * `Buffer`, `global`, `setImmediate` and `__dirname` do not exist in it.
 */

const hostRequire = createRequire(import.meta.url);
const NODE = new Set(builtinModules);

export interface Phone {
	plugin: any;
	app: any;
	files: Map<string, string>;
	secrets: Map<string, string>;
	notices: string[];
	/** Every `require` main.js made, in order. */
	required: string[];
	/** Obsidian API names main.js used that the stub did not define. */
	missing: Set<string>;
	/** The fetch the WebView sees (replace per test). */
	setFetch(f: typeof fetch): void;
	/** Obsidian's requestUrl (replace per test). */
	setRequestUrl(f: (req: any) => Promise<{ status: number; headers: Record<string, string>; text: string }>): void;
	window: Window;
}

function obsidianDom(win: any) {
	const E = win.Element.prototype;
	const N = win.Node.prototype;
	const make = function (this: any, tag: string, o?: any, cb?: (el: any) => void) {
		const el = win.document.createElement(tag);
		if (typeof o === "string") o = { cls: o };
		if (o) {
			if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(" ") : o.cls;
			if (o.text !== undefined) el.textContent = typeof o.text === "string" ? o.text : "";
			if (o.attr) for (const [k, v] of Object.entries(o.attr)) if (v !== null && v !== false) el.setAttribute(k, String(v));
			if (o.title) el.title = o.title;
			if (o.href) el.setAttribute("href", o.href);
			if (o.type) el.setAttribute("type", o.type);
			if (o.value !== undefined) el.value = o.value;
			if (o.placeholder) el.setAttribute("placeholder", o.placeholder);
		}
		if (o?.prepend) this.prepend(el);
		else this.appendChild(el);
		cb?.(el);
		return el;
	};
	N.createEl = make;
	N.createDiv = function (o?: any, cb?: any) {
		return make.call(this, "div", o, cb);
	};
	N.createSpan = function (o?: any, cb?: any) {
		return make.call(this, "span", o, cb);
	};
	N.empty = function () {
		while (this.firstChild) this.removeChild(this.firstChild);
	};
	N.appendText = function (t: string) {
		this.appendChild(win.document.createTextNode(t));
	};
	N.setText = function (t: string) {
		this.textContent = t;
	};
	E.addClass = function (...c: string[]) {
		this.classList.add(...c.flatMap((x) => x.split(/\s+/)).filter(Boolean));
	};
	E.addClasses = function (c: string[]) {
		this.addClass(...c);
	};
	E.removeClass = function (...c: string[]) {
		this.classList.remove(...c);
	};
	E.toggleClass = function (c: string, v?: boolean) {
		this.classList.toggle(c, v);
	};
	E.hasClass = function (c: string) {
		return this.classList.contains(c);
	};
	E.setAttr = function (k: string, v: any) {
		if (v === null || v === false) this.removeAttribute(k);
		else this.setAttribute(k, String(v));
	};
	E.toggle = function (show: boolean) {
		this.style.display = show ? "" : "none";
	};
	E.hide = function () {
		this.style.display = "none";
	};
	E.show = function () {
		this.style.display = "";
	};
	E.isShown = function () {
		return this.style.display !== "none";
	};
	E.find = function (s: string) {
		return this.querySelector(s);
	};
	E.findAll = function (s: string) {
		return [...this.querySelectorAll(s)];
	};
	E.onClickEvent = function (cb: any) {
		this.addEventListener("click", cb);
	};
	E.setCssProps = function (p: Record<string, string>) {
		for (const [k, v] of Object.entries(p)) this.style.setProperty(k, v);
	};
	E.setCssStyles = function (p: Record<string, string>) {
		Object.assign(this.style, p);
	};
	win.DocumentFragment.prototype.createEl = make;
	win.DocumentFragment.prototype.createDiv = N.createDiv;
	win.DocumentFragment.prototype.createSpan = N.createSpan;
	win.createFragment = (cb?: (f: any) => void) => {
		const f = win.document.createDocumentFragment();
		cb?.(f);
		return f;
	};
	win.createDiv = (o?: any, cb?: any) => make.call(win.document.createDocumentFragment(), "div", o, cb);
	win.createEl = (tag: string, o?: any, cb?: any) => make.call(win.document.createDocumentFragment(), tag, o, cb);
	win.activeWindow = win;
	win.activeDocument = win.document;
}

/** The parts of Obsidian's API main.js reaches, on a phone. */
function obsidianModule(ctx: any, phone: Partial<Phone>, state: { requestUrl: any }) {
	const missing = phone.missing!;
	class Events {
		private handlers = new Map<string, ((...a: any[]) => any)[]>();
		on(name: string, cb: (...a: any[]) => any) {
			const l = this.handlers.get(name) ?? [];
			l.push(cb);
			this.handlers.set(name, l);
			return { e: this, name, cb };
		}
		off() {}
		offref() {}
		trigger(name: string, ...a: any[]) {
			for (const cb of this.handlers.get(name) ?? []) cb(...a);
		}
	}
	class Component {
		_children: any[] = [];
		_cleanups: (() => void)[] = [];
		load() {
			this.onload();
		}
		onload(): any {}
		unload() {
			for (const c of this._cleanups) c();
			this.onunload();
		}
		onunload() {}
		addChild(c: any) {
			this._children.push(c);
			c.load?.();
			return c;
		}
		removeChild(c: any) {
			return c;
		}
		register(cb: () => void) {
			this._cleanups.push(cb);
		}
		registerEvent() {}
		registerDomEvent(el: any, type: string, cb: any, o?: any) {
			el.addEventListener(type, cb, o);
		}
		registerInterval(id: number) {
			return id;
		}
	}
	class TAbstractFile {
		vault: any;
		path = "";
		name = "";
		parent: any = null;
	}
	class TFile extends TAbstractFile {
		basename = "";
		extension = "";
		stat = { ctime: 0, mtime: 0, size: 0 };
	}
	class TFolder extends TAbstractFile {
		children: any[] = [];
		isRoot() {
			return this.path === "/";
		}
	}
	class Plugin extends Component {
		commands: any[] = [];
		ribbon: any[] = [];
		statusBar = 0;
		data: any = null;
		constructor(
			public app: any,
			public manifest: any,
		) {
			super();
		}
		async loadData() {
			return this.data;
		}
		async saveData(d: any) {
			this.data = JSON.parse(JSON.stringify(d));
		}
		addCommand(c: any) {
			this.commands.push(c);
			return c;
		}
		addRibbonIcon(icon: string, title: string, cb: any) {
			const el = ctx.document.createElement("div");
			this.ribbon.push({ icon, title, cb, el });
			return el;
		}
		addStatusBarItem() {
			this.statusBar++;
			return ctx.document.createElement("div");
		}
		addSettingTab() {}
		registerEditorExtension() {}
		registerMarkdownCodeBlockProcessor() {}
		registerMarkdownPostProcessor() {}
		registerHoverLinkSource() {}
		registerView() {}
		/** Bases views are registered on mobile too; none is opened here. */
		basesViews = new Map<string, unknown>();
		registerBasesView(id: string, reg: unknown) {
			this.basesViews.set(id, reg);
			return true;
		}
		registerObsidianProtocolHandler() {}
	}
	class Notice {
		noticeEl: any;
		messageEl: any;
		containerEl: any;
		constructor(message: any, _ms?: number) {
			this.noticeEl = this.messageEl = this.containerEl = ctx.document.createElement("div");
			if (typeof message === "string") this.messageEl.textContent = message;
			else if (message) this.messageEl.appendChild(message);
			phone.notices!.push(this.messageEl.textContent);
		}
		setMessage(m: any) {
			this.messageEl.textContent = typeof m === "string" ? m : (m?.textContent ?? "");
			return this;
		}
		hide() {}
	}
	class Modal extends Component {
		containerEl = ctx.document.createElement("div");
		modalEl = this.containerEl.createDiv();
		titleEl = this.modalEl.createDiv();
		contentEl = this.modalEl.createDiv();
		scope = new Scope();
		constructor(public app: any) {
			super();
		}
		open() {
			(this as any).onOpen?.();
		}
		close() {
			(this as any).onClose?.();
		}
		setTitle(t: string) {
			this.titleEl.textContent = t;
			return this;
		}
		setContent(c: any) {
			this.contentEl.textContent = typeof c === "string" ? c : "";
			return this;
		}
	}
	class Scope {
		constructor(public parent?: any) {}
		register() {
			return {};
		}
		unregister() {}
	}
	class BaseComponent {
		disabled = false;
		then(cb: (c: any) => void) {
			cb(this);
			return this;
		}
		setDisabled(d: boolean) {
			this.disabled = d;
			return this;
		}
	}
	class ValueComponent extends BaseComponent {
		value: any;
		cb: any;
		setValue(v: any) {
			this.value = v;
			return this;
		}
		getValue() {
			return this.value;
		}
		onChange(cb: any) {
			this.cb = cb;
			return this;
		}
	}
	class TextComponent extends ValueComponent {
		inputEl: any;
		constructor(el: any) {
			super();
			this.inputEl = el.createEl("input");
		}
		setPlaceholder() {
			return this;
		}
	}
	class TextAreaComponent extends TextComponent {}
	class DropdownComponent extends ValueComponent {
		selectEl: any;
		constructor(el: any) {
			super();
			this.selectEl = el.createEl("select");
		}
		addOption(v: string, t: string) {
			this.selectEl.createEl("option", { text: t, value: v });
			return this;
		}
		addOptions(o: Record<string, string>) {
			for (const [k, v] of Object.entries(o)) this.addOption(k, v);
			return this;
		}
	}
	class ToggleComponent extends ValueComponent {
		toggleEl: any;
		constructor(el: any) {
			super();
			this.toggleEl = el.createDiv();
		}
	}
	class ButtonComponent extends BaseComponent {
		buttonEl: any;
		constructor(el: any) {
			super();
			this.buttonEl = el.createEl("button");
		}
		setButtonText(t: string) {
			this.buttonEl.textContent = t;
			return this;
		}
		setCta() {
			return this;
		}
		setWarning() {
			return this;
		}
		setIcon() {
			return this;
		}
		setTooltip() {
			return this;
		}
		setClass() {
			return this;
		}
		onClick(cb: any) {
			this.buttonEl.addEventListener("click", cb);
			return this;
		}
	}
	class ExtraButtonComponent extends ButtonComponent {}
	class SecretComponent extends ValueComponent {
		constructor(
			public app: any,
			public el: any,
		) {
			super();
		}
	}
	class BasesView extends Component {
		app: unknown;
		constructor(_controller: unknown) {
			super();
		}
	}

	class SettingGroup {
		groupEl: any;
		listEl: any;
		constructor(el: any) {
			this.groupEl = el.createDiv({ cls: "setting-group" });
			this.listEl = this.groupEl.createDiv({ cls: "setting-items" });
		}
		setHeading(text: any) {
			const h = this.groupEl.createDiv({ cls: "setting-item setting-item-heading" });
			h.createDiv({ cls: "setting-item-name", text: typeof text === "string" ? text : "" });
			this.groupEl.prepend(h);
			return this;
		}
		addClass() {
			return this;
		}
		addSetting(cb: any) {
			cb(new Setting(this.listEl));
			return this;
		}
		addSearch() {
			return this;
		}
		addExtraButton() {
			return this;
		}
	}
	class Setting {
		settingEl: any;
		nameEl: any;
		descEl: any;
		controlEl: any;
		components: any[] = [];
		constructor(el: any) {
			this.settingEl = el.createDiv({ cls: "setting-item" });
			this.nameEl = this.settingEl.createDiv({ cls: "setting-item-name" });
			this.descEl = this.settingEl.createDiv({ cls: "setting-item-description" });
			this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
		}
		setName(n: any) {
			this.nameEl.textContent = typeof n === "string" ? n : "";
			return this;
		}
		setDesc(d: any) {
			this.descEl.empty();
			if (typeof d === "string") this.descEl.textContent = d;
			else if (d) this.descEl.appendChild(d);
			return this;
		}
		setHeading() {
			return this;
		}
		setClass() {
			return this;
		}
		setTooltip() {
			return this;
		}
		setDisabled() {
			return this;
		}
		then(cb: any) {
			cb(this);
			return this;
		}
		private add(c: any, cb: any) {
			this.components.push(c);
			cb(c);
			return this;
		}
		addText(cb: any) {
			return this.add(new TextComponent(this.controlEl), cb);
		}
		addTextArea(cb: any) {
			return this.add(new TextAreaComponent(this.controlEl), cb);
		}
		addDropdown(cb: any) {
			return this.add(new DropdownComponent(this.controlEl), cb);
		}
		addToggle(cb: any) {
			return this.add(new ToggleComponent(this.controlEl), cb);
		}
		addButton(cb: any) {
			return this.add(new ButtonComponent(this.controlEl), cb);
		}
		addExtraButton(cb: any) {
			return this.add(new ExtraButtonComponent(this.controlEl), cb);
		}
		addComponent(cb: any) {
			this.components.push(cb(this.controlEl.createDiv()));
			return this;
		}
	}
	class PluginSettingTab {
		containerEl = ctx.document.createElement("div");
		constructor(
			public app: any,
			public plugin: any,
		) {}
	}
	class MarkdownRenderChild extends Component {
		constructor(public containerEl: any) {
			super();
		}
	}
	class MarkdownView {}
	class Menu {
		addItem(cb: any) {
			cb({ setTitle: () => ({}), setIcon: () => ({}), onClick: () => ({}), setSection: () => ({}) });
			return this;
		}
		addSeparator() {
			return this;
		}
		showAtMouseEvent() {}
		showAtPosition() {}
	}
	const MarkdownRenderer = {
		render: async (_app: any, md: string, el: any) => {
			el.createDiv({ text: md });
		},
	};
	const api: Record<string, any> = {
		Platform: { isMobile: true, isMobileApp: true, isDesktop: false, isDesktopApp: false, isIosApp: true, isAndroidApp: false, isPhone: true, isTablet: false, isMacOS: false, isWin: false, isLinux: false, isSafari: true },
		Events,
		Component,
		Plugin,
		Notice,
		Modal,
		Scope,
		Setting,
		SettingGroup,
		BasesView,
		PluginSettingTab,
		MarkdownRenderChild,
		MarkdownView,
		MarkdownRenderer,
		Menu,
		TAbstractFile,
		TFile,
		TFolder,
		BaseComponent,
		ValueComponent,
		TextComponent,
		TextAreaComponent,
		DropdownComponent,
		ToggleComponent,
		ButtonComponent,
		ExtraButtonComponent,
		SecretComponent,
		FileSystemAdapter: class FileSystemAdapter {},
		Keymap: { isModEvent: () => false, isModifier: () => false },
		getLanguage: () => "en",
		setIcon: () => undefined,
		setTooltip: () => undefined,
		normalizePath: (p: string) => p.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, ""),
		debounce: (f: any) => f,
		requestUrl: (req: any) => state.requestUrl(req),
		moment: () => ({ format: () => "" }),
		parseYaml: () => ({}),
		stringifyYaml: () => "",
		getLinkpath: (s: string) => s,
		getAllTags: () => [],
		sanitizeHTMLToDom: (s: string) => {
			const f = ctx.document.createDocumentFragment();
			f.createDiv({ text: s });
			return f;
		},
		apiVersion: "1.11.4",
	};
	return { api, Plugin, TFile, TFolder, Events };
}

/** The in-memory vault and app a phone's Obsidian gives the plugin. */
function makeApp(o: { TFile: any; TFolder: any; Events: any }, files: Map<string, string>, secrets: Map<string, string>) {
	const vaultEvents = new o.Events();
	const fileObj = (path: string) => {
		const f = new o.TFile();
		f.path = path;
		f.name = path.split("/").pop()!;
		f.extension = f.name.includes(".") ? f.name.split(".").pop()! : "";
		f.basename = f.name.replace(/\.[^.]+$/, "");
		f.stat = { ctime: 0, mtime: Date.now(), size: (files.get(path) ?? "").length };
		return f;
	};
	const root = new o.TFolder();
	root.path = "/";
	const adapter = {
		exists: async (p: string) => files.has(p) || [...files.keys()].some((k) => k.startsWith(p + "/")),
		read: async (p: string) => {
			if (!files.has(p)) throw new Error(`ENOENT ${p}`);
			return files.get(p)!;
		},
		readBinary: async (p: string) => new TextEncoder().encode(files.get(p) ?? "").buffer,
		write: async (p: string, d: string) => void files.set(p, d),
		writeBinary: async (p: string, d: ArrayBuffer) => void files.set(p, new TextDecoder().decode(d)),
		mkdir: async () => undefined,
		remove: async (p: string) => void files.delete(p),
		rmdir: async () => undefined,
		list: async (p: string) => ({ files: [...files.keys()].filter((k) => k.startsWith(p + "/") && !k.slice(p.length + 1).includes("/")), folders: [] }),
		stat: async (p: string) => (files.has(p) ? { type: "file", ctime: 0, mtime: 0, size: files.get(p)!.length } : null),
		copy: async (a: string, b: string) => void files.set(b, files.get(a)!),
		getResourcePath: (p: string) => `app://local/${p}`,
	};
	const vault = Object.assign(vaultEvents, {
		adapter,
		configDir: ".obsidian",
		getName: () => "phone",
		getRoot: () => root,
		getAbstractFileByPath: (p: string) => (files.has(p) ? fileObj(p) : null),
		getFileByPath: (p: string) => (files.has(p) ? fileObj(p) : null),
		getFiles: () => [...files.keys()].filter((k) => !k.startsWith(".obsidian/")).map(fileObj),
		getMarkdownFiles: () => [...files.keys()].filter((k) => k.endsWith(".md") && !k.startsWith(".obsidian/")).map(fileObj),
		getAllLoadedFiles: () => [...files.keys()].map(fileObj),
		read: async (f: any) => files.get(f.path) ?? "",
		cachedRead: async (f: any) => files.get(f.path) ?? "",
		readBinary: async (f: any) => new TextEncoder().encode(files.get(f.path) ?? "").buffer,
		create: async (p: string, d: string) => {
			if (files.has(p)) throw new Error("File already exists.");
			files.set(p, d);
			const f = fileObj(p);
			vaultEvents.trigger("create", f);
			return f;
		},
		createFolder: async () => undefined,
		modify: async (f: any, d: string) => {
			files.set(f.path, d);
			vaultEvents.trigger("modify", f);
		},
		process: async (f: any, fn: (s: string) => string) => {
			const next = fn(files.get(f.path) ?? "");
			files.set(f.path, next);
			vaultEvents.trigger("modify", f);
			return next;
		},
		append: async (f: any, d: string) => void files.set(f.path, (files.get(f.path) ?? "") + d),
		delete: async (f: any) => void files.delete(f.path),
		trash: async (f: any) => void files.delete(f.path),
		rename: async (f: any, p: string) => {
			files.set(p, files.get(f.path)!);
			files.delete(f.path);
		},
		getResourcePath: (f: any) => `app://local/${f.path}`,
	});
	const metadataCache = Object.assign(new o.Events(), {
		getFileCache: () => ({ headings: [], links: [], frontmatter: undefined }),
		getCache: () => ({ headings: [], links: [] }),
		getFirstLinkpathDest: (link: string) => {
			const p = [...files.keys()].find((k) => k === link || k === `${link}.md` || k.endsWith(`/${link}.md`));
			return p ? fileObj(p) : null;
		},
		resolvedLinks: {},
		unresolvedLinks: {},
		fileToLinktext: (f: any) => f.basename,
	});
	const workspace = Object.assign(new o.Events(), {
		layoutReady: true,
		onLayoutReady: (cb: () => void) => cb(),
		getActiveViewOfType: () => null,
		getActiveFile: () => null,
		getLeavesOfType: () => [],
		iterateAllLeaves: () => undefined,
		getLeaf: () => ({ openFile: async () => undefined }),
		openLinkText: async () => undefined,
		activeEditor: null,
		containerEl: null,
	});
	return {
		vault,
		metadataCache,
		workspace,
		fileManager: { processFrontMatter: async () => undefined, renameFile: async () => undefined, trashFile: async (f: any) => void files.delete(f.path) },
		secretStorage: {
			setSecret: (id: string, v: string) => void secrets.set(id, v),
			getSecret: (id: string) => secrets.get(id) ?? null,
			listSecrets: () => [...secrets.keys()],
		},
		setting: { open: () => undefined, openTabById: () => undefined },
		loadLocalStorage: () => null,
		saveLocalStorage: () => undefined,
		isDarkMode: () => false,
		emulateMobile: () => undefined,
	};
}

/** Boot main.js on a phone: load it in a context without Node and run the plugin's onload. */
export async function boot(mainJs: string, opts: { files?: Record<string, string>; secrets?: Record<string, string>; data?: unknown } = {}): Promise<Phone> {
	const win = new Window({ url: "app://obsidian.md/index.html", width: 390, height: 844 });
	obsidianDom(win);
	const files = new Map(Object.entries(opts.files ?? {}));
	const secrets = new Map(Object.entries(opts.secrets ?? {}));
	const phone: Partial<Phone> = { files, secrets, notices: [], required: [], missing: new Set(), window: win };
	const state: { fetch: typeof fetch; requestUrl: (req: any) => Promise<{ status: number; headers: Record<string, string>; text: string }> } = {
		fetch: (async () => {
			throw new TypeError("Load failed");
		}) as typeof fetch,
		requestUrl: async (_req: any) => {
			throw new Error("requestUrl: not set");
		},
	};
	phone.setFetch = (f) => (state.fetch = f);
	phone.setRequestUrl = (f) => (state.requestUrl = f);

	// The WebView's globals: the DOM from happy-dom, the web platform (fetch, streams, crypto…) of the JS
	// engine. Nothing of Node's.
	const ctx: any = {};
	const webGlobals = [
		"URL", "URLSearchParams", "TextEncoder", "TextDecoder", "AbortController", "AbortSignal", "Headers", "Request", "Response", "FormData", "Blob", "File",
		"ReadableStream", "WritableStream", "TransformStream", "TextDecoderStream", "TextEncoderStream", "CompressionStream", "DecompressionStream",
		"structuredClone", "queueMicrotask", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "atob", "btoa", "crypto", "performance",
		"Event", "EventTarget", "DOMException", "WebAssembly", "console", "BroadcastChannel", "MessageChannel", "MessagePort",
	];
	for (const k of webGlobals) ctx[k] = (globalThis as any)[k];
	for (const k of Object.getOwnPropertyNames(win)) {
		if (k in ctx || k === "process" || k === "Buffer" || k === "global" || k === "setImmediate" || k === "require") continue;
		try {
			ctx[k] = (win as any)[k];
		} catch {
			/* a getter that needs the real window */
		}
	}
	for (const k of ["document", "navigator", "location", "history", "localStorage", "sessionStorage", "getComputedStyle", "matchMedia", "requestAnimationFrame", "cancelAnimationFrame", "addEventListener", "removeEventListener", "dispatchEvent", "postMessage", "innerWidth", "innerHeight", "devicePixelRatio", "customElements", "getSelection"]) {
		const v = (win as any)[k];
		ctx[k] = typeof v === "function" ? v.bind(win) : v;
	}
	ctx.fetch = (...a: Parameters<typeof fetch>) => state.fetch(...a);
	ctx.createFragment = (win as any).createFragment;
	ctx.createDiv = (win as any).createDiv;
	ctx.createEl = (win as any).createEl;
	ctx.activeDocument = win.document;
	vm.createContext(ctx);
	ctx.window = ctx;
	ctx.self = ctx;
	ctx.globalThis = ctx;
	ctx.activeWindow = ctx;
	ctx.requestAnimationFrame ??= (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 16);

	const { api, Plugin, TFile, TFolder, Events } = obsidianModule(ctx, phone, state);
	const obsidian = new Proxy(api, {
		get(t, k: string) {
			if (k in t) return t[k];
			if (typeof k === "string" && k !== "then" && k !== "__esModule" && k !== "default") phone.missing!.add(k);
			return undefined;
		},
	});
	const require = (id: string) => {
		phone.required!.push(id);
		if (id === "obsidian") return obsidian;
		if (id.startsWith("@codemirror/") || id.startsWith("@lezer/")) return hostRequire(id);
		if (NODE.has(id) || id.startsWith("node:")) throw new Error(`Cannot find module '${id}' (no Node on mobile)`);
		throw new Error(`Cannot find module '${id}'`);
	};
	const module = { exports: {} as any };
	vm.runInContext(`(function (module, exports, require) {\n${mainJs}\n})`, ctx, { filename: "main.js" })(module, module.exports, require);
	const PluginClass = module.exports.default ?? module.exports;
	const app = makeApp({ TFile, TFolder, Events }, files, secrets);
	ctx.app = app;
	const plugin = new PluginClass(app, { id: "icap-agent", name: "ICAP Learning Agent", version: "1.1.4", dir: ".obsidian/plugins/icap-agent" });
	if (!(plugin instanceof Plugin)) throw new Error("main.js did not export the plugin class");
	(plugin as any).data = opts.data ?? null;
	await plugin.onload();
	return Object.assign(phone, { plugin, app }) as Phone;
}

export function readMain(path: string): string {
	return readFileSync(path, "utf8");
}

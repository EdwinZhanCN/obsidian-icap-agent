import { MarkdownRenderChild, MarkdownView, Menu, Modal, Notice, Plugin, Setting, TFile, getLanguage, type Editor, type MarkdownFileInfo } from "obsidian";
import { guideNote } from "./guide/guide";
import { L, setLocale } from "./i18n";
import { mount, unmount } from "svelte";
import bridgeSource from "../pi/icpa-bridge.ts?text";
import { ASK_LANG, parseAskSource } from "./dsl/blocks";
import { selectionMark } from "./editor/selection-mark";
import { freshField } from "./editor/fresh";
import { LearningRuntime, cmOf, type PersistedRuntime } from "./runtime/runtime";
import { DEFAULT_SETTINGS, IcpaSettingTab, type IcpaSettings } from "./settings";
import AskView from "./ui/AskView.svelte";
import Ledger from "./ui/Ledger.svelte";
import LedgerMark from "./ui/LedgerMark.svelte";

interface StoredData extends Partial<PersistedRuntime> {
	settings?: Partial<IcpaSettings>;
}

class SvelteChild extends MarkdownRenderChild {
	private instance: Record<string, unknown> | null = null;
	constructor(
		el: HTMLElement,
		private make: (target: HTMLElement) => Record<string, unknown>,
	) {
		super(el);
	}
	onload() {
		this.instance = this.make(this.containerEl);
	}
	onunload() {
		if (this.instance) void unmount(this.instance);
		this.instance = null;
	}
}

export default class IcpaPlugin extends Plugin {
	settings: IcpaSettings = { ...DEFAULT_SETTINGS };
	runtime!: LearningRuntime;
	extensionPath = "";
	private mounted: Record<string, unknown>[] = [];

	async onload() {
		setLocale(this.language());
		const data = ((await this.loadData()) ?? {}) as StoredData;
		this.settings = { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) };
		this.runtime = new LearningRuntime(this);
		this.runtime.load(data);
		this.extensionPath = await this.writeBridge();
		this.applyInk();

		const rt = this.runtime;

		// Editor: transient glosses + the selection mark.
		this.registerEditorExtension([
			rt.field,
			freshField,
			selectionMark({
				enabled: () => this.settings.selectionMark,
				explain: (view) => rt.explainFromView(view),
				check: (view) => rt.checkFromView(view),
			}),
		]);

		// Markdown DSL: Interactive Blocks.
		this.registerMarkdownCodeBlockProcessor(ASK_LANG, (source, el, ctx) => {
			const src = parseAskSource(source);
			el.addClass("icpa-ask-host");
			ctx.addChild(
				new SvelteChild(el, (target) =>
					mount(AskView, {
						target,
						props: {
							block: rt.blocks.get(src.id) ?? rt.adoptAuthored(src, ctx.sourcePath),
							id: src.id,
							title: src.body.split("\n")[0] ?? "",
							rt,
							sourcePath: ctx.sourcePath,
							host: el,
						},
					}),
				),
			);
		});

		this.registerHoverLinkSource("icpa-agent", { display: "ICAP Learning Agent", defaultMod: true });

		// Activity: a mark in the status bar that unfolds into the ledger.
		const bar = this.addStatusBarItem();
		bar.addClass("icpa-statusbar");
		this.mounted.push(mount(LedgerMark, { target: bar, props: { rt } }));
		const ledgerHost = document.body.createDiv({ cls: "icpa-ledger-host" });
		this.register(() => ledgerHost.remove());
		this.mounted.push(mount(Ledger, { target: ledgerHost, props: { rt } }));

		this.registerCommands();
		// First install: the guide is the first thing the learner sees — a note to learn in, not a welcome page.
		this.app.workspace.onLayoutReady(() => {
			void this.firstRun();
			// What the learner's agent changes in the vault is recorded (after load: startup fires "create" for every file).
			this.registerEvent(this.app.vault.on("create", (f) => rt.onVaultChange("created", f)));
			this.registerEvent(this.app.vault.on("modify", (f) => rt.onVaultChange("edited", f)));
			this.registerEvent(this.app.vault.on("delete", (f) => rt.onVaultChange("deleted", f)));
			this.registerEvent(this.app.vault.on("rename", (f, old) => rt.onVaultChange("edited", f, old)));
		});
		this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, info) => this.editorMenu(menu, editor, info)));
		this.addSettingTab(new IcpaSettingTab(this.app, this));
	}

	private async firstRun() {
		if (this.settings.guideCreated) return;
		this.settings.guideCreated = true;
		await this.saveSettings();
		await this.openGuide();
	}

	/** Obsidian's interface language ("en", "zh", "zh-TW"…). */
	private language(): string {
		try {
			return getLanguage();
		} catch {
			return window.localStorage.getItem("language") || "en";
		}
	}

	/** The vault's folder on disk. */
	vaultPath(): string | undefined {
		return (this.app.vault.adapter as unknown as { getBasePath?: () => string }).getBasePath?.();
	}

	/** Open the guide note; recreate it if it was deleted. */
	async openGuide() {
		const g = guideNote(this.language());
		let file = this.app.vault.getAbstractFileByPath(g.path);
		if (!(file instanceof TFile)) {
			this.runtime.forgetBlocks(g.blockIds);
			try {
				file = await this.app.vault.create(g.path, g.content);
			} catch (e) {
				return void new Notice(L("Could not create the guide: ", "无法创建指南：") + `${e instanceof Error ? e.message : String(e)}`);
			}
		}
		if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
	}

	onunload() {
		this.runtime?.dispose();
		for (const m of this.mounted) void unmount(m);
		this.mounted = [];
		document.body.removeClass("icpa-ink-accent");
		document.querySelectorAll(".icpa-veiled").forEach((e) => e.classList.remove("icpa-veiled"));
	}

	async saveSettings() {
		await this.saveState();
	}

	async saveState() {
		const data: StoredData = { settings: this.settings, ...this.runtime.snapshot() };
		await this.saveData(data);
	}

	applyInk() {
		document.body.toggleClass("icpa-ink-accent", this.settings.ink === "accent");
	}

	private async writeBridge(): Promise<string> {
		const dir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
		const rel = `${dir}/icpa-bridge.ts`;
		const adapter = this.app.vault.adapter;
		const existing = (await adapter.exists(rel)) ? await adapter.read(rel) : null;
		if (existing !== bridgeSource) await adapter.write(rel, bridgeSource);
		const base = this.vaultPath() ?? "";
		return `${base}/${rel}`;
	}

	private withEditor(fn: (editor: Editor, file: TFile) => void) {
		return (checking: boolean) => {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view?.file || !cmOf(view.editor)) return false;
			if (!checking) fn(view.editor, view.file);
			return true;
		};
	}

	private registerCommands() {
		const rt = this.runtime;
		this.addCommand({
			id: "ask-agent",
			name: L("Ask the agent here", "在这里向 Agent 提问"),
			checkCallback: this.withEditor((e, f) => void rt.request(e, f)),
		});
		this.addCommand({
			id: "explain-selection",
			name: L("Explain selection in context", "在上下文中解释选中内容"),
			checkCallback: this.withEditor((e, f) => rt.explain(e, f)),
		});
		this.addCommand({
			id: "recall-from-memory",
			name: L("Recall from memory (this section)", "凭记忆复述（本节）"),
			checkCallback: this.withEditor((e, f) => void rt.recall(e, f)),
		});
		this.addCommand({
			id: "check-my-words",
			name: L("Check what I wrote (selection or paragraph)", "检查我写的内容（选中内容或段落）"),
			checkCallback: this.withEditor((e, f) => void rt.checkWriting(e, f)),
		});
		this.addCommand({
			id: "quiz-section",
			name: L("Check my understanding of this section", "检验我对本节的理解"),
			checkCallback: this.withEditor((e, f) => void rt.quiz(e, f, "section")),
		});
		this.addCommand({
			id: "quiz-note",
			name: L("Check my understanding of this note", "检验我对整篇笔记的理解"),
			checkCallback: this.withEditor((e, f) => void rt.quiz(e, f, "note")),
		});
		this.addCommand({
			id: "concept-note",
			name: L("Create a concept note from selection", "用选中内容新建概念笔记"),
			checkCallback: this.withEditor((e, f) => {
				const s = e.getSelection().trim();
				if (!s) return void new Notice(L("Select the concept first.", "请先选中一个概念。"));
				void rt.noteTask("concept", f, s, e);
			}),
		});
		this.addCommand({
			id: "collect-concepts",
			name: L("Collect key concepts of this note into notes", "把本笔记的关键概念整理成笔记"),
			checkCallback: this.withEditor((e, f) => void rt.noteTask("collect", f, "", e)),
		});
		this.addCommand({
			id: "compare-concepts",
			name: L("Write a comparison note…", "写一篇对比笔记…"),
			checkCallback: this.withEditor((e, f) => {
				new CompareModal(this, e.getSelection().trim(), (v) => void rt.noteTask("compare", f, v, e)).open();
			}),
		});
		this.addCommand({
			id: "focus-interaction",
			name: L("Move into the nearest explanation or question", "进入最近的解释或问题"),
			editorCallback: (_e, info) => {
				if (info instanceof MarkdownView) rt.focusNearestInteraction(info);
			},
		});
		this.addCommand({
			id: "show-activity",
			name: L("Show activity", "显示活动"),
			callback: () => (rt.ledger.open = true),
		});
		this.addCommand({
			id: "open-guide",
			name: L("Open the guide", "打开指南"),
			callback: () => void this.openGuide(),
		});
	}

	private editorMenu(menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) {
		const file = info.file;
		if (!file || !cmOf(editor)) return;
		const rt = this.runtime;
		const hasSel = editor.somethingSelected();
		menu.addSeparator();
		if (hasSel) {
			menu.addItem((i) => i.setTitle(L("Explain in context", "在上下文中解释")).setIcon("book-open").onClick(() => rt.explain(editor, file)));
			menu.addItem((i) => i.setTitle(L("Check what I wrote", "检查我写的内容")).setIcon("pen-line").onClick(() => void rt.checkWriting(editor, file)));
			menu.addItem((i) => i.setTitle(L("Create a concept note", "新建概念笔记")).setIcon("file-plus").onClick(() => void rt.noteTask("concept", file, editor.getSelection(), editor)));
		}
		menu.addItem((i) => i.setTitle(L("Ask the agent here", "在这里向 Agent 提问")).setIcon("message-square-text").onClick(() => void rt.request(editor, file)));
		menu.addItem((i) => i.setTitle(L("Recall from memory", "凭记忆复述")).setIcon("brain").onClick(() => void rt.recall(editor, file)));
		menu.addItem((i) => i.setTitle(L("Check my understanding", "检验我的理解")).setIcon("list-checks").onClick(() => void rt.quiz(editor, file, "section")));
	}
}

class CompareModal extends Modal {
	constructor(
		plugin: IcpaPlugin,
		private initial: string,
		private done: (v: string) => void,
	) {
		super(plugin.app);
	}
	onOpen() {
		this.setTitle(L("Compare concepts", "对比概念"));
		let a = this.initial;
		let b = "";
		const submit = () => {
			if (!a.trim() || !b.trim()) return;
			this.close();
			this.done(`${a.trim()} vs. ${b.trim()}`);
		};
		new Setting(this.contentEl).setName(L("This", "这个")).addText((t) => t.setValue(a).onChange((v) => (a = v)));
		new Setting(this.contentEl).setName(L("With", "和")).addText((t) => {
			t.setPlaceholder(L("e.g. garbage collection", "例如：垃圾回收")).onChange((v) => (b = v));
			t.inputEl.addEventListener("keydown", (e) => e.key === "Enter" && submit());
			window.setTimeout(() => t.inputEl.focus(), 30);
		});
		new Setting(this.contentEl).addButton((btn) => btn.setButtonText(L("Write comparison", "写对比笔记")).setCta().onClick(submit));
	}
	onClose() {
		this.contentEl.empty();
	}
}

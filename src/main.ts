import { MarkdownRenderChild, MarkdownView, Menu, Modal, Notice, Platform, Plugin, Setting, TFile, getLanguage, requestUrl, type Editor, type MarkdownFileInfo } from "obsidian";
import { ACTIVITY_VIEW, ActivityBasesView } from "./activity/view.svelte";
import { guideNote } from "./guide/guide";
import { L, setLocale } from "./i18n";
import { mount, unmount } from "svelte";
import { ASK_LANG, LEGACY_ASK_LANG, parseAskSource } from "./dsl/blocks";
import { selectionMark } from "./editor/selection-mark";
import { freshField } from "./editor/fresh";
import { recordComments } from "./editor/record-comments";
import { LearningRuntime, cmOf, type PersistedRuntime } from "./runtime/runtime";
import { DEFAULT_SETTINGS, IcapSettingTab, type IcapSettings } from "./settings/settings";
import type { AgentBackend } from "./agent/backend";
import { UiHost } from "./genui/host";
import { RulesModal, VAULT_RULES } from "./settings/rules-modal";
import AskView from "./ui/AskView.svelte";
import Ledger from "./ui/Ledger.svelte";
import LedgerMark from "./ui/LedgerMark.svelte";

interface StoredData extends Partial<PersistedRuntime> {
	settings?: Partial<IcapSettings>;
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

export default class IcapPlugin extends Plugin {
	settings: IcapSettings = { ...DEFAULT_SETTINGS };
	runtime!: LearningRuntime;
	/** The agent below the runtime (agent/backend.ts). */
	backend!: AgentBackend;
	private mounted: Record<string, unknown>[] = [];

	async onload() {
		setLocale(this.language());
		const data = ((await this.loadData()) ?? (await this.legacyData()) ?? {}) as StoredData;
		const stored = (data.settings ?? {}) as Partial<IcapSettings> & { ink?: string };
		// Earlier versions let only the ink follow the theme accent; that choice now means the theme's look.
		if (!stored.style && stored.ink === "accent") stored.style = "theme";
		delete stored.ink;
		this.settings = { ...DEFAULT_SETTINGS, ...stored };
		this.backend = await this.chooseBackend();
		this.runtime = new LearningRuntime(this);
		this.runtime.load(data);
		this.applyStyle();

		const rt = this.runtime;

		// Editor: transient glosses + the selection mark.
		this.registerEditorExtension([
			rt.field,
			freshField,
			recordComments,
			selectionMark({
				enabled: () => this.settings.selectionMark,
				explain: (view) => rt.explainFromView(view),
				check: (view) => rt.checkFromView(view),
			}),
		]);

		// Markdown DSL: Interactive Blocks.
		// LEGACY_ASK_LANG: blocks in notes written before the rename keep working; rewriting one upgrades its fence.
		for (const lang of [ASK_LANG, LEGACY_ASK_LANG]) this.registerMarkdownCodeBlockProcessor(lang, (source, el, ctx) => {
			const src = parseAskSource(source);
			el.addClass("icap-ask-host");
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

		// Interactive visuals (```icap-ui) in notes, replies and kept records: sandboxed frames whose
		// icap.ask continues the conversation they appear in.
		new UiHost(this, {
			followUp: (blockId, text) => rt.visualFollowUp(blockId, text),
			requestBelow: (path, line, text) => rt.requestBelow(path, line, text),
		}).register();

		this.registerHoverLinkSource("icap-agent", { display: "ICAP Learning Agent", defaultMod: true });

		// Activity: a mark in the status bar that unfolds into the ledger. Mobile has no status bar: a ribbon
		// button (and the command) open it there.
		if (Platform.isMobile) this.addRibbonIcon("activity", L("Show activity", "显示活动"), () => void rt.showActivity());
		else {
			const bar = this.addStatusBarItem();
			bar.addClass("icap-statusbar");
			this.mounted.push(mount(LedgerMark, { target: bar, props: { rt } }));
		}
		const ledgerHost = document.body.createDiv({ cls: "icap-ledger-host" });
		this.register(() => ledgerHost.remove());
		this.mounted.push(mount(Ledger, { target: ledgerHost, props: { rt } }));

		// The activity as a Bases view type: Activity.base opens on it; its table views stay for when the plugin is gone.
		// Obsidian does not unload a plugin's open Bases views when the plugin is disabled: take them down here.
		const activityViews = new Set<ActivityBasesView>();
		this.register(() => {
			for (const v of activityViews) v.unload();
			activityViews.clear();
		});
		this.registerBasesView(ACTIVITY_VIEW, {
			name: L("Activity", "活动"),
			icon: "activity",
			factory: (controller, el) => {
				const view = new ActivityBasesView(controller, el, { taskOf: (id) => rt.taskNotes.taskOf(id) });
				activityViews.add(view);
				view.register(() => activityViews.delete(view));
				return view;
			},
		});

		this.registerCommands();
		// First install: the guide is the first thing the learner sees — a note to learn in, not a welcome page.
		this.app.workspace.onLayoutReady(() => {
			void this.firstRun();
			// Task notes: what was running when Obsidian closed, and the one-time move of earlier activity into notes.
			void rt.startTaskNotes();
			// Pi sessions of request blocks that were kept or cleared elsewhere (another device, a crash).
			rt.pruneSessions();
			// What the learner's agent changes in the vault is recorded (after load: startup fires "create" for every file).
			this.registerEvent(this.app.vault.on("create", (f) => rt.onVaultChange("created", f)));
			this.registerEvent(this.app.vault.on("modify", (f) => rt.onVaultChange("edited", f)));
			this.registerEvent(this.app.vault.on("delete", (f) => rt.onVaultChange("deleted", f)));
			this.registerEvent(this.app.vault.on("rename", (f, old) => rt.onVaultChange("edited", f, old)));
			// Documents (PDF, EPUB, DOCX) are prepared ahead of time into .icap/docs/, when that is on.
			this.registerEvent(this.app.vault.on("create", (f) => rt.onDocumentChange(f)));
			this.registerEvent(this.app.vault.on("modify", (f) => rt.onDocumentChange(f)));
			window.setTimeout(() => rt.prepareDocuments(), 5000);
		});
		this.registerEvent(this.app.workspace.on("editor-menu", (menu, editor, info) => this.editorMenu(menu, editor, info)));
		this.addSettingTab(new IcapSettingTab(this.app, this));
	}

	/**
	 * The one place a backend is chosen. Each sits behind a dynamic import evaluated only on its platform:
	 * the desktop one reaches Node (fs, child_process, Pi), which does not exist on mobile. Keyed on
	 * isMobile, so the desktop app's mobile emulation (app.emulateMobile) runs the mobile backend too.
	 */
	private async chooseBackend(): Promise<AgentBackend> {
		if (!Platform.isMobile) {
			const { DesktopBackend } = await import("./agent/desktop/desktop-backend");
			return new DesktopBackend(this.app, { pluginDir: () => this.pluginPath(), externalFolders: () => this.settings.externalFolders });
		}
		const { MobileBackend } = await import("./agent/mobile/mobile-backend");
		return new MobileBackend(this.app, { settings: () => this.settings, save: () => this.saveSettings(), requestUrl });
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

	/** This plugin's folder on disk (its data, main.js, and request blocks' Pi sessions). */
	pluginPath(): string | undefined {
		const base = this.vaultPath();
		if (!base) return undefined;
		return `${base}/${this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`}`;
	}

	/** Open the guide note; recreate it if it was deleted. */
	async openGuide() {
		const g = guideNote(this.language(), Platform.isMacOS);
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
		document.body.removeClass("icap-style-theme");
		document.querySelectorAll(".icap-veiled").forEach((e) => e.classList.remove("icap-veiled"));
	}

	async saveSettings() {
		// The `/` catalog depends on the agent setup.
		this.runtime.invalidateCatalog();
		await this.saveState();
	}

	async saveState() {
		const data: StoredData = { settings: this.settings, ...this.runtime.snapshot() };
		await this.saveData(data);
	}

	applyStyle() {
		document.body.toggleClass("icap-style-theme", this.settings.style === "theme");
	}

	/**
	 * The plugin was renamed ICPA → ICAP, and its id with it (icpa-agent → icap-agent), so Obsidian gives
	 * it a fresh folder. On the first start under the new id, carry over the old folder's settings,
	 * activity and Pi sessions. The old folder is left untouched.
	 */
	private async legacyData(): Promise<StoredData | null> {
		const adapter = this.app.vault.adapter;
		const old = `${this.app.vault.configDir}/plugins/icpa-agent`;
		const dir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
		try {
			if (!(await adapter.exists(`${old}/data.json`))) return null;
			const data = JSON.parse(await adapter.read(`${old}/data.json`)) as StoredData;
			if (await adapter.exists(`${old}/sessions`)) {
				if (!(await adapter.exists(`${dir}/sessions`))) await adapter.mkdir(`${dir}/sessions`);
				for (const f of (await adapter.list(`${old}/sessions`)).files) {
					const to = `${dir}/sessions/${f.split("/").pop()}`;
					if (!(await adapter.exists(to))) await adapter.copy(f, to);
				}
			}
			await this.saveData(data);
			new Notice(
				L(
					`ICAP Learning Agent: settings and activity carried over from the earlier “icpa-agent” install. You can turn that one off and delete ${old}.`,
					`ICAP Learning Agent：已从旧的“icpa-agent”安装中迁移设置和活动记录。可以停用旧插件并删除 ${old}。`,
				),
				12000,
			);
			return data;
		} catch {
			return null;
		}
	}

	/** An editor command (so it can sit in the mobile toolbar): available in a note's editor. */
	private withEditor(fn: (editor: Editor, file: TFile) => void) {
		return (checking: boolean, editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
			const file = ctx.file;
			if (!file || !cmOf(editor)) return false;
			if (!checking) fn(editor, file);
			return true;
		};
	}

	private registerCommands() {
		const rt = this.runtime;
		this.addCommand({
			id: "ask-agent",
			icon: "message-circle-question",
			name: L("Ask the agent here", "在这里向 Agent 提问"),
			editorCheckCallback: this.withEditor((e, f) => void rt.request(e, f)),
		});
		this.addCommand({
			id: "explain-selection",
			icon: "lightbulb",
			name: L("Explain selection in context", "在上下文中解释选中内容"),
			editorCheckCallback: this.withEditor((e, f) => rt.explain(e, f)),
		});
		this.addCommand({
			id: "recall-from-memory",
			icon: "brain",
			name: L("Recall from memory (this section)", "凭记忆复述（本节）"),
			editorCheckCallback: this.withEditor((e, f) => void rt.recall(e, f)),
		});
		this.addCommand({
			id: "check-my-words",
			icon: "spell-check",
			name: L("Check what I wrote (selection or paragraph)", "检查我写的内容（选中内容或段落）"),
			editorCheckCallback: this.withEditor((e, f) => void rt.checkWriting(e, f)),
		});
		this.addCommand({
			id: "quiz-section",
			icon: "list-checks",
			name: L("Check my understanding of this section", "检验我对本节的理解"),
			editorCheckCallback: this.withEditor((e, f) => void rt.quiz(e, f, "section")),
		});
		this.addCommand({
			id: "quiz-note",
			icon: "clipboard-check",
			name: L("Check my understanding of this note", "检验我对整篇笔记的理解"),
			editorCheckCallback: this.withEditor((e, f) => void rt.quiz(e, f, "note")),
		});
		this.addCommand({
			id: "concept-note",
			icon: "file-plus-2",
			name: L("Create a concept note from selection", "用选中内容新建概念笔记"),
			editorCheckCallback: this.withEditor((e, f) => {
				const s = e.getSelection().trim();
				if (!s) return void new Notice(L("Select the concept first.", "请先选中一个概念。"));
				void rt.noteTask("concept", f, s, e);
			}),
		});
		this.addCommand({
			id: "collect-concepts",
			icon: "files",
			name: L("Collect key concepts of this note into notes", "把本笔记的关键概念整理成笔记"),
			editorCheckCallback: this.withEditor((e, f) => void rt.noteTask("collect", f, "", e)),
		});
		this.addCommand({
			id: "compare-concepts",
			icon: "columns-2",
			name: L("Write a comparison note…", "写一篇对比笔记…"),
			editorCheckCallback: this.withEditor((e, f) => {
				new CompareModal(this, e.getSelection().trim(), (v) => void rt.noteTask("compare", f, v, e)).open();
			}),
		});
		this.addCommand({
			id: "focus-interaction",
			icon: "corner-down-right",
			name: L("Move into the nearest explanation or question", "进入最近的解释或问题"),
			editorCallback: (_e, info) => {
				if (info instanceof MarkdownView) rt.focusNearestInteraction(info);
			},
		});
		this.addCommand({
			id: "show-activity",
			icon: "activity",
			name: L("Show activity", "显示活动"),
			callback: () => void rt.showActivity(),
		});
		this.addCommand({
			id: "rebuild-task-notes",
			icon: "list-restart",
			name: L("Rebuild task notes from recent activity", "从最近的活动重建任务笔记"),
			callback: () => void rt.rebuildTaskNotes(),
		});
		this.addCommand({
			id: "open-guide",
			icon: "book-open",
			name: L("Open the guide", "打开指南"),
			callback: () => void this.openGuide(),
		});
		this.addCommand({
			id: "vault-conventions",
			icon: "scroll-text",
			name: L("This vault's conventions (AGENTS.md)", "这个库的约定（AGENTS.md）"),
			callback: () => void this.openVaultRules(),
		});
	}

	/** Open the vault's AGENTS.md, or set it up when there is none. */
	async openVaultRules() {
		const f = this.app.vault.getAbstractFileByPath(VAULT_RULES);
		if (f instanceof TFile) await this.app.workspace.getLeaf("tab").openFile(f);
		else new RulesModal(this.app, () => undefined).open();
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
		plugin: IcapPlugin,
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

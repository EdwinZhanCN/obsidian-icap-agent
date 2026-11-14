import { App, Modal, Notice, PluginSettingTab, Setting, SettingGroup, setIcon, type DropdownComponent } from "obsidian";
import type IcapPlugin from "../main";
import type { ConfirmMode, ToolScope } from "../agent/backend";
import type { MobileEndpoint } from "../agent/mobile/providers";
import type { Visuals } from "../agent/prompts";
import { RulesModal, VAULT_RULES } from "./rules-modal";
import { L } from "../i18n";

/** The property value create_note writes (before the rename ICPA → ICAP it was "icpa-agent"). */
export const GENERATED_BY = "icap-agent";

export interface IcapSettings {
	/**
	 * Desktop: which Pi runs the tasks. "builtin": the one inside the plugin. "rpc": the learner's own
	 * installed Pi, started per task (agent/desktop/rpc/); always their whole setup, so `toolScope` and
	 * `confirm` do not apply to it.
	 */
	desktopPi: "builtin" | "rpc";
	/** Built-in Pi: what the agent has (agent/permissions.ts). Before 1.4 this was `agentConfig` (main.ts migrates it). */
	toolScope: ToolScope;
	/** Built-in Pi: when the agent stops to ask (agent/permissions.ts). */
	confirm: ConfirmMode;
	/**
	 * "pending": this install ran the learner's whole Pi setup inside Obsidian (`agentConfig: mine`, before
	 * 1.4); which Pi runs it now is decided on the first start on a desktop, where Pi can be looked for
	 * (main.ts, `choosePi`).
	 */
	piChoice: "" | "pending";
	/** Desktop, "rpc": the path to the learner's Pi; empty = found on PATH. */
	piPath: string;
	model: string;
	thinking: string;
	background: string;
	/** How the learner likes to be taught (language, style…); appended to the agent's instructions. */
	preferences: string;
	/** Where new notes go; empty: the agent chooses (prompts.ts, placementRule). The learner's request overrides it. */
	notesFolder: string;
	/** create_note records `generated-by: icap-agent` in the new note's properties. */
	markGenerated: boolean;
	/** Isolated mode: absolute folders outside the vault the agent may read. */
	externalFolders: string[];
	selectionMark: boolean;
	/**
	 * How ICAP's output looks. "icap": madder ink, kept callouts in the agent's voice. "theme": the
	 * theme accent as ink and the theme's own callouts. Replaces `ink` ("accent" read as "theme", main.ts).
	 */
	style: "icap" | "theme";
	veilByDefault: boolean;
	maxConcurrent: number;
	/**
	 * Request blocks resume the Pi session of their last reply while it still matches the block
	 * (SessionCache, agent/backend.ts). Off: every follow-up replays the block's turns to a fresh Pi.
	 */
	rememberContext: boolean;
	/** Interactive visuals (```icap-ui) in replies and agent-created notes. */
	visuals: Visuals;
	/** Read every PDF, EPUB and DOCX in the vault ahead of time, into the plugin's own docs/ folder (documents/store.ts). */
	prepareDocuments: boolean;
	/** One-sentence summaries of every part of a document, written by the model when it is first read. */
	documentSummaries: boolean;
	/** The guide note is created (and opened) once, on first install. */
	guideCreated: boolean;
	/**
	 * ICAP's own visible folder (runtime/task-notes.ts): Activity.base in it, task notes in its `Tasks/`.
	 * Visible because Obsidian does not index hidden folders, so Bases could not list notes kept in one.
	 * Notes are found by `icap-id`, so moving them is fine.
	 */
	homeFolder: string;
	/**
	 * Record tasks as notes (task notes and Activity.base, in homeFolder). Off by default, so nothing
	 * lands in the vault unasked; off, the activity stays in plugin data (the ledger list). A vault that
	 * already has Activity.base from an earlier version counts as on (main.ts).
	 */
	taskNotes: "on" | "off";
	/** Activity.base was generated once; from then on it is the learner's and never rewritten. */
	activityBaseMade: boolean;
	/** Activity.base has the `icap-activity` view: generated with it, or given it once (a base from 1.1). */
	activityViewAdded: boolean;
	/** The activity earlier versions kept in plugin data was turned into task notes (once per vault). */
	taskNotesMigrated: boolean;
	/** Mobile: provider/id of the model; empty = the first provider with a key, its default model. */
	mobileModel: string;
	/**
	 * Mobile: which secret (app.secretStorage, this device only) holds each provider's key, by provider
	 * or endpoint id. Absent = `icap-<provider>` / `icap-endpoint-<slug>`.
	 */
	mobileSecrets: Record<string, string>;
	/** Mobile: custom endpoints (their keys by reference, in secretStorage). */
	mobileEndpoints: MobileEndpoint[];
}

export const DEFAULT_SETTINGS: IcapSettings = {
	desktopPi: "builtin",
	toolScope: "isolated",
	confirm: "ask",
	piChoice: "",
	piPath: "",
	model: "",
	thinking: "low",
	background: "",
	preferences: "",
	notesFolder: "",
	markGenerated: true,
	externalFolders: [],
	selectionMark: true,
	style: "icap",
	veilByDefault: true,
	maxConcurrent: 3,
	rememberContext: true,
	visuals: "auto",
	prepareDocuments: true,
	documentSummaries: false,
	guideCreated: false,
	mobileModel: "",
	mobileSecrets: {},
	mobileEndpoints: [],
	homeFolder: "ICAP",
	taskNotes: "off",
	activityBaseMade: false,
	activityViewAdded: false,
	taskNotesMigrated: false,
};

export class IcapSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: IcapPlugin) {
		super(app, plugin);
	}


	/**
	 * Laid out like Obsidian's own tabs: groups of settings (SettingGroup), the essentials first without a
	 * heading, "Advanced" last; one short sentence per description, examples as placeholders, and a
	 * setting that only applies to one mode shown only in that mode.
	 */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		const backend = this.plugin.backend;
		const caps = backend.capabilities;
		const mobile = backend.platform === "mobile";
		const save = () => this.plugin.saveSettings();
		const group = (heading?: string) => {
			const g = new SettingGroup(containerEl);
			if (heading) g.setHeading(heading);
			return g;
		};
		const add = (g: SettingGroup) => {
			let setting!: Setting;
			g.addSetting((x) => {
				setting = x;
			});
			return setting;
		};
		const area = (setting: Setting, value: string, onChange: (v: string) => void, placeholder: string) =>
			setting.addTextArea((t) => {
				t.setPlaceholder(placeholder).setValue(value).onChange(onChange);
				t.inputEl.rows = 3;
			});
		const folder = (v: string) => v.trim().replace(/^\/+|\/+$/g, "");

		/* ── The agent: which Pi, whose credentials, which model ── */
		const agent = group();
		// The model setting this device uses: Pi's on desktop, its own on mobile (keys differ per device).
		const modelKey = mobile ? "mobileModel" : "model";
		const defaultWord = mobile ? L("Default", "默认") : L("Pi default", "Pi 默认");
		const status = add(agent)
			.setName(mobile ? L("Agent", "Agent") : "Pi")
			.setDesc(L("Checking…", "检查中…"));
		// Desktop: the Pi inside the plugin, or the learner's own install (their extensions run in its process).
		const own = backend.ownInstall;
		let location: Setting | null = null;
		if (!mobile) {
			add(agent)
				.setName(L("Pi to run", "运行哪个 Pi"))
				.setDesc(
					s.desktopPi === "rpc"
						? L("Each task starts your installed Pi as its own process, with your extensions, skills and MCP servers.", "每个任务把你安装的 Pi 作为独立进程启动，带上你的扩展、skills 和 MCP 服务器。")
						: L("Runs inside Obsidian; there is nothing to install.", "在 Obsidian 里运行，不需要安装任何东西。"),
				)
				.addDropdown((d) =>
					d
						.addOption("builtin", L("Built into ICAP", "ICAP 内置的"))
						.addOption("rpc", L("Your own install", "你自己安装的"))
						.setValue(s.desktopPi)
						.onChange((v) => {
							s.desktopPi = v === "rpc" ? "rpc" : "builtin";
							void save();
							this.display();
						}),
				);
			if (own)
				location = add(agent)
					.setName(L("Pi location", "Pi 的位置"))
					.setDesc(L("Looking for Pi…", "正在查找 Pi…"))
					.addText((t) => {
						t.setPlaceholder(L("Found automatically", "自动查找"))
							.setValue(s.piPath)
							.onChange((v) => {
								s.piPath = v.trim();
								void save();
							});
						// Look again once the path is typed, not at every keystroke.
						t.inputEl.addEventListener("blur", () => check());
					});
		}
		/** Where the learner's Pi is; when there is none, why, and the official install command to copy. */
		const showLocation = async () => {
			if (!own || !location) return;
			const row = location;
			try {
				const path = await own.locate();
				row.setDesc(s.piPath ? L("Found.", "已找到。") : L(`Found at ${path}.`, `位于 ${path}。`));
			} catch (e) {
				row.setDesc(
					createFragment((f) => {
						setIcon(f.createSpan({ cls: "icap-inline-icon is-warning" }), "alert-triangle");
						f.appendText((e as Error).message);
						const line = f.createDiv({ cls: "icap-install-command" });
						line.createEl("code", { text: own.installCommand });
						const copy = line.createEl("button", { text: L("Copy", "复制"), cls: "clickable-icon" });
						copy.addEventListener("click", () => {
							void navigator.clipboard.writeText(own.installCommand);
							new Notice(L("Copied. Run it in a terminal, then check again.", "已复制。在终端里运行，然后重新检查。"));
						});
					}),
				);
			}
		};
		const providers = add(agent).setName(L("Model providers", "模型服务商"));
		const providersHelp = mobile
			? L("Add an API key or a custom endpoint below. Keys stay on this device.", "在下方添加 API Key 或自定义端点，Key 只保存在这台设备上。")
			: L("Log in with an account or an API key. Pi keeps the credentials.", "用账号或 API Key 登录，凭证由 Pi 保存。");
		providers.setDesc(providersHelp);
		const accounts = backend.accounts;
		const login = accounts?.login?.bind(accounts);
		const failed = (e: unknown) => new Notice(L("Pi could not load: ", "Pi 无法加载：") + (e as Error).message);
		if (login)
			providers.addButton((b) =>
				b
					.setButtonText(L("Log in…", "登录…"))
					.setCta()
					.onClick(() => login(check).catch(failed)),
			);
		const endpoints = caps.customEndpoints ? accounts?.endpoints?.bind(accounts) : undefined;
		if (endpoints)
			providers.addButton((b) =>
				b
					.setButtonText(L("Custom endpoint…", "自定义端点…"))
					.setTooltip(L("Ollama, LM Studio, vLLM, a proxy, any OpenAI-compatible API", "Ollama、LM Studio、vLLM、中转站、任何兼容 OpenAI 的 API"))
					.onClick(() => endpoints(check).catch(failed)),
			);
		let modelDropdown: DropdownComponent | null = null;
		const fillModels = (current: string | null, available: string[]) => {
			if (!modelDropdown) return;
			const d = modelDropdown;
			const chosen = s[modelKey];
			d.selectEl.empty();
			d.addOption("", current ? `${defaultWord} (${current})` : defaultWord);
			for (const m of available) d.addOption(m, m);
			if (chosen && !available.includes(chosen)) d.addOption(chosen, chosen);
			d.setValue(chosen);
		};
		add(agent)
			.setName(L("Model", "模型"))
			.setDesc(mobile ? L("Used on this device only.", "只用于这台设备。") : L("“Pi default” follows your Pi settings.", "“Pi 默认”跟随你的 Pi 设置。"))
			.addDropdown((d) => {
				modelDropdown = d;
				fillModels(null, []);
				d.onChange((v) => {
					s[modelKey] = v;
					void save();
				});
			});
		add(agent)
			.setName(L("Thinking", "思考强度"))
			.setDesc(L("Higher is slower; explanations rarely need more than low.", "越高越慢，解释通常用 low 就够。"))
			.addDropdown((d) => {
				for (const l of ["off", "minimal", "low", "medium", "high"]) d.addOption(l, l);
				d.setValue(s.thinking).onChange((v) => {
					s.thinking = v;
					void save();
				});
			});
		const check = () => {
			status.setDesc(L("Checking…", "检查中…"));
			void (async () => {
				let version = "";
				try {
					// ↻ looks for the learner's Pi again: they may have just installed or updated it.
					version = await backend.describe(true);
					void showLocation();
					const probe = caps.modelProbe ? backend.probeModels?.bind(backend) : undefined;
					if (!probe) return void status.setDesc(version);
					status.setDesc(version + " · " + L("asking for its models…", "正在询问可用模型…"));
					const m = await probe(this.plugin.runtime.toolScope(), true);
					fillModels(m.current, m.available);
					const ready = accounts ? await accounts.ready() : [];
					providers.setDesc(ready.length ? L(`Ready: ${ready.join(", ")}. `, `已就绪：${ready.join("、")}。`) + providersHelp : providersHelp);
					if (!m.available.length)
						status.setDesc(
							createFragment((f) => {
								f.appendText(version + " · ");
								setIcon(f.createSpan({ cls: "icap-inline-icon is-warning" }), "alert-triangle");
								f.appendText(mobile ? L("no model can run yet: add an API key below.", "还没有可用的模型：在下方添加 API Key。") : L("no model has credentials yet: log in to a provider.", "还没有模型配置了凭证：请登录一个服务商。"));
							}),
						);
					else status.setDesc(version + " · " + L(`${m.available.length} models available`, `共 ${m.available.length} 个可用模型`));
				} catch (e) {
					void showLocation();
					// A Pi that was not found says so once, where the way out is: in the location row.
					const found = own ? await own.locate().then(() => true, () => false) : true;
					status.setDesc(found ? (version ? version + " · " : "") + L("could not load: ", "无法加载：") + (e as Error).message : L("Not ready: see “Pi location” below.", "尚未就绪：见下方“Pi 的位置”。"));
				}
			})();
		};
		status.addExtraButton((b) => b.setIcon("refresh-cw").setTooltip(L("Check again", "重新检查")).onClick(check));
		// Keys and endpoints edited in place (mobile): their own groups, siblings of the others (Obsidian spaces
		// adjacent groups), re-rendered with the whole tab.
		if (accounts?.render) accounts.render(containerEl, () => this.display());

		/* ── About you ── */
		const you = group(L("About you", "关于你"));
		area(
			add(you)
				.setName(L("Your background", "你的背景"))
				.setDesc(L("Explanations build only on what you state here and what is in your notes.", "解释只基于这里写的和笔记里已有的知识。")),
			s.background,
			(v) => {
				s.background = v;
				void save();
			},
			L("Comfortable with Python; new to C++; know basic linear algebra.", "熟悉 Python；刚开始学 C++；会基础线性代数。"),
		);
		area(
			add(you)
				.setName(L("How you like to learn", "你喜欢怎样学"))
				.setDesc(L("Language, style and depth, followed in every task.", "语言、风格和深浅，每次任务都会遵循。")),
			s.preferences,
			(v) => {
				s.preferences = v;
				void save();
			},
			L("Explain in Chinese; keep English terms; prefer small code examples.", "用中文解释，术语保留英文，多用小段代码举例。"),
		);
		const rules = add(you).setName(L("This vault's conventions", "这个库的约定"));
		const showRules = () => {
			rules.controlEl.empty();
			const exists = !!this.app.vault.getAbstractFileByPath(VAULT_RULES);
			rules.setDesc(
				exists
					? L(`The agent reads ${VAULT_RULES} at the vault's root in every task.`, `Agent 每次任务都会读库根目录的 ${VAULT_RULES}。`)
					: L(`What you study here and how your notes are organised, written to ${VAULT_RULES}.`, `你在这里学什么、笔记怎么组织，写进 ${VAULT_RULES}。`),
			);
			if (exists) rules.addButton((b) => b.setButtonText(L("Open", "打开")).onClick(() => void this.plugin.openVaultRules()));
			else
				rules.addButton((b) =>
					b
						.setButtonText(L("Set up…", "设置…"))
						.setCta()
						.onClick(() => new RulesModal(this.app, () => showRules()).open()),
				);
		};
		showRules();

		/* ── In your notes ── */
		const notes = group(L("In your notes", "笔记中"));
		add(notes)
			.setName(L("Selection mark", "选区标记"))
			.setDesc(L("Show “explain · check” beside selected text.", "选中文字时，在旁边显示“解释 · 检查”。"))
			.addToggle((t) =>
				t.setValue(s.selectionMark).onChange((v) => {
					s.selectionMark = v;
					void save();
				}),
			);
		add(notes)
			.setName(L("Veil the note during recall", "回忆时模糊笔记"))
			.setDesc(L("Blur the rest of the note while you answer from memory.", "凭记忆作答时，模糊笔记的其余部分。"))
			.addToggle((t) =>
				t.setValue(s.veilByDefault).onChange((v) => {
					s.veilByDefault = v;
					void save();
				}),
			);
		add(notes)
			.setName(L("ICAP style", "ICAP 样式"))
			.setDesc(L("Madder ink, and kept explanations and feedback in ICAP's look. Off: your theme's accent and callouts.", "茜红笔迹，保留的解释和反馈使用 ICAP 的样式。关闭则跟随主题的强调色和 callout。"))
			.addToggle((t) =>
				t.setValue(s.style === "icap").onChange((v) => {
					s.style = v ? "icap" : "theme";
					this.plugin.applyStyle();
					void save();
				}),
			);
		add(notes)
			.setName(L("Interactive visuals", "交互式图示"))
			.setDesc(L("Charts and exercises to try in replies and new notes, run in a sandbox.", "回复和新笔记里可以动手试的图示，在沙箱中运行。"))
			.addDropdown((d) =>
				d
					.addOption("auto", L("When it helps", "有帮助时"))
					.addOption("asked", L("Only when I ask", "只在我要求时"))
					.addOption("off", L("Never", "不用"))
					.setValue(s.visuals)
					.onChange((v) => {
						s.visuals = v as Visuals;
						void save();
					}),
			);

		/* ── Files ── */
		const files = group(L("Files", "文件"));
		add(files)
			.setName(L("Folder for new notes", "新笔记的位置"))
			.setDesc(L("Empty: the agent chooses, by where related notes are and your vault's AGENTS.md. A folder: new notes go there, unless you ask for another place.", "留空：由 Agent 决定，参考相关笔记所在的位置和库中的 AGENTS.md。填写文件夹：新笔记放在那里，除非你另外指定。"))
			.addText((t) =>
				t
					.setPlaceholder(L("The agent chooses", "由 Agent 决定"))
					.setValue(s.notesFolder)
					.onChange((v) => {
						s.notesFolder = folder(v);
						void save();
					}),
			);
		add(files)
			.setName(L("Mark notes the agent creates", "标记 Agent 新建的笔记"))
			.setDesc(L("Add generated-by: icap-agent to their properties.", "在属性中写入 generated-by: icap-agent。"))
			.addToggle((t) =>
				t.setValue(s.markGenerated).onChange((v) => {
					s.markGenerated = v;
					void save();
				}),
			);
		add(files)
			.setName(L("Record tasks as notes", "把任务记录成笔记"))
			.setDesc(
				L(
					"A request that does more than answer one question gets a note in the ICAP folder, and Activity.base lists these notes. Off: the activity stays in the plugin, and nothing is written to the vault.",
					"不只是一问一答的请求，会在 ICAP 文件夹里得到一篇笔记，Activity.base 列出这些笔记。关闭：活动只留在插件里，不往库里写任何文件。",
				),
			)
			.addToggle((t) =>
				t.setValue(s.taskNotes === "on").onChange((v) => {
					s.taskNotes = v ? "on" : "off";
					void save();
					if (v) void this.plugin.runtime?.startRecording();
					this.display();
				}),
			);
		if (s.taskNotes === "on") add(files)
			.setName(L("ICAP folder", "ICAP 文件夹"))
			.setDesc(L("Holds Activity.base, and task notes in its Tasks folder.", "存放 Activity.base，任务笔记放在其中的 Tasks 文件夹。"))
			.addText((t) =>
				t
					.setPlaceholder("ICAP")
					.setValue(s.homeFolder)
					.onChange((v) => {
						s.homeFolder = folder(v) || "ICAP";
						void save();
					}),
			);

		/* ── Documents ── */
		const docs = group(L("Documents", "资料"));
		add(docs)
			.setName(L("Prepare documents ahead of time", "提前准备资料"))
			.setDesc(L("Index the vault's PDFs, EPUBs and Word files in the background, on this device.", "在后台为库中的 PDF、EPUB 和 Word 文档建立索引，只保存在这台设备上。"))
			.addToggle((t) =>
				t.setValue(s.prepareDocuments).onChange((v) => {
					s.prepareDocuments = v;
					void save();
					if (v) this.plugin.runtime?.prepareDocuments();
				}),
			);
		add(docs)
			.setName(L("Section summaries", "章节摘要"))
			.setDesc(
				L(
					"The model summarises every part once, for about as many input tokens as the document has words.",
					"由模型为每个部分写一次摘要，约消耗与资料字数相当的输入 token。",
				),
			)
			.addToggle((t) =>
				t.setValue(s.documentSummaries).onChange((v) => {
					s.documentSummaries = v;
					void save();
					if (v) this.plugin.runtime?.prepareDocuments();
				}),
			);

		/* ── Advanced ── */
		const advanced = group(L("Advanced", "高级"));
		// The learner's own install is always their whole setup, and acts on its own: neither choice applies to it.
		if (caps.fullScope && caps.isolatedScope)
			add(advanced)
				.setName(L("Tools", "工具范围"))
				.setDesc(
					s.toolScope === "full"
						? L("Also the shell, your connectors (MCP servers) and files outside the vault, with your Pi skills and prompt templates.", "还包括 shell、你的 Connector（MCP 服务器）和库外的文件，并带上你的 Pi skills 和提示模板。")
						: L("ICAP's own tools, and reading and changing files inside the vault. No shell, no connectors.", "ICAP 自己的工具，以及读取和修改库内的文件。没有 shell，没有 Connector。"),
				)
				.addDropdown((d) =>
					d
						.addOption("isolated", L("ICAP and the vault (isolated)", "ICAP 和库内文件（隔离）"))
						.addOption("full", L("Also shell and connectors (full)", "加上 shell 和 Connector（完整）"))
						.setValue(s.toolScope)
						.onChange((v) => {
							const next: ToolScope = v === "full" ? "full" : "isolated";
							const apply = () => {
								s.toolScope = next;
								void save();
								this.display();
							};
							// Everything running unasked is a choice made with the warning in view, whichever setting completes it.
							if (next === "full" && s.confirm === "skip") new UnboundedModal(this.app, apply, () => this.display()).open();
							else apply();
						}),
				);
		if (caps.confirms)
			add(advanced)
				.setName(L("Confirmation", "确认方式"))
				.setDesc(
					createFragment((f) => {
						const full = this.plugin.runtime.toolScope() === "full";
						if (s.confirm === "skip" && full) setIcon(f.createSpan({ cls: "icap-inline-icon is-warning" }), "alert-triangle");
						f.appendText(
							s.confirm === "ask"
								? full
									? L("Every change shows its diff first; every shell command and connector call asks.", "每处改动先出 diff；每条 shell 命令和每次 Connector 调用都会问。")
									: L("Every change shows its diff first and lands when you agree.", "每处改动先出 diff，你同意后才写入。")
								: s.confirm === "auto-edits"
									? full
										? L("Changes inside the vault land at once, their diff kept; shell commands, connector calls and files outside the vault still ask.", "库内的改动直接写入并留下 diff；shell 命令、Connector 调用和库外的文件仍然会问。")
										: L("Changes inside the vault land at once; their diff stays in the block.", "库内的改动直接写入，diff 留在块里。")
									: full
										? L("Nothing asks: shell commands, connector calls and files anywhere on this computer run at once.", "什么都不问：shell 命令、Connector 调用、这台电脑上任何位置的文件，都直接执行。")
										: L("Changes inside the vault land at once; nothing outside it can be written.", "库内的改动直接写入；库外的文件写不了。"),
						);
						f.appendText(" " + L("The original of each changed file is kept for a month. Obsidian's own folder and Pi's always ask.", "每个被改动文件的原文保留一个月。Obsidian 自己的文件夹和 Pi 的文件夹始终要问。"));
					}),
				)
				.addDropdown((d) =>
					d
						.addOption("ask", L("Ask for each", "逐项确认"))
						.addOption("auto-edits", L("Accept edits in the vault", "自动接受编辑"))
						.addOption("skip", L("Skip all confirmations", "跳过全部确认"))
						.setValue(s.confirm)
						.onChange((v) => {
							const next: ConfirmMode = v === "skip" ? "skip" : v === "auto-edits" ? "auto-edits" : "ask";
							const apply = () => {
								s.confirm = next;
								void save();
								this.display();
							};
							if (next === "skip" && this.plugin.runtime.toolScope() === "full") new UnboundedModal(this.app, apply, () => this.display()).open();
							else apply();
						}),
				);
		// With the full scope, or the learner's own Pi, the agent's own permissions apply instead.
		if (caps.externalFiles && this.plugin.runtime.toolScope() === "isolated")
			area(
				add(advanced)
					.setName(L("Folders outside the vault", "库外的文件夹"))
					.setDesc(L("Absolute paths the agent may also read, one per line.", "Agent 还可以读取的绝对路径，每行一个。")),
				s.externalFolders.join("\n"),
				(v) => {
					s.externalFolders = v
						.split("\n")
						.map((l) => l.trim())
						.filter((l) => l.startsWith("/") || /^[A-Za-z]:[\\/]/.test(l) || l.startsWith("~"));
					void save();
				},
				"/Users/me/Books",
			);
		if (caps.sessionCache)
			add(advanced)
				.setName(L("Remember a request's context", "记住请求的上下文"))
				.setDesc(L("Follow-ups continue the agent's session instead of starting over from the block.", "追问时继续 Agent 的会话，而不是从块中的文字重新开始。"))
				.addToggle((t) =>
					t.setValue(s.rememberContext).onChange((v) => {
						s.rememberContext = v;
						void save();
					}),
				);
		add(advanced)
			.setName(L("Parallel tasks", "并行任务"))
			.setDesc(L("How many tasks may run at once.", "最多同时运行的任务数。"))
			.addSlider((sl) =>
				sl
					.setLimits(1, 6, 1)
					.setValue(s.maxConcurrent)
					.setDynamicTooltip()
					.onChange((v) => {
						s.maxConcurrent = v;
						void save();
					}),
			);
		check();
	}
}

/**
 * Turning on "full tools" together with "skip all confirmations": the one combination with no boundary
 * and no question. It is the learner's to turn on, with what it means in front of them.
 */
class UnboundedModal extends Modal {
	private agreed = false;
	constructor(
		app: App,
		private agree: () => void,
		private cancel: () => void,
	) {
		super(app);
	}
	onOpen() {
		this.setTitle(L("Let the agent act without asking?", "让 Agent 不经询问直接行动？"));
		this.contentEl.createEl("p", {
			text: L(
				"With the full tools and no confirmations, everything the agent decides to do runs at once: shell commands, calls to your connectors, and changes to files anywhere on this computer. A note it reads can influence what it does.",
				"在完整工具范围下跳过全部确认后，Agent 决定做的每件事都会直接执行：shell 命令、对你的 Connector 的调用，以及对这台电脑上任何位置文件的修改。它读到的笔记内容可能影响它的行为。",
			),
		});
		this.contentEl.createEl("p", {
			text: L(
				"Two things still hold: a write to Obsidian's own folder or Pi's always asks, and the original of each file the agent's file tools change is kept for a month. What a shell command changes is not kept.",
				"仍然有两条不变：写入 Obsidian 自己的文件夹或 Pi 的文件夹始终要问；Agent 的文件工具改动的每个文件，原文保留一个月。shell 命令改动的内容不会保留。",
			),
		});
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText(L("Cancel", "取消")).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(L("Turn on", "开启"))
					.setWarning()
					.onClick(() => {
						this.agreed = true;
						this.close();
					}),
			);
	}
	onClose() {
		this.contentEl.empty();
		if (this.agreed) this.agree();
		else this.cancel();
	}
}

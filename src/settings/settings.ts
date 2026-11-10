import { App, Notice, PluginSettingTab, Setting, type DropdownComponent } from "obsidian";
import type IcapPlugin from "../main";
import type { AgentConfig } from "../agent/backend";
import type { MobileEndpoint } from "../agent/mobile/providers";
import type { Visuals } from "../agent/prompts";
import { RulesModal, VAULT_RULES } from "./rules-modal";
import { L } from "../i18n";

/** The property value create_note writes (before the rename ICPA → ICAP it was "icpa-agent"). */
export const GENERATED_BY = "icap-agent";

export interface IcapSettings {
	agentConfig: AgentConfig;
	model: string;
	thinking: string;
	background: string;
	/** How the learner likes to be taught (language, style…); appended to the agent's instructions. */
	preferences: string;
	notesFolder: string;
	/** create_note records `generated-by: icap-agent` in the new note's properties. */
	markGenerated: boolean;
	/** Isolated mode: absolute folders outside the vault the agent may read. */
	externalFolders: string[];
	selectionMark: boolean;
	ink: "madder" | "accent";
	veilByDefault: boolean;
	maxConcurrent: number;
	/**
	 * Request blocks resume the Pi session of their last reply while it still matches the block
	 * (SessionCache, agent/backend.ts). Off: every follow-up replays the block's turns to a fresh Pi.
	 */
	rememberContext: boolean;
	/** Interactive visuals (```icap-ui) in replies and agent-created notes. */
	visuals: Visuals;
	/** Read every PDF, EPUB and DOCX in the vault ahead of time, into .icap/docs/ (docs/store.ts). */
	prepareDocuments: boolean;
	/** One-sentence summaries of every part of a document, written by the model when it is first read. */
	documentSummaries: boolean;
	/** The guide note is created (and opened) once, on first install. */
	guideCreated: boolean;
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
	agentConfig: "mine",
	model: "",
	thinking: "low",
	background: "",
	preferences: "",
	notesFolder: "",
	markGenerated: true,
	externalFolders: [],
	selectionMark: true,
	ink: "madder",
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
};

export class IcapSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: IcapPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		const backend = this.plugin.backend;
		const caps = backend.capabilities;
		const save = () => this.plugin.saveSettings();
		const area = (setting: Setting, value: string, rows: number, onChange: (v: string) => void, placeholder = "") =>
			setting.addTextArea((t) => {
				t.setPlaceholder(placeholder).setValue(value).onChange(onChange);
				t.inputEl.rows = rows;
				t.inputEl.setCssStyles({ width: "100%" });
			});

		/* ── What you already know ── */
		new Setting(containerEl).setName(L("What you already know", "你已经知道的")).setHeading();
		area(
			new Setting(containerEl)
				.setName(L("Your background", "你的背景"))
				.setDesc(
					L(
						"Explanations only build on knowledge you state here or that exists in your notes. Nothing is assumed. Example: “Comfortable with Python; new to C++; know basic linear algebra.”",
						"解释只会建立在你在这里写下的、或笔记里已有的知识之上，不做任何假设。例如：“熟悉 Python；刚开始学 C++；会基础线性代数。”",
					),
				),
			s.background,
			4,
			(v) => {
				s.background = v;
				void save();
			},
		);
		area(
			new Setting(containerEl)
				.setName(L("How you like to learn", "你喜欢怎样学"))
				.setDesc(
					L(
						"Language, style, depth — the agent follows this in every explanation and request. Example: “Explain in Chinese; keep English terms; prefer small code examples.”",
						"语言、风格、深浅——Agent 在每次解释和请求中都会遵循。例如：“用中文解释，术语保留英文，多用小段代码举例。”",
					),
				),
			s.preferences,
			3,
			(v) => {
				s.preferences = v;
				void save();
			},
		);

		/* ── In the document ── */
		new Setting(containerEl).setName(L("In the document", "文档中")).setHeading();
		new Setting(containerEl)
			.setName(L("Selection mark", "选区标记"))
			.setDesc(L("After you select text, show a small “explain · check” mark beside it.", "选中文字后，在旁边显示一个小小的“解释 · 检查”标记。"))
			.addToggle((t) =>
				t.setValue(s.selectionMark).onChange((v) => {
					s.selectionMark = v;
					void save();
				}),
			);
		new Setting(containerEl)
			.setName(L("Veil the note during recall", "回忆时模糊笔记"))
			.setDesc(L("Softly blur the rest of the note while you write from memory. You can always lift it.", "凭记忆书写时，轻轻模糊笔记的其余部分。随时可以取消。"))
			.addToggle((t) =>
				t.setValue(s.veilByDefault).onChange((v) => {
					s.veilByDefault = v;
					void save();
				}),
			);
		new Setting(containerEl)
			.setName(L("Ink", "墨色"))
			.setDesc(L("The colour of the agent's marks in your notes.", "Agent 在笔记中留下的标记的颜色。"))
			.addDropdown((d) =>
				d
					.addOption("madder", L("Madder — a tutor's pencil", "茜红——导师的铅笔"))
					.addOption("accent", L("Theme accent", "主题强调色"))
					.setValue(s.ink)
					.onChange((v) => {
						s.ink = v as IcapSettings["ink"];
						this.plugin.applyInk();
						void save();
					}),
			);
		new Setting(containerEl)
			.setName(L("Folder for new notes", "新笔记的位置"))
			.setDesc(L("Where agent-created notes go. Empty = next to the note you are studying.", "Agent 新建的笔记放在哪里。留空 = 与正在学习的笔记放在一起。"))
			.addText((t) =>
				t
					.setPlaceholder("Learning/Concepts")
					.setValue(s.notesFolder)
					.onChange((v) => {
						s.notesFolder = v.trim().replace(/^\/+|\/+$/g, "");
						void save();
					}),
			);
		new Setting(containerEl)
			.setName(L("Mark notes the agent creates", "标记 Agent 新建的笔记"))
			.setDesc(
				L(
					"Notes created through ICAP get `generated-by: icap-agent` in their properties, so later explanations don't mistake them for what you wrote yourself.",
					"通过 ICAP 新建的笔记会在属性中记录 `generated-by: icap-agent`，以后的解释就不会把它们当成你自己写的内容。",
				),
			)
			.addToggle((t) =>
				t.setValue(s.markGenerated).onChange((v) => {
					s.markGenerated = v;
					void save();
				}),
			);
		new Setting(containerEl)
			.setName(L("Interactive visuals", "交互式图示"))
			.setDesc(
				L(
					"The agent may put something you can try out — a chart with a slider, a process to step through, a quick check — into its replies and the notes it creates. It runs in a sandbox: no internet, no access to your notes or your computer.",
					"Agent 可以在回复和它新建的笔记里放一个可以动手试的图示：带滑块的图表、可以一步步走的过程、一个小练习。它在沙箱里运行：不能联网，也碰不到你的笔记和电脑。",
				),
			)
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

		/* ── Documents ── */
		new Setting(containerEl).setName(L("Documents", "资料")).setHeading();
		new Setting(containerEl)
			.setName(L("Prepare documents ahead of time", "提前准备资料"))
			.setDesc(
				L(
					"Read the PDFs, EPUBs and Word documents in this vault in the background — their structure and text — so the agent can find its way through many of them quickly. Kept in the hidden .icap folder of this vault, on this device; nothing is sent anywhere. Off: a document is prepared the first time the agent reads it.",
					"在后台读取这个库里的 PDF、EPUB 和 Word 文档——它们的结构和文字——让 Agent 在大量资料里也能快速找到要读的部分。存放在这个库的隐藏文件夹 .icap 里，只在这台设备上，不会发送到任何地方。关闭后，资料在 Agent 第一次读它时才准备。",
				),
			)
			.addToggle((t) =>
				t.setValue(s.prepareDocuments).onChange((v) => {
					s.prepareDocuments = v;
					void save();
					if (v) this.plugin.runtime?.prepareDocuments();
				}),
			);
		new Setting(containerEl)
			.setName(L("Summaries of every part", "为每个部分写摘要"))
			.setDesc(
				L(
					"When a document is prepared, the model writes one sentence for every chapter and section, and a few for the whole document. The agent then sees what each part covers before reading it, which helps most across many books. It uses your model: roughly as many input tokens as the document has words, once per document (a 300-page book is on the order of 150,000), kept and never repeated while the file stays the same.",
					"准备资料时，由模型为每一章、每一节写一句摘要，再为整份资料写几句。Agent 在读之前就能看到每部分讲什么，资料越多越有用。会使用你的模型：每份资料大约消耗与它字数相当的输入 token（一本 300 页的书约 15 万），只写一次并保存，文件不变就不会重复。",
				),
			)
			.addToggle((t) =>
				t.setValue(s.documentSummaries).onChange((v) => {
					s.documentSummaries = v;
					void save();
					if (v) this.plugin.runtime?.prepareDocuments();
				}),
			);

		/* ── Agent ── */
		new Setting(containerEl).setName(L("Agent", "Agent")).setHeading();
		const mobile = backend.platform === "mobile";
		// The model setting this device uses: Pi's on desktop, its own on mobile (keys differ per device).
		const modelKey = mobile ? "mobileModel" : "model";
		const defaultWord = mobile ? L("Default", "默认") : L("Pi default", "Pi 默认");
		const status = new Setting(containerEl).setName(mobile ? L("Agent", "Agent") : "Pi").setDesc(L("Checking…", "检查中…"));
		const providers = new Setting(containerEl).setName(L("Model providers", "模型服务商"));
		const providersHelp = mobile
			? L(
					"An API key per provider, or a custom endpoint. Keys are kept in Obsidian's keychain on this device only: never in your vault, never synced. Account logins (subscriptions) are desktop only.",
					"每个服务商一个 API Key，或一个自定义端点。Key 保存在这台设备的 Obsidian 钥匙串里：不进入库，也不会同步。账号登录（订阅）只在桌面版可用。",
				)
			: L(
					"Log in with an account or an API key. Credentials are Pi's own (~/.pi/agent/auth.json, or a key exported in your shell profile); ICAP never stores them.",
					"用账号或 API Key 登录。凭证属于 Pi（~/.pi/agent/auth.json，或 shell 配置文件中导出的密钥），ICAP 从不保存。",
				);
		providers.setDesc(providersHelp);
		const accounts = backend.accounts;
		const login = accounts?.login?.bind(accounts);
		if (login)
			providers.addButton((b) =>
				b
					.setButtonText(L("Log in…", "登录…"))
					.setCta()
					.onClick(async () => {
						try {
							await login(check);
						} catch (e) {
							new Notice(L("Pi could not load: ", "Pi 无法加载：") + (e as Error).message);
						}
					}),
			);
		const endpoints = caps.customEndpoints ? accounts?.endpoints?.bind(accounts) : undefined;
		if (endpoints)
			providers.addButton((b) =>
				b.setButtonText(L("Custom endpoint…", "自定义端点…")).setTooltip(L("Ollama, LM Studio, vLLM, a proxy, any OpenAI-compatible API", "Ollama、LM Studio、vLLM、中转站、任何兼容 OpenAI 的 API")).onClick(async () => {
					try {
						await endpoints(check);
					} catch (e) {
						new Notice(L("Pi could not load: ", "Pi 无法加载：") + (e as Error).message);
					}
				}),
			);
		// Keys and endpoints edited in place (mobile).
		if (accounts?.render) accounts.render(containerEl.createDiv(), () => this.display());
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
		const check = () => {
			status.setDesc(L("Checking…", "检查中…"));
			void (async () => {
				let version = "";
				try {
					version = await backend.describe();
					const probe = caps.modelProbe ? backend.probeModels?.bind(backend) : undefined;
					if (!probe) return void status.setDesc(version);
					status.setDesc(version + " · " + L("asking for its models…", "正在询问可用模型…"));
					const m = await probe(this.plugin.runtime.agentConfig(), true);
					fillModels(m.current, m.available);
					const ready = accounts ? await accounts.ready() : [];
					providers.setDesc(ready.length ? L(`Ready: ${ready.join(", ")}. `, `已就绪：${ready.join("、")}。`) + providersHelp : providersHelp);
					if (!m.available.length)
						status.setDesc(
							version +
								" · " +
								(mobile
									? L("⚠ no model can run yet — add an API key below.", "⚠ 还没有可用的模型——在下面添加一个 API Key。")
									: L("⚠ no model has credentials yet — log in to a provider below.", "⚠ 还没有任何模型配置了凭证——在下面登录一个服务商。")),
						);
					else status.setDesc(version + " · " + L(`uses ${s[modelKey] || m.current} · ${m.available.length} models available`, `使用 ${s[modelKey] || m.current} · 共 ${m.available.length} 个可用模型`));
				} catch (e) {
					status.setDesc((version ? version + " · " : "") + L("could not load: ", "无法加载：") + (e as Error).message);
				}
			})();
		};
		status.addExtraButton((b) => b.setIcon("refresh-cw").setTooltip(L("Check again", "重新检查")).onClick(check));
		new Setting(containerEl)
			.setName(L("Model", "模型"))
			.setDesc(
				mobile
					? L("Models of the providers with a key on this device. This choice is for mobile; the desktop keeps its own.", "这台设备上有 Key 的服务商的模型。这个选择只用于手机，桌面版保留自己的选择。")
					: L("Models that have credentials in your Pi. “Pi default” follows your Pi settings.", "你的 Pi 中已有凭证的模型。“Pi 默认”跟随你的 Pi 设置。"),
			)
			.addDropdown((d) => {
				modelDropdown = d;
				fillModels(null, []);
				d.onChange((v) => {
					s[modelKey] = v;
					void save();
				});
			});
		new Setting(containerEl)
			.setName(L("Thinking", "思考强度"))
			.setDesc(L("Lower is faster. Explanations rarely need more than “low”.", "越低越快。解释很少需要超过“low”。"))
			.addDropdown((d) => {
				for (const l of ["off", "minimal", "low", "medium", "high"]) d.addOption(l, l);
				d.setValue(s.thinking).onChange((v) => {
					s.thinking = v;
					void save();
				});
			});
		if (caps.ownSetup)
			new Setting(containerEl)
				.setName(L("Agent setup", "Agent 配置"))
				.setDesc(
					L(
						"Your Pi setup: the agent runs with your own skills, extensions, MCP servers, AGENTS.md and tools (including shell), plus ICAP's note tools — it may change files directly; every change is listed in the activity. ICAP only: just ICAP's tools and this vault's conventions, read-only, no shell — predictable, but your own setup is not used.",
						"你的 Pi 配置：Agent 带着你自己的 skills、扩展、MCP、AGENTS.md 和工具（包括 shell）运行，再加上 ICAP 的笔记工具——它可以直接修改文件，每处修改都会列在活动中。仅 ICAP：只有 ICAP 的工具和这个库的约定，只读、没有 shell——行为可预期，但不使用你自己的配置。",
					),
				)
				.addDropdown((d) =>
					d
						.addOption("mine", L("Your Pi setup + ICAP", "你的 Pi 配置 + ICAP"))
						.addOption("isolated", L("ICAP only (isolated)", "仅 ICAP（隔离）"))
						.setValue(s.agentConfig)
						.onChange((v) => {
							s.agentConfig = v as AgentConfig;
							void save();
							check();
						}),
				);
		const rules = new Setting(containerEl).setName(L("This vault's conventions", "这个库的约定"));
		const showRules = () => {
			rules.controlEl.empty();
			const exists = !!this.app.vault.getAbstractFileByPath(VAULT_RULES);
			rules.setDesc(
				exists
					? L(
							`What the agent should know about this vault — what you study here, how notes are organised, what it must leave alone — is in ${VAULT_RULES} at the vault's root. The agent reads it in every task; edit it like any note.`,
							`Agent 需要知道的这个库的情况——你在这里学什么、笔记怎么组织、哪些地方不要动——写在库根目录的 ${VAULT_RULES} 里。Agent 每次任务都会读它，你可以像普通笔记一样修改。`,
						)
					: L(
							`Tell the agent what you study here, how your notes are organised and what it must leave alone. A few questions, a ready-made starting point for your kind of study, and a note (${VAULT_RULES}) the agent reads in every task.`,
							`告诉 Agent 你在这里学什么、笔记怎么组织、哪些地方不要动。回答几个问题，选一个适合你的学习方式的起点，就会生成一篇笔记（${VAULT_RULES}），Agent 每次任务都会读它。`,
						),
			);
			if (exists)
				rules.addButton((b) => b.setButtonText(L("Open", "打开")).onClick(() => void this.plugin.openVaultRules()));
			else
				rules.addButton((b) =>
					b
						.setButtonText(L("Set up…", "设置…"))
						.setCta()
						.onClick(() => new RulesModal(this.app, () => showRules()).open()),
				);
		};
		showRules();
		if (caps.externalFiles)
			area(
				new Setting(containerEl)
					.setName(L("Folders outside the vault", "Vault 之外的文件夹"))
					.setDesc(
						L(
							"ICAP only (isolated): absolute paths of folders the agent may also read, one per line. With your Pi setup, your Pi's own permissions apply.",
							"仅 ICAP（隔离）模式：Agent 还可以读取的文件夹的绝对路径，每行一个。使用你的 Pi 配置时，按你的 Pi 自身的权限。",
						),
					),
				s.externalFolders.join("\n"),
				2,
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
			new Setting(containerEl)
				.setName(L("Remember a request's context", "记住请求的上下文"))
				.setDesc(
					L(
						"A follow-up in a request block continues the agent's own session — what it already read and did — as long as it still matches what the block shows. Off: each follow-up starts a fresh agent from the block's text. Either way the note is the record; sessions are deleted when the block is kept or cleared.",
						"在请求块里追问时，继续 Agent 自己的会话（它已经读过、做过的内容），前提是会话仍与块中显示的内容一致。关闭后，每次追问都由新的 Agent 从块中的文字重新开始。两种方式下笔记都是记录本身；块被保留或清除时会话会被删除。",
					),
				)
				.addToggle((t) =>
					t.setValue(s.rememberContext).onChange((v) => {
						s.rememberContext = v;
						void save();
					}),
				);
		new Setting(containerEl)
			.setName(L("Parallel tasks", "并行任务"))
			.setDesc(L("How many agent tasks may run at once.", "最多同时运行几个 Agent 任务。"))
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

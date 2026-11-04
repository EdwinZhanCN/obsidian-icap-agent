import { App, PluginSettingTab, Setting, type DropdownComponent } from "obsidian";
import type IcpaPlugin from "./main";
import { probeModels, resetPiEnvironment, resolvePiEnvironment } from "./agent/pi-env";
import type { AgentConfig } from "./agent/pi-session";
import { L } from "./i18n";

export interface IcpaSettings {
	piPath: string;
	agentConfig: AgentConfig;
	model: string;
	thinking: string;
	background: string;
	/** How the learner likes to be taught (language, style…); appended to the agent's instructions. */
	preferences: string;
	notesFolder: string;
	/** create_note records `generated-by: icpa-agent` in the new note's properties. */
	markGenerated: boolean;
	/** Isolated mode: absolute folders outside the vault the agent may read. */
	externalFolders: string[];
	selectionMark: boolean;
	ink: "madder" | "accent";
	veilByDefault: boolean;
	maxConcurrent: number;
	/** The guide note is created (and opened) once, on first install. */
	guideCreated: boolean;
}

export const DEFAULT_SETTINGS: IcpaSettings = {
	piPath: "",
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
	guideCreated: false,
};

export class IcpaSettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: IcpaPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		const save = () => this.plugin.saveSettings();
		const area = (setting: Setting, value: string, rows: number, onChange: (v: string) => void, placeholder = "") =>
			setting.addTextArea((t) => {
				t.setPlaceholder(placeholder).setValue(value).onChange(onChange);
				t.inputEl.rows = rows;
				t.inputEl.style.width = "100%";
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
						s.ink = v as IcpaSettings["ink"];
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
					"Notes created through ICPA get `generated-by: icpa-agent` in their properties, so later explanations don't mistake them for what you wrote yourself.",
					"通过 ICPA 新建的笔记会在属性中记录 `generated-by: icpa-agent`，以后的解释就不会把它们当成你自己写的内容。",
				),
			)
			.addToggle((t) =>
				t.setValue(s.markGenerated).onChange((v) => {
					s.markGenerated = v;
					void save();
				}),
			);

		/* ── Agent ── */
		new Setting(containerEl).setName(L("Agent", "Agent")).setHeading();
		const status = new Setting(containerEl).setName("Pi").setDesc(L("Checking…", "检查中…"));
		new Setting(containerEl)
			.setName(L("Providers and API keys", "服务商与 API Key"))
			.setDesc(
				L(
					"Managed by Pi, not by ICPA: run `pi` in a terminal and use `/login` (saved in ~/.pi/agent/auth.json), or export the provider's key (e.g. ANTHROPIC_API_KEY) in your shell profile. ICPA never stores keys.",
					"由 Pi 管理，而不是 ICPA：在终端运行 `pi` 并使用 `/login`（保存在 ~/.pi/agent/auth.json），或在 shell 配置文件里导出服务商的密钥（如 ANTHROPIC_API_KEY）。ICPA 从不保存密钥。",
				),
			);
		let modelDropdown: DropdownComponent | null = null;
		const fillModels = (current: string | null, available: string[]) => {
			if (!modelDropdown) return;
			const d = modelDropdown;
			d.selectEl.empty();
			d.addOption("", current ? L(`Pi default (${current})`, `Pi 默认（${current}）`) : L("Pi default", "Pi 默认"));
			for (const m of available) d.addOption(m, m);
			if (s.model && !available.includes(s.model)) d.addOption(s.model, s.model);
			d.setValue(s.model);
		};
		const check = () => {
			resetPiEnvironment();
			status.setDesc(L("Checking…", "检查中…"));
			resolvePiEnvironment(s.piPath)
				.then(async (env) => {
					const found = L(`Found ${env.command}`, `已找到 ${env.command}`) + (env.version ? ` · ${env.version}` : "");
					status.setDesc(found + " · " + L("asking for its models…", "正在询问可用模型…"));
					try {
						const m = await probeModels(env, s.agentConfig === "isolated", this.plugin.vaultPath());
						fillModels(m.current, m.available);
						if (!m.available.length)
							status.setDesc(
								found +
									" · " +
									L(
										"⚠ no model has credentials yet. In a terminal run `pi`, then `/login` — or export your provider's API key in your shell profile and click ↻.",
										"⚠ 还没有任何模型配置了凭证。请在终端运行 `pi` 后执行 `/login`，或在 shell 配置文件中导出服务商的 API Key，然后点 ↻。",
									),
							);
						else
							status.setDesc(
								found +
									" · " +
									L(`uses ${s.model || m.current} · ${m.available.length} models available`, `使用 ${s.model || m.current} · 共 ${m.available.length} 个可用模型`),
							);
					} catch (e) {
						status.setDesc(found + " · " + L("could not list its models: ", "无法列出模型：") + (e as Error).message);
					}
				})
				.catch((e) => status.setDesc(String((e as Error).message)));
		};
		status.addExtraButton((b) => b.setIcon("refresh-cw").setTooltip(L("Check again", "重新检查")).onClick(check));
		new Setting(containerEl)
			.setName(L("Pi executable", "Pi 可执行文件"))
			.setDesc(L("Leave empty to find `pi` on your login shell PATH.", "留空则在登录 shell 的 PATH 中查找 `pi`。"))
			.addText((t) =>
				t
					.setPlaceholder("/usr/local/bin/pi")
					.setValue(s.piPath)
					.onChange((v) => {
						s.piPath = v.trim();
						resetPiEnvironment();
						void save();
					}),
			);
		new Setting(containerEl)
			.setName(L("Model", "模型"))
			.setDesc(L("Models that have credentials in your Pi. “Pi default” follows your Pi settings.", "你的 Pi 中已有凭证的模型。“Pi 默认”跟随你的 Pi 设置。"))
			.addDropdown((d) => {
				modelDropdown = d;
				fillModels(null, []);
				d.onChange((v) => {
					s.model = v;
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
		new Setting(containerEl)
			.setName(L("Agent setup", "Agent 配置"))
			.setDesc(
				L(
					"Your Pi setup: the agent runs with your own skills, extensions, MCP servers, AGENTS.md and tools (including shell), plus ICPA's note tools — it may change files directly; every change is listed in the activity. ICPA only: just ICPA's tools, read-only, no shell — predictable, but your own setup is not used.",
					"你的 Pi 配置：Agent 带着你自己的 skills、扩展、MCP、AGENTS.md 和工具（包括 shell）运行，再加上 ICPA 的笔记工具——它可以直接修改文件，每处修改都会列在活动中。仅 ICPA：只有 ICPA 的工具，只读、没有 shell——行为可预期，但不使用你自己的配置。",
				),
			)
			.addDropdown((d) =>
				d
					.addOption("mine", L("Your Pi setup + ICPA", "你的 Pi 配置 + ICPA"))
					.addOption("isolated", L("ICPA only (isolated)", "仅 ICPA（隔离）"))
					.setValue(s.agentConfig)
					.onChange((v) => {
						s.agentConfig = v as AgentConfig;
						void save();
						check();
					}),
			);
		area(
			new Setting(containerEl)
				.setName(L("Folders outside the vault", "Vault 之外的文件夹"))
				.setDesc(
					L(
						"ICPA only (isolated): absolute paths of folders the agent may also read, one per line. With your Pi setup, your Pi's own permissions apply.",
						"仅 ICPA（隔离）模式：Agent 还可以读取的文件夹的绝对路径，每行一个。使用你的 Pi 配置时，按你的 Pi 自身的权限。",
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

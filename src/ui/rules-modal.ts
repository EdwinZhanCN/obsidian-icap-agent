import { App, ButtonComponent, DropdownComponent, Modal, Notice, Setting, TextAreaComponent, TFile, TFolder } from "obsidian";
import { L, isZh } from "../i18n";
import { VAULT_RULES, renderRules, rulesPresets, type RulesAnswers } from "../guide/vault-rules";

export { VAULT_RULES };

/**
 * Set up the vault's AGENTS.md without knowing what that is: choose a kind of study, answer two or
 * three questions, look at (and edit) the result, create it. It never overwrites an existing file.
 */
export class RulesModal extends Modal {
	private answers: RulesAnswers = { preset: "course", subject: "", sources: "", protect: "" };

	constructor(
		app: App,
		/** The file was created. */
		private onDone: () => void,
	) {
		super(app);
	}

	onOpen() {
		this.modalEl.addClass("icap-rules");
		this.showPresets();
	}

	onClose() {
		this.contentEl.empty();
	}

	private showPresets() {
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle(L("This vault's conventions", "这个库的约定"));
		contentEl.createEl("p", {
			cls: "setting-item-description",
			text: L(
				`Tell the agent what you study here and how you like your notes. The answers become a note, ${VAULT_RULES}, at the vault's root: the agent reads it before every task, and you can change it any time. First, what kind of study is this vault for?`,
				`告诉 Agent 你在这里学什么、笔记想怎么组织。你的回答会变成库根目录的一篇笔记 ${VAULT_RULES}：Agent 每次任务前都会读它，你随时可以修改。先选一下，这个库主要用来：`,
			),
		});
		const grid = contentEl.createDiv({ cls: "icap-rules-presets" });
		for (const p of rulesPresets(isZh())) {
			const b = grid.createEl("button", { cls: "icap-rules-preset" });
			b.createDiv({ cls: "icap-rules-preset-name", text: p.name });
			b.createDiv({ cls: "icap-rules-preset-hint", text: p.hint });
			b.addEventListener("click", () => {
				if (this.answers.preset !== p.id) this.answers.subject = "";
				this.answers.preset = p.id;
				this.showQuestions();
			});
		}
	}

	private folders(): string[] {
		return this.app.vault
			.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder && !f.isRoot() && !f.path.split("/").some((s) => s.startsWith(".")))
			.map((f) => f.path)
			.sort((a, b) => a.localeCompare(b));
	}

	private folderSetting(name: string, desc: string, value: string, set: (v: string) => void) {
		new Setting(this.contentEl)
			.setName(name)
			.setDesc(desc)
			.addDropdown((d: DropdownComponent) => {
				d.addOption("", L("— none —", "——没有——"));
				for (const f of this.folders()) d.addOption(f, f);
				d.setValue(value).onChange(set);
			});
	}

	private showQuestions() {
		const { contentEl } = this;
		contentEl.empty();
		const preset = rulesPresets(isZh()).find((p) => p.id === this.answers.preset)!;
		this.setTitle(L(`This vault's conventions · ${preset.name}`, `这个库的约定 · ${preset.name}`));
		const subject = new Setting(contentEl)
			.setName(L("What do you study here?", "你在这里学什么？"))
			.setDesc(L("One or two sentences; the agent takes it as the vault's subject.", "一两句话就好，Agent 会把它当作这个库的主题。"));
		subject.addTextArea((t: TextAreaComponent) => {
			t.setPlaceholder(preset.id === "blank" ? preset.example : L("For example: ", "例如：") + preset.example)
				.setValue(this.answers.subject)
				.onChange((v) => (this.answers.subject = v));
			t.inputEl.rows = 2;
			t.inputEl.addClass("icap-rules-subject");
			window.setTimeout(() => t.inputEl.focus(), 0);
		});
		this.folderSetting(
			L("Where is your study material?", "学习资料放在哪？"),
			L("Books, slides, papers… The agent bases its answers on them first.", "书、讲义、论文……Agent 回答时会优先依据这些资料。"),
			this.answers.sources,
			(v) => (this.answers.sources = v),
		);
		this.folderSetting(
			L("A folder the agent must not change?", "有没有 Agent 不能改动的文件夹？"),
			L("For example your own lecture notes. It may still read them.", "比如你自己的课堂笔记。它仍然可以读。"),
			this.answers.protect,
			(v) => (this.answers.protect = v),
		);
		new Setting(contentEl)
			.addButton((b) => b.setButtonText(L("Back", "返回")).onClick(() => this.showPresets()))
			.addButton((b) =>
				b
					.setButtonText(L("Preview", "预览"))
					.setCta()
					.onClick(() => this.showPreview()),
			);
	}

	private showPreview() {
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle(L(`Preview · ${VAULT_RULES}`, `预览 · ${VAULT_RULES}`));
		contentEl.createEl("p", {
			cls: "setting-item-description",
			text: L(
				"This is what the agent will read. Change anything you like — now, or later in the note itself.",
				"这就是 Agent 会读到的内容。哪里不合适就直接改——现在改，或者以后在笔记里改都行。",
			),
		});
		const text = new TextAreaComponent(contentEl).setValue(renderRules(isZh(), this.answers));
		text.inputEl.addClass("icap-rules-preview");
		text.inputEl.rows = 18;
		const footer = new Setting(contentEl);
		footer.addButton((b) => b.setButtonText(L("Back", "返回")).onClick(() => this.showQuestions()));
		footer.addButton((b: ButtonComponent) =>
			b
				.setButtonText(L(`Create ${VAULT_RULES}`, `创建 ${VAULT_RULES}`))
				.setCta()
				.onClick(() => void this.create(text.getValue())),
		);
	}

	private async create(content: string) {
		const existing = this.app.vault.getAbstractFileByPath(VAULT_RULES);
		if (existing instanceof TFile) {
			new Notice(L(`${VAULT_RULES} already exists; it was left as it is.`, `${VAULT_RULES} 已经存在，没有改动它。`));
		} else {
			try {
				await this.app.vault.create(VAULT_RULES, content.trimEnd() + "\n");
				new Notice(L(`Created ${VAULT_RULES}. The agent reads it from the next task on.`, `已创建 ${VAULT_RULES}，从下一个任务起 Agent 就会读它。`));
			} catch (e) {
				new Notice(L("Could not create it: ", "无法创建：") + (e as Error).message);
				return;
			}
		}
		this.onDone();
		this.close();
		const file = this.app.vault.getAbstractFileByPath(VAULT_RULES);
		if (file instanceof TFile) await this.app.workspace.getLeaf("tab").openFile(file);
	}
}

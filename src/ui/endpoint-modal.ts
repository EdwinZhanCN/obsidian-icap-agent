import { App, Modal, Notice, Setting } from "obsidian";
import { L } from "../i18n";
import type { PiSdk } from "../agent/pi-host";
import { ENDPOINT_APIS, endpointProblem, listEndpoints, modelsFile, parseModelIds, removeEndpoint, saveEndpoint, type Endpoint } from "../agent/pi-endpoints";

const PRESETS: { label: string; endpoint: Partial<Endpoint> }[] = [
	{ label: "Ollama", endpoint: { name: "Ollama", id: "ollama", baseUrl: "http://localhost:11434/v1", apiKey: "ollama" } },
	{ label: "LM Studio", endpoint: { name: "LM Studio", id: "lmstudio", baseUrl: "http://localhost:1234/v1", apiKey: "lm-studio" } },
	{ label: "vLLM", endpoint: { name: "vLLM", id: "vllm", baseUrl: "http://localhost:8000/v1", apiKey: "vllm" } },
];

const blank = (): Endpoint => ({ id: "", name: "", baseUrl: "", api: "openai-completions", apiKey: "", models: [] });

/**
 * Add a model endpoint that Pi does not include — Ollama, LM Studio, vLLM, a proxy, any
 * OpenAI-compatible service — by editing Pi's own ~/.pi/agent/models.json. ICAP keeps no copy.
 */
export class EndpointModal extends Modal {
	constructor(
		app: App,
		private pi: PiSdk,
		/** An endpoint was added, changed or removed (the model list must be read again). */
		private onChange: () => void,
	) {
		super(app);
	}

	onOpen() {
		this.modalEl.addClass("icap-login");
		this.showList();
	}

	onClose() {
		this.contentEl.empty();
	}

	private dir() {
		return this.pi.getAgentDir();
	}

	/** Pi reads models.json when the runtime is created; tell the settings to ask again. */
	private changed() {
		this.onChange();
	}

	/* ───────────── The endpoints ───────────── */

	private showList() {
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle(L("Custom model endpoints", "自定义模型端点"));
		contentEl.createEl("p", {
			cls: "setting-item-description",
			text: L(
				`For services Pi does not list: Ollama, LM Studio, vLLM, a proxy, any OpenAI-compatible API. Saved in Pi's ${modelsFile(this.dir())}, shared with the Pi command line if you have it. A key written here is stored in that file as plain text; use $NAME to read it from an environment variable instead.`,
				`用于 Pi 没有列出的服务：Ollama、LM Studio、vLLM、中转站、任何兼容 OpenAI 的 API。保存在 Pi 的 ${modelsFile(this.dir())}，与 Pi 命令行（如果你装了）共用。这里填的 Key 会以明文存在该文件中；想从环境变量读取，请填 $NAME。`,
			),
		});
		let endpoints: Endpoint[];
		try {
			endpoints = listEndpoints(this.dir());
		} catch (e) {
			contentEl.createEl("p", { cls: "setting-item-description mod-warning", text: (e as Error).message });
			return;
		}
		const list = contentEl.createDiv({ cls: "icap-login-list" });
		if (!endpoints.length) list.createEl("p", { cls: "setting-item-description", text: L("No custom endpoint yet.", "还没有自定义端点。") });
		for (const e of endpoints) {
			new Setting(list)
				.setName(e.name)
				.setDesc(`${e.baseUrl} · ${e.models.join(", ")}`)
				.addButton((b) => b.setButtonText(L("Edit", "编辑")).onClick(() => this.showForm(e, e.id)))
				.addExtraButton((b) =>
					b
						.setIcon("trash-2")
						.setTooltip(L("Remove from models.json", "从 models.json 中删除"))
						.onClick(() => {
							try {
								removeEndpoint(this.dir(), e.id);
								this.changed();
							} catch (err) {
								new Notice((err as Error).message);
							}
							this.showList();
						}),
				);
		}
		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText(L("Add endpoint…", "添加端点…"))
				.setCta()
				.onClick(() => this.showForm(blank(), null)),
		);
	}

	/* ───────────── One endpoint ───────────── */

	private showForm(initial: Endpoint, editing: string | null) {
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle(editing ? L("Edit endpoint", "编辑端点") : L("Add endpoint", "添加端点"));
		const e: Endpoint = { ...initial, models: [...initial.models] };
		let idTouched = !!editing;
		const fields: Record<string, HTMLInputElement | HTMLTextAreaElement> = {};

		if (!editing) {
			new Setting(contentEl)
				.setName(L("Start from", "从模板开始"))
				.addDropdown((d) => {
					d.addOption("", L("Blank", "空白"));
					for (const p of PRESETS) d.addOption(p.label, p.label);
					d.onChange((v) => {
						const p = PRESETS.find((x) => x.label === v);
						Object.assign(e, blank(), p?.endpoint ?? {});
						idTouched = false;
						fields.name.value = e.name;
						fields.id.value = e.id;
						fields.baseUrl.value = e.baseUrl;
						fields.apiKey.value = e.apiKey;
						fields.api.value = e.api;
					});
				});
		}
		new Setting(contentEl).setName(L("Name", "名称")).addText((t) => {
			fields.name = t.inputEl;
			t.setPlaceholder("My proxy")
				.setValue(e.name)
				.onChange((v) => {
					e.name = v.trim();
					if (!idTouched) {
						e.id = e.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
						fields.id.value = e.id;
					}
				});
		});
		new Setting(contentEl)
			.setName(L("Provider id", "服务商 ID"))
			.setDesc(L("Models are named id/model, e.g. ollama/qwen2.5. Lowercase letters, digits, - _ .", "模型以 id/模型名 引用，例如 ollama/qwen2.5。小写字母、数字、- _ ."))
			.addText((t) => {
				fields.id = t.inputEl;
				t.setPlaceholder("my-proxy")
					.setValue(e.id)
					.onChange((v) => {
						idTouched = true;
						e.id = v.trim();
					});
			});
		new Setting(contentEl)
			.setName(L("API", "接口类型"))
			.setDesc(L("Most services are “OpenAI Chat Completions”.", "大多数服务选“OpenAI Chat Completions”。"))
			.addDropdown((d) => {
				for (const a of ENDPOINT_APIS) d.addOption(a.id, a.label);
				if (!ENDPOINT_APIS.some((a) => a.id === e.api)) d.addOption(e.api, e.api);
				fields.api = d.selectEl as unknown as HTMLInputElement;
				d.setValue(e.api).onChange((v) => (e.api = v));
			});
		new Setting(contentEl)
			.setName(L("Base URL", "Base URL"))
			.setDesc(L("Up to and including /v1, without /chat/completions.", "到 /v1 为止，不含 /chat/completions。"))
			.addText((t) => {
				fields.baseUrl = t.inputEl;
				t.setPlaceholder("https://example.com/v1")
					.setValue(e.baseUrl)
					.onChange((v) => (e.baseUrl = v.trim()));
			});
		new Setting(contentEl)
			.setName(L("API key", "API Key"))
			.setDesc(L("A key, $NAME to read an environment variable, or empty. For a local server any text will do.", "填 Key，或 $NAME 以读取环境变量，也可留空。本地服务随便填一段文字即可。"))
			.addText((t) => {
				fields.apiKey = t.inputEl;
				t.inputEl.type = "password";
				t.setValue(e.apiKey).onChange((v) => (e.apiKey = v.trim()));
			});
		new Setting(contentEl)
			.setName(L("Models", "模型"))
			.setDesc(L("The model ids the service accepts, one per line.", "服务接受的模型 ID，每行一个。"))
			.addTextArea((t) => {
				fields.models = t.inputEl;
				t.setPlaceholder("gpt-4o-mini").setValue(e.models.join("\n")).onChange((v) => (e.models = parseModelIds(v)));
				t.inputEl.rows = 3;
				t.inputEl.setCssStyles({ width: "100%" });
			});
		const warn = contentEl.createEl("p", { cls: "setting-item-description mod-warning" });
		warn.hide();

		const footer = new Setting(contentEl);
		footer.addButton((b) => b.setButtonText(L("Back", "返回")).onClick(() => this.showList()));
		footer.addButton((b) =>
			b
				.setButtonText(L("Save", "保存"))
				.setCta()
				.onClick(() => {
					let taken: string[] = [];
					try {
						taken = listEndpoints(this.dir()).map((x) => x.id);
					} catch (err) {
						return this.warn(warn, (err as Error).message);
					}
					const problem = endpointProblem(e, taken, editing);
					if (problem) return this.warn(warn, PROBLEMS[problem]());
					try {
						saveEndpoint(this.dir(), { ...e, name: e.name || e.id }, editing);
					} catch (err) {
						return this.warn(warn, (err as Error).message);
					}
					new Notice(L(`Saved ${e.name || e.id}.`, `已保存 ${e.name || e.id}。`));
					this.changed();
					this.showList();
				}),
		);
		fields.name.focus();
	}

	private warn(el: HTMLElement, text: string) {
		el.setText(text);
		el.show();
	}
}

const PROBLEMS = {
	id: () => L("The provider id uses lowercase letters, digits, - _ . and starts with a letter or digit.", "服务商 ID 只能用小写字母、数字和 - _ .，且以字母或数字开头。"),
	"id-taken": () => L("Another endpoint already has this id.", "已有另一个端点使用这个 ID。"),
	url: () => L("The base URL must start with http:// or https://.", "Base URL 必须以 http:// 或 https:// 开头。"),
	models: () => L("Add at least one model id.", "至少添加一个模型 ID。"),
	key: () => L("A key uses only English letters, digits and symbols. Check what you pasted.", "Key 只由英文字母、数字和符号组成，请检查粘贴的内容。"),
};

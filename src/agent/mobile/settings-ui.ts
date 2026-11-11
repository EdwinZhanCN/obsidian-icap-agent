import { Modal, Notice, SecretComponent, Setting, SettingGroup, setIcon, type App } from "obsidian";
import { L } from "../../i18n";
import { ENDPOINT_APIS, MOBILE_PROVIDERS, endpointSecretId, providerById, providerSecretId, slugOf, type EndpointApi, type MobileEndpoint } from "./providers";
import { probeTransport, type RequestUrl } from "./transport";
import type { MobileSettings } from "./mobile-backend";

/**
 * Mobile settings for the agent: a key per provider (app.secretStorage: this device only, never in
 * plugin data or sync) and custom endpoints. Rendered right in the settings tab.
 */

interface Ctx {
	settings: () => MobileSettings;
	save: () => Promise<void>;
	requestUrl: RequestUrl;
	/** Something changed: the settings re-read the models. */
	done: () => void;
}

/** A secret id chosen in the picker, checked the way secretStorage checks it. */
function checkedId(id: string): string {
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error(`Not a valid secret id: “${id}”.`);
	return id;
}

function keySetting(app: App, group: SettingGroup, ctx: Ctx, provider: string, name: string, fallbackId: string, desc?: DocumentFragment) {
	const s = ctx.settings();
	const current = s.mobileSecrets[provider] ?? fallbackId;
	const has = (() => {
		try {
			return !!app.secretStorage.getSecret(current);
		} catch {
			return false;
		}
	})();
	group.addSetting((setting) => {
		setting.setName(name);
		if (has) {
			const mark = setting.nameEl.createSpan({ cls: "icap-inline-icon is-ok", attr: { "aria-label": L("Key set", "已设置 Key") } });
			setIcon(mark, "check");
		}
		if (desc) setting.setDesc(desc);
		setting.addComponent((c) =>
			new SecretComponent(app, c).setValue(current).onChange((id) => {
				try {
					if (id) s.mobileSecrets[provider] = checkedId(id);
					else delete s.mobileSecrets[provider];
				} catch (e) {
					return void new Notice((e as Error).message);
				}
				void ctx.save().then(ctx.done);
			}),
		);
	});
}

/** Appends its groups to `el` (the settings tab, which re-renders as a whole on `done`). */
export function renderAccounts(app: App, el: HTMLElement, ctx: Ctx) {
	// That keys stay on this device is said once, in the "Model providers" description above.
	const keys = new SettingGroup(el).setHeading(L("API keys", "API Key"));
	for (const p of MOBILE_PROVIDERS) {
		const link = createFragment((f) => void f.createEl("a", { text: L("Get a key", "获取 Key"), href: p.keyUrl }));
		keySetting(app, keys, ctx, p.id, p.name, providerSecretId(p.id), link);
	}
	const custom = new SettingGroup(el).setHeading(L("Custom endpoints", "自定义端点"));
	for (const e of ctx.settings().mobileEndpoints) {
		const via = e.transport === "stream" ? L("streams", "流式") : L("replies arrive whole", "整段返回");
		custom.addSetting((row) => {
			row.setName(e.name).setDesc(`${e.baseUrl} · ${e.models.join(", ")} · ${via}`);
			row.addButton((b) => b.setButtonText(L("Edit", "编辑")).onClick(() => new EndpointModal(app, ctx, e).open()));
			row.addButton((b) =>
				b.setButtonText(L("Remove", "移除")).setWarning().onClick(async () => {
					const s = ctx.settings();
					s.mobileEndpoints = s.mobileEndpoints.filter((x) => x !== e);
					delete s.mobileSecrets[e.id];
					await ctx.save();
					ctx.done();
				}),
			);
		});
		if (e.hasKey) keySetting(app, custom, ctx, e.id, L(`Key for ${e.name}`, `${e.name} 的 Key`), endpointSecretId(e.id));
	}
	custom.addSetting((row) => {
		row
			.setName(L("Add endpoint", "添加端点"))
			.setDesc(L("Ollama, LM Studio, a proxy, any OpenAI- or Anthropic-compatible API.", "Ollama、LM Studio、中转站，任何兼容 OpenAI 或 Anthropic 的 API。"))
			.addButton((b) => b.setButtonText(L("Add…", "添加…")).onClick(() => new EndpointModal(app, ctx).open()));
	});
}

/** Add or edit a custom endpoint. Saving measures how its requests travel (probeTransport), once. */
class EndpointModal extends Modal {
	private draft: MobileEndpoint;

	constructor(
		app: App,
		private ctx: Ctx,
		private existing?: MobileEndpoint,
	) {
		super(app);
		this.draft = existing ? { ...existing, models: [...existing.models] } : { id: "", name: "", baseUrl: "", api: "openai-completions", models: [], transport: "stream", hasKey: true };
	}

	onOpen() {
		const d = this.draft;
		this.setTitle(this.existing ? L("Edit endpoint", "编辑端点") : L("Add endpoint", "添加端点"));
		const { contentEl } = this;
		new Setting(contentEl).setName(L("Name", "名称")).addText((t) => t.setPlaceholder("Ollama").setValue(d.name).onChange((v) => (d.name = v.trim())));
		new Setting(contentEl)
			.setName(L("Base URL", "Base URL"))
			.setDesc(L("Up to the version, e.g. http://192.168.1.20:11434/v1", "到版本号为止，例如 http://192.168.1.20:11434/v1"))
			.addText((t) => {
				t.setPlaceholder("https://…/v1").setValue(d.baseUrl).onChange((v) => (d.baseUrl = v.trim()));
				t.inputEl.setAttr("inputmode", "url");
			});
		new Setting(contentEl).setName(L("API", "API")).addDropdown((dd) => {
			for (const a of ENDPOINT_APIS) dd.addOption(a.id, a.label);
			dd.setValue(d.api).onChange((v) => (d.api = v as EndpointApi));
		});
		new Setting(contentEl)
			.setName(L("Models", "模型"))
			.setDesc(L("Model ids, separated by commas or new lines.", "模型 ID，用逗号或换行分隔。"))
			.addTextArea((t) => t.setValue(d.models.join("\n")).onChange((v) => (d.models = v.split(/[\n,]/).map((x) => x.trim()).filter(Boolean))));
		new Setting(contentEl)
			.setName(L("Needs an API key", "需要 API Key"))
			.addToggle((t) => t.setValue(d.hasKey).onChange((v) => (d.hasKey = v)));
		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText(L("Save", "保存"))
				.setCta()
				.onClick(async () => {
					const problem = this.problem();
					if (problem) return void new Notice(problem);
					b.setDisabled(true).setButtonText(L("Checking the connection…", "正在检查连接…"));
					// Measured once here, and again only when the endpoint is edited.
					d.transport = await probeTransport(d.api, d.baseUrl);
					const s = this.ctx.settings();
					s.mobileEndpoints = this.existing ? s.mobileEndpoints.map((x) => (x === this.existing ? d : x)) : [...s.mobileEndpoints, d];
					await this.ctx.save();
					this.close();
					new Notice(
						d.transport === "stream"
							? L(`${d.name}: replies will stream.`, `${d.name}：回复将流式显示。`)
							: L(`${d.name}: this server only answers through Obsidian, so each reply arrives whole.`, `${d.name}：这个服务器只能通过 Obsidian 访问，每条回复会整段到达。`),
					);
					this.ctx.done();
				}),
		);
	}

	private problem(): string | null {
		const d = this.draft;
		if (!d.name) return L("Give the endpoint a name.", "请为端点命名。");
		if (!this.existing) d.id = slugOf(d.name);
		if (!d.id) return L("The name needs a letter or digit.", "名称需要包含字母或数字。");
		if (providerById(d.id)) return L(`“${d.id}” is a built-in provider; choose another name.`, `“${d.id}”是内置服务商，请换个名称。`);
		if (!this.existing && this.ctx.settings().mobileEndpoints.some((e) => e.id === d.id)) return L("An endpoint with this name exists.", "已有同名端点。");
		if (!/^https?:\/\/\S+$/i.test(d.baseUrl)) return L("The base URL must start with http:// or https://.", "Base URL 必须以 http:// 或 https:// 开头。");
		if (!d.models.length) return L("List at least one model.", "至少填写一个模型。");
		return null;
	}

	onClose() {
		this.contentEl.empty();
	}
}

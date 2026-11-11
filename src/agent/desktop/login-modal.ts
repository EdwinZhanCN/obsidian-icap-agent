import { App, ButtonComponent, Modal, Notice, Setting, TextComponent } from "obsidian";
import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { L } from "../../i18n";
import type { PiSdk } from "./pi-host";
import { keyProblem, login, loginChoices, logout, providerStates, type LoginChoice, type ProviderState } from "./pi-login";

/** host/path…, for a long authorization URL whose query string means nothing to the learner. */
function shortUrl(url: string): string {
	try {
		const u = new URL(url);
		return u.host + u.pathname + (u.search ? "…" : "");
	} catch {
		return url;
	}
}

/**
 * Log in to a model provider without the Pi CLI: pick a provider and a way in (account or API key),
 * then follow the provider's own flow — a link to open, a device code, a key or code to paste. The
 * credential lands in Pi's ~/.pi/agent/auth.json.
 */
export class LoginModal extends Modal {
	private flow: AbortController | null = null;
	private query = "";

	constructor(
		app: App,
		private pi: PiSdk,
		/** A credential was added or removed. */
		private onChange: () => void,
	) {
		super(app);
	}

	onOpen() {
		this.modalEl.addClass("icap-login");
		void this.showPicker();
	}

	onClose() {
		this.flow?.abort();
		this.flow = null;
		this.contentEl.empty();
	}

	/* ───────────── Choosing a provider ───────────── */

	private async showPicker() {
		this.flow = null;
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle(L("Log in to a model provider", "登录模型服务商"));
		contentEl.createEl("p", {
			cls: "setting-item-description",
			text: L(
				"Saved in Pi's ~/.pi/agent/auth.json, shared with the Pi command line if you have it. ICAP keeps no copy.",
				"保存在 Pi 的 ~/.pi/agent/auth.json，与 Pi 命令行（如果你装了）共用。ICAP 不保留副本。",
			),
		});
		const search = new TextComponent(contentEl).setPlaceholder(L("Search providers", "搜索服务商")).setValue(this.query);
		search.inputEl.addClass("icap-login-search");
		const list = contentEl.createDiv({ cls: "icap-login-list" });
		list.setText(L("Loading…", "加载中…"));

		let choices: LoginChoice[];
		let states: Map<string, ProviderState>;
		try {
			[choices, states] = await Promise.all([loginChoices(this.pi), providerStates(this.pi).then((s) => new Map(s.map((x) => [x.provider, x])))]);
		} catch (e) {
			list.setText(L("Could not list providers: ", "无法列出服务商：") + (e as Error).message);
			return;
		}
		const render = () => {
			list.empty();
			const q = this.query.trim().toLowerCase();
			const byProvider = new Map<string, LoginChoice[]>();
			for (const c of choices) {
				if (q && !c.name.toLowerCase().includes(q) && !c.provider.toLowerCase().includes(q) && !c.label.toLowerCase().includes(q)) continue;
				byProvider.set(c.provider, [...(byProvider.get(c.provider) ?? []), c]);
			}
			// Configured providers first, then by name.
			const rows = [...byProvider.values()].sort(
				(a, b) => Number(!!states.get(b[0].provider)?.configured) - Number(!!states.get(a[0].provider)?.configured) || a[0].name.localeCompare(b[0].name),
			);
			if (!rows.length) list.createEl("p", { cls: "setting-item-description", text: L("No provider matches.", "没有匹配的服务商。") });
			for (const ways of rows) this.providerRow(list, ways, states.get(ways[0].provider));
		};
		search.onChange((v) => {
			this.query = v;
			render();
		});
		render();
		search.inputEl.focus();
	}

	private providerRow(parent: HTMLElement, ways: LoginChoice[], state: ProviderState | undefined) {
		const first = ways[0];
		const row = new Setting(parent).setName(first.name);
		const notes: string[] = [];
		if (state?.stored) notes.push(state.stored === "oauth" ? L("logged in with an account", "已用账号登录") : L("API key saved", "已保存 API Key"));
		else if (state?.configured) notes.push(L(`configured (${state.source ?? "outside Pi"})`, `已配置（${state.source ?? "Pi 之外"}）`));
		const oauth = ways.find((w) => w.kind === "oauth");
		const key = ways.find((w) => w.kind === "api_key");
		if (oauth?.subscription) notes.push(L("subscription", "订阅"));
		if (key && !key.interactive && !oauth) notes.push(L(`${key.label} is set up outside Pi`, `${key.label} 在 Pi 之外配置`));
		row.setDesc(notes.join(" · "));
		if (oauth) {
			row.addButton((b) =>
				b
					.setButtonText(L("Account", "账号登录"))
					.setTooltip(oauth.label)
					.onClick(() => void this.runLogin(oauth)),
			);
		}
		if (key?.interactive) {
			row.addButton((b) => b.setButtonText("API Key").setTooltip(key.label).onClick(() => void this.runLogin(key)));
		}
		if (state?.stored) {
			row.addExtraButton((b) =>
				b
					.setIcon("log-out")
					.setTooltip(L("Log out (removes it from auth.json)", "退出登录（从 auth.json 中删除）"))
					.onClick(async () => {
						try {
							await logout(this.pi, first.provider);
							new Notice(L(`Logged out of ${first.name}.`, `已退出 ${first.name}。`));
							this.onChange();
						} catch (e) {
							new Notice(L("Could not log out: ", "无法退出登录：") + (e as Error).message);
						}
						void this.showPicker();
					}),
			);
		}
	}

	/* ───────────── A provider's login flow ───────────── */

	private async runLogin(choice: LoginChoice) {
		const ctl = new AbortController();
		this.flow = ctl;
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle(L(`Log in to ${choice.name}`, `登录 ${choice.name}`));
		contentEl.createEl("p", { cls: "setting-item-description", text: choice.label });
		const events = contentEl.createDiv({ cls: "icap-login-events" });
		const promptEl = contentEl.createDiv({ cls: "icap-login-prompt" });
		const status = contentEl.createDiv({ cls: "icap-login-status setting-item-description" });
		const footer = new Setting(contentEl);
		footer.addButton((b) =>
			b.setButtonText(L("Cancel", "取消")).onClick(() => {
				ctl.abort();
				void this.showPicker();
			}),
		);

		const ui = {
			notify: (e: AuthEvent) => this.showEvent(events, status, e),
			prompt: (p: AuthPrompt) => this.ask(promptEl, p, ctl.signal),
		};
		try {
			await login(this.pi, choice, ui, ctl.signal);
			if (ctl.signal.aborted) return;
			new Notice(choice.kind === "oauth" ? L(`Logged in to ${choice.name}.`, `已登录 ${choice.name}。`) : L(`API key saved for ${choice.name}.`, `已保存 ${choice.name} 的 API Key。`));
			this.onChange();
			this.close();
		} catch (e) {
			if (ctl.signal.aborted || this.flow !== ctl) return;
			const msg = (e as Error).message;
			if (/cancel/i.test(msg)) {
				void this.showPicker();
				return;
			}
			promptEl.empty();
			status.empty();
			status.addClass("mod-warning");
			status.setText(L("Login failed: ", "登录失败：") + msg);
			footer.clear();
			footer.addButton((b) => b.setButtonText(L("Back", "返回")).onClick(() => void this.showPicker()));
			footer.addButton((b) =>
				b
					.setButtonText(L("Try again", "重试"))
					.setCta()
					.onClick(() => void this.runLogin(choice)),
			);
		}
	}

	private showEvent(events: HTMLElement, status: HTMLElement, e: AuthEvent) {
		if (e.type === "progress") {
			status.setText(e.message);
			return;
		}
		const box = events.createDiv({ cls: "icap-login-event" });
		if (e.type === "auth_url") {
			box.createEl("p", { text: e.instructions || L("Continue in your browser.", "请在浏览器中继续。") });
			const open = () => window.open(e.url);
			new ButtonComponent(box).setButtonText(L("Open in browser", "在浏览器中打开")).setCta().onClick(open);
			box.createEl("a", { cls: "icap-login-url", text: shortUrl(e.url), href: e.url });
			open();
		} else if (e.type === "device_code") {
			box.createEl("p", { text: L("Enter this code on the provider's page:", "在服务商页面输入这个代码：") });
			box.createEl("div", { cls: "icap-login-code", text: e.userCode });
			const row = box.createDiv({ cls: "icap-login-buttons" });
			new ButtonComponent(row)
				.setButtonText(L("Copy code and open page", "复制代码并打开页面"))
				.setCta()
				.onClick(() => {
					void navigator.clipboard.writeText(e.userCode);
					window.open(e.verificationUri);
				});
			box.createEl("a", { cls: "icap-login-url", text: e.verificationUri, href: e.verificationUri });
			status.setText(L("Waiting for you to confirm…", "等待你确认…"));
		} else {
			box.createEl("p", { text: e.message });
			for (const link of e.links ?? []) box.createEl("a", { cls: "icap-login-url", text: link.label ?? link.url, href: link.url });
		}
	}

	/** One question from the login flow; rejects when cancelled or when the flow no longer needs it. */
	private ask(el: HTMLElement, p: AuthPrompt, flow: AbortSignal): Promise<string> {
		return new Promise((resolve, reject) => {
			el.empty();
			const done = (fn: () => void) => {
				p.signal?.removeEventListener("abort", onAbort);
				flow.removeEventListener("abort", onAbort);
				el.empty();
				fn();
			};
			const onAbort = () => done(() => reject(new Error("Login cancelled")));
			if (p.signal?.aborted || flow.aborted) return reject(new Error("Login cancelled"));
			p.signal?.addEventListener("abort", onAbort, { once: true });
			flow.addEventListener("abort", onAbort, { once: true });

			el.createEl("p", { text: p.message });
			if (p.type === "select") {
				const row = el.createDiv({ cls: "icap-login-options" });
				for (const o of p.options) {
					const b = new ButtonComponent(row).setButtonText(o.label).onClick(() => done(() => resolve(o.id)));
					if (o.description) b.setTooltip(o.description);
				}
				return;
			}
			const input = new TextComponent(el).setPlaceholder(p.placeholder ?? "");
			input.inputEl.addClass("icap-login-input");
			if (p.type === "secret") input.inputEl.type = "password";
			const warn = el.createEl("p", { cls: "setting-item-description mod-warning" });
			warn.hide();
			input.onChange(() => warn.hide());
			const submit = () => {
				const v = input.getValue().trim();
				// The field is masked, so say plainly what is wrong with the paste instead of saving it.
				const problem = p.type === "secret" && v ? keyProblem(v) : undefined;
				if (problem) {
					warn.setText(
						problem === "space"
							? L("A key has no spaces or line breaks. Check what you pasted.", "Key 里不会有空格或换行，请检查粘贴的内容。")
							: L("This doesn't look like a key: keys use only English letters, digits and symbols. Check what you pasted.", "这不像一个 Key：Key 只由英文字母、数字和符号组成，请检查粘贴的内容。"),
					);
					warn.show();
					input.inputEl.focus();
					return;
				}
				// A text question may be answered blank (e.g. "blank for github.com"); a key or code may not.
				if (v || p.type === "text") done(() => resolve(v));
			};
			input.inputEl.addEventListener("keydown", (ev) => {
				if (ev.key === "Enter") submit();
			});
			new ButtonComponent(el).setButtonText(L("Continue", "继续")).setCta().onClick(submit);
			input.inputEl.focus();
		});
	}
}

import type { Api, Model } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { mistralConversationsApi } from "@earendil-works/pi-ai/api/mistral-conversations.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { PI_AI_VERSION } from "@earendil-works/pi-ai/utils/version";
import type { App } from "obsidian";
import { L } from "../../i18n";
import type { IcapSettings } from "../../settings/settings";
import { SetupNeeded, type AgentBackend, type AgentConfig, type AgentEvents, type AgentRequest, type AgentResult, type AgentRun, type BackendAccounts, type BackendCapabilities, type ModelList } from "../backend";
import { MobileSession, type StreamFunction } from "./mobile-session";
import { MOBILE_PROVIDERS, defaultModel, endpointModel, endpointSecretId, providerById, providerSecretId, transportOf, type MobileApi } from "./providers";
import { renderAccounts } from "./settings-ui";
import { wholeFetch, type RequestUrl } from "./transport";

/** pi-ai's adapter for each API the mobile agent speaks (loaded on first use). */
const ADAPTERS: Record<MobileApi, () => { streamSimple: StreamFunction }> = {
	"anthropic-messages": anthropicMessagesApi,
	"openai-completions": openAICompletionsApi,
	"openai-responses": openAIResponsesApi,
	"google-generative-ai": googleGenerativeAIApi,
	"mistral-conversations": mistralConversationsApi,
};

export type MobileSettings = Pick<IcapSettings, "mobileModel" | "mobileSecrets" | "mobileEndpoints" | "thinking">;

/** A model ready to run: the model, its key, how it travels. */
interface Resolved {
	model: Model<Api>;
	apiKey?: string;
	transport: "stream" | "whole";
}

/**
 * The mobile backend: ICAP's own agent (pi-agent-core + pi-ai) in the WebView, with an API key per
 * provider (app.secretStorage) or a custom endpoint. No learner's setup, no session cache, no
 * `/compact`, no extension dialogs, no files outside the vault.
 */
export class MobileBackend implements AgentBackend {
	readonly platform = "mobile" as const;
	readonly capabilities: BackendCapabilities = {
		ownSetup: false,
		sessionCache: false,
		compact: false,
		oauthLogin: false,
		customEndpoints: true,
		extensionDialogs: false,
		modelProbe: true,
		commandProbe: false,
		externalFiles: false,
		fileTools: false,
		skillFiles: false,
	};
	readonly accounts: BackendAccounts;

	constructor(
		private app: App,
		private opts: {
			settings: () => MobileSettings;
			save: () => Promise<void>;
			requestUrl: RequestUrl;
			/** Tests: the adapter for an API (default: pi-ai's). */
			adapter?: (api: string) => StreamFunction | undefined;
		},
	) {
		this.accounts = {
			ready: async () => [...MOBILE_PROVIDERS.filter((p) => this.key(p.id)).map((p) => p.name), ...this.opts.settings().mobileEndpoints.filter((e) => !e.hasKey || this.key(e.id)).map((e) => e.name)],
			render: (el, done) => renderAccounts(this.app, el, { settings: this.opts.settings, save: this.opts.save, requestUrl: this.opts.requestUrl, done }),
		};
	}

	/** The secret id that holds a provider's (or endpoint's) key. */
	secretIdOf(provider: string): string {
		const chosen = this.opts.settings().mobileSecrets[provider];
		if (chosen) return chosen;
		return providerById(provider) ? providerSecretId(provider) : endpointSecretId(provider);
	}

	/** The key for a provider on this device, if any. */
	key(provider: string): string | undefined {
		try {
			return this.app.secretStorage.getSecret(this.secretIdOf(provider))?.trim() || undefined;
		} catch {
			return undefined;
		}
	}

	/** Every model this device can use now, as provider/id. */
	available(): Model<Api>[] {
		const out: Model<Api>[] = [];
		for (const p of MOBILE_PROVIDERS) if (this.key(p.id)) out.push(...p.models());
		for (const e of this.opts.settings().mobileEndpoints) if (!e.hasKey || this.key(e.id)) out.push(...e.models.map((id) => endpointModel(e, id)));
		return out;
	}

	/** The model used when neither the block nor the settings name one. */
	defaultRef(): string | null {
		for (const p of MOBILE_PROVIDERS) {
			if (!this.key(p.id)) continue;
			const m = defaultModel(p);
			if (m) return `${p.id}/${m.id}`;
		}
		const e = this.opts.settings().mobileEndpoints.find((x) => x.models.length && (!x.hasKey || this.key(x.id)));
		return e ? `${e.id}/${e.models[0]}` : null;
	}

	/** provider/id → the model, its key and transport; a clear SetupNeeded when it cannot run. */
	resolve(ref: string): Resolved {
		const want = ref.trim() || this.defaultRef();
		if (!want) throw new SetupNeeded(L("No model provider is set up on this device yet. Add an API key in the settings.", "这台设备上还没有设置模型服务商。请在设置中添加 API Key。"));
		const i = want.indexOf("/");
		const provider = i > 0 ? want.slice(0, i) : want;
		const id = i > 0 ? want.slice(i + 1) : "";
		const endpoints = this.opts.settings().mobileEndpoints;
		const endpoint = endpoints.find((e) => e.id === provider);
		const builtin = providerById(provider);
		if (!endpoint && !builtin) throw new SetupNeeded(L(`“${want}” is not available on mobile. Choose a model in the settings.`, `“${want}”在手机上不可用。请在设置中选择模型。`));
		const model = endpoint ? (endpoint.models.includes(id) ? endpointModel(endpoint, id) : undefined) : builtin!.models().find((m) => m.id === id);
		if (!model) throw new SetupNeeded(L(`There is no model “${want}”. Choose one in the settings.`, `没有“${want}”这个模型。请在设置中选择一个。`));
		const needsKey = !endpoint || endpoint.hasKey;
		const apiKey = this.key(provider);
		if (needsKey && !apiKey) throw new SetupNeeded(L(`No API key for ${endpoint?.name ?? builtin!.name} on this device. Add it in the settings.`, `这台设备上没有 ${endpoint?.name ?? builtin!.name} 的 API Key。请在设置中添加。`));
		// The provider SDKs insist on a key; a server that needs none ignores this one.
		return { model, apiKey: apiKey ?? (needsKey ? undefined : "none"), transport: transportOf(provider, endpoints) };
	}

	private adapter(api: string): StreamFunction {
		const own = this.opts.adapter?.(api);
		if (own) return own;
		const make = ADAPTERS[api as MobileApi];
		if (!make) throw new Error(`The ${api} API is not available on mobile.`);
		return make().streamSimple;
	}

	run(req: AgentRequest, events: AgentEvents): AgentRun {
		let cancelled = false;
		let session: MobileSession | null = null;
		const result = (async (): Promise<AgentResult> => {
			if (req.control) throw new Error(L("Not available on mobile.", "手机上不可用。"));
			const r = this.resolve(req.model ?? "");
			if (cancelled) return { text: "", aborted: true };
			session = new MobileSession({
				...events,
				onDialog: undefined,
				model: r.model,
				apiKey: r.apiKey,
				stream: this.adapter(r.model.api),
				transport: r.transport,
				// Google's adapter rejects a custom fetch; its provider streams anyway (transportOf).
				fetch: r.transport === "whole" && r.model.api !== "google-generative-ai" ? wholeFetch(this.opts.requestUrl) : undefined,
				systemPrompt: req.systemPrompt,
				prompt: req.prompt,
				tools: req.tools,
				thinking: req.thinking,
			});
			return session.run();
		})();
		return {
			result,
			cancel: () => {
				cancelled = true;
				session?.cancel();
			},
		};
	}

	describe(): Promise<string> {
		return Promise.resolve(L(`Built-in agent (pi-ai ${PI_AI_VERSION})`, `内置 Agent（pi-ai ${PI_AI_VERSION}）`));
	}

	probeModels(_config: AgentConfig): Promise<ModelList> {
		return Promise.resolve({ current: this.defaultRef(), available: this.available().map((m) => `${m.provider}/${m.id}`) });
	}
}

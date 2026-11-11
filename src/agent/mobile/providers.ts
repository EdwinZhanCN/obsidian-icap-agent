import type { Api, Model } from "@earendil-works/pi-ai";
import { ANTHROPIC_MODELS } from "@earendil-works/pi-ai/providers/anthropic.models";
import { DEEPSEEK_MODELS } from "@earendil-works/pi-ai/providers/deepseek.models";
import { GOOGLE_MODELS } from "@earendil-works/pi-ai/providers/google.models";
import { GROQ_MODELS } from "@earendil-works/pi-ai/providers/groq.models";
import { MISTRAL_MODELS } from "@earendil-works/pi-ai/providers/mistral.models";
import { OPENAI_MODELS } from "@earendil-works/pi-ai/providers/openai.models";
import { OPENROUTER_MODELS } from "@earendil-works/pi-ai/providers/openrouter.models";
import { XAI_MODELS } from "@earendil-works/pi-ai/providers/xai.models";

/**
 * The model providers ICAP offers on mobile: an API key each, or a custom endpoint. Pi's catalog
 * (pi-ai's model tables) is the source of the models; how a request travels is decided by one fixed
 * rule per provider (transportOf). Bedrock, Vertex and subscription logins (OAuth) are desktop only.
 */

/** How a request reaches the provider. "stream": the WebView's fetch, streamed (CORS allowed). "whole": Obsidian's requestUrl (no CORS, no streaming, no abort). */
export type Transport = "stream" | "whole";

/** The provider APIs the mobile agent can speak (pi-ai adapters it bundles). */
export const MOBILE_APIS = ["anthropic-messages", "openai-completions", "openai-responses", "google-generative-ai", "mistral-conversations"] as const;
export type MobileApi = (typeof MOBILE_APIS)[number];

/** The API types a custom endpoint may use. Google's adapter cannot take a custom fetch, so it is not offered. */
export const ENDPOINT_APIS = [
	{ id: "openai-completions", label: "OpenAI Chat Completions" },
	{ id: "openai-responses", label: "OpenAI Responses" },
	{ id: "anthropic-messages", label: "Anthropic Messages" },
] as const;
export type EndpointApi = (typeof ENDPOINT_APIS)[number]["id"];

export interface MobileProvider {
	id: string;
	name: string;
	/** Where the learner gets a key. */
	keyUrl: string;
	/** Preferred default model ids, best first (the first one present in the catalog wins). */
	defaults: string[];
	models: () => Model<Api>[];
}

const table = (t: Record<string, unknown>) => () => (Object.values(t) as Model<Api>[]).filter((m) => (MOBILE_APIS as readonly string[]).includes(m.api));

export const MOBILE_PROVIDERS: MobileProvider[] = [
	{ id: "anthropic", name: "Anthropic", keyUrl: "https://console.anthropic.com/settings/keys", defaults: ["claude-sonnet-5", "claude-sonnet-4-5"], models: table(ANTHROPIC_MODELS) },
	{ id: "openai", name: "OpenAI", keyUrl: "https://platform.openai.com/api-keys", defaults: ["gpt-5", "gpt-4.1"], models: table(OPENAI_MODELS) },
	{ id: "google", name: "Google Gemini", keyUrl: "https://aistudio.google.com/apikey", defaults: ["gemini-2.5-flash", "gemini-2.5-pro"], models: table(GOOGLE_MODELS) },
	{ id: "openrouter", name: "OpenRouter", keyUrl: "https://openrouter.ai/keys", defaults: ["~anthropic/claude-sonnet-latest"], models: table(OPENROUTER_MODELS) },
	{ id: "deepseek", name: "DeepSeek", keyUrl: "https://platform.deepseek.com/api_keys", defaults: ["deepseek-flash"], models: table(DEEPSEEK_MODELS) },
	{ id: "mistral", name: "Mistral", keyUrl: "https://console.mistral.ai/api-keys", defaults: ["mistral-medium-latest", "mistral-large-latest"], models: table(MISTRAL_MODELS) },
	{ id: "groq", name: "Groq", keyUrl: "https://console.groq.com/keys", defaults: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"], models: table(GROQ_MODELS) },
	{ id: "xai", name: "xAI", keyUrl: "https://console.x.ai", defaults: ["grok-4.7", "grok-4.6"], models: table(XAI_MODELS) },
];

export function providerById(id: string): MobileProvider | undefined {
	return MOBILE_PROVIDERS.find((p) => p.id === id);
}

/** The provider's default model: its first preferred one in the catalog, else its first. */
export function defaultModel(p: MobileProvider): Model<Api> | undefined {
	const models = p.models();
	for (const id of p.defaults) {
		const m = models.find((x) => x.id === id);
		if (m) return m;
	}
	return models[0];
}

/** A custom endpoint (Ollama on the LAN, LM Studio, a proxy…): kept in plugin data; its key, if any, in secretStorage. */
export interface MobileEndpoint {
	/** Slug: the provider id of its models ("<slug>/<model>"), and the secret `icap-endpoint-<slug>`. */
	id: string;
	name: string;
	baseUrl: string;
	api: EndpointApi;
	models: string[];
	/** Measured once when saved (probeTransport) and again only when the endpoint is edited. */
	transport: Transport;
	/** The endpoint needs a key (stored in secretStorage). */
	hasKey: boolean;
}

/** A model of a custom endpoint, as pi-ai describes models. */
export function endpointModel(e: MobileEndpoint, id: string): Model<Api> {
	return {
		id,
		name: id,
		api: e.api,
		provider: e.id,
		baseUrl: e.baseUrl.replace(/\/+$/, ""),
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
	};
}

/** The one rule for how a provider's requests travel: built-in providers stream; an endpoint uses what its probe found. */
export function transportOf(provider: string, endpoints: MobileEndpoint[]): Transport {
	const e = endpoints.find((x) => x.id === provider);
	if (e) return e.transport;
	if (providerById(provider)) return "stream";
	throw new Error(`Unknown provider “${provider}”.`);
}

const SECRET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function checked(id: string): string {
	if (!SECRET_ID.test(id)) throw new Error(`Not a valid secret id: “${id}” (lowercase letters, digits and dashes only).`);
	return id;
}

/** The secretStorage id of a built-in provider's key. */
export function providerSecretId(provider: string): string {
	return checked(`icap-${provider}`);
}

/** The secretStorage id of a custom endpoint's key. */
export function endpointSecretId(slug: string): string {
	return checked(`icap-endpoint-${slug}`);
}

/** A name → an endpoint slug (lowercase alphanumerics and dashes). */
export function slugOf(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

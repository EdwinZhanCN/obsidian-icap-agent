import type { AuthEvent, AuthPrompt } from "@earendil-works/pi-ai";
import { modelRuntime, type PiSdk } from "./pi-host";

/**
 * Logging in to a model provider from inside Obsidian, the way Pi's `/login` does: an account
 * (OAuth / subscription) or an API key, saved in Pi's own ~/.pi/agent/auth.json — so the Pi CLI, if
 * the learner has it, sees the same credentials. ICAP stores nothing itself.
 */

export type AuthKind = "oauth" | "api_key";

export interface LoginChoice {
	provider: string;
	name: string;
	kind: AuthKind;
	/** The provider's own label for this way in, e.g. "Anthropic (Claude Pro/Max)". */
	label: string;
	/** OAuth backed by a subscription (Claude Pro, ChatGPT Plus…). */
	subscription: boolean;
	/** False: credentials come from outside Pi (cloud profiles, environment) — nothing to enter. */
	interactive: boolean;
}

export interface ProviderState {
	provider: string;
	name: string;
	/** How it is configured, if at all: a stored credential, an environment variable… */
	configured: boolean;
	source?: string;
	/** A credential in auth.json that logout can remove. */
	stored?: AuthKind;
}

/**
 * Why a pasted key cannot be one, or undefined. Keys and tokens travel in HTTP headers, which take
 * no CJK text, and every provider's are printable ASCII. Without this check, a wrong paste (say, a
 * sentence in Chinese) is saved and fails only on the first request, with "Failed to execute 'append'
 * on 'Headers'". `value` is already trimmed.
 */
export function keyProblem(value: string): "space" | "not-a-key" | undefined {
	if (/\s/.test(value)) return "space";
	if (/[^\x21-\x7e]/.test(value)) return "not-a-key";
	return undefined;
}

/** Every way to log in that Pi offers, by provider name. */
export async function loginChoices(pi: PiSdk): Promise<LoginChoice[]> {
	const runtime = await modelRuntime(pi);
	const out: LoginChoice[] = [];
	for (const p of runtime.getProviders()) {
		const { oauth, apiKey } = p.auth;
		if (oauth) {
			out.push({ provider: p.id, name: p.name, kind: "oauth", label: oauth.loginLabel ?? oauth.name, subscription: oauth.isSubscription === true, interactive: true });
		}
		if (apiKey) {
			out.push({ provider: p.id, name: p.name, kind: "api_key", label: apiKey.name, subscription: false, interactive: !!apiKey.login });
		}
	}
	return out.sort((a, b) => a.name.localeCompare(b.name) || (a.kind === "oauth" ? -1 : 1));
}

/** Providers with credentials, and which of those are stored in auth.json. */
export async function providerStates(pi: PiSdk): Promise<ProviderState[]> {
	const runtime = await modelRuntime(pi);
	const stored = new Map((await runtime.listCredentials({ signal: AbortSignal.timeout(15_000) })).map((c) => [c.providerId, c.type]));
	const out: ProviderState[] = [];
	for (const p of runtime.getProviders()) {
		const status = runtime.getProviderAuthStatus(p.id);
		if (!status.configured && !stored.has(p.id)) continue;
		out.push({ provider: p.id, name: p.name, configured: status.configured, source: status.label ?? status.source, stored: stored.get(p.id) });
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** What a login flow needs from the screen. */
export interface LoginUi {
	/** Ask for text, a secret, a pasted code, or a choice (returns the option id). Rejects when cancelled. */
	prompt(prompt: AuthPrompt): Promise<string>;
	/** A link to open, a device code, a progress line, or information. */
	notify(event: AuthEvent): void;
}

/** Run a provider's login; resolves once the credential is saved to auth.json. */
export async function login(pi: PiSdk, choice: Pick<LoginChoice, "provider" | "kind">, ui: LoginUi, signal: AbortSignal): Promise<void> {
	const runtime = await modelRuntime(pi);
	// Pi's device id (OpenAI sends it as the agent host id): the same one the CLI uses.
	const settings = pi.SettingsManager.create(process.cwd(), pi.getAgentDir(), { projectTrusted: false });
	await runtime.login(choice.provider, choice.kind, { signal, prompt: (p) => ui.prompt(p), notify: (e) => ui.notify(e) }, { getDeviceId: () => settings.getOrCreateDeviceId() });
}

/** Remove a provider's stored credential from auth.json. */
export async function logout(pi: PiSdk, provider: string): Promise<void> {
	const runtime = await modelRuntime(pi);
	await runtime.logout(provider, { signal: AbortSignal.timeout(15_000) });
}

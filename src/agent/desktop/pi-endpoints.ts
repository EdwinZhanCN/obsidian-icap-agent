import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { dirname, join } from "path";

/**
 * Custom model endpoints (Ollama, LM Studio, vLLM, a proxy, any OpenAI-compatible service) are
 * Pi's own `models.json`, in its agent dir. This edits only the providers it is asked to and keeps
 * everything else in the file (other providers, overrides, fields the form does not know) as it was,
 * so the Pi CLI sees the same endpoints. ICAP keeps no copy.
 */

export const ENDPOINT_APIS = [
	{ id: "openai-completions", label: "OpenAI Chat Completions" },
	{ id: "openai-responses", label: "OpenAI Responses" },
	{ id: "anthropic-messages", label: "Anthropic Messages" },
	{ id: "google-generative-ai", label: "Google Generative AI" },
] as const;

export interface Endpoint {
	/** The provider id: the key under `providers`, and the part before `/` in a model reference. */
	id: string;
	name: string;
	baseUrl: string;
	api: string;
	/** A literal key, `$NAME` (environment variable) or `!command`; empty for an endpoint without one. */
	apiKey: string;
	models: string[];
}

type Json = Record<string, unknown>;

export function modelsFile(agentDir: string): string {
	return join(agentDir, "models.json");
}

function readFile(path: string): Json {
	if (!existsSync(path)) return {};
	const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
	if (!text.trim()) return {};
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch (e) {
		throw new Error(`${path} is not valid JSON (${(e as Error).message}). Fix it first; ICAP does not overwrite it.`);
	}
	if (!json || typeof json !== "object" || Array.isArray(json)) throw new Error(`${path} must hold a JSON object.`);
	return json as Json;
}

function providersOf(file: Json): Json {
	const p = file.providers;
	return p && typeof p === "object" && !Array.isArray(p) ? (p as Json) : {};
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** The endpoints the form can show: providers that bring their own `baseUrl` and a list of models. */
export function listEndpoints(agentDir: string): Endpoint[] {
	const providers = providersOf(readFile(modelsFile(agentDir)));
	const out: Endpoint[] = [];
	for (const [id, raw] of Object.entries(providers)) {
		if (!raw || typeof raw !== "object") continue;
		const p = raw as Json;
		const models = Array.isArray(p.models) ? p.models.map((m) => str((m as Json)?.id)).filter(Boolean) : [];
		if (!str(p.baseUrl) || !models.length) continue;
		out.push({ id, name: str(p.name) || id, baseUrl: str(p.baseUrl), api: str(p.api) || "openai-completions", apiKey: str(p.apiKey), models });
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** What is wrong with a form, or undefined. Messages are short sentences for the learner. */
export function endpointProblem(e: Endpoint, existingIds: string[], editing: string | null): "id" | "id-taken" | "url" | "models" | "key" | undefined {
	if (!/^[a-z0-9][a-z0-9._-]*$/.test(e.id)) return "id";
	if (e.id !== editing && existingIds.includes(e.id)) return "id-taken";
	try {
		const u = new URL(e.baseUrl);
		if (u.protocol !== "http:" && u.protocol !== "https:") return "url";
	} catch {
		return "url";
	}
	if (!e.models.length) return "models";
	// A key travels in an HTTP header: printable ASCII, no spaces (an env reference or a command is fine).
	if (e.apiKey && !/^[$!]/.test(e.apiKey) && /[^\x21-\x7e]/.test(e.apiKey)) return "key";
	return undefined;
}

/** "a, b\nc" → ["a","b","c"], without blanks and repeats. */
export function parseModelIds(text: string): string[] {
	return [...new Set(text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean))];
}

/**
 * Write one endpoint. Fields of an existing provider the form does not edit (headers, compat, a
 * model's context window…) stay: a model that is kept keeps its own entry, a new id gets a bare one.
 * `previousId` is the id before a rename.
 */
export function saveEndpoint(agentDir: string, e: Endpoint, previousId: string | null = null): void {
	const path = modelsFile(agentDir);
	const file = readFile(path);
	const providers = providersOf(file);
	const before = (providers[previousId ?? e.id] ?? {}) as Json;
	const old = new Map((Array.isArray(before.models) ? (before.models as Json[]) : []).map((m) => [str(m?.id), m]));
	const next: Json = { ...before, name: e.name && e.name !== e.id ? e.name : undefined, baseUrl: e.baseUrl, api: e.api, models: e.models.map((id) => old.get(id) ?? { id }) };
	if (e.apiKey) next.apiKey = e.apiKey;
	else delete next.apiKey;
	if (previousId && previousId !== e.id) delete providers[previousId];
	providers[e.id] = next;
	write(path, { $schema: "https://pi.dev/schemas/models.schema.json", ...file, providers });
}

export function removeEndpoint(agentDir: string, id: string): void {
	const path = modelsFile(agentDir);
	const file = readFile(path);
	const providers = providersOf(file);
	delete providers[id];
	write(path, { ...file, providers });
}

/** JSON.stringify drops `undefined`; the temp-file rename keeps a crash from leaving half a file. */
function write(path: string, file: Json): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.icap-tmp`;
	// Private like auth.json: the file may hold a key.
	writeFileSync(tmp, JSON.stringify(file, null, 2) + "\n", { mode: 0o600 });
	renameSync(tmp, path);
}

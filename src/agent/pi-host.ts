import { execFile } from "child_process";
import { pathToFileURL } from "url";
import type * as Sdk from "./pi-sdk-entry";
import type { AgentConfig } from "./pi-session";

/**
 * Pi runs inside Obsidian: its SDK is bundled into main.js (esbuild.config.mjs) and loaded on first use.
 * Configuration is Pi's own — ~/.pi/agent (auth.json, settings.json, skills, extensions, AGENTS.md, MCP)
 * and the vault's .pi/ — shared with the Pi CLI, which need not be installed.
 */
export type PiSdk = typeof Sdk;

let sdk: Promise<PiSdk> | null = null;

/**
 * Load the bundled SDK. `baseUrl` stands in for `import.meta.url` inside the CommonJS bundle (Pi locates
 * itself with it); it must be set before the bundle first runs.
 */
export function loadPi(baseFile?: string): Promise<PiSdk> {
	if (!sdk) {
		const g = globalThis as { __ICAP_PI_URL?: string };
		if (baseFile && !g.__ICAP_PI_URL) g.__ICAP_PI_URL = pathToFileURL(baseFile).href;
		const loading = (async () => {
			await adoptLoginShellEnv();
			return await import("./pi-sdk-entry");
		})();
		sdk = loading;
		loading.catch(() => {
			if (sdk === loading) sdk = null;
		});
	}
	return sdk;
}

/* ───────────── The login shell's environment ───────────── */

function run(cmd: string, args: string[], timeout = 8000): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, { timeout, maxBuffer: 1024 * 1024 }, (err, stdout) => {
			if (err) reject(err);
			else resolve(String(stdout));
		});
	});
}

/** `env -0` output → variables. */
export function parseEnv(raw: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const entry of raw.split("\0")) {
		const i = entry.indexOf("=");
		if (i > 0) out[entry.slice(0, i)] = entry.slice(i + 1);
	}
	return out;
}

async function loginShellEnv(): Promise<Record<string, string> | undefined> {
	const shell = process.env.SHELL || "/bin/zsh";
	const script = "printf '__ICAP__'; env -0; printf '__ICAP__'";
	for (const flags of ["-lic", "-lc"]) {
		try {
			const out = await run(shell, [flags, script]);
			const m = out.match(/__ICAP__([\s\S]*)__ICAP__/);
			if (m) return parseEnv(m[1]);
		} catch {
			/* try the next way */
		}
	}
	return undefined;
}

const SKIP_VARS = new Set(["ELECTRON_RUN_AS_NODE", "SHLVL", "_", "OLDPWD", "PWD"]);

/**
 * What Obsidian's environment gains from the login shell: the variables it lacks, and a PATH that
 * includes the shell's. Existing variables are never replaced. Pure.
 */
export function envAdditions(current: NodeJS.ProcessEnv, shell: Record<string, string>): Record<string, string> {
	const add: Record<string, string> = {};
	for (const [k, v] of Object.entries(shell)) {
		if (k === "PATH" || SKIP_VARS.has(k) || current[k] !== undefined) continue;
		add[k] = v;
	}
	const home = shell.HOME || current.HOME || "";
	const parts = [shell.PATH, current.PATH, "/opt/homebrew/bin", "/usr/local/bin", `${home}/.local/bin`, `${home}/.bun/bin`]
		.filter((p): p is string => !!p)
		.flatMap((p) => p.split(":"))
		.filter(Boolean);
	const PATH = [...new Set(parts)].join(":");
	if (PATH !== current.PATH) add.PATH = PATH;
	return add;
}

let adopted: Promise<void> | null = null;

/**
 * Obsidian launched from the Dock does not see what ~/.zshrc exports: PATH (for the agent's shell
 * commands) and provider keys (ANTHROPIC_API_KEY, DEEPSEEK_API_KEY…) that many people export rather
 * than save with /login. Pi reads both from process.env, which it now shares with Obsidian, so the
 * missing variables are added to it once (never overriding Obsidian's own).
 */
export function adoptLoginShellEnv(): Promise<void> {
	adopted ??= loginShellEnv().then(
		(shell) => {
			if (shell) Object.assign(process.env, envAdditions(process.env, shell));
		},
		() => undefined,
	);
	return adopted;
}

/* ───────────── Models and credentials ───────────── */

let models: Promise<Sdk.ModelRuntime> | null = null;

/**
 * One model runtime (credentials + model catalog) shared by every task. `fresh` re-reads Pi's auth
 * and models files (after the learner logged in elsewhere, or from the settings' ↻).
 */
export function modelRuntime(pi: PiSdk, fresh = false): Promise<Sdk.ModelRuntime> {
	if (!models || fresh) {
		const loading = pi.ModelRuntime.create();
		models = loading;
		loading.catch(() => {
			if (models === loading) models = null;
		});
	}
	return models;
}

/** "provider/id" → the model in Pi's catalog. */
export function findModel(runtime: Sdk.ModelRuntime, ref: string) {
	const i = ref.indexOf("/");
	if (i <= 0) return undefined;
	return runtime.getModel(ref.slice(0, i), ref.slice(i + 1));
}

/* ───────────── Project trust ───────────── */

/**
 * Whether the vault's own Pi resources (.pi/ extensions, skills, settings) load: the learner's stored
 * decision, else only when there is nothing there that needs trust — what non-interactive Pi does.
 * "ICAP only" never loads them.
 */
export function projectTrusted(pi: PiSdk, cwd: string, config: AgentConfig): boolean {
	if (config === "isolated") return false;
	const stored = new pi.ProjectTrustStore(pi.getAgentDir()).get(cwd);
	return stored ?? !pi.hasTrustRequiringProjectResources(cwd);
}

import { execFile } from "child_process";
import { pathToFileURL } from "url";
import type * as Sdk from "./pi-sdk-entry";
import type { AgentConfig } from "../backend";
import { L } from "../../i18n";

/**
 * Pi runs inside Obsidian: its SDK is bundled into main.js (scripts/build/pi-bundle.ts) and loaded on first use.
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
		const g = window as unknown as { __ICAP_PI_URL?: string }; // the renderer's global object, where Pi's bundle reads it
		if (baseFile && !g.__ICAP_PI_URL) g.__ICAP_PI_URL = pathToFileURL(baseFile).href;
		const loading = (async () => {
			const short = oldNode(process.versions.node);
			if (short) throw new Error(short);
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

/**
 * Node comes with Obsidian's installer (its Electron), which Obsidian's in-app updates do not replace.
 * Pi needs Node 22: installers up to 1.8.9 (Electron 34 and earlier) have Node 20 or older, on which
 * Pi's bundle fails to load with a TypeError that tells the learner nothing. Installer 1.9.10 (Electron
 * 37) went straight to Node 22.18, the oldest Node 22 any installer has, and runs Pi (Pi and undici
 * declare 22.19; 22.18 was checked with a full session). Returns why Pi cannot run, or null.
 */
export function oldNode(version: string): string | null {
	const [major = 0, minor = 0] = version.split(".").map(Number);
	if (major > 22 || (major === 22 && minor >= 18)) return null;
	return L(
		`Obsidian's installer is too old for Pi (it has Node ${version}; Pi needs Node 22). Download the latest installer from obsidian.md/download and install it over this one. Your vaults and settings stay.`,
		`Obsidian 的安装程序太旧，无法运行 Pi（它带的是 Node ${version}，Pi 需要 Node 22）。请从 obsidian.md/download 下载最新的安装程序并覆盖安装。库和设置都会保留。`,
	);
}

/* ───────────── The login shell's environment ───────────── */

function run(cmd: string, args: string[], timeout = 8000): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, { timeout, maxBuffer: 1024 * 1024 }, (err, stdout) => {
			if (err) reject(err instanceof Error ? err : new Error(String(err)));
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

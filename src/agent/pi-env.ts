import { execFile, spawn } from "child_process";

/**
 * Obsidian launched from the Dock does not inherit the user's shell PATH, so `pi` (a Node
 * script) and `node` are usually not visible. We ask the login shell once and cache it.
 */
export interface PiEnvironment {
	command: string;
	env: NodeJS.ProcessEnv;
	version?: string;
}

let cached: Promise<PiEnvironment> | null = null;
let cachedFor = "";

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv, timeout = 8000): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, { env, timeout, maxBuffer: 1024 * 1024 }, (err, stdout) => {
			if (err) reject(err);
			else resolve(String(stdout));
		});
	});
}

/**
 * The login shell's environment, the way the learner's terminal sees it: PATH, and also the provider
 * keys (ANTHROPIC_API_KEY, DEEPSEEK_API_KEY…) that many people export in ~/.zshrc rather than saving
 * with Pi's /login. Without them Pi would start but find no credentials.
 */
async function loginShellEnv(): Promise<Record<string, string> | undefined> {
	const shell = process.env.SHELL || "/bin/zsh";
	const script = "printf '__ICPA__'; env -0; printf '__ICPA__'";
	for (const flags of ["-lic", "-lc"]) {
		try {
			const out = await run(shell, [flags, script]);
			const m = out.match(/__ICPA__([\s\S]*)__ICPA__/);
			if (m) return parseEnv(m[1]);
		} catch {
			/* try the next way */
		}
	}
	return undefined;
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

export function resetPiEnvironment() {
	cached = null;
	cachedFor = "";
}

export function resolvePiEnvironment(configuredPath: string): Promise<PiEnvironment> {
	const key = configuredPath.trim();
	// A different configured path (settings changed) invalidates what we resolved before.
	if (cached && cachedFor !== key) cached = null;
	if (!cached) {
		cachedFor = key;
		cached = (async () => {
			const shell = await loginShellEnv();
			const extra = ["/opt/homebrew/bin", "/usr/local/bin", `${process.env.HOME}/.local/bin`, `${process.env.HOME}/.bun/bin`];
			const PATH = [shell?.PATH, process.env.PATH, ...extra].filter(Boolean).join(":");
			// The terminal's variables win over Obsidian's (which lacks what ~/.zshrc exports).
			const env: NodeJS.ProcessEnv = { ...process.env, ...shell, PATH };
			for (const k of ["ELECTRON_RUN_AS_NODE", "SHLVL", "_", "OLDPWD", "PWD"]) delete env[k];
			let command = configuredPath.trim();
			if (!command) {
				const found = await run("/usr/bin/env", ["which", "pi"], env).catch(() => "");
				command = found.trim().split("\n")[0] ?? "";
			}
			if (!command) throw new Error("Pi was not found. Install it with `npm i -g @earendil-works/pi-coding-agent`, or set its path in settings.");
			const probe = await run(command, ["--version"], env).then(
				(out) => ({ ok: true, out }),
				() => ({ ok: false, out: "" }),
			);
			// An explicitly configured path must actually run; otherwise fail now (and don't cache it).
			if (!probe.ok && key) throw new Error(`Pi was not found at ${key} — check the path in settings.`);
			return { command, env, version: probe.out.trim() || undefined };
		})();
		const mine = cached;
		mine.catch(() => {
			if (cached === mine) cached = null;
		});
	}
	return cached;
}

export interface PiModels {
	/** provider/id Pi will use by default; null = no model has credentials. */
	current: string | null;
	/** Models with credentials, as provider/id. */
	available: string[];
}

/**
 * Ask Pi which model it would use and which ones have credentials. Runs Pi the way tasks run it
 * (the learner's own extensions may register providers), but sends no prompt: nothing is spent.
 */
export function probeModels(env: PiEnvironment, isolated: boolean, cwd?: string): Promise<PiModels> {
	return new Promise((resolve, reject) => {
		const args = ["--mode", "rpc", "--no-session"];
		if (isolated) args.push("--no-extensions", "--no-skills", "--no-context-files", "--no-mcp");
		const proc = spawn(env.command, args, { env: env.env, cwd, stdio: "pipe" });
		let buf = "";
		let current: string | null | undefined;
		let available: string[] | undefined;
		const done = (err?: Error) => {
			clearTimeout(timer);
			proc.stdout.removeAllListeners();
			proc.stdin.end();
			setTimeout(() => proc.kill(), 300);
			if (err) reject(err);
			else resolve({ current: current ?? null, available: available ?? [] });
		};
		const timer = setTimeout(() => done(new Error("Pi did not answer in time.")), 15000);
		proc.on("error", (e) => done(e));
		proc.stdout.setEncoding("utf8");
		proc.stdout.on("data", (chunk: string) => {
			buf += chunk;
			const lines = buf.split("\n");
			buf = lines.pop() ?? "";
			for (const line of lines) {
				let rec: any;
				try {
					rec = JSON.parse(line);
				} catch {
					continue;
				}
				if (rec.type !== "response") continue;
				if (rec.command === "get_state") {
					const m = rec.data?.model;
					current = m && m.provider !== "unknown" ? `${m.provider}/${m.id}` : null;
				} else if (rec.command === "get_available_models") {
					available = (rec.data?.models ?? []).map((m: any) => `${m.provider}/${m.id}`);
				}
				if (current !== undefined && available !== undefined) done();
			}
		});
		proc.stdin.write(JSON.stringify({ id: "s", type: "get_state" }) + "\n");
		proc.stdin.write(JSON.stringify({ id: "m", type: "get_available_models" }) + "\n");
	});
}

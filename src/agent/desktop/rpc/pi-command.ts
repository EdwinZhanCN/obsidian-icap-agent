import { execFile } from "child_process";
import { accessSync, constants, statSync } from "fs";
import { homedir } from "os";
import { delimiter, join } from "path";
import { L } from "../../../i18n";
import { SetupNeeded } from "../../backend";

/**
 * The learner's own Pi, found on this computer. ICAP only looks for it: it never installs or updates Pi
 * (an Obsidian plugin must not install dependencies). The order: the path in the settings, else the login
 * shell's PATH; then `pi --version` must say 1.5.0 or later, the first release whose RPC mode has
 * everything ICAP uses (`--session-id`, `get_commands`, the extension UI records).
 */

export const PI_MIN_VERSION = "1.5.0";

/** A Pi that can be started. */
export interface PiCommand {
	/** The executable, as found. */
	path: string;
	/** What `pi --version` printed, e.g. "1.5.0". */
	version: string;
	/** Arguments that come before Pi's own; none for an installed Pi (a test runs Pi's `cli.js` with Node). */
	args: string[];
	/** The environment Pi runs in: Obsidian's plus the login shell's (PATH for `node`, provider keys). */
	env: NodeJS.ProcessEnv;
}

/** The official ways to install Pi (docs: quickstart). Shown, never run. */
export function installCommands(platform: NodeJS.Platform = process.platform): { installer: string; npm: string } {
	return {
		installer: platform === "win32" ? 'powershell -c "irm https://pi.dev/install.ps1 | iex"' : "curl -fsSL https://pi.dev/install.sh | sh",
		npm: "npm install -g --ignore-scripts @earendil-works/pi-coding-agent",
	};
}

/** "1.5.0" out of whatever `--version` printed; null when there is no version in it. Pure. */
export function parseVersion(out: string): string | null {
	return out.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
}

/** Is `version` at least `min`? Both `major.minor.patch`. Pure. */
export function versionAtLeast(version: string, min: string): boolean {
	const a = version.split(".").map(Number);
	const b = min.split(".").map(Number);
	for (let i = 0; i < 3; i++) {
		const d = (a[i] || 0) - (b[i] || 0);
		if (d !== 0) return d > 0;
	}
	return true;
}

/** A plain argument needs no quotes in `cmd.exe`; anything else is quoted, with `"` doubled. */
function cmdQuote(arg: string): string {
	return /^[A-Za-z0-9_\-.:\\/=,+@]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '""')}"`;
}

/**
 * How to start `path` with `args`. npm installs Pi on Windows as `pi.cmd`, which Node refuses to spawn
 * directly: it goes through `cmd.exe /d /s /c "<line>"`, the line passed verbatim. Every argument ICAP
 * passes is a path, an id or a flag (prompts travel in files and on stdin), so quoting is enough. Pure.
 */
export function spawnSpec(path: string, args: string[], platform: NodeJS.Platform = process.platform, comspec = process.env.ComSpec): { command: string; args: string[]; verbatim: boolean } {
	if (platform === "win32" && /\.(cmd|bat)$/i.test(path)) {
		const line = [path, ...args].map(cmdQuote).join(" ");
		return { command: comspec || "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`], verbatim: true };
	}
	return { command: path, args, verbatim: false };
}

function expandHome(p: string): string {
	return p === "~" ? homedir() : /^~[\\/]/.test(p) ? join(homedir(), p.slice(2)) : p;
}

function runnable(file: string, platform: NodeJS.Platform): boolean {
	try {
		if (!statSync(file).isFile()) return false;
		if (platform !== "win32") accessSync(file, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/** The value of PATH, whatever its case (Windows spells it `Path`). */
function pathOf(env: NodeJS.ProcessEnv): string {
	const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH");
	return (key && env[key]) || "";
}

/**
 * Every `pi` on PATH, in PATH's order, then where the installers put it (a Dock-launched Obsidian and a
 * login shell that could not be asked both leave PATH short). Windows: `pi.cmd` (npm) before `pi.exe`.
 */
export function piCandidates(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string[] {
	const home = env.HOME || env.USERPROFILE || homedir();
	const sep = platform === "win32" ? ";" : delimiter;
	const dirs = pathOf(env).split(sep).filter(Boolean);
	const extra =
		platform === "win32"
			? [env.APPDATA ? join(env.APPDATA, "npm") : "", join(home, ".pi", "agent", "bin"), join(home, ".local", "bin")]
			: [join(home, ".local", "bin"), join(home, ".pi", "agent", "bin"), "/opt/homebrew/bin", "/usr/local/bin", join(home, ".bun", "bin")];
	const names = platform === "win32" ? ["pi.cmd", "pi.exe", "pi.bat"] : ["pi"];
	const out: string[] = [];
	for (const dir of [...dirs, ...extra.filter(Boolean)]) {
		for (const name of names) {
			const file = join(dir, name);
			if (!out.includes(file) && runnable(file, platform)) out.push(file);
		}
	}
	return out;
}

/** What `--version` prints, or null when it could not be run. */
function versionOf(path: string, args: string[], env: NodeJS.ProcessEnv): Promise<string | null> {
	const spec = spawnSpec(path, [...args, "--version"]);
	return new Promise((resolve) => {
		execFile(spec.command, spec.args, { env, timeout: 20000, maxBuffer: 256 * 1024, windowsVerbatimArguments: spec.verbatim, windowsHide: true }, (err, stdout, stderr) => {
			if (err) resolve(null);
			else resolve(parseVersion(String(stdout)) ?? parseVersion(String(stderr)));
		});
	});
}

function missing(): SetupNeeded {
	return new SetupNeeded(
		L(
			"Pi was not found on this computer. Install it (ICAP's settings show the command), or set its path there.",
			"这台电脑上没有找到 Pi。请先安装（ICAP 的设置里有安装命令），或在设置里填写它的路径。",
		),
	);
}

/**
 * Find the learner's Pi and check its version. `configured`: the path from the settings ("~" allowed);
 * empty looks on PATH. Throws `SetupNeeded`, saying what to do, when there is none or it is too old.
 */
export async function findPi(configured: string, env: NodeJS.ProcessEnv): Promise<PiCommand> {
	const wanted = configured.trim();
	const candidates = wanted ? [expandHome(wanted)] : piCandidates(env);
	if (wanted && !runnable(candidates[0], process.platform)) {
		throw new SetupNeeded(L(`There is no Pi at “${wanted}” (the path in ICAP's settings).`, `“${wanted}”处没有 Pi（ICAP 设置里填写的路径）。`));
	}
	if (!candidates.length) throw missing();
	let old: { path: string; version: string } | null = null;
	for (const path of candidates) {
		const version = await versionOf(path, [], env);
		if (!version) continue;
		if (versionAtLeast(version, PI_MIN_VERSION)) return { path, version, args: [], env };
		old ??= { path, version };
	}
	if (old) {
		throw new SetupNeeded(
			L(
				`Pi ${old.version} (${old.path}) is too old: ICAP needs Pi ${PI_MIN_VERSION} or later. Update it in a terminal: pi update`,
				`Pi ${old.version}（${old.path}）版本过低：ICAP 需要 Pi ${PI_MIN_VERSION} 或更高。请在终端里更新：pi update`,
			),
		);
	}
	if (wanted) throw new SetupNeeded(L(`“${wanted}” did not answer “--version”: is it Pi?`, `“${wanted}”没有回应“--version”：它是 Pi 吗？`));
	throw missing();
}

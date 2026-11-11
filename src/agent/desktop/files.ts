import { promises as fs } from "fs";
import { homedir } from "os";
import { isAbsolute, join, relative, resolve } from "path";
import type { ExternalFiles } from "../backend";

/** Is `target` (absolute) inside one of `roots` (absolute)? */
export function within(target: string, roots: string[]): boolean {
	return roots.some((root) => {
		const rel = relative(resolve(root), resolve(target));
		return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
	});
}

/** "~/Books" → the home folder's Books. */
export function expandHome(f: string): string {
	const home = homedir();
	return f === "~" ? home : f.startsWith("~/") ? home + f.slice(1) : f;
}

/**
 * Files outside the vault on disk, for read_document and documents: the folders the learner allowed
 * (settings → "Folders outside the vault") and absolute paths the agent names.
 */
export class DesktopFiles implements ExternalFiles {
	constructor(
		private vaultRoot: () => string,
		private folders: () => string[],
	) {}

	isAbsolute(p: string): boolean {
		return isAbsolute(p);
	}

	roots(): string[] {
		return this.folders().map(expandHome);
	}

	resolve(p: string, restrict: boolean): string | null {
		const abs = resolve(p);
		if (restrict && !within(abs, [this.vaultRoot(), ...this.roots()])) return null;
		return abs;
	}

	async stat(abs: string) {
		const s = await fs.stat(abs).catch(() => null);
		return s?.isFile() ? { size: s.size, mtime: Math.floor(s.mtimeMs) } : null;
	}

	async read(abs: string): Promise<Uint8Array> {
		return new Uint8Array(await fs.readFile(abs));
	}

	readText(abs: string): Promise<string | null> {
		return fs.readFile(abs, "utf8").catch(() => null);
	}

	async list(dir: string) {
		const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
		return entries.map((e) => ({ path: join(dir, e.name), name: e.name, folder: e.isDirectory() }));
	}
}

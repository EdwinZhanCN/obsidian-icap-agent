/**
 * The original of every file the agent's edit and write tools change, kept before the write. Once
 * changes may land without the learner seeing them first (the confirmation modes, agent/permissions.ts),
 * being able to put a file back matters more than having been able to stop the change.
 *
 * Kept in the plugin's own folder (`backups/`), never in the vault's notes: a folder per day, a file per
 * write, and `index.jsonl` saying which file each one is the original of. Days older than `KEEP_DAYS`
 * are removed on start. What a shell command changes is not known to the plugin and is not kept.
 */

export const KEEP_DAYS = 30;
/** A file larger than this is not copied: a note is never this large, and a data file would fill the folder. */
export const MAX_BYTES = 5 * 1024 * 1024;

/** The part of `vault.adapter` backups use. */
export interface BackupStore {
	exists(path: string): Promise<boolean>;
	mkdir(path: string): Promise<void>;
	write(path: string, data: string): Promise<void>;
	append(path: string, data: string): Promise<void>;
	list(path: string): Promise<{ files: string[]; folders: string[] }>;
	rmdir(path: string, recursive: boolean): Promise<void>;
}

export interface BackupEntry {
	/** When the original was kept (ISO). */
	at: string;
	/** The task whose agent wrote. */
	task: string;
	/** The file that was about to change: vault-relative, or absolute when outside the vault. */
	path: string;
	/** The copy, relative to the backups folder; absent when the file was too large to keep. */
	file?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `2026-11-12` and `143205` of a moment, local time. Pure. */
export function stamp(at: Date): { day: string; time: string } {
	return {
		day: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
		time: `${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`,
	};
}

/** A file name safe on every platform, from the name of the file being kept. Pure. */
export function safeName(path: string): string {
	const base = path.split(/[\\/]/).pop() || "file";
	return base.replace(/[<>:"|?*\u0000-\u001f]/g, "_").slice(0, 80);
}

/** The day folders (`YYYY-MM-DD`) that are older than `keepDays` on `today`. Pure. */
export function expired(folders: string[], today: Date, keepDays = KEEP_DAYS): string[] {
	const limit = new Date(today.getFullYear(), today.getMonth(), today.getDate() - keepDays).getTime();
	return folders.filter((f) => {
		const m = (f.split("/").pop() ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
		return !!m && new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() < limit;
	});
}

export class Backups {
	private seq = 0;

	/** `dir`: the backups folder, as the store addresses it (the plugin's own `backups/`). */
	constructor(
		private store: BackupStore,
		private dir: string,
	) {}

	/**
	 * Keep `original` (the file's text before the write) and return where, relative to the backups
	 * folder. A new file has no original and nothing is kept. Never throws: a backup that cannot be
	 * written must not be why a change the learner approved fails; it is reported as `null`.
	 */
	async keep(task: string, path: string, original: string | null, now = new Date()): Promise<string | null> {
		if (original === null) return null;
		const { day, time } = stamp(now);
		const entry: BackupEntry = { at: now.toISOString(), task, path };
		try {
			if (!(await this.store.exists(this.dir))) await this.store.mkdir(this.dir);
			if (original.length <= MAX_BYTES) {
				if (!(await this.store.exists(`${this.dir}/${day}`))) await this.store.mkdir(`${this.dir}/${day}`);
				entry.file = `${day}/${time}-${++this.seq}-${safeName(path)}`;
				await this.store.write(`${this.dir}/${entry.file}`, original);
			}
			await this.store.append(`${this.dir}/index.jsonl`, JSON.stringify(entry) + "\n");
			return entry.file ?? null;
		} catch {
			return null;
		}
	}

	/** Remove the days that are older than the limit. */
	async prune(now = new Date()): Promise<void> {
		try {
			if (!(await this.store.exists(this.dir))) return;
			for (const folder of expired((await this.store.list(this.dir)).folders, now)) await this.store.rmdir(folder, true);
		} catch {
			/* next start tries again */
		}
	}
}

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { VISUAL_SKILL, visualSkill } from "../visual-skill";

/**
 * ICAP's own Pi skills. They ship inside main.js and are written to the plugin's folder (inside the
 * vault, so the agent can read them in isolated mode too); Pi lists them in the system prompt and the
 * agent reads one when its task needs it (the text: agent/visual-skill.ts).
 */

/** Write ICAP's skills under the plugin folder (when they changed) and return their folders for Pi. */
export function ensureSkills(pluginDir: string): string[] {
	const dir = join(pluginDir, "skills", VISUAL_SKILL);
	const file = join(dir, "SKILL.md");
	const want = visualSkill();
	let have = "";
	try {
		have = readFileSync(file, "utf8");
	} catch {
		/* not written yet */
	}
	if (have !== want) {
		mkdirSync(dir, { recursive: true });
		writeFileSync(file, want);
	}
	return [dir];
}

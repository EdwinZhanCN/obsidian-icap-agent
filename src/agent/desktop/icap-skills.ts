import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { VISUAL_SKILL, visualSkill } from "../visual-skill";
import { STRUCTURE_SKILLS, skillFile } from "../skills";

/**
 * ICAP's own Pi skills. They ship inside main.js and are written to the plugin's folder (inside the
 * vault, so the agent can read them in isolated mode too); Pi lists them in the system prompt and the
 * agent reads one when its task needs it (the texts: agent/visual-skill.ts, agent/skills.ts).
 */

function files(): Record<string, string> {
	return { [VISUAL_SKILL]: visualSkill(), ...Object.fromEntries(STRUCTURE_SKILLS.map((s) => [s.name, skillFile(s)])) };
}

/** Write ICAP's skills under the plugin folder (when they changed) and return the folders of `names` for Pi. */
export function ensureSkills(pluginDir: string, names: string[]): string[] {
	const out: string[] = [];
	for (const [name, want] of Object.entries(files())) {
		const dir = join(pluginDir, "skills", name);
		const file = join(dir, "SKILL.md");
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
		if (names.includes(name)) out.push(dir);
	}
	return out;
}

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ensureSkills } from "../../../../src/agent/desktop/icap-skills";
import { visualSkill } from "../../../../src/agent/visual-skill";
import { STRUCTURE_SKILLS, skillFile } from "../../../../src/agent/skills";



describe("the visual skill", () => {
	it("is a Pi skill with a name and a description", () => {
		const s = visualSkill();
		expect(s).toMatch(/^---\nname: icap-visual\ndescription: .+\n---\n/);
		expect(s).toContain("icap.ask(");
		expect(s).toContain("--interactive-accent");
	});
	it("is written once into the plugin folder", () => {
		const dir = mkdtempSync(join(tmpdir(), "icap-plugin-"));
		const [skill] = ensureSkills(dir, ["icap-visual"]);
		expect(readFileSync(join(skill, "SKILL.md"), "utf8")).toBe(visualSkill());
		expect(ensureSkills(dir, ["icap-visual"])).toEqual([skill]);
	});
});

describe("the structure skills (Mermaid, Canvas, Bases)", () => {
	it("are Pi skills, all written, offered only by name", () => {
		const dir = mkdtempSync(join(tmpdir(), "icap-plugin-"));
		const names = STRUCTURE_SKILLS.map((s) => s.name);
		expect(names).toEqual(["icap-mermaid", "icap-canvas", "icap-bases"]);
		const dirs = ensureSkills(dir, names);
		expect(dirs).toHaveLength(3);
		for (const [i, s] of STRUCTURE_SKILLS.entries()) {
			const text = readFileSync(join(dirs[i], "SKILL.md"), "utf8");
			expect(text).toBe(skillFile(s));
			expect(text).toMatch(new RegExp(`^---\\nname: ${s.name}\\ndescription: .+\\n---\\n`));
			// Short: on mobile all three are part of every system prompt.
			expect(s.body.length).toBeLessThan(3200);
		}
		// The visual skill is on disk too, but not offered.
		expect(readFileSync(join(dir, "skills", "icap-visual", "SKILL.md"), "utf8")).toBe(visualSkill());
	});
});

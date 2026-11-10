import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ensureSkills, visualSkill } from "../../../../src/agent/desktop/icap-skills";



describe("the visual skill", () => {
	it("is a Pi skill with a name and a description", () => {
		const s = visualSkill();
		expect(s).toMatch(/^---\nname: icap-visual\ndescription: .+\n---\n/);
		expect(s).toContain("icap.ask(");
		expect(s).toContain("--interactive-accent");
	});
	it("is written once into the plugin folder", () => {
		const dir = mkdtempSync(join(tmpdir(), "icap-plugin-"));
		const [skill] = ensureSkills(dir);
		expect(readFileSync(join(skill, "SKILL.md"), "utf8")).toBe(visualSkill());
		expect(ensureSkills(dir)).toEqual([skill]);
	});
});

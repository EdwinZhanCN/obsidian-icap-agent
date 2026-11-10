import { describe, expect, it } from "vite-plus/test";
import { renderRules, rulesPresets } from "./vault-rules";



describe("the vault's conventions (AGENTS.md)", () => {
	it("are written from the learner's answers and a preset", () => {
		const md = renderRules(true, { preset: "course", subject: "线性代数（MIT 18.06）", sources: "资料/", protect: "课堂笔记" });
		expect(md.startsWith("# 这个库\n\n> ")).toBe(true);
		expect(md).toContain("线性代数（MIT 18.06）");
		expect(md).toContain("学习资料（书、讲义、论文）在 `资料/` 里");
		expect(md).toContain("- 每一讲一篇笔记");
		expect(md).toContain("- 不要修改 `课堂笔记/` 里的任何文件");
	});
	it("leave out what was not answered, and start blank when asked", () => {
		const md = renderRules(false, { preset: "blank", subject: "", sources: "", protect: "" });
		expect(md).toContain("(Write one sentence here: what this vault is for.)");
		expect(md).not.toContain("## Material");
		expect(md).not.toContain("Do not change anything in");
		expect(md).toContain("## How the agent works here\n\n- Before creating a note");
	});
	it("offer the same kinds of study in both languages", () => {
		expect(rulesPresets(true).map((p) => p.id)).toEqual(rulesPresets(false).map((p) => p.id));
	});
	it("are a quiet note: no links or math outside inline code (no unresolved links in the graph)", () => {
		for (const zh of [true, false])
			for (const p of rulesPresets(zh)) {
				const md = renderRules(zh, { preset: p.id, subject: "x", sources: "Sources", protect: "Mine" });
				expect(md.replace(/`[^`]*`/g, "")).not.toMatch(/\[\[|\$/);
			}
	});
});

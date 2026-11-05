import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_ASK, MAX_HEIGHT, UI_CSP, parseUiMessage, veilWidgets, widgetDocument } from "../src/genui/widget";
import { ensureSkills, visualSkill } from "../src/agent/icap-skills";
import { systemPrompt } from "../src/agent/prompts";
import { renderRules, rulesPresets } from "../src/guide/vault-rules";

const theme = { dark: true, vars: { "text-normal": "#ddd", "interactive-accent": "hsl(258, 88%, 66%)", "font-interface": "Inter, sans-serif" } };

describe("visual document", () => {
	const doc = widgetDocument('<button id="b">go</button><script>b.onclick=()=>icap.ask("why?")</script>', theme);

	it("locks the frame down with a CSP whose keywords keep their quotes", () => {
		expect(doc).toContain(`<meta http-equiv="Content-Security-Policy" content="${UI_CSP}">`);
		expect(UI_CSP).toContain("default-src 'none'");
		expect(UI_CSP).toContain("script-src 'unsafe-inline'");
		expect(UI_CSP).not.toMatch(/https?:|connect-src|'self'/);
	});
	it("passes the note's theme and runs the built-in runtime before the visual", () => {
		expect(doc).toContain("--text-normal:#ddd;");
		expect(doc).toContain("--interactive-accent:hsl(258, 88%, 66%);");
		expect(doc).toContain('class="dark"');
		expect(doc).toContain("color-scheme:dark");
		expect(doc.indexOf("window.icap=")).toBeLessThan(doc.indexOf('<button id="b">'));
	});
	it("cannot be broken out of through a theme value", () => {
		const bad = widgetDocument("x", { dark: false, vars: { "text-normal": "red}</style><script>alert(1)</script>" } });
		expect(bad).not.toContain("<script>alert(1)");
	});
});

describe("what a visual may post", () => {
	it("accepts the four messages, bounded", () => {
		expect(parseUiMessage({ icap: "ui", type: "size", height: 99999 })).toEqual({ icap: "ui", type: "size", height: MAX_HEIGHT });
		expect(parseUiMessage({ icap: "ui", type: "ask", text: "  why?  " })).toEqual({ icap: "ui", type: "ask", text: "why?" });
		expect((parseUiMessage({ icap: "ui", type: "ask", text: "x".repeat(5000) }) as { text: string }).text).toHaveLength(MAX_ASK);
		expect(parseUiMessage({ icap: "ui", type: "open", link: "[[Gradient descent]]" })).toEqual({ icap: "ui", type: "open", link: "Gradient descent" });
		expect(parseUiMessage({ icap: "ui", type: "error", message: "boom" })).toMatchObject({ type: "error" });
	});
	it("ignores anything else", () => {
		for (const d of [null, "ask", { type: "ask", text: "x" }, { icap: "ui", type: "ask", text: "  " }, { icap: "ui", type: "eval", code: "1" }, { icap: "ui", type: "size", height: "1e9" }])
			expect(parseUiMessage(d)).toBeNull();
	});
});

describe("streaming placeholder", () => {
	it("hides visuals, closed or still open, and nothing else", () => {
		const md = "Try this:\n\n```icap-ui\n<div>…</div>\n```\n\n```python\nprint(1)\n```\n\nThen:\n\n````icap-ui\n<script>let a = 1";
		expect(veilWidgets(md, "drawing…")).toBe("Try this:\n\n*drawing…*\n\n```python\nprint(1)\n```\n\nThen:\n\n*drawing…*");
	});
});

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

describe("visuals in the protocol", () => {
	it("off: no HTML at all, no mention of visuals", () => {
		const p = systemPrompt("isolated", "", "off");
		expect(p).toContain("No HTML.");
		expect(p).not.toContain("icap-ui");
	});
	it("auto: the agent decides, after reading the skill", () => {
		const p = systemPrompt("mine", "", "auto");
		expect(p).toContain("No HTML outside an icap-ui block.");
		expect(p).toContain("read the icap-visual skill");
		expect(p).toContain("never for decoration");
	});
	it("asked: only when the learner asks", () => {
		expect(systemPrompt("isolated", "", "asked")).toContain("only when the learner asks for a visual");
	});
});

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

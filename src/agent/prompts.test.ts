import { describe, expect, it } from "vite-plus/test";
import { systemPrompt } from "./prompts";



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

describe("the protocol on mobile (no file tools, no skill files)", () => {
	const mobile = { fileTools: false, skills: false };
	it("lists only ICAP's tools", () => {
		expect(systemPrompt("isolated")).toContain("read / grep / find / ls");
		const p = systemPrompt("isolated", "", "off", mobile);
		expect(p).not.toContain("read / grep / find / ls");
		expect(p).toContain("ask_learner");
	});
	it("carries the icap-visual rules itself instead of pointing at a skill to read", () => {
		const p = systemPrompt("isolated", "", "auto", mobile);
		expect(p).toContain("<icap-visual>");
		expect(p).toContain("icap.ask(");
		expect(p).not.toMatch(/read the icap-visual skill/i);
		expect(systemPrompt("isolated", "", "off", mobile)).not.toContain("icap-visual");
	});
});

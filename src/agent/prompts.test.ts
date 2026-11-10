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

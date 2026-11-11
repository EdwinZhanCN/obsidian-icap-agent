import { describe, expect, it } from "vite-plus/test";
import { MARKS, markFor } from "./provider-marks";

describe("provider marks", () => {
	it("knows a model by its family before its provider", () => {
		expect(markFor("anthropic/claude-sonnet-4-5")).toBe(MARKS.claude);
		expect(markFor("openrouter/anthropic/claude-sonnet-4.5")).toBe(MARKS.claude);
		expect(markFor("amazon-bedrock/us.anthropic.claude-opus-4")).toBe(MARKS.claude);
		expect(markFor("openai/gpt-5")).toBe(MARKS.openai);
		expect(markFor("openai/o3")).toBe(MARKS.openai);
		expect(markFor("google/gemini-2.5-pro")).toBe(MARKS.gemini);
		expect(markFor("groq/llama-3.3-70b")).toBe(MARKS.meta);
	});
	it("falls back to the provider, then to nothing", () => {
		expect(markFor("groq/some-new-model")).toBe(MARKS.groq);
		expect(markFor("xai/grok-4")).toBe(MARKS.grok);
		expect(markFor("my-endpoint/house-model")).toBeNull();
	});
	it("ships monochrome marks only", () => {
		for (const m of Object.values(MARKS)) expect(m.body).not.toMatch(/fill="#|stop-color|url\(/);
	});
});

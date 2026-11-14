import { describe, expect, it } from "vite-plus/test";
import { stepResult } from "./steps";

describe("a tool call's result", () => {
	it("keeps the start of its text, and whether it failed", () => {
		expect(stepResult({ content: [{ type: "text", text: "line one\n\n  line two" }] }, false, "c1")).toEqual({ id: "c1", error: false, preview: "line one line two" });
		expect(stepResult({ content: [{ type: "text", text: "No such file" }] }, true)).toEqual({ error: true, preview: "No such file" });
		expect(stepResult({ content: [{ type: "image" }, { type: "text", text: "ok" }] }, false).preview).toBe("image ok");
		expect(stepResult({ content: [{ type: "text", text: "x".repeat(400) }] }, false).preview).toHaveLength(159);
		expect(stepResult(undefined, undefined)).toEqual({ error: false, preview: "" });
	});
});

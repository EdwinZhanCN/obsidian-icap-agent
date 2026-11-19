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
	it("keeps a failure's message whole, with its lines", () => {
		const trace = "Command failed: tsc\r\nsrc/a.ts(3,1): error TS2304   \n\n\n\nexit code 2\n";
		expect(stepResult({ content: [{ type: "text", text: trace }] }, true).preview).toBe("Command failed: tsc\nsrc/a.ts(3,1): error TS2304\n\nexit code 2");
		expect(stepResult({ content: [{ type: "text", text: "first" }, { type: "text", text: "second" }] }, true).preview).toBe("first\nsecond");
		// Longer than a preview, shorter than the limit: nothing is cut.
		expect(stepResult("x".repeat(400), true).preview).toHaveLength(400);
		const long = stepResult("x".repeat(5000), true).preview;
		expect(long).toHaveLength(1999);
		expect(long.endsWith("…")).toBe(true);
	});
});

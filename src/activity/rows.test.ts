import { describe, expect, it } from "vite-plus/test";
import { costText, duration, modelName, parseLocal, rowOf, spans, stepKind, tone } from "./rows";

describe("activity rows", () => {
	it("reads a task note's properties", () => {
		const row = rowOf("ICAP/Tasks/Renewal.md", "Renewal", {
			icap: "task",
			"icap-id": "bq9",
			"icap-status": "done",
			"icap-source": ["[[Contracts/Acme MSA]]"],
			"icap-changed": ["[[Learning/Renewal terms]]"],
			"icap-started": "2026-11-10T14:02:10",
			"icap-ended": "2026-11-10T14:06:48",
			"icap-cost": 0.0421,
			"icap-tokens": 18452,
			"icap-model": "anthropic/claude-sonnet-4-5",
		});
		expect(row).toMatchObject({ id: "bq9", status: "done", source: "Contracts/Acme MSA", changed: ["Learning/Renewal terms"], cost: 0.0421, tokens: 18452, model: "anthropic/claude-sonnet-4-5" });
		expect(row!.ended! - row!.started!).toBe(278_000);
	});
	it("takes what it can from an older or hand-edited note", () => {
		expect(rowOf("a.md", "a", { icap: "task", "icap-status": "whatever", "icap-cost": "unknown" })).toMatchObject({ status: null, cost: "unknown", model: null, started: null });
		expect(rowOf("a.md", "a", { tags: ["x"] })).toBeNull();
		expect(parseLocal("2026-11-10")).toBe(new Date(2026, 10, 10).getTime());
		expect(parseLocal("not a date")).toBeNull();
	});
	it("groups statuses by what they ask of the learner", () => {
		expect([tone("running"), tone("needs-you"), tone("review"), tone("done"), tone("cancelled"), tone(null)]).toEqual(["live", "you", "you", "done", "stopped", "idle"]);
	});
});

describe("the strip", () => {
	it("places timed steps between start and end", () => {
		const s = spans(
			[
				{ tool: "read", detail: "a", at: 1000, end: 2000 },
				{ tool: "propose_edit", detail: "b", at: 6000, end: 6000 },
				{ tool: "old", detail: "untimed" },
				{ tool: "ask_learner", detail: "c", at: 9000 },
			],
			0,
			10_000,
		);
		expect(s.map((x) => [x.index, x.kind, x.left, x.running])).toEqual([
			[0, "read", 0.1, false],
			[1, "write", 0.6, false],
			[3, "ask", 0.9, true],
		]);
		expect(s[0].width).toBeCloseTo(0.1);
		expect(s[1].width).toBeGreaterThan(0);
		expect(s[2].width).toBeCloseTo(0.1);
	});
	it("knows a tool by what it does", () => {
		expect([stepKind("grep"), stepKind("obsidian"), stepKind("create_note"), stepKind("bash"), stepKind("ask_learner")]).toEqual(["read", "read", "write", "write", "ask"]);
	});
});

describe("words", () => {
	it("prints durations, models and costs briefly", () => {
		expect([duration(800), duration(7240), duration(48_000), duration(278_000), duration(7_500_000)]).toEqual(["0.8s", "7.2s", "48s", "4m 38s", "2h 05m"]);
		expect(modelName("openrouter/anthropic/claude-sonnet-4.5")).toBe("claude-sonnet-4.5");
		expect([costText(0.0421), costText(0.004), costText(1.5), costText("unknown"), costText(null)]).toEqual(["≈$0.042", "≈$0.0040", "≈$1.50", null, null]);
	});
});

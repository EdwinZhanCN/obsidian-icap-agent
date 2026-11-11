import { describe, expect, it } from "vite-plus/test";
import { readRecords } from "./records";
import { activityBase, applyTaskProperties, linkPath, linkTo, localDateTime, renderTaskNote, taskFileName, taskProperties, taskStatus, type TaskNote } from "./task-notes";

const at = (h: number, m: number) => new Date(2026, 10, 10, h, m, 5).getTime();
const note: TaskNote = { id: "b1", status: "running", source: "Contracts/Acme MSA.md", changed: [], started: at(14, 2), ended: null, cost: null, tokens: null, cache: null };

describe("task status", () => {
	it("maps the runtime's states onto icap-status", () => {
		expect(taskStatus({ status: "processing", reviewing: false })).toBe("running");
		expect(taskStatus({ status: "waiting", reviewing: false })).toBe("needs-you");
		expect(taskStatus({ status: "waiting", reviewing: true })).toBe("review");
		expect(taskStatus({ status: "completed", reviewing: false })).toBe("done");
		expect(taskStatus({ status: "failed", reviewing: false })).toBe("failed");
		expect(taskStatus({ status: "cancelled", reviewing: false })).toBe("cancelled");
	});
});

describe("task properties", () => {
	it("writes no property without a value", () => {
		expect(taskProperties(note)).toEqual({ icap: "task", "icap-id": "b1", "icap-status": "running", "icap-source": ["[[Contracts/Acme MSA]]"], "icap-started": "2026-11-10T14:02:05" });
		// Ended: the cost is always there, as a number or as "unknown".
		expect(taskProperties({ ...note, ended: at(14, 6) })["icap-cost"]).toBe("unknown");
		expect(taskProperties({ ...note, ended: at(14, 6), cost: 0.0421, tokens: 18452, cache: 83 })).toMatchObject({ "icap-cost": 0.0421, "icap-tokens": 18452, "icap-cache": 83 });
		expect(taskProperties({ ...note, cost: "unknown", tokens: 512, cache: 0 })).toMatchObject({ "icap-cost": "unknown", "icap-tokens": 512, "icap-cache": 0 });
		expect(Object.keys(taskProperties({ ...note, source: null }))).not.toContain("icap-source");
	});

	it("updates only its own properties and reports whether anything changed", () => {
		const fm: Record<string, unknown> = { ...taskProperties(note), tags: ["mine"], "icap-apply": "review" };
		expect(applyTaskProperties(fm, note)).toBe(false);
		const done = { ...note, status: "done" as const, changed: ["Learning/Renewal.md"], ended: at(14, 6) };
		expect(applyTaskProperties(fm, done)).toBe(true);
		expect(fm["icap-status"]).toBe("done");
		expect(fm["icap-changed"]).toEqual(["[[Learning/Renewal]]"]);
		expect(fm["icap-ended"]).toBe("2026-11-10T14:06:05");
		expect(fm.tags).toEqual(["mine"]);
		expect(fm["icap-apply"]).toBe("review");
		// The next round of the same block runs again: the end is removed, not left stale.
		expect(applyTaskProperties(fm, { ...done, status: "running", ended: null })).toBe(true);
		expect("icap-ended" in fm).toBe(false);
		expect(applyTaskProperties(fm, { ...done, status: "running", ended: null })).toBe(false);
	});

	it("links round-trip", () => {
		expect(linkPath(linkTo("A/B c.md"))).toBe("A/B c");
		expect(linkPath("[[A/B|alias]]")).toBe("A/B");
		expect(linkPath("plain")).toBeNull();
	});

	it("formats local date-times as Obsidian stores them", () => {
		expect(localDateTime(at(9, 3))).toBe("2026-11-10T09:03:05");
	});
});

describe("a new task note", () => {
	it("is read back by the reference reader", () => {
		const done = { ...note, status: "done" as const, changed: ["Learning/Renewal: terms.md"], ended: at(14, 6) };
		const md = renderTaskNote(done, "Summarise the “renewal” terms: all of them", "Asked in [[Contracts/Acme MSA]]; the conversation is in that note.");
		expect(readRecords(md).task).toEqual({
			id: "b1",
			status: "done",
			source: ["Contracts/Acme MSA"],
			changed: ["Learning/Renewal: terms"],
			started: "2026-11-10T14:02:05",
			ended: "2026-11-10T14:06:05",
			cost: "unknown",
		});
		const priced = renderTaskNote({ ...done, cost: 0.0421, tokens: 18452, cache: 83 }, "x", "");
		expect(readRecords(priced).task).toMatchObject({ cost: 0.0421, tokens: 18452, cache: 83 });
		expect(md.split("---")[2].trim().startsWith("Summarise the “renewal” terms")).toBe(true);
	});

	it("gets a file name the file system accepts", () => {
		expect(taskFileName("“What is a/b: c?”")).toBe("What is a b c");
		expect(taskFileName("  ...  ")).toBe("Task");
		expect(taskFileName("x".repeat(200)).length).toBe(60);
	});
});

describe("Activity.base", () => {
	const base = activityBase({ status: "状态", source: "笔记", changed: "改动", started: "开始", ended: "结束", minutes: "用时（分）", cost: "花费（$）", tokens: "Tokens", cache: "缓存命中（%）", needsMe: "需要我", inProgress: "进行中", all: "全部" });

	it("never writes a hyphenated property bare in an expression (Bases would subtract)", () => {
		const expressions = base.split("\n").filter((l) => /==|if\(/.test(l));
		expect(expressions.length).toBeGreaterThan(4);
		for (const e of expressions) expect(e.replace(/note\["icap(-[a-z]+)?"\]/g, "")).not.toMatch(/icap-/);
	});

	it("lists only task notes, in three views, with English keys and localized names", () => {
		expect(base).toContain(`'note["icap"] == "task"'`);
		expect(base.match(/- type: table/g)?.length).toBe(3);
		expect(base).toContain('name: "需要我"');
		expect(base).toContain("property: note.icap-status");
		expect(base).toContain("note.icap-cost: Sum");
	});
});

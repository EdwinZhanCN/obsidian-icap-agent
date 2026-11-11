import { describe, expect, it } from "vite-plus/test";
import { baseProblem, canvasProblem, noteTypeOf } from "./structures";

const node = (id: string, extra: object = {}) => ({ id, type: "text", text: "A", x: 0, y: 0, width: 260, height: 120, ...extra });

describe("canvasProblem", () => {
	it("accepts a valid canvas and an empty one", () => {
		const c = { nodes: [node("a"), node("b", { type: "file", file: "M.md", text: undefined, color: "4" })], edges: [{ id: "e", fromNode: "a", toNode: "b", toEnd: "arrow", fromSide: "right" }] };
		expect(canvasProblem(JSON.stringify(c))).toBeNull();
		expect(canvasProblem("{}")).toBeNull();
	});

	it("names what is wrong", () => {
		expect(canvasProblem("{nodes: []}")).toMatch(/not valid JSON/);
		expect(canvasProblem(JSON.stringify({ nodes: [node("a"), node("a")] }))).toMatch(/a is used twice/);
		expect(canvasProblem(JSON.stringify({ nodes: [node("a")], edges: [{ id: "e", fromNode: "a", toNode: "zz" }] }))).toMatch(/toNode must be the id of a node/);
		expect(canvasProblem(JSON.stringify({ nodes: [{ ...node("a"), x: "0" }] }))).toMatch(/x must be a number/);
		expect(canvasProblem(JSON.stringify({ nodes: [node("a", { type: "link" })] }))).toMatch(/needs "url"/);
		expect(canvasProblem(JSON.stringify({ nodes: [node("a", { color: "red" })] }))).toMatch(/color/);
	});
});

describe("baseProblem", () => {
	it("accepts a base whose formulas are defined", () => {
		const b = { filters: { and: ['file.inFolder("P")'] }, formulas: { age: "(today() - file.ctime).days" }, views: [{ type: "table", order: ["file.name", "formula.age"] }] };
		expect(baseProblem(b)).toBeNull();
	});

	it("names what is wrong", () => {
		expect(baseProblem(null)).toMatch(/empty/);
		expect(baseProblem({ filters: "x" })).toMatch(/needs views/);
		expect(baseProblem({ views: [{ type: "grid" }] })).toMatch(/type must be table/);
		expect(baseProblem({ views: [{ type: "table", order: ["formula.total"] }] })).toMatch(/formula\.total is used but not defined/);
	});
});

it("noteTypeOf reads the extension", () => {
	expect(noteTypeOf("a/b.canvas")).toBe("canvas");
	expect(noteTypeOf("b.base")).toBe("base");
	expect(noteTypeOf("b.md")).toBe("note");
});

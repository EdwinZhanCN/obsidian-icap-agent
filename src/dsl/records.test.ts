import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { readRecords } from "./records";

/**
 * FORMAT.md conformance: each fixture note has the JSON a reader must produce from it, in a shape
 * any language can compare against (the Hub runs the same fixtures).
 */
const dir = new URL("../../test/fixtures/format/", import.meta.url).pathname;

const notes = readdirSync(dir).filter((f) => f.endsWith(".md"));

describe("format fixtures", () => {
	it("has fixtures", () => expect(notes.length).toBeGreaterThan(0));
	for (const f of notes) {
		it(f, () => {
			const want = JSON.parse(readFileSync(join(dir, f.replace(/\.md$/, ".json")), "utf8"));
			expect(readRecords(readFileSync(join(dir, f), "utf8"))).toEqual(want);
		});
	}
});

import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { evidenceCallout, evidenceComment, glossCallout, parseEvidenceComment, quoteValue } from "../../../src/dsl/blocks";
import { readRecords } from "../../../src/dsl/records";



describe("what the writer leaves is what the reader sees", () => {
	it("quotes a topic so no quote or --> escapes the comment", () => {
		expect(quoteValue(' a "b"  --> \\c ')).toBe('"a \\"b\\" --\\> \\\\c"');
		const e = { kind: "recall" as const, id: "q1", date: "2026-11-07", verdict: "holds" as const, topic: 'say "hi" --> bye' };
		const c = evidenceComment(e);
		expect(c).not.toMatch(/-->.*-->/);
		expect(parseEvidenceComment(c)).toEqual(e);
	});
	it("pairs a multi-paragraph recall answer with its record", () => {
		const md = ["# T", "", "Intro.", "", "First.", "", "Second.", "", evidenceCallout("feedback", "T", { kind: "recall", id: "q1", date: "2026-11-07", topic: "T", paragraphs: 2 }, "Ok.")].join("\n");
		expect(md).toContain("paragraphs=2");
		expect(readRecords(md).records[0].learnerText).toBe("First.\n\nSecond.");
	});
	it("records a kept gloss: id, date, full term, depth", () => {
		const long = "a".repeat(70);
		const md = glossCallout(long, "Body.", [], { id: "g1", date: "2026-11-07", depth: ["plainer"] });
		expect(md.split("\n")[0]).toBe(`<!-- icap gloss id=g1 date=2026-11-07 depth=plainer topic="${long}" -->`);
		const [r] = readRecords(md).records;
		expect(r).toMatchObject({ kind: "gloss", id: "g1", date: "2026-11-07", topic: long, depth: ["plainer"] });
		expect(r.title.endsWith("…")).toBe(true);
		expect(glossCallout("RAII", "Body.", []).startsWith("> [!gloss] RAII")).toBe(true);
	});
});

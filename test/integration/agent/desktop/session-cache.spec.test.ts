import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { blockOfFile, removeSessions, sessionExists, sessionId } from "../../../../src/agent/desktop/session-cache";



describe("session files", () => {
	it("finds and removes a block's sessions, and prunes the rest", () => {
		const dir = mkdtempSync(join(tmpdir(), "icap-sessions-"));
		const touch = (n: string) => writeFileSync(join(dir, n), "{}\n");
		touch(`2026-11-04T10-00-00_${sessionId("qa1", 1)}.jsonl`);
		touch(`2026-11-04T10-05-00_${sessionId("qa1", 2)}.jsonl`);
		touch(`2026-11-04T10-06-00_${sessionId("qb2", 1)}.jsonl`);
		touch("2026-11-04T10-07-00_someone-elses.jsonl");
		expect(blockOfFile(`x_${sessionId("qa1", 12)}.jsonl`)).toBe("qa1");
		expect(sessionId("qa1", 1)).toBe("icap-qa1-1");
		expect(blockOfFile("x_icpa-qold-3.jsonl")).toBe("qold"); // sessions from before the rename
		expect(sessionExists(dir, sessionId("qa1", 2))).toBe(true);
		expect(removeSessions(dir, { block: "qa1" })).toBe(2);
		expect(removeSessions(dir, { keep: new Set(["qb2"]) })).toBe(0);
		expect(removeSessions(dir, { keep: new Set() })).toBe(1);
		expect(readdirSync(dir)).toEqual(["2026-11-04T10-07-00_someone-elses.jsonl"]);
	});
});

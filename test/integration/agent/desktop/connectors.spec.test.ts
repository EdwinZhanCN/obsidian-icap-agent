import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import * as sdk from "../../../../src/agent/desktop/pi-sdk-entry";
import { DesktopConnectors } from "../../../../src/agent/desktop/connectors";
import type { PiSdk } from "../../../../src/agent/desktop/pi-host";

/** The harness's own mcp.json functions, on a scratch agent folder: never the learner's ~/.pi/agent. */
function scratch(initial?: string) {
	const dir = mkdtempSync(join(tmpdir(), "icap-mcp-"));
	if (initial !== undefined) writeFileSync(join(dir, "mcp.json"), initial);
	const pi = { ...sdk, getAgentDir: () => dir } as unknown as PiSdk;
	return { dir, c: new DesktopConnectors(async () => pi), read: () => readFileSync(join(dir, "mcp.json"), "utf8") };
}

describe("connectors in mcp.json", () => {
	it("lists, adds, turns off and removes servers, keeping the rest of the file", async () => {
		const { c, read } = scratch(JSON.stringify({ autoEnableCodemode: false, mcpServers: { fs: { command: "npx", args: ["-y", "server fs"] } } }, null, 4));
		expect((await c.list()).servers).toEqual([{ name: "fs", kind: "stdio", target: 'npx -y "server fs"', enabled: true }]);

		await c.add("docs", { url: "https://example.com/mcp" });
		await c.setEnabled("fs", false);
		const listed = (await c.list()).servers;
		expect(listed.map((s) => [s.name, s.kind, s.enabled])).toEqual([
			["fs", "stdio", false],
			["docs", "http", true],
		]);
		const file = JSON.parse(read());
		expect(file.autoEnableCodemode).toBe(false);
		expect(file.mcpServers.docs).toEqual({ url: "https://example.com/mcp" });
		expect(read()).toContain('\n    "mcpServers"');

		await c.setEnabled("fs", true);
		expect(JSON.parse(read()).mcpServers.fs.enabled).toBeUndefined();
		await c.remove("docs");
		expect(Object.keys(JSON.parse(read()).mcpServers)).toEqual(["fs"]);
	});

	it("creates the file, and refuses a taken name, a bad name and a bad URL", async () => {
		const { c, read } = scratch();
		await c.add("notion", { command: "npx", args: ["-y", "notion-mcp"] });
		expect(JSON.parse(read()).mcpServers.notion).toEqual({ command: "npx", args: ["-y", "notion-mcp"] });
		await expect(c.add("notion", { url: "https://x.dev/mcp" })).rejects.toThrow(/notion/);
		await expect(c.add("my docs", { url: "https://x.dev/mcp" })).rejects.toThrow();
		await expect(c.add("docs", { url: "x.dev/mcp" })).rejects.toThrow();
		await expect(c.add("empty", { command: "", args: [] })).rejects.toThrow();
	});

	it("says what in the file cannot be read", async () => {
		const { c } = scratch("{ not json");
		const r = await c.list();
		expect(r.servers).toEqual([]);
		expect(r.errors.length).toBe(1);
	});
});

import { describe, expect, it } from "vite-plus/test";
import { CONNECTOR_NAME, joinCommand, splitCommand } from "./connectors";

describe("connectors", () => {
	it("splits a command line the way a shell would", () => {
		expect(splitCommand("npx -y @modelcontextprotocol/server-filesystem .")).toEqual(["npx", "-y", "@modelcontextprotocol/server-filesystem", "."]);
		expect(splitCommand(`node "/Users/me/My Servers/x.js" --name 'a b' c\\ d`)).toEqual(["node", "/Users/me/My Servers/x.js", "--name", "a b", "c d"]);
		expect(splitCommand(`run ""  `)).toEqual(["run", ""]);
		expect(splitCommand("   ")).toEqual([]);
	});
	it("shows a command line back, quoting what needs it", () => {
		expect(joinCommand("node", ["/a b/x.js", "-y"])).toBe('node "/a b/x.js" -y');
		expect(splitCommand(joinCommand("node", ["/a b/x.js", "-y"]))).toEqual(["node", "/a b/x.js", "-y"]);
	});
	it("takes the names tool names can be built from", () => {
		expect(["notion", "my-docs_2"].every((n) => CONNECTOR_NAME.test(n))).toBe(true);
		expect(["my docs", "a.b", ""].some((n) => CONNECTOR_NAME.test(n))).toBe(false);
	});
});

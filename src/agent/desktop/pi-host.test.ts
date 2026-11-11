import { describe, expect, it } from "vite-plus/test";
import { envAdditions, parseEnv } from "./pi-host";



describe("login shell environment", () => {
	it("parses env -0 output, keeping = and newlines in values", () => {
		expect(parseEnv("PATH=/bin:/usr/bin\0DEEPSEEK_API_KEY=sk-a=b\0MULTI=line1\nline2\0")).toEqual({
			PATH: "/bin:/usr/bin",
			DEEPSEEK_API_KEY: "sk-a=b",
			MULTI: "line1\nline2",
		});
	});
	it("adds only what Obsidian lacks, and the shell's PATH first", () => {
		const add = envAdditions({ HOME: "/h", PATH: "/usr/bin", KEEP: "mine" }, { PATH: "/opt/pi/bin:/usr/bin", KEEP: "shell", DEEPSEEK_API_KEY: "sk", SHLVL: "2" });
		expect(add.DEEPSEEK_API_KEY).toBe("sk");
		expect(add.KEEP).toBeUndefined();
		expect(add.SHLVL).toBeUndefined();
		expect(add.PATH?.split(":").slice(0, 2)).toEqual(["/opt/pi/bin", "/usr/bin"]);
		expect(add.PATH?.split(":").filter((p) => p === "/usr/bin")).toHaveLength(1);
	});
});

import { oldNode } from "./pi-host";

describe("oldNode", () => {
	it("lets Node 22.18 and later run Pi", () => {
		for (const v of ["22.18.0", "22.22.1", "24.21.0"]) expect(oldNode(v)).toBeNull();
	});
	it("names the installer's Node when it is too old", () => {
		for (const v of ["20.18.3", "22.14.0"]) expect(oldNode(v)).toContain(v);
	});
});

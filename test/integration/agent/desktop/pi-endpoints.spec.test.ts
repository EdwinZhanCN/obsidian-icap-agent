import { mkdtempSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { endpointProblem, listEndpoints, parseModelIds, removeEndpoint, saveEndpoint, type Endpoint } from "../../../../src/agent/desktop/pi-endpoints";

const ep = (o: Partial<Endpoint> = {}): Endpoint => ({ id: "proxy", name: "My proxy", baseUrl: "https://example.com/v1", api: "openai-completions", apiKey: "sk-abc", models: ["m1"], ...o });

const dir = () => mkdtempSync(join(tmpdir(), "icap-endpoints-"));

const read = (d: string) => JSON.parse(readFileSync(join(d, "models.json"), "utf8"));

describe("Pi reads what the form writes", () => {
	it("offers the saved models", async () => {
		const d = dir();
		saveEndpoint(d, ep({ id: "local", apiKey: "x", models: ["qwen2.5", "llama3"] }));
		process.env.PI_CODING_AGENT_DIR = d;
		const pi = await import("../../../../src/agent/desktop/pi-sdk-entry");
		const runtime = await pi.ModelRuntime.create();
		expect(runtime.getModel("local", "qwen2.5")?.baseUrl).toBe("https://example.com/v1");
		expect(runtime.getModel("local", "llama3")).toBeTruthy();
	});
});

describe("custom endpoints in Pi's models.json", () => {
	it("creates the file and lists what it wrote", () => {
		const d = dir();
		saveEndpoint(d, ep());
		expect(listEndpoints(d)).toEqual([ep()]);
		expect(read(d).providers.proxy).toEqual({ name: "My proxy", baseUrl: "https://example.com/v1", api: "openai-completions", apiKey: "sk-abc", models: [{ id: "m1" }] });
		if (process.platform !== "win32") expect(statSync(join(d, "models.json")).mode & 0o077).toBe(0);
	});

	it("keeps everything else in the file, and a kept model's own fields", () => {
		const d = dir();
		writeFileSync(
			join(d, "models.json"),
			JSON.stringify({ providers: { anthropic: { baseUrl: "https://p/v1" }, proxy: { baseUrl: "https://old/v1", api: "openai-completions", headers: { x: "1" }, models: [{ id: "m1", contextWindow: 9000 }] } }, other: 1 }),
		);
		saveEndpoint(d, ep({ models: ["m1", "m2"] }), "proxy");
		const f = read(d);
		expect(f.other).toBe(1);
		expect(f.providers.anthropic).toEqual({ baseUrl: "https://p/v1" });
		expect(f.providers.proxy.headers).toEqual({ x: "1" });
		expect(f.providers.proxy.models).toEqual([{ id: "m1", contextWindow: 9000 }, { id: "m2" }]);
		// The built-in provider override has no models: not an endpoint the form shows.
		expect(listEndpoints(d).map((e) => e.id)).toEqual(["proxy"]);
	});

	it("renames and removes", () => {
		const d = dir();
		saveEndpoint(d, ep());
		saveEndpoint(d, ep({ id: "renamed" }), "proxy");
		expect(Object.keys(read(d).providers)).toEqual(["renamed"]);
		removeEndpoint(d, "renamed");
		expect(listEndpoints(d)).toEqual([]);
	});

	it("never overwrites a file it cannot read", () => {
		const d = dir();
		writeFileSync(join(d, "models.json"), "{ not json");
		expect(() => saveEndpoint(d, ep())).toThrow(/not valid JSON/);
		expect(readFileSync(join(d, "models.json"), "utf8")).toBe("{ not json");
	});

	it("rejects a bad form", () => {
		expect(endpointProblem(ep(), [], null)).toBeUndefined();
		expect(endpointProblem(ep({ id: "Bad Id" }), [], null)).toBe("id");
		expect(endpointProblem(ep(), ["proxy"], null)).toBe("id-taken");
		expect(endpointProblem(ep(), ["proxy"], "proxy")).toBeUndefined();
		expect(endpointProblem(ep({ baseUrl: "example.com" }), [], null)).toBe("url");
		expect(endpointProblem(ep({ models: [] }), [], null)).toBe("models");
		expect(endpointProblem(ep({ apiKey: "密钥" }), [], null)).toBe("key");
		expect(endpointProblem(ep({ apiKey: "$MY_KEY" }), [], null)).toBeUndefined();
	});

	it("parses model ids", () => {
		expect(parseModelIds("a, b\n\n c\na")).toEqual(["a", "b", "c"]);
	});
});

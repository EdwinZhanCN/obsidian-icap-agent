import { describe, expect, it } from "vite-plus/test";
import { MOBILE_APIS, MOBILE_PROVIDERS, defaultModel, endpointModel, endpointSecretId, providerSecretId, slugOf, transportOf, type MobileEndpoint } from "./providers";
import { probeTransport, requestPath, wholeFetch, type RequestUrl } from "./transport";

const endpoint = (transport: "stream" | "whole"): MobileEndpoint => ({ id: "lan", name: "LAN", baseUrl: "http://10.0.0.2:11434/v1/", api: "openai-completions", models: ["qwen3"], transport, hasKey: false });

describe("the transport rule", () => {
	it("every built-in provider streams; an endpoint uses what its probe found", () => {
		for (const p of MOBILE_PROVIDERS) expect(transportOf(p.id, []), p.id).toBe("stream");
		expect(transportOf("lan", [endpoint("whole")])).toBe("whole");
		expect(transportOf("lan", [endpoint("stream")])).toBe("stream");
		expect(() => transportOf("bedrock", [])).toThrow(/Unknown provider/);
	});

	it("offers the eight providers, each with models it can speak and a default", () => {
		expect(MOBILE_PROVIDERS.map((p) => p.id)).toEqual(["anthropic", "openai", "google", "openrouter", "deepseek", "mistral", "groq", "xai"]);
		for (const p of MOBILE_PROVIDERS) {
			const models = p.models();
			expect(models.length, p.id).toBeGreaterThan(0);
			for (const m of models) expect(MOBILE_APIS as readonly string[], `${p.id}/${m.id}`).toContain(m.api);
			expect(defaultModel(p), p.id).toBeTruthy();
		}
	});

	it("an endpoint's model is a pi-ai model at its base URL", () => {
		expect(endpointModel(endpoint("stream"), "qwen3")).toMatchObject({ id: "qwen3", provider: "lan", api: "openai-completions", baseUrl: "http://10.0.0.2:11434/v1" });
	});
});

describe("secret ids", () => {
	it("are icap-<provider> and icap-endpoint-<slug>", () => {
		expect(providerSecretId("anthropic")).toBe("icap-anthropic");
		expect(endpointSecretId("my-ollama")).toBe("icap-endpoint-my-ollama");
	});

	it("anything but lowercase letters, digits and dashes throws", () => {
		expect(() => providerSecretId("Open AI")).toThrow(/secret id/);
		expect(() => endpointSecretId("a_b")).toThrow(/secret id/);
		expect(() => endpointSecretId("")).toThrow(/secret id/);
	});

	it("a name becomes a valid slug", () => {
		expect(slugOf("My Ollama (LAN)")).toBe("my-ollama-lan");
		expect(() => endpointSecretId(slugOf("LM Studio 2"))).not.toThrow();
	});
});

describe("wholeFetch: requestUrl as a fetch", () => {
	const sse = 'data: {"a":1}\n\ndata: [DONE]\n\n';

	it("returns a standard Response whose body is the whole text", async () => {
		const seen: Parameters<RequestUrl>[0][] = [];
		const f = wholeFetch(async (req) => {
			seen.push(req);
			return { status: 200, headers: { "content-type": "text/event-stream", "content-length": "999", "content-encoding": "gzip" }, text: sse };
		});
		const res = await f("http://x/v1/chat/completions", { method: "POST", headers: { Authorization: "Bearer k" }, body: '{"q":1}' });
		expect(res).toBeInstanceOf(Response);
		expect(res.ok).toBe(true);
		expect(res.headers.get("content-type")).toBe("text/event-stream");
		// The body is decoded text now: the wire length and encoding no longer describe it.
		expect(res.headers.get("content-length")).toBeNull();
		expect(res.headers.get("content-encoding")).toBeNull();
		expect(seen[0]).toMatchObject({ url: "http://x/v1/chat/completions", method: "POST", headers: { authorization: "Bearer k" }, body: '{"q":1}', throw: false });
	});

	it("its body reads as a stream the SDKs parse event by event", async () => {
		const f = wholeFetch(async () => ({ status: 200, headers: {}, text: sse }));
		const reader = (await f("http://x", {})).body!.pipeThrough(new TextDecoderStream()).getReader();
		let all = "";
		for (let r = await reader.read(); !r.done; r = await reader.read()) all += r.value;
		expect(all).toBe(sse);
	});

	it("keeps HTTP errors as statuses (requestUrl must not throw them)", async () => {
		const f = wholeFetch(async () => ({ status: 401, headers: {}, text: '{"error":"bad key"}' }));
		const res = await f("http://x", {});
		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "bad key" });
	});

	it("stopping rejects at once and discards the late result", async () => {
		let finish!: (v: { status: number; headers: Record<string, string>; text: string }) => void;
		const f = wholeFetch(() => new Promise((r) => (finish = r)));
		const ac = new AbortController();
		const p = f("http://x", { signal: ac.signal });
		await Promise.resolve();
		ac.abort();
		await expect(p).rejects.toMatchObject({ name: "AbortError" });
		finish({ status: 200, headers: {}, text: "late" });
	});

	it("an aborted signal never sends", async () => {
		let sent = false;
		const ac = new AbortController();
		ac.abort();
		await expect(
			wholeFetch(async () => {
				sent = true;
				return { status: 200, headers: {}, text: "" };
			})("http://x", { signal: ac.signal }),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(sent).toBe(false);
	});
});

describe("probeTransport", () => {
	it("aims at the real request path of the API", () => {
		expect(requestPath("openai-completions", "http://h/v1/")).toBe("http://h/v1/chat/completions");
		expect(requestPath("openai-responses", "http://h/v1")).toBe("http://h/v1/responses");
		expect(requestPath("anthropic-messages", "http://h")).toBe("http://h/v1/messages");
	});

	it("any status read back, even 401, means stream", async () => {
		let auth = "";
		const f = (async (_u: string, init: RequestInit) => {
			auth = new Headers(init.headers).get("authorization") ?? "";
			return new Response("unauthorized", { status: 401 });
		}) as unknown as typeof fetch;
		expect(await probeTransport("openai-completions", "http://h/v1", f)).toBe("stream");
		expect(auth).toBe("Bearer icap-probe-invalid");
	});

	it("a thrown TypeError (CORS refused, unreachable) means whole", async () => {
		const f = (async () => {
			throw new TypeError("Load failed");
		}) as unknown as typeof fetch;
		expect(await probeTransport("anthropic-messages", "http://h", f)).toBe("whole");
	});
});

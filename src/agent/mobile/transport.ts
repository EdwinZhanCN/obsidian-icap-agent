import type { EndpointApi, Transport } from "./providers";

/**
 * How a request reaches a model on mobile.
 *
 * "stream": the WebView's own fetch. Streams token by token and can be aborted, but only reaches
 * servers that allow cross-origin requests (CORS) — every built-in provider does.
 *
 * "whole": Obsidian's requestUrl, which is not subject to CORS (a local Ollama, a proxy) but returns
 * the response only once it is complete and cannot be aborted. wholeFetch wraps it as a standard
 * fetch, so pi-ai's adapters parse the server-sent events of the whole body as usual.
 */

/** The part of Obsidian's requestUrl wholeFetch needs (injected: tests and the vm run have no Obsidian). */
export type RequestUrl = (req: { url: string; method?: string; headers?: Record<string, string>; body?: string | ArrayBuffer; throw?: boolean }) => Promise<{
	status: number;
	headers: Record<string, string>;
	text: string;
}>;

function abortError(): Error {
	const e = new Error("The operation was aborted.");
	e.name = "AbortError";
	return e;
}

function headerRecord(h: HeadersInit | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (!h) return out;
	new Headers(h).forEach((v, k) => (out[k] = v));
	return out;
}

async function bodyOf(body: BodyInit | null | undefined): Promise<string | ArrayBuffer | undefined> {
	if (body == null) return undefined;
	if (typeof body === "string") return body;
	if (body instanceof ArrayBuffer) return body;
	if (ArrayBuffer.isView(body)) return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
	return await new Response(body).text();
}

/**
 * requestUrl as a fetch. The Response's body is the whole text. A signal that aborts while the request
 * runs rejects with AbortError at once; the request itself carries on and its result is discarded.
 */
export function wholeFetch(requestUrl: RequestUrl): typeof fetch {
	return async (input, init) => {
		const signal = init?.signal ?? undefined;
		if (signal?.aborted) throw abortError();
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		const req = requestUrl({
			url,
			method: init?.method ?? (input instanceof Request ? input.method : "GET"),
			headers: headerRecord(init?.headers ?? (input instanceof Request ? input.headers : undefined)),
			body: await bodyOf(init?.body),
			throw: false,
		});
		const res = await new Promise<Awaited<ReturnType<RequestUrl>>>((resolve, reject) => {
			const onAbort = () => reject(abortError());
			signal?.addEventListener("abort", onAbort, { once: true });
			req.then(
				(r) => (signal?.removeEventListener("abort", onAbort), resolve(r)),
				(e: unknown) => (signal?.removeEventListener("abort", onAbort), reject(e instanceof Error ? e : new Error(String(e)))),
			);
		});
		const headers = new Headers();
		for (const [k, v] of Object.entries(res.headers ?? {})) {
			// The body is already decoded text: a length or encoding of the wire form no longer applies.
			if (!/^(content-length|content-encoding|transfer-encoding)$/i.test(k)) headers.set(k, v);
		}
		const status = res.status >= 200 && res.status <= 599 ? res.status : 502;
		const empty = status === 204 || status === 205 || status === 304;
		return new Response(empty ? null : res.text, { status, headers });
	};
}

/** The URL a request of this API type goes to (the probe aims at the real thing). */
export function requestPath(api: EndpointApi, baseUrl: string): string {
	const base = baseUrl.replace(/\/+$/, "");
	return api === "anthropic-messages" ? `${base}/v1/messages` : api === "openai-responses" ? `${base}/responses` : `${base}/chat/completions`;
}

/**
 * Which transport a custom endpoint needs, measured once when it is saved: a POST through the WebView's
 * fetch with an invalid key. Any HTTP status read back (even 401) means the server allows cross-origin
 * requests → "stream". A thrown TypeError (CORS refused, or unreachable from the WebView) → "whole".
 */
export async function probeTransport(api: EndpointApi, baseUrl: string, f: typeof fetch = globalThis.fetch, timeoutMs = 10000): Promise<Transport> {
	const headers: Record<string, string> = { "content-type": "application/json" };
	if (api === "anthropic-messages") {
		headers["x-api-key"] = "icap-probe-invalid";
		headers["anthropic-version"] = "2023-06-01";
	} else headers.authorization = "Bearer icap-probe-invalid";
	try {
		const res = await f(requestPath(api, baseUrl), {
			method: "POST",
			headers,
			body: JSON.stringify({ model: "icap-probe", max_tokens: 1, messages: [{ role: "user", content: "ping" }] }),
			signal: AbortSignal.timeout(timeoutMs),
		});
		void res.body?.cancel().catch(() => undefined);
		return "stream";
	} catch {
		return "whole";
	}
}

import * as timers from "timers";
import * as web from "stream/web";
import { Blob as NodeBlob, File as NodeFile } from "buffer";
import { fileURLToPath } from "url";
import { performance as nodePerformance } from "perf_hooks";
import type * as Undici from "undici";

/**
 * Node's versions of the browser globals Pi relies on. Obsidian's renderer is a browser page with Node
 * alongside, so `fetch`, timers, web streams and Blob are Chromium's — Pi's CLI runs where they are
 * Node's. scripts/build/pi-bundle.ts points these names inside Pi's bundle here (define + inject); Obsidian's
 * own globals are left alone. Nothing here may load at import time what Pi itself imports (undici is
 * required on first use), or the bundle's initialization would become circular.
 */

/* Timers: Node code (undici, Pi) calls .unref() / .refresh() on them, which Chromium's numbers lack. */
export const __icapSetTimeout = timers.setTimeout;
export const __icapClearTimeout = timers.clearTimeout;
export const __icapSetInterval = timers.setInterval;
export const __icapClearInterval = timers.clearInterval;

/* Web streams, Blob, File: undici's fetch mixes the globals with node:stream/web internals. */
export const __icapReadableStream = web.ReadableStream;
export const __icapWritableStream = web.WritableStream;
export const __icapTransformStream = web.TransformStream;
export const __icapTextDecoderStream = web.TextDecoderStream;
export const __icapTextEncoderStream = web.TextEncoderStream;
export const __icapCompressionStream = web.CompressionStream;
export const __icapDecompressionStream = web.DecompressionStream;
export const __icapByteLengthQueuingStrategy = web.ByteLengthQueuingStrategy;
export const __icapCountQueuingStrategy = web.CountQueuingStrategy;
export const __icapReadableStreamDefaultReader = web.ReadableStreamDefaultReader;
export const __icapReadableStreamBYOBReader = web.ReadableStreamBYOBReader;
export const __icapWritableStreamDefaultWriter = web.WritableStreamDefaultWriter;
export const __icapBlob = NodeBlob;
/* undici records resource timing with performance.markResourceTiming, which Chromium's lacks. */
export const __icapPerformance = nodePerformance;
export const __icapFile = NodeFile;

/*
 * import(specifier) with a specifier computed at runtime (jiti loading Node built-ins for the learner's
 * extensions, pi-ai's Node helpers): in the renderer, import() is Chromium's module loader, which knows
 * no node: modules. Node's require does.
 */
export function __icapImport(specifier: unknown): Promise<unknown> {
	return new Promise((resolve, reject) => {
		try {
			const s = specifier instanceof URL ? specifier.href : String(specifier);
			const mod: unknown = require(s.startsWith("file:") ? fileURLToPath(s) : s);
			const esm = !!mod && typeof mod === "object" && (mod as { __esModule?: unknown }).__esModule;
			resolve(esm ? mod : { ...(mod as object), default: mod });
		} catch (e) {
			reject(e instanceof Error ? e : new Error(String(e)));
		}
	});
}

/*
 * fetch: Pi's network calls go through Node (undici). Chromium applies CORS to the renderer, and
 * several providers refuse cross-origin requests (OpenAI's Responses API, Anthropic's OAuth token
 * exchange, GitHub's device login); Node is not subject to CORS, as when Pi runs in a terminal. Like
 * the Pi CLI: HTTP(S)_PROXY / NO_PROXY are honoured, no HTTP/2, five-minute idle timeouts.
 */

let undici: typeof Undici | undefined;
let dispatcher: Undici.EnvHttpProxyAgent | undefined;

function agent(u: typeof Undici): Undici.EnvHttpProxyAgent {
	if (!dispatcher) {
		dispatcher = new u.EnvHttpProxyAgent({
			allowH2: false,
			proxyTunnel: true,
			bodyTimeout: 300_000,
			headersTimeout: 300_000,
			connect: { autoSelectFamilyAttemptTimeout: 2_000 },
		});
		// undici can emit an internal error while a streamed body is torn down; the body's reader
		// rejects on its own, so this only keeps it from becoming an uncaught "error" event.
		(dispatcher as unknown as NodeJS.EventEmitter).on("error", () => undefined);
	}
	return dispatcher;
}

type Init = Record<string, unknown>;

/** A Request built with the renderer's class, which undici does not accept: re-read it as url + init. */
async function fromForeignRequest(r: { url: string; method: string; headers: Iterable<[string, string]>; signal?: unknown; arrayBuffer(): Promise<ArrayBuffer> }): Promise<[string, Init]> {
	const body = r.method === "GET" || r.method === "HEAD" ? undefined : await r.arrayBuffer();
	return [r.url, { method: r.method, headers: [...r.headers], body, signal: r.signal }];
}

export async function __icapFetch(input: unknown, init?: Init): Promise<Response> {
	const u = (undici ??= require("undici") as typeof Undici);
	let url = input;
	let options: Init = { ...(init ?? {}) };
	if (input && typeof input === "object" && !(input instanceof u.Request)) {
		if ("url" in input && "method" in input) {
			const [s, base] = await fromForeignRequest(input as Parameters<typeof fromForeignRequest>[0]);
			url = s;
			options = { ...base, ...options };
		} else {
			url = String(input); // the renderer's URL class
		}
	}
	return (await u.fetch(url as string, { ...options, dispatcher: agent(u) })) as unknown as Response;
}

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { UserConfig } from "vite-plus/pack";
import type { Plugin } from "vite/rolldown";

export const piEntry = resolve("src/agent/desktop/pi-sdk-entry.ts");
export const piBundle = resolve("build/pi-sdk.cjs");
const shim = resolve("src/agent/desktop/pi-node.ts");
const globals = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "ReadableStream", "WritableStream", "TransformStream", "TextDecoderStream", "TextEncoderStream", "CompressionStream", "DecompressionStream", "ByteLengthQueuingStrategy", "CountQueuingStrategy", "ReadableStreamDefaultReader", "ReadableStreamBYOBReader", "WritableStreamDefaultWriter", "Blob", "File", "performance"];
const names = { fetch: "__icapFetch", ...Object.fromEntries(globals.map(n => [n, `__icap${n[0].toUpperCase()}${n.slice(1)}`])) };

/**
 * What three of the harness's dependencies need to run from one CommonJS bundle in Obsidian's renderer.
 * The harness itself (pi/, a fork) needs none: what used to be patched in Pi's own files is changed
 * there. Each patch throws when its dependency no longer has the code it changes.
 */
export function bundlePatches(): Plugin {
  return {
    name: "icap-bundle-patches",
    async load(id) {
      if (/photon-node\/photon_rs\.js$/.test(id)) {
        // The WASM is read from a file next to the module, which a bundle does not have: embed it.
        const src = await readFile(id, "utf8");
        const read = "const path = require('path').join(__dirname, 'photon_rs_bg.wasm');\nconst bytes = require('fs').readFileSync(path);";
        if (!src.includes(read)) throw new Error("photon-node changed its WASM loader; update bundlePatches");
        return src.replace(read, "const bytes = require('./photon_rs_bg.wasm');");
      }
      if (/undici\/index\.js$/.test(id)) {
        // install() assigns the real globals; ICAP never calls it, and the fetch define must not rewrite it.
        const src = await readFile(id, "utf8");
        const assign = "globalThis.fetch = module.exports.fetch";
        if (!src.includes(assign)) throw new Error("undici changed install(); update bundlePatches");
        return src.replace(assign, "Object.assign(globalThis, { fetch: module.exports.fetch })");
      }
      if (/pi-ai\/dist\/(env-api-keys|auth\/context|auth\/oauth\/load|api\/bedrock-converse-stream\.lazy)\.js$/.test(id)) {
        // pi-ai imports these through specifiers computed at run time, which a bundle cannot follow.
        const src = await readFile(id, "utf8");
        const out = src.replace(/(?<![\w$."'`])import\((?!["'`])/g, "__icapImport(");
        if (out === src) throw new Error(`${id}: runtime import patch no longer matches`);
        return out;
      }
    },
  };
}

export function piPack(): UserConfig {
  return {
    entry: { "pi-sdk": piEntry }, outDir: "build", format: "cjs", target: "node22",
    clean: false, dts: false, minify: true, sourcemap: false, platform: "node",
    deps: { alwaysBundle: [/./], neverBundle: ["electron", "kerberos"], onlyBundle: false },
    define: {
      "import.meta.url": "globalThis.__ICAP_PI_URL",
      ...Object.fromEntries(Object.entries(names).flatMap(([name, to]) => ["", "globalThis.", "window.", "self."].map(prefix => [prefix + name, to]))),
    },
    inputOptions: { transform: { inject: Object.fromEntries([...Object.values(names), "__icapImport"].map(n => [n, [shim, n] as [string, string]])) } },
    outputOptions: { codeSplitting: false, dynamicImportInCjs: false },
    loader: { ".wasm": "binary" }, plugins: [bundlePatches()],
  };
}

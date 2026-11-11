import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { UserConfig } from "vite-plus/pack";
import type { Plugin } from "vite/rolldown";

export const piEntry = resolve("src/agent/desktop/pi-sdk-entry.ts");
export const piBundle = resolve("build/pi-sdk.cjs");
const shim = resolve("src/agent/desktop/pi-node.ts");
const globals = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "ReadableStream", "WritableStream", "TransformStream", "TextDecoderStream", "TextEncoderStream", "CompressionStream", "DecompressionStream", "ByteLengthQueuingStrategy", "CountQueuingStrategy", "ReadableStreamDefaultReader", "ReadableStreamBYOBReader", "WritableStreamDefaultWriter", "Blob", "File", "performance"];
const names = { fetch: "__icapFetch", ...Object.fromEntries(globals.map(n => [n, `__icap${n[0].toUpperCase()}${n.slice(1)}`])) };

/** Keep upstream-sensitive patches fail-fast when upgrading Pi. */
export function piPatches(): Plugin {
  return {
    name: "icap-pi-patches",
    async load(id) {
      if (/pi-coding-agent\/dist\/config\.js$/.test(id)) {
        const src = await readFile(id, "utf8");
        const pkg = JSON.parse(await readFile(resolve("node_modules/@earendil-works/pi-coding-agent/package.json"), "utf8"));
        const declaration = "let pkg = {};";
        const read = 'pkg = JSON.parse(stripBom(readFileSync(packageJsonPath, "utf-8")));';
        if (!src.includes(declaration) || !src.includes(read)) throw new Error(`Pi ${pkg.version}: update piPatches for config.js`);
        return src.replace(declaration, `let pkg = ${JSON.stringify({ name: pkg.name, version: pkg.version, piConfig: pkg.piConfig })};`).replace(read, "");
      }
      if (/photon-node\/photon_rs\.js$/.test(id)) {
        const src = await readFile(id, "utf8");
        const read = "const path = require('path').join(__dirname, 'photon_rs_bg.wasm');\nconst bytes = require('fs').readFileSync(path);";
        if (!src.includes(read)) throw new Error("photon-node changed its WASM loader; update piPatches");
        return src.replace(read, "const bytes = require('./photon_rs_bg.wasm');");
      }
      if (/undici\/index\.js$/.test(id)) {
        // install() assigns the real globals; ICAP never calls it, and the fetch define must not rewrite it.
        const src = await readFile(id, "utf8");
        const assign = "globalThis.fetch = module.exports.fetch";
        if (!src.includes(assign)) throw new Error("undici changed install(); update piPatches");
        return src.replace(assign, "Object.assign(globalThis, { fetch: module.exports.fetch })");
      }
      if (id.endsWith("jiti/dist/jiti.cjs")) {
        // The learner's extensions and the modules they require are evaluated by jiti in the renderer, where these
        // globals are Chromium's. Wrap each module in a function whose
        // parameters are the same names, called with Node's versions (the define below rewrites the arguments), so
        // an extension sees what it sees under the Pi CLI. Outside the module's own function, so its own
        // \`const { setTimeout } = require("timers")\` still shadows them.
        const src = await readFile(id, "utf8");
        const evaluate = "runInThisContext(F,{filename:c,lineOffset:0,displayErrors:!1})";
        if (src.split(evaluate).length !== 2) throw new Error("jiti changed how it evaluates a module; update piPatches");
        // A plain CommonJS file (undici in an extension's node_modules) needs no transform, so jiti hands it to
        // Node's require, whose module wrapper sees the renderer's globals. Evaluate it in jiti's wrapper too,
        // untransformed; only a native ES module that is imported still loads natively.
        const native = 'else{if(debug(t,"[native]",n.async?"[import]":"[require]",c),n.async)return Promise.resolve(nativeImportOrRequire(t,c,n.async)).catch(e=>(debug(t,"Native import error:",e),debug(t,"[fallback]",c),eval_evalModule(t,i,{...n,forceTranspile:!0})));try{return nativeImportOrRequire(t,c,n.async)}catch(e){debug(t,"Native require error:",e),debug(t,"[fallback]",c),i=transform(t,{filename:c,source:i,ts:E,async:n.async??!1,jsx:t.opts.jsx})}}';
        if (src.split(native).length !== 2) throw new Error("jiti changed when it requires a module natively; update piPatches");
        const params = Object.keys(names).join(", ");
        return src
          .replace(native, 'else if(w&&n.async)return debug(t,"[native]","[import]",c),Promise.resolve(nativeImportOrRequire(t,c,!0)).catch(e=>(debug(t,"Native import error:",e),debug(t,"[fallback]",c),eval_evalModule(t,i,{...n,forceTranspile:!0})));')
          .replace(evaluate, `runInThisContext("(function (${params}) { return " + F.slice(0, -1) + "; })",{filename:c,lineOffset:0,displayErrors:!1})(${params})`);
      }
      if (/(pi-ai\/dist\/(env-api-keys|auth\/context|auth\/oauth\/load|api\/bedrock-converse-stream\.lazy)\.js|jiti\/lib\/jiti(-static|-native)?\.mjs)$/.test(id)) {
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
      PI_BUNDLED_NODE: "true", "import.meta.url": "globalThis.__ICAP_PI_URL",
      ...Object.fromEntries(Object.entries(names).flatMap(([name, to]) => ["", "globalThis.", "window.", "self."].map(prefix => [prefix + name, to]))),
    },
    inputOptions: { transform: { inject: Object.fromEntries([...Object.values(names), "__icapImport"].map(n => [n, [shim, n] as [string, string]])) } },
    outputOptions: { codeSplitting: false, dynamicImportInCjs: false },
    loader: { ".wasm": "binary" }, plugins: [piPatches()],
  };
}

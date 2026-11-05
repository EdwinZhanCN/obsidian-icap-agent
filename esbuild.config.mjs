import esbuild from "esbuild";
import sveltePlugin from "esbuild-svelte";
import { builtinModules } from "node:module";
import { existsSync, lstatSync } from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";

const prod = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/* ── Pi's SDK, bundled for Node on its own, then included in main.js (loaded on first use) ── */

const PI_ENTRY = path.resolve("src/agent/pi-sdk-entry.ts");
const PI_BUNDLE = path.resolve("build/pi-sdk.cjs");
const piPkg = JSON.parse(await readFile("node_modules/@earendil-works/pi-coding-agent/package.json", "utf8"));

/**
 * main.js ships alone, without Pi's package files: embed what Pi reads from its package.json (name,
 * version, config dir) instead of letting it look for one on disk.
 */
const piConfigPatch = {
  name: "pi-config",
  setup(build) {
    build.onLoad({ filter: /pi-coding-agent[\\/]dist[\\/]config\.js$/ }, async (args) => {
      const src = await readFile(args.path, "utf8");
      const declare = "let pkg = {};";
      const read = 'pkg = JSON.parse(stripBom(readFileSync(packageJsonPath, "utf-8")));';
      if (!src.includes(declare) || !src.includes(read)) {
        throw new Error(`Pi ${piPkg.version}: dist/config.js changed — update piConfigPatch in esbuild.config.mjs`);
      }
      const pkg = { name: piPkg.name, version: piPkg.version, piConfig: piPkg.piConfig };
      return { contents: src.replace(declare, `let pkg = ${JSON.stringify(pkg)};`).replace(read, ""), loader: "js" };
    });
  },
};

/**
 * Pi resizes images the agent reads with photon (WebAssembly), which reads its .wasm next to itself.
 * Embed the bytes: without them images come back as "[Image omitted]".
 */
const photonWasm = {
  name: "photon-wasm",
  setup(build) {
    build.onLoad({ filter: /photon-node[\\/]photon_rs\.js$/ }, async (args) => {
      const src = await readFile(args.path, "utf8");
      const read = "const path = require('path').join(__dirname, 'photon_rs_bg.wasm');\nconst bytes = require('fs').readFileSync(path);";
      if (!src.includes(read)) throw new Error("photon-node changed how it loads its wasm — update photonWasm in esbuild.config.mjs");
      return {
        contents: src.replace(read, "const bytes = require('./photon_rs_bg.wasm');"),
        loader: "js",
        resolveDir: path.dirname(args.path),
      };
    });
  },
};

/** `name`, `globalThis.name`, `window.name`, `self.name` → the replacement, for each global. */
function nodeGlobals(map) {
  return Object.fromEntries(
    Object.entries(map).flatMap(([name, to]) => ["", "globalThis.", "window.", "self."].map((p) => [p + name, to])),
  );
}

/**
 * import(x) with a specifier computed at runtime is Chromium's module loader in the renderer, which
 * cannot load node: modules. In the few files that do it (pi-ai's Node helpers, jiti's built-in
 * loading for the learner's extensions), call agent/pi-node.ts's require-based __icapImport instead.
 */
const runtimeImports = {
  name: "runtime-imports",
  setup(build) {
    const files = /(pi-ai[\\/]dist[\\/](env-api-keys|auth[\\/]context|auth[\\/]oauth[\\/]load|api[\\/]bedrock-converse-stream\.lazy)\.js|jiti[\\/]lib[\\/]jiti(-static|-native)?\.mjs)$/;
    build.onLoad({ filter: files }, async (args) => {
      const src = await readFile(args.path, "utf8");
      const out = src.replace(/(?<![\w$."'`])import\((?!["'`])/g, "__icapImport(");
      if (out === src) throw new Error(`${args.path}: no runtime import() found — update runtimeImports in esbuild.config.mjs`);
      return { contents: out, loader: "js" };
    });
  },
};

async function buildPi() {
  await esbuild.build({
    entryPoints: [PI_ENTRY],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node22",
    outfile: PI_BUNDLE,
    minify: true,
    treeShaking: true,
    logLevel: "warning",
    legalComments: "none",
    define: {
      // Pi's bundled mode: user extensions resolve typebox / pi-ai / pi-coding-agent to the embedded copies.
      PI_BUNDLED_NODE: "true",
      // CommonJS has no import.meta; agent/pi-host.ts sets this before the bundle first runs.
      "import.meta.url": "globalThis.__ICAP_PI_URL",
      // Node's fetch (no CORS), timers (with unref), web streams and Blob instead of the renderer's (agent/pi-node.ts).
      ...nodeGlobals({
        fetch: "__icapFetch",
        ...Object.fromEntries(
          [
            "setTimeout", "clearTimeout", "setInterval", "clearInterval",
            "ReadableStream", "WritableStream", "TransformStream", "TextDecoderStream", "TextEncoderStream",
            "CompressionStream", "DecompressionStream", "ByteLengthQueuingStrategy", "CountQueuingStrategy",
            "ReadableStreamDefaultReader", "ReadableStreamBYOBReader", "WritableStreamDefaultWriter",
            "Blob", "File", "performance",
          ].map((name) => [name, `__icap${name[0].toUpperCase()}${name.slice(1)}`]),
        ),
      }),
    },
    inject: [path.resolve("src/agent/pi-node.ts")],
    external: ["electron"],
    loader: { ".wasm": "binary" },
    // Every import() becomes require(): in the renderer import() is Chromium's module loader, which
    // cannot load node: modules (pi-ai loads node:crypto, node:fs… this way).
    supported: { "dynamic-import": false },
    plugins: [piConfigPatch, photonWasm, runtimeImports],
  });
}
await buildPi();

/** main.js loads Pi's SDK from the Node bundle above (agent/pi-host.ts imports it dynamically). */
const piSdk = {
  name: "pi-sdk",
  setup(build) {
    build.onResolve({ filter: /[\\/]pi-sdk-entry$/ }, () => ({ path: PI_BUNDLE }));
  },
};

/**
 * dev-vault/ symlinks the plugin to the build output; where symlinks are not allowed (Windows without Developer
 * Mode) scripts/dev-vault.mjs copies main.js instead, and each build refreshes that copy.
 */
const devVaultCopy = {
  name: "dev-vault-copy",
  setup(build) {
    build.onEnd(async (result) => {
      const copy = "dev-vault/.obsidian/plugins/icap-agent/main.js";
      if (result.errors.length || !existsSync(copy) || lstatSync(copy).isSymbolicLink()) return;
      await copyFile("main.js", copy);
    });
  },
};

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  target: "es2022",
  platform: "browser",
  outfile: "main.js",
  sourcemap: prod ? false : "inline",
  minify: prod,
  treeShaking: true,
  logLevel: "info",
  mainFields: ["svelte", "browser", "module", "main"],
  conditions: ["svelte", "browser"],
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    // Optional native module for Kerberos proxy auth (Bedrock); Pi's bundle requires it in a try/catch.
    "kerberos",
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
  ],
  // Pi's bundle carries Babel (via jiti), which has a harmless duplicate case clause.
  logOverride: { "duplicate-case": "silent" },
  plugins: [
    piSdk,
    sveltePlugin({
      compilerOptions: { css: "injected", dev: !prod },
    }),
    devVaultCopy,
  ],
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}

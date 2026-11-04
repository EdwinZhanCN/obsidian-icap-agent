import esbuild from "esbuild";
import sveltePlugin from "esbuild-svelte";
import { builtinModules } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";

/** `import src from "./file.ts?text"` → the file contents as a string. */
const textPlugin = {
  name: "text",
  setup(build) {
    build.onResolve({ filter: /\?text$/ }, (args) => ({
      path: path.resolve(args.resolveDir, args.path.replace(/\?text$/, "")),
      namespace: "text",
    }));
    build.onLoad({ filter: /.*/, namespace: "text" }, async (args) => ({
      contents: await readFile(args.path, "utf8"),
      loader: "text",
      watchFiles: [args.path],
    }));
  },
};

const prod = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

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
    ...builtinModules,
    ...builtinModules.map((m) => `node:${m}`),
  ],
  plugins: [
    textPlugin,
    sveltePlugin({
      compilerOptions: { css: "injected", dev: !prod },
    }),
  ],
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}

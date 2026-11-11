import { builtinModules } from "node:module";
import { defineConfig } from "vite-plus";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwind from "@tailwindcss/vite";
import { obsidianBuild } from "./tooling/obsidian-build";
import { piPack } from "./tooling/pi-bundle";

// Node's built-ins are not listed: obsidianBuild() serves them as lazy requires (none may run on mobile).
const hostModules = new Set(["obsidian", "electron", "kerberos"]);
export default defineConfig(({ mode }) => ({
  plugins: [svelte({ emitCss: false, compilerOptions: { dev: mode === "development" } }), tailwind(), obsidianBuild()],
  resolve: { conditions: ["svelte", "browser"] },
  // A library build keeps `process.env.NODE_ENV` as written, and a phone has no `process`: motion's
  // animate() reads it on every call, so one unreplaced use breaks every animation on mobile.
  define: { "process.env.NODE_ENV": JSON.stringify(mode === "development" ? "development" : "production") },
  build: {
    outDir: "build/plugin", emptyOutDir: false, target: "es2022", sourcemap: mode === "development" ? "inline" : false,
    minify: mode !== "development", cssCodeSplit: false,
    lib: { entry: "tooling/plugin-entry.ts", formats: ["cjs"], fileName: () => "main.js", cssFileName: "styles" },
    rolldownOptions: {
      external: (id) => hostModules.has(id) || id.startsWith("@codemirror/") || id.startsWith("@lezer/"),
      output: { exports: "default", codeSplitting: false, dynamicImportInCjs: false },
    },
  },
  pack: piPack(),
  test: {
    projects: [
      { test: { name: "unit", include: ["src/**/*.test.ts"], exclude: ["src/**/*.spec.test.ts"], environment: "node" } },
      { test: { name: "integration", include: ["test/integration/**/*.spec.test.ts"], environment: "node" } },
    ],
  },
  check: { fmt: false },
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["docs/**", "site/**", "dev-vault/**", "build/**", "main.js", "styles.css", "marketing/**"],
    // Node's built-ins only where Node is certain: the desktop backend, tests and the build. Everything
    // else must also run on Obsidian mobile (agent/backend.ts).
    rules: {
      "no-restricted-imports": ["error", {
        paths: builtinModules.filter((m) => !m.startsWith("_")).map((name) => ({ name, message: "Node built-ins belong in src/agent/desktop/ (the desktop backend), not in shared code." })),
        patterns: [{ group: ["node:*"], message: "Node built-ins belong in src/agent/desktop/ (the desktop backend), not in shared code." }],
      }],
    },
    overrides: [
      { files: ["src/agent/desktop/**", "**/*.test.ts", "test/**", "tooling/**", "scripts/**", "vite.config.ts"], rules: { "no-restricted-imports": "off" } },
    ],
  },
}));

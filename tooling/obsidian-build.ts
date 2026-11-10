import { existsSync, lstatSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { build } from "vite-plus/pack";
import type { Plugin } from "vite-plus";
import { piBundle, piEntry, piPack } from "./pi-bundle";

const builtins = new Set(builtinModules);
const LAZY = "\0icap-node:";

/**
 * Build Pi with Node semantics; Vite then embeds it behind the existing lazy import.
 *
 * Node's built-ins are external, and an ESM import of an external becomes a `require` at the top of
 * main.js — which throws on Obsidian mobile, where there is no Node. Each built-in is therefore
 * served as a tiny CommonJS module whose `require` runs when the module is first used: inside the
 * desktop backend's lazy import, never on mobile (test/integration/mobile-load.spec.test.ts).
 */
export function obsidianBuild(): Plugin {
  return {
    name: "icap-obsidian-build",
    enforce: "pre",
    apply: "build",
    async buildStart() {
      this.addWatchFile(piEntry);
      this.addWatchFile(resolve("src/agent/desktop/pi-node.ts"));
      await build({ ...piPack(), config: false });
    },
    resolveId(source, importer) {
      if (importer && /\/pi-sdk-entry(?:\.ts)?$/.test(source)) return piBundle;
      if (!importer || !(source.startsWith("node:") || builtins.has(source))) return;
      // The lazy module's own require is Node's (Electron's): external, never a browser shim.
      return importer.startsWith(LAZY) ? { id: source, external: true } : LAZY + source;
    },
    load(id) {
      if (id.startsWith(LAZY)) return { code: `module.exports = require(${JSON.stringify(id.slice(LAZY.length))});`, moduleType: "js" };
    },
    async writeBundle() {
      for (const file of ["main.js", "styles.css"]) {
        await copyFile(`build/plugin/${file}`, file);
        const target = `dev-vault/.obsidian/plugins/icap-agent/${file}`;
        if (existsSync(target) && !lstatSync(target).isSymbolicLink()) await copyFile(file, target);
      }
    },
  };
}

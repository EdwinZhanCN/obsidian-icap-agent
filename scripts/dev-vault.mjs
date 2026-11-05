#!/usr/bin/env node
// Build the dev vault (dev-vault/, git-ignored) from the tracked seed in test/fixtures/dev-vault/.
//   npm run vault                create dev-vault/ if it is missing; (re)link the plugin to the build output
//   npm run vault -- --reset     back to the seed: everything the agent wrote is removed (notes, sessions,
//                                skills, tasks, the guide note); your plugin settings are kept, and the guide
//                                note is created again on the next load
//   npm run vault -- --clean     like --reset, settings included: a first-install vault
// Close the vault in Obsidian before --reset / --clean, or run "Reload app without saving" right after.
// To change the sample notes, edit test/fixtures/dev-vault/ (not dev-vault/), then --reset.
//
// The plugin folder symlinks main.js, manifest.json and styles.css to the build output. Where symlinks are
// not allowed (Windows without Developer Mode) the files are copied instead: every esbuild run refreshes the
// copied main.js, and running this script again refreshes all three.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SEED = join(ROOT, "test", "fixtures", "dev-vault");
const VAULT = join(ROOT, "dev-vault");
const PLUGIN = join(VAULT, ".obsidian", "plugins", "icap-agent");
const BUILD = ["main.js", "manifest.json", "styles.css"];

const mode = process.argv[2] ?? "";
if (!["", "--reset", "--clean"].includes(mode)) {
  console.error("usage: npm run vault [-- --reset | --clean]");
  process.exit(2);
}

let keep = null;
if (mode && existsSync(VAULT)) {
  const data = join(PLUGIN, "data.json");
  if (mode === "--reset" && existsSync(data)) {
    const { settings } = JSON.parse(readFileSync(data, "utf8"));
    keep = { settings: { ...settings, guideCreated: false } };
  }
  rmSync(VAULT, { recursive: true, force: true });
  console.log("removed dev-vault/");
}

if (!existsSync(VAULT)) {
  cpSync(SEED, VAULT, { recursive: true });
  console.log("created dev-vault/ from test/fixtures/dev-vault/");
}

mkdirSync(PLUGIN, { recursive: true });
let copied = false;
for (const file of BUILD) {
  const dest = join(PLUGIN, file);
  rmSync(dest, { force: true });
  try {
    symlinkSync(join("..", "..", "..", "..", file), dest, "file");
  } catch (e) {
    if (e.code !== "EPERM") throw e;
    if (existsSync(join(ROOT, file))) copyFileSync(join(ROOT, file), dest);
    copied = true;
  }
}

if (keep) {
  writeFileSync(join(PLUGIN, "data.json"), JSON.stringify(keep, null, 2));
  console.log("kept your plugin settings");
}
if (copied) {
  console.log("symlinks are not allowed here, so the build was copied (on Windows, Developer Mode allows them).");
  console.log("npm run dev refreshes main.js; after npm run build:css, run npm run vault again for styles.css.");
}
if (!existsSync(join(ROOT, "main.js"))) console.log("main.js is not built yet: run npm run build (or npm run dev)");

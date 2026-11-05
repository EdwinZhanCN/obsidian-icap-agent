#!/usr/bin/env node
// Drive the plugin in a running Obsidian through the Obsidian CLI (Obsidian ≥ 1.12, Settings → General →
// Command line interface). Every command targets the vault named dev-vault unless ICAP_VAULT says otherwise.
//
//   node scripts/drive.mjs select "<text>" [len]   select the first occurrence in the active note (len: the text's length)
//   node scripts/drive.mjs cmd <command-id>         run an icap-agent command, e.g. explain-selection
//   node scripts/drive.mjs wait [seconds]           wait until no task is processing (default 90 s)
//   node scripts/drive.mjs state                    dump the runtime state (tasks, glosses, blocks) as JSON
//   node scripts/drive.mjs shot <name> [selector]   screenshot to .shots/<name>.png, scrolling selector into view first
//
// Trusted keyboard input through CDP, for keyboard-flow tests:
//   node scripts/drive.mjs key <Key> <Code> <vk> [modifiers]   modifiers: 1 alt, 2 ctrl, 4 meta, 8 shift
//   node scripts/drive.mjs type "<text>"
//   node scripts/drive.mjs palette "<command name>"            open the command palette, type, Enter
//   node scripts/drive.mjs focus                               describe document.activeElement
//
// env: ICAP_VAULT=<vault name> (default dev-vault) · ICAP_SHOTS=<dir> (default .shots/ at the repo root)
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VAULT = `vault=${process.env.ICAP_VAULT ?? "dev-vault"}`;
const SHOTS = resolve(process.env.ICAP_SHOTS ?? join(ROOT, ".shots"));
const MOD = process.platform === "darwin" ? 4 : 2; // ⌘ on macOS, Ctrl elsewhere

const obsidian = (...args) => execFileSync("obsidian", [VAULT, ...args], { encoding: "utf8" }).trim();
const evaluate = (code) => obsidian("eval", `code=${code}`).replace(/^=> /, "");
const cdp = (method, params) => obsidian("dev:cdp", `method=${method}`, `params=${JSON.stringify(params)}`);
const PLUGIN = "app.plugins.plugins['icap-agent']";

function key(key, code, vk, modifiers = 0) {
  for (const type of ["rawKeyDown", "keyUp"]) {
    cdp("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: Number(vk), modifiers: Number(modifiers) });
  }
}
const type = (text) => cdp("Input.insertText", { text });

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case "select": {
    const [text, len] = args;
    console.log(
      evaluate(`(()=>{const e=app.workspace.activeEditor.editor;const t=e.getValue();const q=${JSON.stringify(text)};
const i=t.indexOf(q);if(i<0)return 'not found';const n=${Number(len) || 0}||q.length;
e.setSelection(e.offsetToPos(i),e.offsetToPos(i+n));e.focus();return i})()`),
    );
    break;
  }
  case "cmd":
    console.log(evaluate(`app.commands.executeCommandById(${JSON.stringify(`icap-agent:${args[0]}`)})`));
    break;
  case "wait": {
    const seconds = Number(args[0] ?? 90);
    for (let i = 0; i < seconds; i++) {
      if (evaluate(`${PLUGIN}.runtime.ledger.tasks.filter(t=>t.status==='processing').length`) === "0") break;
      await sleep(1000);
    }
    console.log("settled");
    break;
  }
  case "state":
    console.log(
      evaluate(`(()=>{const rt=${PLUGIN}.runtime;return JSON.stringify({
tasks:rt.ledger.tasks.slice(0,6).map(t=>({k:t.kind,s:t.status,p:t.phase,o:t.outcome,e:t.error,a:t.artifacts.map(a=>a.kind+':'+a.path)})),
glosses:[...rt.glosses.values()].map(g=>({term:g.term,sec:g.sections.map(s=>s.status+':'+s.text.slice(0,160))})),
blocks:[...rt.blocks.values()].map(b=>({k:b.kind,ph:b.phase,turns:b.turns.map(t=>({k:t.kind,q:t.question.slice(0,140),a:t.answer,fb:(t.feedback||'').slice(0,200),v:t.verdict})),sum:b.summary.slice(0,300),err:b.error}))
},null,1)})()`),
    );
    break;
  case "shot": {
    const [name, selector] = args;
    if (selector) {
      evaluate(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'center'})`);
      await sleep(500);
    }
    mkdirSync(SHOTS, { recursive: true });
    console.log(obsidian("dev:screenshot", `path=${join(SHOTS, `${name}.png`)}`));
    break;
  }
  case "key":
    key(...args);
    break;
  case "type":
    type(args[0]);
    break;
  case "palette":
    key("p", "KeyP", 80, MOD);
    await sleep(400);
    type(args[0]);
    await sleep(400);
    key("Enter", "Enter", 13);
    await sleep(400);
    break;
  case "focus":
    console.log(
      evaluate(`(()=>{const a=document.activeElement;const r=a.closest('.icap-gloss,.icap-ask,.icap-ledger,.cm-content,.prompt');
return (r?r.className.split(' ')[0]:'-')+' > '+a.tagName.toLowerCase()+(a.getAttribute('role')?'['+a.getAttribute('role')+']':'')+' "'+(a.textContent||a.value||'').trim().slice(0,30)+'"'})()`),
    );
    break;
  default:
    console.error("usage: node scripts/drive.mjs <select|cmd|wait|state|shot|key|type|palette|focus> … (see the header of this file)");
    process.exit(2);
}

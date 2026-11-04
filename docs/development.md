# Development

## Run it

Requirements: Obsidian ≥ 1.7 (desktop), Node ≥ 20, and the [Pi](https://github.com/earendil-works/pi) CLI
configured with a model (`pi` on `PATH`, or set its path in the plugin settings).

```bash
npm install
npm run build        # Tailwind → styles.css, esbuild → main.js
npm test             # vitest: Markdown DSL + JSONL + block editing helpers
npm run check        # svelte-check + tsc
```

`dev-vault/` is a ready-made test vault: its `.obsidian/plugins/icpa-agent/` symlinks to the build output.
Open it in Obsidian, enable community plugins, and try the sample notes ("C++ Memory Management" contains
a deliberate misconception under *My understanding*).

`scripts/drive.sh` drives the running plugin through the Obsidian CLI (select text, run a command, wait for
the agent, dump state, screenshot into `.shots/`).

## Architecture

```
pi/icpa-bridge.ts         Pi extension: obsidian · read_document · ask_learner · create_note · propose_edit
                          (each tool round-trips through ctx.ui.editor("icpa:<op>") → RPC → plugin).
                          In isolated mode (env ICPA_ALLOWED_ROOTS) a tool_call guard keeps read/grep/find/ls
                          inside the vault + the folders the learner allowed.
src/agent/                PiSession (one `pi --mode rpc` process per task), prompts, env discovery.
                          Launch (piArgs): "mine" = the learner's own Pi setup + `-e icpa-bridge`, ICPA
                          protocol via --append-system-prompt, unused ICPA tools hidden (--exclude-tools);
                          "isolated" = --no-extensions/--no-skills/--no-context-files/--no-mcp/--no-approve,
                          read-only --tools, protocol as --system-prompt. Dialogs from the learner's own
                          extensions (select/confirm/input/editor) become turns in the task's block.
src/agent/pi-env.ts       finds `pi` and the login shell's full environment (PATH and provider keys exported in
                          ~/.zshrc, which a Dock-launched Obsidian lacks); probeModels asks Pi over RPC which
                          model it uses and which have credentials (no prompt, nothing spent) for the settings
src/agent/vault-tools.ts  the read-only `obsidian` commands (Obsidian CLI surface via the App API) and
                          read_document (PDF.js via loadPdfJs: outline + page ranges); pure helpers in doc-pages.ts
src/dsl/                  pure Markdown helpers: ```icpa-ask fences, callouts, anchors, sections
src/runtime/              LearningRuntime (orchestration) + rune state: Task/Ledger, Gloss, AskBlock
src/editor/               CM6: transient gloss widgets, the selection mark, the highlighter (fresh.ts),
                          edge cues (cue.ts)
src/ui/                   Svelte 5 views: GlossView, AskView, WritingLine, Choices, Ledger, LedgerMark
src/ui/motion.ts          the motion language (Motion springs, frames, ink entrances, drawn strokes)
src/guide/                the first-run guide note (zh / en)
src/styles/main.css       design system (Tailwind v4 utilities, prefixed `tw:`; Obsidian variables)
```

Document model:

| What | Lives in | Becomes on "keep" |
| --- | --- | --- |
| Gloss (explanation) | CodeMirror only — transient | `> [!gloss] term` |
| Recall / check / quiz / agent question | ```` ```icpa-ask ```` fence + plugin data | learner's words + `> [!feedback]` / `> [!practice]` |
| Edit to an existing note | review turn with a diff | applied only after "apply change" |
| Request (command *Ask the agent here*; `[[`/`@` in its writing line suggests vault files, src/dsl/links.ts; linked files are resolved and listed as paths in the prompt) | ```` ```icpa-ask ```` fence, `kind: request` + plugin data | `> [!request]` record: requests, replies, files |

In "mine" mode, vault create/modify/delete/rename events are recorded on whichever task's agent is running a
tool call at that moment (or ended one < 3 s ago — file watchers lag), for every task kind: request, explain,
recall, check, quiz, note. PiSession reports tool_execution_start/end through `onTool`. The task's own note
(the plugin writes its blocks there) and notes the learner is typing in are skipped. A task's own result
(gloss / feedback / kept) is set with `setResult`, which keeps the file entries.

Every kept artifact is plain Obsidian Markdown; uninstalling the plugin leaves readable notes.

## Keyboard

| Where | Keys |
| --- | --- |
| Note → interaction | command "Move into the nearest explanation or question" (bind a hotkey) |
| Gloss | Tab through keep · deeper · example · plainer · compare… · dismiss; Esc returns to the note |
| Choices | ↑↓ move (single choice selects as it moves), a–h jump, Space mark, ↵ submit |
| Writing line | ⌘↵ submit (an Obsidian `Scope` is pushed while focused, so editor chords don't fire); Esc leaves |
| Recall veil | first Esc lifts the veil, the next returns to the note |
| Ledger | Esc closes and restores focus |

Glosses and blocks render inside CodeMirror's contenteditable; `inertToEditor` swallows `beforeinput` while one of
their buttons/options has focus, so a stray key can never edit the note underneath.

`dev-vault/.obsidian/themes/Paperline` is a deliberately unusual test theme (paper ground, serif, green accent,
dark variant) used to check theme compatibility; switch to it in Appearance.

## Motion and the guide

See *docs/design.md* §5–6. To check animations frame by frame from the CLI, sample
`getBoundingClientRect()` / computed styles in a `requestAnimationFrame` loop via `obsidian eval`.
Chromium pauses rAF while the Obsidian window is hidden, so in a background window run
`require('electron').remote.getCurrentWebContents().setBackgroundThrottling(false)` and
`obsidian dev:cdp method=Emulation.setFocusEmulationEnabled params='{"enabled":true}'` first; emulate
reduced motion with `Emulation.setEmulatedMedia` (`prefers-reduced-motion: reduce`).

The guide is created once (`guideCreated` in the plugin data); the command *Open the guide* reopens
or recreates it.

## Known limitations

- Desktop only (spawns the Pi CLI). Requires Pi to be installed and configured with a model.
- Explanations start from Live Preview / Source mode; reading view shows blocks and kept callouts but has no
  selection mark.
- Open (un-kept) glosses are transient and disappear when the plugin reloads; blocks persist and resume.
- An interrupted agent turn resumes by replaying the transcript into a fresh Pi session, so the model may
  phrase the next question differently.
- The interface is English or Chinese, following Obsidian's language (`src/i18n.ts`: every string is
  `L("English", "中文")` at its call site). Markers stored in notes stay English on purpose (callout
  types, `kind:`, `generated-by`, the "Plainly."/"Deeper." headings the agent reads back as evidence).
  Agent output follows the note's language. The guide exists in Chinese and English.
- Animations, like all rendering, pause while the Obsidian window is hidden and resume when it is shown.

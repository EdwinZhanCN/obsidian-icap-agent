# AGENTS.md

ICAP Learning Agent is a desktop Obsidian plugin (TypeScript, Svelte 5, CodeMirror 6, Tailwind v4) that runs [Pi](https://pi.dev)'s agent SDK inside Obsidian. Explanations, questions, feedback and requests live in the learner's Markdown notes; there is no chat panel.

- What users see and do: [README.md](README.md)
- How the product behaves and why: [DESIGN.md](DESIGN.md). Read it before changing an interaction.
- Setup, checks and releasing: [CONTRIBUTING.md](CONTRIBUTING.md)

## Commands

```bash
npm run build                   # styles.css (Tailwind) + build/pi-sdk.cjs + main.js
npm run dev                     # watch main.js (not styles.css: npm run build:css)
npm run check                   # tsc + svelte-check: must be 0 errors
npm test                        # vitest: must pass
npm run vault [-- --reset|--clean]   # generate dev-vault/ from test/fixtures/dev-vault/
node scripts/drive.mjs …        # drive the running plugin through the Obsidian CLI (commands listed in the file)
```

## Verify a change

1. `npm run check && npm test && npm run build`.
2. For anything visible, see it in Obsidian (`dev-vault`): `drive.mjs select` / `cmd` / `wait` / `state` / `shot`, plus `key` / `type` / `palette` / `focus` for keyboard flows. Read the screenshot; a passing test is not evidence that an interaction looks or feels right.
3. Chromium pauses `requestAnimationFrame` while the Obsidian window is hidden, so animations and modals stall in a background window. Before sampling animation frame by frame (`getBoundingClientRect()` or computed styles in a rAF loop through `obsidian eval`), run `require('electron').remote.getCurrentWebContents().setBackgroundThrottling(false)` and `obsidian dev:cdp method=Emulation.setFocusEmulationEnabled params='{"enabled":true}'`. Emulate reduced motion with `Emulation.setEmulatedMedia` (`prefers-reduced-motion: reduce`). Settings and the login dialog never attach while hidden: render the tab with `app.setting.pluginTabs.find(t => t.id === "icap-agent").display()`.
4. Never complete a login or write `~/.pi/agent/auth.json` from a test or a script. Use `ModelRuntime.create({ authPath: <scratch file> })`; tests answer through pi-ai's faux provider.
5. Never touch a user's own vault. Work in `dev-vault/` only, and change sample content in `test/fixtures/dev-vault/`.

## Code map

```
src/main.ts               plugin entry: commands, editor menu, settings load, one-time import from icpa-agent/
src/settings.ts           settings tab and DEFAULT_SETTINGS
src/i18n.ts               L("English", "中文"), the interface language follows Obsidian's
src/context.ts            NoteContext, what a task is told about its note: heading trail, frontmatter, links,
                          the passage and section around the focus, the note windowed around it

src/runtime/runtime.ts    LearningRuntime: orchestrates every task (explain, recall, check, quiz, note, request),
                          writes blocks back into notes, records file changes on the running task
src/runtime/state.svelte.ts  rune state: Task / Ledger, Gloss, AskBlock
src/runtime/transcript.ts pure: a block's conversation as text (the agent's history; the session fingerprint)

src/agent/pi-host.ts      loads Pi's SDK on first use; first fills process.env with the login shell's missing
                          variables and PATH (provider keys exported in ~/.zshrc, which a Dock-launched Obsidian
                          lacks), never overriding. Shared ModelRuntime; project trust
src/agent/pi-session.ts   PiSession: one in-process AgentSession per task. sessionPlan "mine" (the learner's
                          ~/.pi/agent + vault .pi/, ICAP protocol appended) or "isolated" (no extensions or
                          skills, exact tool allowlist, protocol as the whole system prompt). Extension dialogs
                          become turns in the task's block. probeModels / probeCommands read without prompting
src/agent/prompts.ts      the ICAP protocol (systemPrompt) and each task's prompt (explain, recall, quiz, note,
                          request, follow-up, continuation)
src/agent/icap-tools.ts   ICAP's tools as an inline extension (loads even with noExtensions): obsidian,
                          read_document, ask_learner, create_note, propose_edit. Isolated: a tool_call guard keeps
                          read/grep/find/ls inside the vault and the allowed folders
src/agent/vault-tools.ts  the read-only `obsidian` commands (Obsidian CLI surface through the App API) and
                          read_document (PDF.js: outline + page ranges); pure page helpers in doc-pages.ts
src/agent/session-cache.ts a request block's Pi session (<plugin>/sessions/) as a cache, resumed only while its
                          fingerprint equals the block's history; deleted on keep / clear; orphans pruned on start
src/agent/icap-skills.ts  ICAP's own skills (icap-visual), shipped in main.js, written to <plugin>/skills/
src/agent/pi-login.ts     provider login without the CLI; src/ui/login-modal.ts is its dialog
src/agent/pi-sdk-entry.ts the SDK surface ICAP uses, built for Node into build/pi-sdk.cjs (see "Pi inside Obsidian")
src/agent/pi-node.ts      injected into Pi's bundle only: Node's fetch, timers, streams, Blob/File, __icapImport

src/dsl/blocks.ts         the Markdown DSL: ```icap-ask fences (and legacy ```icpa-ask), callouts
src/dsl/text.ts, links.ts, commands.ts   pure helpers: sections and anchors, `[[`/`@` links, the `/` grammar
src/dsl/doc-ops.ts        writing into notes: spliceFile (through the open editor when there is one), block
                          insertion, unique paths for new notes
src/editor/               CM6: transient glosses (gloss-field.ts), the selection mark, the highlighter (fresh.ts),
                          edge cues (cue.ts)
src/genui/widget.ts       pure: ```icap-ui fence → sandboxed document; parseUiMessage; veilWidgets (streaming)
src/genui/host.ts         UiHost: the sandboxed iframe, its one message listener, theme rebroadcast
src/guide/guide.ts        the first-run guide note (zh / en)
src/guide/vault-rules.ts  pure: presets and renderRules for the AGENTS.md wizard (src/ui/rules-modal.ts)
src/ui/                   Svelte views (GlossView, AskView, WritingLine, Choices, Ledger, LedgerMark, Markdown),
                          motion.ts (the motion language), keys.ts (the writing Scope), focus.ts, hold-height.ts,
                          phrases.ts (task phases as sentences)
src/styles/main.css       the design system: Tailwind v4 utilities with the `tw:` prefix, on Obsidian's variables
test/                     vitest; test/fixtures/dev-vault/ is the dev vault's seed
```

## Document model

| What | Lives in | Becomes on *keep* |
|---|---|---|
| Gloss (explanation) | CodeMirror decorations only, never the file | `> [!gloss] term` |
| Recall, check, quiz, agent question | an ```` ```icap-ask ```` fence, with its state in plugin data | the learner's words + `> [!feedback]` / `> [!practice]` |
| Request (*Ask the agent here*) | an ```` ```icap-ask ```` fence with `kind: request` + plugin data | `> [!request]` record: requests, replies, files |
| Edit to an existing note | a review turn showing a diff | applied only after *apply change* |
| Interactive visual | an ```` ```icap-ui ```` fence in a reply or an agent-created note | unchanged |

## Rules that must hold

- **Kept output is plain Obsidian Markdown.** Uninstalling the plugin must leave readable notes. Transient state (open glosses, block state) never leaks into the file.
- **The note is the source of truth; a Pi session is a cache.** What the agent is told of a conversation is what the block shows (`transcript.ts`). A session is resumed only while its fingerprint matches. Runtime command turns (`/model`, `/thinking`, `/compact`) carry `control: true` and never reach the transcript or the kept record.
- **The learner decides what changes.** The plugin writes only its own blocks into the task's note. ICAP's tools change existing notes only through `propose_edit`, which the learner applies. The agent never rewrites the learner's answer.
- **Every file change is attributed.** In "mine" mode, vault create, modify, delete and rename events are recorded on the task whose agent is in a tool call, or ended one less than 3 s ago. Exempt: the task's own note and notes the learner is typing in. Keep this working for every task kind.
- **Slash commands exist only in request blocks.** In a recall, check or quiz the learner's text is an answer, so a leading `/` is just text.
- **Context files stop at the vault.** Only Pi's global `AGENTS.md` (in "mine" mode) and those inside the vault are loaded, never an ancestor's (`vaultContextFiles`). Isolated mode loads only the vault's own.
- **Visuals stay sandboxed.** `sandbox="allow-scripts"` without `allow-same-origin`, and CSP `default-src 'none'`. `ask` and `open` are honoured only from the rendered frame, well-formed, and while the learner has focused it. The iframe's `color-scheme` must match the inner document's, or Chromium paints an opaque backdrop.
- **Bilingual interface, English markers.** Every UI string is `L("English", "中文")` at its call site. Callout types, `kind:`, `generated-by` and the *Plainly.* / *Deeper.* headings stay English: the agent reads them back as evidence.
- **Motion has rules** (DESIGN.md, Motion). Only frames animate `height`; everything else is `transform` / `opacity`. Keyframes end at the natural state, and reduced motion keeps a 140 ms fade. An entrance plays once per thing, so re-created widgets and reloads never replay it. Animate through the tokens in `src/ui/motion.ts`.
- **Glosses and blocks never edit the note by accident.** They render inside CodeMirror's contenteditable; `inertToEditor` swallows `beforeinput` while their controls have focus. The writing line pushes an Obsidian `Scope` (`src/ui/keys.ts`) that owns Mod+Enter and swallows formatting chords.

## Pi inside Obsidian

`esbuild.config.mjs` builds `src/agent/pi-sdk-entry.ts` for Node into `build/pi-sdk.cjs`, and `main.js` includes it behind a lazy import. Tests import the entry directly.

The bundle is CJS with `PI_BUNDLED_NODE`. `import.meta.url` maps to `globalThis.__ICAP_PI_URL`, and Pi's package.json and photon's wasm are embedded. Like Pi's standalone binary, the entry registers the OAuth flows and Bedrock statically.

`pi-node.ts` gives Pi's code Node's fetch (undici, honouring `HTTP(S)_PROXY`, no CORS), timers, web streams, Blob/File and performance. Obsidian's own globals are untouched.

The esbuild plugins `piConfigPatch`, `photonWasm` and `runtimeImports` patch specific upstream files and **throw when upstream changes**. When bumping `@earendil-works/pi-*` (pinned to an exact version in `package.json`), expect to update them.

## Legacy ICPA formats

The plugin used to be spelled ICPA (`icpa-agent`). Formats that outlive a version still accept the old spelling. Do not drop these readers:

| Stored where | Written now | Still read |
|---|---|---|
| fences in notes | ```` ```icap-ask ```` | ```` ```icpa-ask ```` (`LEGACY_ASK_LANG`, `ASK_LANG_RE` in `src/dsl/blocks.ts`; rewriting a block upgrades the fence) |
| note properties | `generated-by: icap-agent` (`GENERATED_BY`) | `icpa-agent` (the prompt counts both as agent-written) |
| plugin folder | `.obsidian/plugins/icap-agent/` | `icpa-agent/data.json` and `sessions/`, imported once when the new folder has no data (`legacyData()` in `src/main.ts`) |
| Pi session files | `…_icap-<block>-<n>.jsonl` | `…_icpa-…` (`blockOfFile`) |
| bridge calls | `icap:<op>` | `icpa:<op>` (`BRIDGE_PREFIX` in `src/agent/pi-session.ts`) |

## Known limitations

- Desktop only (Pi needs Node). `main.js` is about 11 MB: Pi with its providers (including the AWS SDK for Bedrock), jiti for the learner's TypeScript extensions, and photon.
- Only Pi's own code gets Node's fetch. A learner's extension calling `fetch` itself runs in the renderer and is subject to CORS, unlike in the Pi CLI. Pi's codemode (QuickJS in a worker) is not bundled.
- The selection mark exists in Live Preview and Source mode only. An unkept gloss disappears on plugin reload; blocks persist and resume.
- An interrupted turn resumes by replaying the transcript into a fresh session, so the next question may be phrased differently.
- Interactive visuals have been tested with hand-written `icap-ui` blocks, not yet with a model writing them. A visual's state is not saved. In Reading view, a visual in a note without a request block asks through a new request block, which needs the note to be editable.

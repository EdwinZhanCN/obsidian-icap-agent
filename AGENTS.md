# AGENTS.md

ICAP Learning Agent is an Obsidian plugin (TypeScript, Svelte 5, CodeMirror 6, Tailwind v4) for desktop and mobile. On desktop it runs [Pi](https://pi.dev)'s agent SDK inside Obsidian; on mobile, which has no Node, its own agent on Pi's `pi-agent-core` and `pi-ai`. Explanations, questions, feedback and requests live in the learner's Markdown notes; there is no chat panel.

- What users see and do: [README.md](README.md)
- How the product behaves and why: [DESIGN.md](DESIGN.md). Read it before changing an interaction.
- Setup, checks and releasing: [CONTRIBUTING.md](CONTRIBUTING.md)

## Commands

```bash
pnpm build                      # vp build: build/pi-sdk.cjs (vp pack) + main.js + styles.css
pnpm dev                        # the same, watching
pnpm check                      # vp check (type-aware Oxlint + type check) + svelte-check: 0 errors
pnpm test                       # vp test: unit (src/**/*.test.ts) + integration (test/integration/): must pass.
                                # Includes main.js on a phone (test/integration/mobile/): run after pnpm build
pnpm vault [--reset|--clean]    # generate dev-vault/ from test/fixtures/dev-vault/
node scripts/drive.mjs …        # drive the running plugin through the Obsidian CLI (commands listed in the file)
```

## Verify a change

1. `pnpm check && pnpm test && pnpm build`.
2. For anything visible, see it in Obsidian (`dev-vault`): `drive.mjs select` / `cmd` / `wait` / `state` / `shot`, plus `key` / `type` / `palette` / `focus` for keyboard flows. Read the screenshot; a passing test is not evidence that an interaction looks or feels right.
3. Chromium pauses `requestAnimationFrame` while the Obsidian window is hidden, so animations and modals stall in a background window. Before sampling animation frame by frame (`getBoundingClientRect()` or computed styles in a rAF loop through `obsidian eval`), run `require('electron').remote.getCurrentWebContents().setBackgroundThrottling(false)` and `obsidian dev:cdp method=Emulation.setFocusEmulationEnabled params='{"enabled":true}'`. Emulate reduced motion with `Emulation.setEmulatedMedia` (`prefers-reduced-motion: reduce`). Settings and the login dialog never attach while hidden: render the tab with `app.setting.pluginTabs.find(t => t.id === "icap-agent").display()`.
4. Never complete a login or write `~/.pi/agent/auth.json` from a test or a script. Use `ModelRuntime.create({ authPath: <scratch file> })`; tests answer through pi-ai's faux provider.
5. Never touch a user's own vault. Work in `dev-vault/` only, and change sample content in `test/fixtures/dev-vault/`.

## Code map

```
src/main.ts               plugin entry: chooses the backend (a dynamic import per Platform), commands (editor
                          commands with icons, for the mobile toolbar), editor menu, settings load, one-time
                          import from icpa-agent/
src/settings/settings.ts  settings tab and DEFAULT_SETTINGS (what the backend cannot do is not shown); its
                          dialog rules-modal.ts (the AGENTS.md wizard); login / endpoint dialogs are the backend's
src/i18n.ts               L("English", "中文"), the interface language follows Obsidian's
src/runtime/context.ts    NoteContext, what a task is told about its note: heading trail, frontmatter, links,
                          the passage and section around the focus, the note windowed around it

src/runtime/runtime.ts    LearningRuntime: orchestrates every task (explain, recall, check, quiz, note, request),
                          writes blocks back into notes, records file changes on the running task. Reaches the
                          agent only through AgentBackend
src/runtime/state.svelte.ts  rune state: Task / Ledger, Gloss, AskBlock
src/runtime/transcript.ts pure: a block's conversation as text (the agent's history; the session fingerprint)
src/runtime/task-notes.ts TaskNotes: request and note tasks mirrored into notes with `icap-*` properties (found by
                          icap-id, written only on a change of state and only by the device running the task),
                          Activity.base generated once, the one-time migration of the earlier ledger

src/agent/backend.ts      AgentBackend: the boundary under LearningRuntime (run a task, events, capability flags,
                          probes, SessionCache, ExternalFiles, accounts) and the platform-neutral types (AgentPhase,
                          AgentConfig, Control, DialogRequest…), SetupNeeded. Only main.ts imports a backend,
                          each behind a dynamic import evaluated on its platform
src/agent/prompts.ts      the ICAP protocol (systemPrompt, shaped by PromptEnv: file tools? skill files?) and each
                          task's prompt (explain, recall, quiz, note, request, follow-up, continuation)
src/agent/usage.ts        pure: RunUsage (tokens, cache, price) from each assistant message's usage, summed per task;
                          cost unknown when a message has tokens but no price; the one-line display
src/agent/visual-skill.ts the icap-visual skill text: a skill file on desktop, part of the system prompt on mobile
src/agent/skills.ts       the structure skills, as short: icap-mermaid (Pele, Mermaid 12.1), icap-canvas, icap-bases;
                          offered on every task (offeredSkills in prompts.ts), the same two ways
src/agent/tools/icap-tools.ts  ICAP's tools, platform-neutral (name, description, TypeBox schema, execute through
                          the bridge): obsidian, read_document, documents, ask_learner, create_note, propose_edit
src/agent/tools/vault-tools.ts  the read-only `obsidian` commands (Obsidian CLI surface through the App API); pure
                          helpers (page specs, caps, search syntax) in doc-pages.ts
src/documents/            documents (PDF, EPUB, DOCX) as PageIndex-style trees. Pure: model.ts (DocTree, outline),
                          epub.ts, docx.ts, html.ts, detect.ts (headings and titles from PDF layout), search.ts,
                          summaries.ts. pdf.ts (PDF.js), store.ts (the cache in the plugin's own docs/ through vault.adapter:
                          content hash, LRU), tools.ts (read_document, documents); files outside the vault only
                          through the backend's ExternalFiles

src/agent/desktop/        the desktop backend, Pi on Node (the only place for Node built-ins outside tests/tooling):
  desktop-backend.ts      DesktopBackend: every capability on; vault root, allowed folders, sessions dir, skills
  pi-host.ts              loads Pi's SDK on first use; first fills process.env with the login shell's missing
                          variables and PATH (provider keys exported in ~/.zshrc, which a Dock-launched Obsidian
                          lacks), never overriding. Shared ModelRuntime; project trust
  pi-session.ts           PiSession: one in-process AgentSession per task. sessionPlan "mine" (the learner's
                          ~/.pi/agent + vault .pi/, ICAP protocol appended) or "isolated" (no extensions or
                          skills, exact tool allowlist, protocol as the whole system prompt). Extension dialogs
                          become turns in the task's block. probeModels / probeCommands read without prompting
  icap-extension.ts       ICAP's tools as a Pi inline extension (loads even with noExtensions). Isolated: a
                          tool_call guard keeps read/grep/find/ls inside the vault and the allowed folders
  files.ts                DesktopFiles (ExternalFiles): documents in folders outside the vault, `within`
  session-cache.ts        a request block's Pi session (<plugin>/sessions/) as a cache, resumed only while its
                          fingerprint equals the block's history; deleted on keep / clear; orphans pruned on start
  icap-skills.ts          ICAP's own skills (icap-visual), shipped in main.js, written to <plugin>/skills/
  pi-login.ts             provider login without the CLI; login-modal.ts is its dialog
  pi-endpoints.ts         custom model endpoints in Pi's models.json; endpoint-modal.ts is its dialog
  pi-sdk-entry.ts         the SDK surface ICAP uses, built for Node into build/pi-sdk.cjs (see "Pi inside Obsidian")
  pi-node.ts              injected into Pi's bundle only: Node's fetch, timers, streams, Blob/File, __icapImport

src/agent/mobile/         the mobile backend, no Node (also what desktop's app.emulateMobile(true) runs):
  mobile-backend.ts       MobileBackend: isolated only, ICAP's tools; resolves provider/model, key and transport
                          (SetupNeeded when a key is missing); probeModels from pi-ai's catalog + endpoints
  mobile-session.ts       MobileSession: pi-agent-core's Agent on a pi-ai adapter (api/*.lazy), events as PiSession's,
                          its own provider retry ("retrying"), a lost connection → interrupted
  providers.ts            the eight providers (pi-ai model tables), custom endpoints, transportOf (the one rule:
                          built-ins stream, an endpoint uses its probe), secret ids icap-<provider> / icap-endpoint-<slug>
  transport.ts            wholeFetch (requestUrl as a fetch: whole body, abort discards) and probeTransport
  settings-ui.ts          keys (SecretComponent → app.secretStorage) and the endpoint dialog, in the settings tab

src/activity/             the `icap-activity` Bases view over task notes: rows.ts (pure: a note as a row, steps as
                          spans), ActivityView.svelte, view.svelte.ts (the BasesView; strips only for this
                          device's tasks). Display only. Its table views in Activity.base work without the plugin
src/ui/provider-marks.ts  model marks (Lobe Icons, MIT, mono) and markFor(`provider/id`)
src/dsl/blocks.ts         the Markdown DSL: ```icap-ask fences (and legacy ```icpa-ask), callouts
src/dsl/records.ts        pure: the reference reader of FORMAT.md (readRecords); test/fixtures/format/ pairs each
                          sample note with the JSON it must read as
src/dsl/task-notes.ts     pure: FORMAT.md v4 task notes: status mapping, properties, the note's text, Activity.base
src/dsl/structures.ts     pure: canvasProblem / baseProblem, why a canvas or base would not open (create_note
                          with type canvas / base and propose_edit on one refuse it with the reason)
src/dsl/text.ts, links.ts, commands.ts   pure helpers: sections and anchors, `[[`/`@` links, the `/` grammar
src/dsl/doc-ops.ts        writing into notes: spliceFile (through the open editor when there is one), block
                          insertion, unique paths for new notes
src/editor/               CM6: transient glosses (gloss-field.ts), the selection mark, the highlighter (fresh.ts),
                          edge cues (cue.ts)
src/genui/widget.ts       pure: ```icap-ui fence → sandboxed document; parseUiMessage; veilWidgets (streaming)
src/genui/host.ts         UiHost: the sandboxed iframe, its one message listener, theme rebroadcast
src/guide/guide.ts        the first-run guide note (zh / en)
src/guide/vault-rules.ts  pure: presets and renderRules for the AGENTS.md wizard (src/settings/rules-modal.ts)
src/ui/                   Svelte views (GlossView, AskView, WritingLine, Choices, Ledger, LedgerMark, Markdown),
                          motion.ts (the motion language), keys.ts (the writing Scope), focus.ts, hold-height.ts,
                          phrases.ts (task phases as sentences)
src/styles/main.css       the design system: Tailwind v4 utilities with the `tw:` prefix, on Obsidian's variables
src/**/*.test.ts          unit tests, next to their module
test/integration/         tests against the real Pi SDK (*.spec.test.ts); test/fixtures/dev-vault/ is the dev vault's seed.
                          mobile/: the built main.js booted in a vm with no Node (phone.ts: happy-dom + an obsidian
                          stub with Platform.isMobile; require throws on Node built-ins), driven end to end
tooling/                  the build: obsidian-build.ts (Vite plugin: Pi bundle, Node built-ins as lazy requires,
                          copies to the repo root and dev-vault),
                          pi-bundle.ts (vp pack config for Pi), plugin-entry.ts (main.ts + the stylesheet)
```

## Document model

| What | Lives in | Becomes on *keep* |
|---|---|---|
| Gloss (explanation) | CodeMirror decorations only, never the file | `> [!gloss] term` under an `<!-- icap gloss … -->` comment |
| Recall, check, quiz, agent question | an ```` ```icap-ask ```` fence, with its state in plugin data | the learner's words + `> [!feedback]` / `> [!practice]`, titled with the date and verdict mark, under an `<!-- icap … -->` comment |
| Request (*Ask the agent here*) | an ```` ```icap-ask ```` fence with `kind: request` + plugin data | `> [!request]` record: requests, replies, files |
| Edit to an existing note | a review turn showing a diff | applied only after *apply change* |
| Interactive visual | an ```` ```icap-ui ```` fence in a reply or an agent-created note | unchanged |

What ends up in notes is a contract other tools read: [FORMAT.md](FORMAT.md). Change a kept format only with its version.

## Rules that must hold

- **Kept output is plain Obsidian Markdown.** Uninstalling the plugin must leave readable notes. Transient state (open glosses, block state) never leaks into the file.
- **The note is the source of truth; a Pi session is a cache.** What the agent is told of a conversation is what the block shows (`transcript.ts`). A session is resumed only while its fingerprint matches. Runtime command turns (`/model`, `/thinking`, `/compact`) carry `control: true` and never reach the transcript or the kept record.
- **The learner decides what changes.** The plugin writes only its own blocks into the task's note, plus, only when the learner turned on *Record tasks as notes* (`taskNotes`, off by default; on for a vault that already had `Activity.base`), its own record of request and note tasks: task notes in `ICAP/Tasks/` and the once-generated `ICAP/Activity.base` (`src/runtime/task-notes.ts`; a visible folder, because Obsidian does not index hidden ones). Nothing else of the plugin's lands in the vault: caches live in the plugin's own folder. Never ask with a dialog before writing; the setting is the choice. A task note the learner deleted is rewritten only by the *Rebuild task notes* command. It never edits a task note's body after creating it, sets only its own `icap-*` properties, and never rewrites `Activity.base`, save once: a base generated before the activity view gets that view as its first (`withActivityView`, flag `activityViewAdded`). ICAP's tools change existing notes only through `propose_edit`, which the learner applies. It refuses, before the learner sees anything, an edit that adds an ```` ```icap-ui ```` visual or touches an ICAP block (`editProblem` in `src/dsl/blocks.ts`). The agent never rewrites the learner's answer.
- **Every file change is attributed.** ICAP's own tools (`create_note`, an applied `propose_edit`) record the file on their task when they write it; on mobile they are the only writers. In "mine" mode, vault create, modify, delete and rename events are recorded on the task whose agent is in a tool call, or ended one less than 3 s ago. Exempt: the task's own note, task notes and `Activity.base` (the plugin's own files, `TaskNotes.owns`), notes the learner is typing in, and the legacy document cache (`icap/docs/`; `.icap/docs/` and the plugin's own `docs/` raise no vault events). Keep this working for every task kind.
- **Slash commands exist only in request blocks.** In a recall, check or quiz the learner's text is an answer, so a leading `/` is just text.
- **Context files stop at the vault.** Only Pi's global `AGENTS.md` (in "mine" mode) and those inside the vault are loaded, never an ancestor's (`vaultContextFiles`). Isolated mode loads only the vault's own; so does mobile, which reads the vault root's file itself (`src/agent/context-files.ts`, Pi's names and rendering).
- **Visuals stay sandboxed.** `sandbox="allow-scripts"` without `allow-same-origin`, and CSP `default-src 'none'`. `ask` and `open` are honoured only from the rendered frame, well-formed, and while the learner has focused it. The iframe's `color-scheme` must match the inner document's, or Chromium paints an opaque backdrop.
- **The agent sits behind `AgentBackend`.** The runtime, settings and tools reach Pi only through `src/agent/backend.ts`; a feature a backend lacks is gated by its capability flags, never faked. Node built-ins (`fs`, `path`, `os`, `node:*`…) are imported only in `src/agent/desktop/`, tests, `tooling/` and `scripts/`; `pnpm check` fails otherwise (`no-restricted-imports` in `vite.config.ts`).
- **Nothing on the mobile load path touches Node.** Obsidian mobile has no `require("fs")`, `process` or `Buffer`; one top-level use and the plugin fails to load on a phone. Node built-ins are never external imports at the top of `main.js`: `obsidianBuild()` serves each as a CommonJS module whose `require` runs on first use, inside the desktop backend's lazy import. `test/integration/mobile/mobile-load.spec.test.ts` boots the built `main.js` with no Node and runs a request: it failing is the phone failing.
- **Touch has a way to everything.** Hover, right-click and keyboard chords are extras: every action is a visible control or a command (with an icon, usable from the mobile toolbar). On mobile, keycap hints are hidden and the activity opens from the ribbon.
- **Tasks can be notes; the activity is a Base.** With recording on, note tasks, and request blocks that amount to a task (a tool call, a file touched, a question back, or more than one round: `TaskNotes.substantial`), are recorded as task notes (`icap: task`, FORMAT.md); a one-question-one-answer request, and explain, recall, check and quiz, never are. Live phase never goes into properties. An ended task always records `icap-cost`: a number, or `unknown` when it cannot be told (never 0 for "don't know"). In a `.base` expression a hyphenated property is `note["icap-status"]` (bare, Bases subtracts); as a column or group key, `note.icap-status`. Status-bar mark, mobile ribbon and *Show activity* open `Activity.base` (with recording on), whose first view is the plugin's `icap-activity` (uninstalled, Bases says the view type is unknown and the tables after it still work); the ledger list is what they open when recording is off or the Bases core plugin is off. A row's title opens where the task was asked (`openTask`: the block, else the kept `[!request]` record, else the note); Mod opens the task note. This plugin is released: what earlier versions stored (the ledger in plugin data, `icap/docs/`, `.icap/docs/`) is migrated, never dropped.
- **The docs site is its own repository** ([icap-site](https://github.com/EdwinZhanCN/icap-site), Astro Starlight, en + zh-cn, Simplified Technical English), so the community plugin scanner reads only the plugin. It holds this repository as a submodule and imports `src/` (the Svelte views, `main.css`): code it imports must not touch `window` or `document` on import (Astro evaluates it on the server), and an Obsidian API those views start using needs its stand-in there (`src/demo/obsidian.ts`).
- **Bilingual interface, English markers.** Every UI string is `L("English", "中文")` at its call site. Callout types, `kind:`, `generated-by` and the *Plainly.* / *Deeper.* headings stay English: the agent reads them back as evidence.
- **Motion has rules** (DESIGN.md, Motion). Only frames animate `height`; everything else is `transform` / `opacity`. Keyframes end at the natural state, and reduced motion keeps a 140 ms fade. An entrance plays once per thing, so re-created widgets and reloads never replay it. Animate through the tokens in `src/ui/motion.ts`.
- **Glosses and blocks never edit the note by accident.** They render inside CodeMirror's contenteditable; `inertToEditor` swallows `beforeinput` while their controls have focus. The writing line pushes an Obsidian `Scope` (`src/ui/keys.ts`) that owns Mod+Enter and swallows formatting chords.

## Pi inside Obsidian

`vp pack` (tsdown, configured in `tooling/pi-bundle.ts`) builds `src/agent/desktop/pi-sdk-entry.ts` for Node into `build/pi-sdk.cjs` at the start of `vp build`, and `main.js` includes it behind a lazy import. Tests import the entry directly.

The bundle is CJS with `PI_BUNDLED_NODE`. `import.meta.url` maps to `globalThis.__ICAP_PI_URL`, and Pi's package.json and photon's wasm are embedded. Like Pi's standalone binary, the entry registers the OAuth flows and Bedrock statically.

`pi-node.ts` gives Pi's code, through rolldown's `define` + `transform.inject`, Node's fetch (undici, honouring `HTTP(S)_PROXY`, no CORS), timers, web streams, Blob/File and performance. Obsidian's own globals are untouched.

`piPatches` in `tooling/pi-bundle.ts` patches specific upstream files (Pi's config.js, photon's wasm loader, undici's `install()`, runtime `import()` in pi-ai and jiti) and **throw when upstream changes**. When bumping `@earendil-works/pi-*` (pinned to an exact version in `package.json`), expect to update them.

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

- `main.js` is about 13 MB: Pi with its providers (including the AWS SDK for Bedrock), jiti for the learner's TypeScript extensions and photon, all behind the desktop's lazy import; plus pi-agent-core and the five pi-ai adapters the mobile agent uses (which desktop's Pi bundle also contains: they are in main.js twice, uncompressed).
- Desktop needs Node 22.18 or later. Node comes with Obsidian's installer, not its in-app updates: installer 1.9.10 and later (Electron 37+, Node 22.18+) run Pi; 1.8.9 and earlier (Electron 34, Node 20) do not, and the settings say to reinstall (`oldNode` in `pi-host.ts`). Obsidian never shipped Electron 35 or 36. Pi and undici declare 22.19; 22.18 was checked with a full session.
- Mobile: isolated only with ICAP's tools; API keys or custom endpoints only (no OAuth, Bedrock, Vertex); no session cache (each run replays the transcript) and no `/compact`; no documents outside the vault. A custom endpoint without CORS replies whole through `requestUrl`, which cannot be aborted: stopping discards the reply, the provider still bills it.
- Only Pi's own code gets Node's fetch. A learner's extension calling `fetch` itself runs in the renderer and is subject to CORS, unlike in the Pi CLI. Pi's codemode (QuickJS in a worker) is not bundled.
- The selection mark exists in Live Preview and Source mode only. An unkept gloss disappears on plugin reload; blocks persist and resume.
- An interrupted turn resumes by replaying the transcript into a fresh session, so the next question may be phrased differently.
- A visual's state is not saved. In Reading view, a visual in a note without a request block asks through a new request block, which needs the note to be editable.

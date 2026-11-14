# AGENTS.md

ICAP Learning Agent is an Obsidian plugin (TypeScript, Svelte 5, CodeMirror 6, Tailwind v4) for desktop and mobile. On desktop it runs [Pi](https://pi.dev): a trimmed fork of Pi's coding agent inside Obsidian (the built-in agent), or the learner's own installed Pi as a process per task (`pi --mode rpc`); on mobile, which has no Node, its own agent on Pi's `pi-agent-core` and `pi-ai`. Explanations, questions, feedback and requests live in the learner's Markdown notes; there is no chat panel.

- What users see and do: [README.md](README.md)
- How the product behaves and why: [DESIGN.md](DESIGN.md). Read it before changing an interaction.
- Setup, checks and releasing: [CONTRIBUTING.md](CONTRIBUTING.md)

## Commands

```bash
git submodule update --init     # pi/: the fork of Pi's coding agent the built-in agent is built from (its own repository)
pnpm build                      # vp build: build/pi-sdk.cjs (vp pack) + main.js + styles.css
pnpm dev                        # the same, watching
pnpm check                      # vp check (type-aware Oxlint + type check) + tsc on pi/ (tsconfig.pi.json) + svelte-check: 0 errors
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
src/runtime/file-change.ts  pure: the whole new file from the agent's edit or write tool as the one change the learner
                          reviews (hunk), applied to the note as it is now (locate)
src/runtime/backups.ts    the original of every file those tools change, kept before the write in <plugin>/backups/
                          (a folder per day, index.jsonl; a month)
src/runtime/task-notes.ts TaskNotes: request and note tasks mirrored into notes with `icap-*` properties (found by
                          icap-id, written only on a change of state and only by the device running the task),
                          Activity.base generated once, the one-time migration of the earlier ledger

src/agent/backend.ts      AgentBackend: the boundary under LearningRuntime (run a task, events, capability flags,
                          probes, SessionCache, ExternalFiles, accounts, OwnInstall, dispose) and the platform-neutral
                          types (AgentPhase, ToolScope, ConfirmMode, Control, DialogRequest…), SetupNeeded. Only main.ts
                          imports a backend, each behind a dynamic import evaluated on its platform
src/agent/permissions.ts  pure: what the built-in agent may do without asking. ToolScope (isolated | full) decides what
                          it has, ConfirmMode (ask | auto-edits | skip) when it stops to ask: writeDecision,
                          actionDecision, mentionsPath (a command that names a protected folder)
src/agent/prompts.ts      the ICAP protocol (systemPrompt, shaped by PromptEnv: file tools? skill files?) and each
                          task's prompt (explain, recall, quiz, note, request, follow-up, continuation)
src/agent/steps.ts        pure: a tool call's result as the steps keep it (error, the start of its text)
src/agent/connectors.ts   pure: connector names and command lines; desktop/connectors.ts reads and writes Pi's global
                          mcp.json with the harness's own functions (the settings' Connectors group)
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

src/agent/desktop/        the desktop backend, Pi on Node (the only place for Node built-ins outside tests/scripts):
  desktop-backend.ts      DesktopBackend: vault root, allowed folders, sessions dir, skills; chooses at every run
                          (settings.desktopPi) between the built-in agent (pi-session.ts) and the learner's own Pi
                          (rpc/). The learner's own Pi has no isolated scope and does not ask (`confirms` false)
  pi-events.ts            pure: Pi's session events as AgentEvents and the run's result (PiEvents), read the same
                          from the SDK and from RPC's JSON records; stepDetail, extensionName
  pi-host.ts              loads the harness on first use; first fills process.env with the login shell's missing
                          variables and PATH (provider keys exported in ~/.zshrc, which a Dock-launched Obsidian
                          lacks), never overriding. Shared ModelRuntime; project trust
  pi-session.ts           PiSession: one in-process session of the harness per task. sessionPlan "full" (the
                          learner's skills, prompt templates and connectors, the shell, ICAP protocol appended) or
                          "isolated" (ICAP's tools + read, edit, write; the protocol as the whole system prompt).
                          Dialogs become turns in the task's block. probeModels / probeCommands read without prompting
  icap-extension.ts       ICAP's tools as an inline extension of the harness, and its guard (tool_call): isolated,
                          the file tools stay in the vault; full, a shell command and a connector call ask the
                          plugin first (bridge op `permit`)
  tool-ops.ts             the harness's edit and write hand their writes to the plugin (bridge op `write_file`);
                          classifyWrite: vault, protected (Obsidian's folder, Pi's, the vault's .pi) or outside
  files.ts                DesktopFiles (ExternalFiles): documents in folders outside the vault, `within`
  session-cache.ts        a request block's Pi session (<plugin>/sessions/) as a cache, resumed only while its
                          fingerprint equals the block's history; deleted on keep / clear; orphans pruned on start
  icap-skills.ts          ICAP's own skills (icap-visual), shipped in main.js, written to <plugin>/skills/
  pi-login.ts             provider login without the CLI; login-modal.ts is its dialog
  pi-endpoints.ts         custom model endpoints in Pi's models.json; endpoint-modal.ts is its dialog
  pi-sdk-entry.ts         the part of the harness (pi/) ICAP uses, built for Node into build/pi-sdk.cjs (see "Pi
                          inside Obsidian"); shellTool (bash, or PowerShell on Windows without one)
  pi-node.ts              injected into the bundle only: Node's fetch, timers, streams, Blob/File, __icapImport
  rpc/                    the learner's own installed Pi, never loaded into Obsidian (see "The learner's own Pi"):
    pi-command.ts         findPi: the path in the settings, else PATH (the login shell's), then `pi --version` ≥ 1.5.0;
                          SetupNeeded otherwise. Only finds: never installs. spawnSpec (npm's pi.cmd on Windows)
    rpc-process.ts        PiProcess: one `pi --mode rpc` child; commands by id, records by line (jsonl.ts: LF only,
                          never readline), the stderr tail, process-group kill / taskkill /T /F
    rpc-session.ts        RpcSession: a task on that process (prompt, compact, abort, extension dialogs and errors),
                          rpcArgs, probePi (models, commands)
    bridge-server.ts      ToolBridge: a Unix socket / Windows named pipe, a token per task; ICAP's tools run here
    icap-forwarder.ts     `icap-extension.js`, written to <plugin>/pi/: a dependency-free Pi extension that only
                          forwards tool calls over the socket; socket and token come in the environment
    pi-rpc.ts             PiRpc: ties them together per task; the context files Pi is given (contextFiles); dispose

src/agent/mobile/         the mobile backend, no Node (also what desktop's app.emulateMobile(true) runs):
  mobile-backend.ts       MobileBackend: isolated only, ICAP's tools; resolves provider/model, key and transport
                          (SetupNeeded when a key is missing); probeModels from pi-ai's catalog + endpoints
  mobile-session.ts       MobileSession: pi-agent-core's Agent on a pi-ai adapter (api/*.lazy), events as PiSession's,
                          its own provider retry ("retrying"), a lost connection → interrupted
  providers.ts            the eight providers (pi-ai model tables), custom endpoints, transportOf (the one rule:
                          built-ins stream, an endpoint uses its probe), secret ids icap-<provider> / icap-endpoint-<slug>
  transport.ts            wholeFetch (requestUrl as a fetch: whole body, abort discards) and probeTransport
  settings-ui.ts          keys (SecretComponent → app.secretStorage) and the endpoint dialog, in the settings tab

src/activity/             the `icap-activity` Bases view over task notes: rows.ts (pure: a note as a row, steps and
                          phases as spans), ActivityView.svelte, view.svelte.ts (the BasesView; strips and traces only
                          for this device's tasks), Strip.svelte (a task's time: phases under, tool calls over) and
                          StepList.svelte (its tool calls with result previews), shared with the ledger. Display only.
                          Its table views in Activity.base work without the plugin
src/ui/provider-marks.ts  model marks (Lobe Icons, MIT, mono) and markFor(`provider/id`)
src/dsl/blocks.ts         the Markdown DSL: ```icap-ask fences (and legacy ```icpa-ask), callouts
src/dsl/records.ts        pure: the reference reader of FORMAT.md (readRecords, requestRounds); test/fixtures/format/
                          pairs each sample note with the JSON it must read as
src/dsl/session.ts        pure: session notes (FORMAT.md 7): the note's text and name, the `[!request]` record above a
                          `record: live` fence (findLiveRecord), a round added (appendRounds) or taken back (dropLastRound)
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
scripts/build/            the build, under scripts/ (which the community plugin scanner skips): obsidian-build.ts
                          (Vite plugin: Pi bundle, Node built-ins as lazy requires, copies to the repo root and
                          dev-vault), pi-bundle.ts (vp pack config for Pi), plugin-entry.ts (main.ts + the stylesheet)
pi/                       a git submodule, its own repository: the fork of earendil-works/pi whose packages/coding-agent
                          is the harness (branch `icap`; pi/FORK.md says what was cut and how to follow upstream).
                          Checked by tsconfig.pi.json, never linted or scanned with the plugin
```

## Document model

| What | Lives in | Becomes on *keep* |
|---|---|---|
| Gloss (explanation) | CodeMirror decorations only, never the file | `> [!gloss] term` under an `<!-- icap gloss … -->` comment |
| Recall, check, quiz, agent question | an ```` ```icap-ask ```` fence, with its state in plugin data | the learner's words + `> [!feedback]` / `> [!practice]`, titled with the date and verdict mark, under an `<!-- icap … -->` comment |
| Request (*Ask the agent here*) | an ```` ```icap-ask ```` fence with `kind: request` + plugin data | `> [!request]` record: requests, replies, files |
| Session note (*New session note*) | a note with `icap: session`: a request fence with `record: live`, its `[!request]` record directly above, one round added as each ends | *end session* removes only the fence; the record is already there |
| Edit to an existing note | a review turn showing a diff | applied only after *apply change* |
| Interactive visual | an ```` ```icap-ui ```` fence in a reply or an agent-created note | unchanged |

What ends up in notes is a contract other tools read: [FORMAT.md](FORMAT.md). Change a kept format only with its version.

## Rules that must hold

- **Kept output is plain Obsidian Markdown.** Uninstalling the plugin must leave readable notes. Transient state (open glosses, block state) never leaks into the file.
- **The note is the source of truth; the agent's session is a cache.** What the agent is told of a conversation is what the block shows (`transcript.ts`); for a `record: live` block (a session note), the `[!request]` record above its fence plus the round in progress in the block (`src/dsl/session.ts`). What the learner writes while the agent works waits in the block (`AskBlock.queue`, not persisted) and is part of the conversation only once sent or delivered (`steer`). A session is resumed only while its fingerprint matches. Runtime command turns (`/model`, `/thinking`, `/compact`) carry `control: true` and never reach the transcript or the kept record.
- **The learner decides what changes.** The plugin writes only its own blocks into the task's note, the session notes the learner asks for (*New session note*: two properties, the block, and the `[!request]` record it adds each finished round to, never rewriting what is there; renamed once from the first request while it still has the plugin's name), and the images the learner pastes into a request (saved where Obsidian's attachments go), plus, only when the learner turned on *Record tasks as notes* (`taskNotes`, off by default; on for a vault that already had `Activity.base`), its own record of request and note tasks: task notes in `ICAP/Tasks/` and the once-generated `ICAP/Activity.base` (`src/runtime/task-notes.ts`; a visible folder, because Obsidian does not index hidden ones). Nothing else of the plugin's lands in the vault: caches live in the plugin's own folder. Never ask with a dialog before writing; the setting is the choice. A task note the learner deleted is rewritten only by the *Rebuild task notes* command. It never edits a task note's body after creating it, sets only its own `icap-*` properties, and never rewrites `Activity.base`, save once: a base generated before the activity view gets that view as its first (`withActivityView`, flag `activityViewAdded`). ICAP's tools change existing notes only through `propose_edit`, which the learner applies. The built-in agent's own `edit` and `write` land the same way: their write goes to the plugin (`writeFile` in `runtime.ts`), which shows the changed lines as a review turn and applies them when the learner agrees, unless the learner chose a confirmation mode that accepts edits. Both refuse, before the learner sees anything, a change that adds an ```` ```icap-ui ```` visual or touches an ICAP block (`editProblem` in `src/dsl/blocks.ts`). The agent never rewrites the learner's answer.
- **Every file change is attributed.** ICAP's own tools (`create_note`, an applied `propose_edit`) record the file on their task when they write it; on mobile they are the only writers. The built-in agent's `edit` and `write` record theirs the same way. With the full tool scope (the shell, connectors, the learner's own Pi), vault create, modify, delete and rename events are also recorded on the task whose agent is in a tool call, or ended one less than 3 s ago. Exempt: the task's own note, task notes and `Activity.base` (the plugin's own files, `TaskNotes.owns`), notes the learner is typing in, and the legacy document cache (`icap/docs/`; `.icap/docs/` and the plugin's own `docs/` raise no vault events). Keep this working for every task kind.
- **Slash commands exist only in request blocks.** In a recall, check or quiz the learner's text is an answer, so a leading `/` is just text.
- **Context files stop at the vault.** Only Pi's global `AGENTS.md` (with the full tool scope) and those inside the vault are loaded, never an ancestor's (`vaultContextFiles`). The isolated scope loads only the vault's own; so does mobile, which reads the vault root's file itself (`src/agent/context-files.ts`, Pi's names and rendering). The learner's own Pi is started with `-nc` (its own discovery walks up to the filesystem root) and given the same two files in the appended prompt (`contextFiles` in `rpc/pi-rpc.ts`).
- **The plugin installs nothing.** It never installs, updates or downloads Pi, a dependency or an executable. The learner's own Pi is only looked for (`findPi`); when there is none, the settings show the official install command to copy, and a task ends with `SetupNeeded`.
- **A capability is removed only once its replacement shipped.** The built-in agent does not load Pi extensions; the learner's own Pi over RPC, released a version earlier, does. An install that ran the learner's whole Pi setup in Obsidian moves to their own Pi when one is found, and otherwise keeps everything but extensions and is told once (`choosePi` in `main.ts`).
- **Tool scope and confirmation are two settings** (`src/agent/permissions.ts`). The scope decides what the built-in agent has: *isolated* (ICAP's tools, and read, edit, write inside the vault) or *full* (also the shell, the learner's connectors, files outside the vault). The confirmation mode decides when it stops to ask: *ask*, *auto-edits* (changes in the vault land at once, their diff left in the block), *skip*. Four things no mode changes: `ask_learner` always waits; a write to a protected folder (Obsidian's own, Pi's own, the vault's `.pi`) always asks; the original of a file is kept before each write (`src/runtime/backups.ts`); the isolated scope never has the shell or a connector, remote ones included. Full scope with *skip* is turned on only through its warning (`UnboundedModal`). No mode has a model judge each action. A permission is a turn in the task's block; "always" lasts as long as the block and is never a setting.
- **Only `pi-coding-agent` is forked.** `pi-ai`, `pi-agent-core` and `pi-mcp` are dependencies at the same exact version, unchanged, and follow upstream.
- **Visuals stay sandboxed.** `sandbox="allow-scripts"` without `allow-same-origin`, and CSP `default-src 'none'`. `ask` and `open` are honoured only from the rendered frame, well-formed, and while the learner has focused it. The iframe's `color-scheme` must match the inner document's, or Chromium paints an opaque backdrop.
- **The agent sits behind `AgentBackend`.** The runtime, settings and tools reach Pi only through `src/agent/backend.ts` (what the agent may do is asked of the runtime through the bridge: `write_file`, `permit`); a feature a backend lacks is gated by its capability flags, never faked. Node built-ins (`fs`, `path`, `os`, `node:*`…) are imported only in `src/agent/desktop/`, tests and `scripts/` (the build is in `scripts/build/`); `pnpm check` fails otherwise (`no-restricted-imports` in `vite.config.ts`).
- **Nothing on the mobile load path touches Node.** Obsidian mobile has no `require("fs")`, `process` or `Buffer`; one top-level use and the plugin fails to load on a phone. Node built-ins are never external imports at the top of `main.js`: `obsidianBuild()` serves each as a CommonJS module whose `require` runs on first use, inside the desktop backend's lazy import. `test/integration/mobile/mobile-load.spec.test.ts` boots the built `main.js` with no Node and runs a request: it failing is the phone failing.
- **Touch has a way to everything.** Hover, right-click and keyboard chords are extras: every action is a visible control or a command (with an icon, usable from the mobile toolbar). On mobile, keycap hints are hidden and the activity opens from the ribbon.
- **Tasks can be notes; the activity is a Base.** With recording on, note tasks, and request blocks that amount to a task (a tool call, a file touched, a question back, or more than one round: `TaskNotes.substantial`), are recorded as task notes (`icap: task`, FORMAT.md); a one-question-one-answer request, and explain, recall, check and quiz, never are. Live phase never goes into properties. An ended task always records `icap-cost`: a number, or `unknown` when it cannot be told (never 0 for "don't know"). In a `.base` expression a hyphenated property is `note["icap-status"]` (bare, Bases subtracts); as a column or group key, `note.icap-status`. Status-bar mark, mobile ribbon and *Show activity* open `Activity.base` (with recording on), whose first view is the plugin's `icap-activity` (uninstalled, Bases says the view type is unknown and the tables after it still work); the ledger list is what they open when recording is off or the Bases core plugin is off. A row's title opens where the task was asked (`openTask`: the block, else the kept `[!request]` record, else the note); Mod opens the task note. This plugin is released: what earlier versions stored (the ledger in plugin data, `icap/docs/`, `.icap/docs/`) is migrated, never dropped.
- **The docs site is its own repository** ([icap-site](https://github.com/EdwinZhanCN/icap-site), Astro Starlight, en + zh-cn, Simplified Technical English), so the community plugin scanner reads only the plugin. It holds this repository as a submodule and imports `src/` (the Svelte views, `main.css`): code it imports must not touch `window` or `document` on import (Astro evaluates it on the server), and an Obsidian API those views start using needs its stand-in there (`src/demo/obsidian.ts`).
- **Bilingual interface, English markers.** Every UI string is `L("English", "中文")` at its call site. Callout types, `kind:`, `generated-by` and the *Plainly.* / *Deeper.* headings stay English: the agent reads them back as evidence.
- **Motion has rules** (DESIGN.md, Motion). Only frames animate `height`; everything else is `transform` / `opacity`. Keyframes end at the natural state, and reduced motion keeps a 140 ms fade. An entrance plays once per thing, so re-created widgets and reloads never replay it. Animate through the tokens in `src/ui/motion.ts`.
- **Glosses and blocks never edit the note by accident.** They render inside CodeMirror's contenteditable; `inertToEditor` swallows `beforeinput` while their controls have focus. The writing line pushes an Obsidian `Scope` (`src/ui/keys.ts`) that owns Mod+Enter and swallows formatting chords.

## Pi inside Obsidian

The built-in agent is a fork of `@earendil-works/pi-coding-agent`, in its own repository and here as the submodule `pi/` (branch `icap`, cut from upstream 1.5.2; `pi/FORK.md`). It keeps Pi's sessions, compaction, session files, models and credentials, settings, skills, prompt templates, context files, the tools read, bash, powershell, edit and write, and MCP. It has no terminal, no CLI, no RPC mode, no package manager, and loads no code from disk: no extension files, no jiti. `src/agent/desktop/pi-sdk-entry.ts` is the part ICAP uses.

`vp pack` (tsdown, configured in `scripts/build/pi-bundle.ts`) builds that entry for Node into `build/pi-sdk.cjs` at the start of `vp build`, straight from the fork's TypeScript, and `main.js` includes it behind a lazy import. Tests import the entry directly. The fork's dependencies are the plugin's own (`package.json`), found from `pi/` by Node's upward lookup; nothing is installed inside the submodule. `import.meta.url` maps to `globalThis.__ICAP_PI_URL`. Like Pi's standalone binary, the entry registers the OAuth flows and Bedrock statically.

`pi-node.ts` gives the bundle's code, through rolldown's `define` + `transform.inject`, Node's fetch (undici, honouring `HTTP(S)_PROXY`, no CORS), timers, web streams, Blob/File and performance. Obsidian's own globals are untouched.

`bundlePatches` in `scripts/build/pi-bundle.ts` patches three dependencies, none of them the fork: photon's wasm loader, undici's `install()`, and the runtime `import()` in pi-ai. Each **throws when its dependency changes**. When bumping `@earendil-works/pi-*` (pinned to an exact version in `package.json`, the same one the fork was cut from), expect to update them, and sync the fork (`pi/FORK.md`).

How the agent's actions reach the learner: the harness takes its tools' operations from the host (`toolOptions`). ICAP's (`tool-ops.ts`) hand every `edit` and `write` to the plugin, and its inline extension (`icap-extension.ts`) asks the plugin before a shell command or a connector call. The runtime decides by the tool scope and the confirmation mode, in the task's block.

Connectors are the learner's MCP servers in `~/.pi/agent/mcp.json`, shared with their own Pi, over stdio and streamable HTTP. The harness has neither codemode nor tool search, so every tool of a server is declared to the model directly, whatever `exposure` says. They exist in the full scope only. `/mcp login <server>` signs in to one from a request block.

## The learner's own Pi

With *Pi to run → Your own install* (`settings.desktopPi: "rpc"`), each task starts `pi --mode rpc` in the vault: `-nc --append-system-prompt <file> -e <plugin>/pi/icap-extension.js --skill … --provider … --model … --thinking …`, and `--session-dir <plugin>/sessions --session-id icap-<block>-<n>` for a request block (else `--no-session`). The process ends with the task: stdin is closed, and a Pi that has not left after 3 s is killed with its process group.

It is always the learner's whole setup (the full scope, and nothing asked by the plugin): their Pi loads their extensions, skills, MCP servers and tools in its own process, with Node's own globals, so nothing of #3 applies. The built-in Pi and theirs share `~/.pi/agent` (`auth.json`, `models.json`, `settings.json`, `mcp.json`) and Pi's session format, so a block's session resumes under either.

ICAP's tools reach the plugin over a local socket (`ToolBridge`): a Unix domain socket in a `0700` temporary folder, a named pipe on Windows; nothing listens on the network. Each task gets a token valid while it runs; socket path and token travel in the environment (`ICAP_BRIDGE`, `ICAP_BRIDGE_TOKEN`, `ICAP_TOOLS`), never on a command line. The extension file holds only the tools' names, descriptions and JSON Schemas; the tools run in the plugin (`icap-tools.ts`). The prompt file lives in the same temporary folder and is removed with the task.

`test/integration/agent/desktop/pi-rpc.spec.test.ts` runs the pinned Pi CLI as a real child process on the scenarios a learner's extensions need (commands, dialogs, errors). `pi-session.spec.test.ts` runs the built-in agent: scopes, reviewed writes, permission, a connector over a real stdio server, logins. A change to how tasks run on Pi must pass both.

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

- `main.js` is about 9 MB (9.06 MB measured at the fork's first build; 12.7 MB with the whole SDK): the harness with its providers (including the AWS SDK for Bedrock) and photon, 7.0 MB, behind the desktop's lazy import; plus pi-agent-core and the five pi-ai adapters the mobile agent uses (which the desktop bundle also contains: they are in main.js twice, uncompressed).
- Desktop needs Node 22.18 or later. Node comes with Obsidian's installer, not its in-app updates: installer 1.9.10 and later (Electron 37+, Node 22.18+) run Pi; 1.8.9 and earlier (Electron 34, Node 20) do not, and the settings say to reinstall (`oldNode` in `pi-host.ts`). Obsidian never shipped Electron 35 or 36. Pi and undici declare 22.19; 22.18 was checked with a full session.
- Mobile: isolated only with ICAP's tools; API keys or custom endpoints only (no OAuth, Bedrock, Vertex); no session cache (each run replays the transcript) and no `/compact`; no documents outside the vault. A custom endpoint without CORS replies whole through `requestUrl`, which cannot be aborted: stopping discards the reply, the provider still bills it.
- The learner's own Pi (RPC) was run on macOS; Windows (`pi.cmd` through `cmd.exe`, the named pipe, `taskkill`) is covered by unit tests of the command line only, not yet by a run on Windows.
- The built-in agent loads no Pi extensions, Pi packages or themes, and has no codemode or tool search: with many connector tools, all of them are declared to the model. Extensions need the learner's own Pi.
- What a shell command changes is neither reviewed nor kept: only the command is asked about. A command is taken to touch a protected folder when its text names one (`mentionsPath`), which a path built at run time escapes.
- A change reviewed from the `edit` tool is shown as one span, from its first changed line to its last, even when the lines between did not change.
- The selection mark exists in Live Preview and Source mode only. An unkept gloss disappears on plugin reload; blocks persist and resume.
- An interrupted turn resumes by replaying the transcript into a fresh session, so the next question may be phrased differently.
- A visual's state is not saved. In Reading view, a visual in a note without a request block asks through a new request block, which needs the note to be editable.

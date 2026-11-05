# ICAP Learning Agent

Learn inside your Obsidian notes. Select a term you don't understand and the explanation appears under the paragraph. Explain a section from memory and get feedback on what you wrote. Answer the questions the agent asks right in the note, or ask your agent for anything else from where you are. Whatever you decide to keep is plain Markdown.

ICAP is an Obsidian plugin. Its agent is [Pi](https://pi.dev), which ships inside the plugin and uses your own model provider. The name comes from the ICAP framework (Chi & Wylie, 2014): learning gets deeper as engagement moves from **P**assive to **A**ctive, **C**onstructive and **I**nteractive, and the plugin is built to make the deeper modes easy.

**[中文说明](README.zh-CN.md)**

- Desktop Obsidian 1.7 or later
- Interface in English or Chinese, following Obsidian's language
- No chat panel: everything happens in the note you are reading

## Install

ICAP is not in the community plugin directory yet.

1. Download `main.js`, `manifest.json` and `styles.css` from the latest [release](https://github.com/EdwinZhanCN/obsidian-icap-agent/releases).
2. Put them in `<your vault>/.obsidian/plugins/icap-agent/`.
3. In Obsidian, open **Settings → Community plugins**, turn off Restricted mode, and enable **ICAP Learning Agent**.

On first launch the plugin opens a guide note, *Learning with ICAP*. Working through it takes you through every interaction once.

**Upgrading from ICPA.** The plugin used to be called ICPA (folder `icpa-agent`). Install ICAP into the new folder and enable it. On its first start it imports the old folder's settings, activity and sessions. Then disable the old plugin and delete `.obsidian/plugins/icpa-agent/`. Existing `icpa-ask` blocks and `generated-by: icpa-agent` properties keep working.

## Connect a model

Pi is built in, so you don't need to install Pi or Node.js. You do need a model provider:

1. Open **Settings → ICAP Learning Agent → Model providers → Log in…**
2. Pick your provider, then either sign in with an existing subscription (for example Claude Pro/Max, ChatGPT or GitHub Copilot) or paste an API key.

The credential is stored by Pi in `~/.pi/agent/auth.json`, the same place the Pi CLI uses; ICAP keeps no keys of its own. A key exported in your shell profile (for example `export DEEPSEEK_API_KEY=…`) or a Pi CLI `/login` works too.

## Use it

| To | Do this |
|---|---|
| Understand a word or passage | Select it and click the small mark that appears, or run **Explain selection in context**. Ask for *deeper*, *example*, *plainer* or *compare…*, and *keep in note* if it helped. |
| Test whether you really understand a section | **Recall from memory (this section)**. The rest of the note blurs while you write; the agent responds and asks a follow-up. |
| Check something you wrote | Select your paragraph and choose *check my words*, or run **Check what I wrote**. |
| Answer a few questions | **Check my understanding of this section** or **…of this note**. |
| Ask for anything else | **Ask the agent here** (also in the right-click menu). Type your request and press ⌘↵ (Ctrl+Enter). Type `[[` or `@` to point at files in the vault, and `/` for commands: your Pi skills, prompt templates and extension commands, plus `/model`, `/thinking` and `/compact`. |
| Try something hands-on | Ask for it ("draw…", "make a slider that…"), or let the agent add one when it helps. Interactive visuals are `icap-ui` blocks. |
| See what the agent did | Click the dot in the status bar to open **Activity**: every task, its state, and the files it created, changed or deleted. |

Everything you keep is ordinary Markdown: callouts, paragraphs and links. Your notes stay readable without the plugin.

## Settings

| Setting | What it does |
|---|---|
| Your background | What you already know. Explanations build on this and on your own notes. |
| How you like to learn | Language, style and depth, applied to every explanation and request. |
| Model | Optional. The list shows only models you have credentials for; *Pi default* follows Pi's own settings. |
| Thinking | Reasoning effort for models that support it (default: low). |
| Agent setup | **Your Pi setup + ICAP** (default) or **ICAP only (isolated)**. See below. |
| This vault's conventions | A short wizard that writes an `AGENTS.md` at the vault root: what you study here, how notes are organised, which folders the agent must leave alone. |
| Interactive visuals | *When it helps* (default), *Only when I ask*, or *Never*. |

## What the agent can do

- **Your Pi setup + ICAP (default).** The agent runs with your own Pi configuration: your skills, extensions, MCP servers, `AGENTS.md`, and Pi's built-in tools, including the shell. It can edit files directly, the same as running Pi in the vault yourself. ICAP records every file it creates, changes, deletes or renames in Activity. ICAP's own tools never rewrite the text of an existing note without your approval: they propose the edit as a diff, and nothing changes until you apply it.
- **ICAP only (isolated).** Read-only tools plus ICAP's own, no shell. The agent can read this vault and only the outside folders you allow. Your Pi extensions, skills and global `AGENTS.md` are not loaded; the vault's own `AGENTS.md` still is.
- **Interactive visuals** run in a sandbox: no network, no access to your notes, Obsidian or your computer. A visual can do two things, and only after you click it: send one message back to the agent, or open a note in the vault.
- **Your learning record is your notes.** There is no hidden learner database. Notes the agent creates are marked `generated-by: icap-agent` so it can tell your writing from its own; you can turn this off.

## Troubleshooting

- **"No model has credentials":** log in under **Model providers**. A key exported in `~/.zshrc` reaches Obsidian on its next launch; then press ↻ in the settings.
- **The model isn't the one you expected:** if Pi's default model has no credential, Pi falls back to another one. Choose a model in the settings, or change Pi's `settings.json`.
- **You don't want the agent editing files directly:** switch **Agent setup** to *ICAP only (isolated)*.

## Known limitations

- Desktop only: Pi needs Node.js, which only desktop Obsidian has.
- `main.js` is about 11 MB, because it carries Pi and its model providers.
- The selection mark works in Live Preview and Source mode, not Reading view.
- An explanation you haven't kept disappears when the plugin reloads; question and request blocks persist and resume.

## More

- [DESIGN.md](DESIGN.md): how ICAP works and why
- [CONTRIBUTING.md](CONTRIBUTING.md): building, testing and releasing
- [AGENTS.md](AGENTS.md): the code map, for coding agents

## License

[MIT](LICENSE)

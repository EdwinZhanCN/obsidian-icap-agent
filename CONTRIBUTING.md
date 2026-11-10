# Contributing

Thanks for helping. This file covers setting up, the checks a change must pass, and releasing. How the product is meant to behave is in [DESIGN.md](DESIGN.md); the code map and the rules the code relies on are in [AGENTS.md](AGENTS.md).

## Requirements

- Node.js 22.19 or later and pnpm (`corepack enable` picks the version in `package.json`); macOS, Windows and Linux all work
- Desktop Obsidian 1.8.7 or later, to run the plugin
- Obsidian 1.12 or later with **Settings → General → Command line interface** turned on, only if you use `scripts/drive.mjs`
- A model credential only for trying the agent by hand. The tests need none and spend nothing.

## Set up

```bash
pnpm install
pnpm build           # Vite+: main.js and styles.css (Pi's SDK is bundled in through vp pack)
pnpm vault           # create dev-vault/ from test/fixtures/dev-vault/
```

In Obsidian choose **Open folder as vault**, pick `dev-vault/`, turn off Restricted mode and enable **ICAP Learning Agent**. Connect a model under **Settings → ICAP Learning Agent → Model providers**. The sample note *C++ Memory Management* contains a deliberate misconception under *My understanding*, to try *check my words* on.

## Work on it

```bash
pnpm dev             # rebuild main.js and styles.css on every save
```

After a rebuild, reload the plugin: toggle it in Community plugins, or run **Reload app without saving**.

### The dev vault

`dev-vault/` is generated and git-ignored. Its plugin folder links to the build output in the repo root.

| Command | Effect |
|---|---|
| `pnpm vault` | Create the vault if it is missing; relink the plugin |
| `pnpm vault --reset` | Back to the seed: everything the agent wrote is removed and your plugin settings are kept. The guide note is created again on the next load |
| `pnpm vault --clean` | Like `--reset`, but the settings go too: a first-install vault |

Close the vault in Obsidian before `--reset` or `--clean`, or run **Reload app without saving** right after. To change the sample notes or the vault config, edit `test/fixtures/dev-vault/`, never `dev-vault/`. `test/fixtures/dev-vault/.obsidian/themes/Paperline` is a deliberately unusual theme (paper ground, serif, green accent, dark variant) for checking theme compatibility.

On Windows without Developer Mode, symlinks are not allowed, so the script copies the build instead. `pnpm dev` keeps the copied `main.js` and `styles.css` fresh.

### Driving Obsidian from the terminal

`scripts/drive.mjs` controls the running plugin through the Obsidian CLI. It can select text, run a command, wait for the agent, dump runtime state, take screenshots into `.shots/`, and send trusted key presses. The commands are listed at the top of the file. For example:

```bash
node scripts/drive.mjs select "RAII"
node scripts/drive.mjs cmd explain-selection
node scripts/drive.mjs wait && node scripts/drive.mjs shot gloss
```

## Before you open a pull request

```bash
pnpm check           # vp check (Oxlint, type-aware, with type checking) + svelte-check
pnpm test            # vp test: unit (src/**/*.test.ts) and integration (test/integration/)
pnpm build
```

All three must pass. In addition:

- **Try UI changes in Obsidian**, in light and dark themes and in Paperline, and with reduced motion if you touched animation. Test results don't show what an interaction feels like.
- **Every user-facing string is bilingual**, written at its call site as `L("English", "中文")`. Markers stored in notes stay English: callout types, `kind:`, `generated-by`, and the *Plainly.* / *Deeper.* headings.
- **Never use your real Pi credentials in a test.** Tests run the real SDK against pi-ai's faux provider in a temporary agent directory. Never complete a login against `~/.pi/agent/auth.json`; use `ModelRuntime.create({ authPath: <scratch file> })`.
- **Keep the docs in their lanes.** Update [README.md](README.md) and [README.zh-CN.md](README.zh-CN.md) when what users see or do changes, [DESIGN.md](DESIGN.md) when how or why the product behaves changes, and [AGENTS.md](AGENTS.md) when the code map or one of its rules changes.

## Release

1. Bump `version` in `manifest.json` and `package.json`. Add `"<version>": "<minAppVersion>"` to `versions.json`.
2. `pnpm check && pnpm test && pnpm build`
3. Commit, then tag the commit with the bare version, with no `v` prefix (Obsidian looks the release up by the manifest's version): `git tag 1.0.0 && git push --tags`
4. Create a GitHub release for the tag and attach `main.js`, `manifest.json` and `styles.css` as separate files.

---
title: Troubleshooting and limits
description: What to do when a task fails, and what ICAP cannot do.
sidebar:
  order: 6
---

## Messages and what to do

| Message | Cause | What to do |
|---|---|---|
| "could not load: Obsidian's installer is too old for Pi…" (in the settings, on a computer) | Your Obsidian installer has Node 20. Pi needs Node 22. Obsidian's updates inside the app do not change the installer. | Download the latest installer from obsidian.md/download, and install it over the current Obsidian. Your vaults and settings stay. |
| "no model has credentials yet: log in to a provider." (in the settings) | Pi has no credential for a provider. | Log in under **Model providers**. If your key is in your shell profile, restart Obsidian, then select ↻ (**Check again**). |
| "no model can run yet: add an API key below." (in the settings, on a phone or tablet) | This device has no API key. | Add a key under **API keys**. |
| "No model provider is set up on this device yet. Add an API key in the settings." | The same, when a task starts. | Select **Open settings** in the notice, and add a key. |
| "No API key for *provider* on this device. Add it in the settings." | The model of the task needs a key that this device does not have. | Add the key on this device. Keys do not sync. |
| "“*model*” is not available on mobile. Choose a model in the settings." | The model is not one of the providers on a phone, or not one of your endpoints. | Select a different model in **Model**. |
| "There is no model “*model*”. Choose one in the settings." | The model name does not exist for that provider or endpoint. | Select a model in **Model**. |
| "The model provider refused the request — check the credentials (Model providers, in the settings)." | The provider replied that the key or the login is not valid (401 or 403). | Log in again, or type the key again. Make sure that your account with the provider is active. |
| "Network problem reaching the model." | ICAP could not connect to the provider. | Check your network connection and your proxy. Then select **try again** in the block. |
| "the model provider returned an error — trying again…" | The provider returned an error. ICAP tries again. | Wait. If it continues, check the provider's status page. |
| "paused — the connection was lost" | The connection stopped, for example when the app went to the background. | Open the note again, and select **continue**. |
| "paused when Obsidian closed" | Obsidian closed while the task ran. | Select **continue**. |
| "couldn't continue" | The task failed. The block shows the reason. | Correct the cause, then select **try again**. |

:::tip
If a task fails with an error such as `500` or `internal_error`, or a task waits for a long time with no reply, first look at the status page of your provider. The problem is often at the provider, not in ICAP.
:::

### A reply that comes in one piece

Some custom endpoints on a phone or tablet do not let the app stream the reply. Then the reply comes in one piece, and the block shows "waiting for the complete reply…". The stop button is **stop waiting — this request is still billed**.

:::caution
**stop waiting** stops only the wait. The server completes the request, and the provider bills it.
:::

## Limits

### On a phone or tablet

- The agent uses only ICAP's tools. Your Pi setup (skills, extensions, MCP servers, `/compact`) is not available. There are no file or shell tools.
- Use API keys or custom endpoints only. Subscription logins, Bedrock and Vertex are not available.
- The agent cannot read folders outside the vault.
- ICAP does not save sessions. Each round of a request block sends the full conversation to the model again.
- The model on a phone or tablet is a different setting from the model on a computer.

### Explanations and blocks

- The selection mark shows only in Live Preview and Source mode.
- An explanation that you did not keep disappears when the plugin reloads. Blocks stay, and you can continue them.
- When a task continues after a pause, ICAP sends the conversation to a new session. The next question of the agent can be different from the question it was going to ask.

### Visuals

- ICAP does not save the state of an interactive visual.
- In Reading view, a visual in a note without a request block asks its question through a new request block. The note must be editable for this.

### Documents

- ICAP cannot read a scanned PDF that has no text layer. It has no text recognition (OCR).

### On a computer

- Only Pi's own code connects to the network through Node. If one of your own Pi extensions calls the network itself, it runs inside Obsidian and the server must allow requests from the app (CORS). In the Pi command line, the same extension has no such limit.
- Pi's code mode is not in the plugin.

### Size

`main.js` is about 13 MB. It holds Pi for computers and the model libraries for phones and tablets. A phone or tablet loads only the libraries that it needs.

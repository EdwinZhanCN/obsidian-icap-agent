---
title: Connect a model
description: Give the agent a model to use, on a computer or on a phone.
sidebar:
  order: 3
---

ICAP has no model of its own. It uses a model from a provider that you choose. The procedure on a computer is different from the procedure on a phone or tablet.

## On a computer

The agent on a computer is [Pi](https://pi.dev). Pi is in the plugin. You do not install it.

### Log in to a provider

1. Open **Settings → ICAP Learning Agent**.
2. In **Model providers**, select **Log in…**.
3. Select the provider.
4. Do one of these:
   - Select **Account** to use a subscription that you have, for example Claude Pro or ChatGPT.
   - Type an API key.
5. In **Model**, select the model that the agent uses.

Pi keeps the credential in `~/.pi/agent/auth.json`. The Pi command line uses the same file. ICAP does not keep a copy.

:::note
A key in your shell profile also works, for example `export ANTHROPIC_API_KEY=…` in `~/.zshrc`. Obsidian reads it at the next start. Then select ↻ next to the status at the top of the settings.
:::

### Use a model that Pi does not list

Use a custom endpoint for Ollama, LM Studio, vLLM, a proxy, or another OpenAI-compatible API.

1. In **Model providers**, select **Custom endpoint…**.
2. Type a name, the base URL, the API key and the model IDs.
3. Select **Save**.

Pi keeps the endpoint in `~/.pi/agent/models.json`.

:::caution
A key in `models.json` is plain text. To keep the key out of the file, type `$NAME` in place of the key. Pi then reads the environment variable `NAME`.
:::

## On a phone or tablet

Obsidian on a phone does not have Node, and Pi needs Node. On a phone, ICAP uses its own agent with the same model libraries.

### Add an API key

1. Open **Settings → ICAP Learning Agent**.
2. In **API keys**, find your provider. To get a key, select **Get a key**.
3. Type the key.
4. In **Model**, select the model that the agent uses.

Keys are in Obsidian's keychain on that device. They are not in the vault, and they do not sync. Add a key on each device.

Providers on a phone: Anthropic, OpenAI, Google Gemini, OpenRouter, DeepSeek, Mistral, Groq and xAI.

### Add an endpoint

1. In **Custom endpoints**, find **Add endpoint**, then select **Add…**.
2. Type a name, the base URL and the model IDs. If the server needs a key, turn on **Needs an API key** and type the key.
3. Select **Save**.

When you save, ICAP checks if the server lets the app stream the reply. If it does not, the reply comes in one piece. You then see "waiting for the complete reply…".

:::caution
If the reply comes in one piece, the stop button is **stop waiting — this request is still billed**. It stops only the wait. The server completes the request, and the provider bills it.
:::

## What a phone cannot do

- Log in with a subscription, or use Bedrock or Vertex.
- Use your Pi setup: skills, extensions, MCP servers and `/compact`.
- Read folders outside the vault.

The model on a phone is a different setting from the model on a computer.

Next: [Your first lesson](/start/first-lesson/).

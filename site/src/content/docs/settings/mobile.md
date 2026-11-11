---
title: On a phone
description: What is different when you use ICAP on a phone or a tablet.
sidebar:
  order: 6
---

Obsidian on a phone or a tablet does not have Node, and Pi needs Node. On a phone, ICAP uses its own agent. This agent uses the same model libraries, the same rules for teaching and the same ICAP tools as on a computer. To add your first key, read [Connect a model](/start/connect-a-model/).

## Settings on a phone

**Settings → ICAP Learning Agent** on a phone shows these groups:

| Group | Settings |
|---|---|
| (no heading) | **Agent**, **Model providers**, **Model**, **Thinking** |
| **API keys** | one key for each provider |
| **Custom endpoints** | your endpoints, and **Add endpoint** |
| **About you** | the same as on a computer |
| **In your notes** | the same as on a computer |
| **Files** | the same as on a computer |
| **Documents** | the same as on a computer |
| **Advanced** | **Parallel tasks** only |

A phone does not show **Log in…**, **Custom endpoint…**, **Agent setup**, **Folders outside the vault** or **Remember a request's context**.

## API keys

The group **API keys** has one line for each provider: Anthropic, OpenAI, Google Gemini, OpenRouter, DeepSeek, Mistral, Groq and xAI.

1. Find your provider.
2. If you do not have a key, select **Get a key**. The provider's page opens.
3. Add the key in the field of that line.

A check mark next to the name shows that the key is set.

The key is in Obsidian's keychain on this device. It is not in the vault or in the plugin's data, and it does not sync. Add the key on each device. The default name of the key in the keychain is `icap-<provider>`, for example `icap-anthropic`.

## Custom endpoints

Use a custom endpoint for Ollama or LM Studio on your network, for a proxy, or for another API that is compatible with OpenAI or Anthropic.

1. In **Add endpoint**, select **Add…**.
2. In **Name**, type a name.
3. In **Base URL**, type the URL up to the version, for example `http://192.168.1.20:11434/v1`.
4. In **API**, select **OpenAI Chat Completions**, **OpenAI Responses** or **Anthropic Messages**.
5. In **Models**, type the model IDs. Put a comma or a new line between two IDs.
6. If the server needs a key, keep **Needs an API key** on. If not, turn it off.
7. Select **Save**.

If the endpoint needs a key, a line **Key for** and the endpoint's name shows below it. Add the key there. To change an endpoint, select **Edit**. To delete it, select **Remove**.

When you save, ICAP checks one time if the server lets the app stream the reply.

- If it does, the reply shows while the model writes it.
- If it does not, the reply comes through Obsidian in one piece. You see "waiting for the complete reply…".

:::caution
If the reply comes in one piece, the stop button is **stop waiting — this request is still billed**. It stops only the wait. The server completes the request, and the provider bills it.
:::

## Model

The model on a phone is a different setting from the model on a computer. **Default** is the default model of the first provider that has a key. Read [Models and providers](/settings/models/).

## What is different from a computer

- **One agent setup only.** The agent always works like **ICAP only (isolated)**, with ICAP's tools only. It has no file tools and no shell. Your Pi skills, extensions and MCP servers are not available.
- **API keys and custom endpoints only.** You cannot log in with a subscription, and you cannot use Bedrock or Vertex.
- **No folders outside the vault.** The agent reads only the vault.
- **No session cache.** Each round of a request block sends the full conversation to the model again. This uses more input tokens.
- **No `/compact`.** In a request block, only `/model` and `/thinking` are available.

:::note
If iOS stops Obsidian while a reply comes in, the task pauses. Open the note again and select **continue**.
:::

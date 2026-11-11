---
title: Models and providers
description: Choose the model and the thinking level, and give the agent access to a provider.
sidebar:
  order: 1
---

The first group of **Settings → ICAP Learning Agent** has no heading. It sets which model the agent uses and how the agent gets access to it. To log in for the first time, read [Connect a model](/start/connect-a-model/).

## The settings

| Setting | What it does | Default | Platform |
|---|---|---|---|
| **Pi** (computer) or **Agent** (phone) | Shows the agent's version and how many models are available. | — | both |
| **Model providers** | On a computer: **Log in…** and **Custom endpoint…**. On a phone: a description only. | — | both |
| **Model** | The model that a task uses when the task has no model of its own. | **Pi default** (computer), **Default** (phone) | both |
| **Thinking** | How much the model thinks before it replies: `off`, `minimal`, `low`, `medium` or `high`. | `low` | both |
| **API keys** | One key for each provider. | empty | phone |
| **Custom endpoints** | Servers that ICAP does not list. | none | phone |

## Pi or Agent

This line shows the agent's version, then the number of models that you can use. The plugin asks for the list without a prompt, so the check costs nothing.

If the line says "no model has credentials yet" (computer) or "no model can run yet" (phone), give the agent access to a provider. Then select ↻ (**Check again**) at the end of the line.

## Model providers

On a computer, the agent is Pi, and Pi keeps the credentials.

- **Log in…** opens **Log in to a model provider**. Select a provider, then select **Account** or type an API key. Pi writes the credential to `~/.pi/agent/auth.json`.
- **Custom endpoint…** opens **Custom model endpoints**. Use it for Ollama, LM Studio, vLLM, a proxy, or another OpenAI-compatible API. Pi writes the endpoint to `~/.pi/agent/models.json`.

When a provider is ready, the description of **Model providers** starts with "Ready:" and the names of the providers.

On a phone, the keys and endpoints have their own groups below: **API keys** and **Custom endpoints**. Read [On a phone](/settings/mobile/).

## Model

The list shows only the models that have credentials.

- On a computer, **Pi default** follows the model in your Pi settings. The model in brackets is that model now.
- On a phone, **Default** is the default model of the first provider that has a key.

The model on a phone is a different setting from the model on a computer. Each device keeps its own keys, so each device chooses its own model.

## Thinking

A higher level makes the reply slower and uses more tokens. An explanation rarely needs a level higher than `low`.

## A model for one request block

A request block can use a different model from the settings. Type the command as a request in the block:

| Command | What it does |
|---|---|
| `/model` | Shows the model of this block. |
| `/model <name>` | Uses `<name>` in this block, from the next request. |
| `/model default` | Uses the model in the settings again. |
| `/thinking` | Shows the thinking level of this block and the levels you can use. |
| `/thinking <level>` | Uses `<level>` in this block: `off`, `minimal`, `low`, `medium`, `high` or `xhigh`. |
| `/thinking default` | Uses the thinking level in the settings again. |

These commands change only that block. The agent does not see them, and they do not go into the kept record. Commands exist only in request blocks. In a recall, check or quiz, a `/` at the start is only text.

If the model name is not in the list of models with credentials, the block shows a warning. The next request can then fail.

## The model of each task

Each task note records the model of the latest run in the property `icap-model`, for example `anthropic/claude-sonnet-4-5`. The model in the settings is only the default for a task that does not have a model yet.

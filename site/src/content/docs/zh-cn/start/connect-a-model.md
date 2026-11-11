---
title: 接上模型
description: 给 Agent 一个可用的模型，在电脑上或手机上。
sidebar:
  order: 3
---

ICAP 没有自己的模型。它使用你选择的服务商提供的模型。电脑上的步骤和手机、平板上的不同。

## 在电脑上

电脑上的 Agent 是 [Pi](https://pi.dev)。Pi 内置在插件中，你不用另外安装。

### 登录服务商

1. 打开 **设置 → ICAP Learning Agent**。
2. 在 **模型服务商** 中，选择 **登录…**。
3. 选择服务商。
4. 二选一：
   - 选择 **账号登录**，使用你已有的订阅，例如 Claude Pro 或 ChatGPT。
   - 输入 API Key。
5. 在 **模型** 中，选择 Agent 使用的模型。

Pi 把凭据存在 `~/.pi/agent/auth.json`，Pi 命令行也用这个文件。ICAP 不另存副本。

:::note
写在 shell 配置文件中的 Key 也能用，例如 `~/.zshrc` 中的 `export ANTHROPIC_API_KEY=…`。Obsidian 下次启动时读取它。然后，选择设置顶部状态旁的 ↻。
:::

### 使用 Pi 没有列出的模型

Ollama、LM Studio、vLLM、代理，或其他兼容 OpenAI 的接口，用自定义端点接入。

1. 在 **模型服务商** 中，选择 **自定义端点…**。
2. 输入名称、Base URL、API Key 和模型 ID。
3. 选择 **保存**。

Pi 把端点存在 `~/.pi/agent/models.json`。

:::caution
`models.json` 中的 Key 是明文。要让 Key 不写进文件，在 Key 的位置输入 `$NAME`，Pi 会读取环境变量 `NAME`。
:::

## 在手机或平板上

手机上的 Obsidian 没有 Node，而 Pi 需要 Node。在手机上，ICAP 使用自己的 Agent，模型库和电脑上相同。

### 添加 API Key

1. 打开 **设置 → ICAP Learning Agent**。
2. 在 **API Key** 中找到你的服务商。要申请 Key，选择 **获取 Key**。
3. 输入 Key。
4. 在 **模型** 中，选择 Agent 使用的模型。

Key 存在这台设备上 Obsidian 的钥匙串中。它不在库中，也不会同步。每台设备都要添加一次。

手机上可用的服务商：Anthropic、OpenAI、Google Gemini、OpenRouter、DeepSeek、Mistral、Groq 和 xAI。

### 添加端点

1. 在 **自定义端点** 中找到 **添加端点**，选择 **添加…**。
2. 输入名称、Base URL 和模型 ID。如果服务器需要 Key，打开 **需要 API Key** 并输入 Key。
3. 选择 **保存**。

保存时，ICAP 检查服务器是否允许应用以流式接收回复。如果不允许，回复会一次性到达，你会看到「等待完整回复…」。

:::caution
回复一次性到达时，停止按钮显示为 **停止等待——这次请求仍会计费**。它只停止等待。服务器仍会完成请求，服务商仍会收费。
:::

## 手机上不能做的事

- 用订阅账号登录，或使用 Bedrock、Vertex。
- 使用你的 Pi 配置：技能、扩展、MCP 服务器和 `/compact`。
- 读取库外的文件夹。

手机上的模型和电脑上的模型是两个独立的设置。

下一步：[第一课](/zh-cn/start/first-lesson/)。

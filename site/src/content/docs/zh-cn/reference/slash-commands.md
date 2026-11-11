---
title: 斜杠命令
description: 在请求块中用“/”输入的命令。
sidebar:
  order: 2
---

斜杠命令是以 `/` 开头的请求。斜杠命令只在请求块中可用。在回忆、检查或测验中，你的文字是回答，所以开头的 `/` 只是文字。

## 语法

```
/name argument
```

- 请求必须以 `/` 开头。`/` 后面的第一个词是命令名。
- 命令名后面的全部文字是参数。参数可以为空。
- 在请求块开头输入 `/` 时，ICAP 显示命令列表。在 `/model` 或 `/thinking` 后输入空格时，ICAP 显示可选的值。

## ICAP 的命令

这三个命令改变这个块中 Agent 的工作方式。它们不改变其他块，也不改变设置。

| 命令 | 作用 |
|---|---|
| `/model` | 显示这个块的模型。 |
| `/model name` | 从下一个请求起，这个块使用模型 `name`。Pi 也接受名字的一部分，例如 `sonnet`。如果没有已配置凭证的模型与这个名字匹配，ICAP 提示下一个请求可能会失败。 |
| `/model default` | 这个块重新使用设置中的模型。 |
| `/thinking` | 显示这个块的思考强度和可选的级别。 |
| `/thinking level` | 从下一个请求起，这个块使用思考强度 `level`。级别有 `off`、`minimal`、`low`、`medium`、`high` 和 `xhigh`。 |
| `/thinking default` | 这个块重新使用设置中的思考强度。 |
| `/compact` | 为 Agent 把前面的轮次压缩成摘要。Agent 带着摘要继续。笔记不变。 |
| `/compact instructions` | 作用相同，Agent 按 `instructions` 写摘要。 |

`default` 也可以写成 `reset` 或 `-`。

:::note
`/compact` 只在电脑上可用，并且要打开 **记住请求的上下文**。如果这个块没有保存的会话，ICAP 回复“没有可压缩的内容：这个块的对话每次都直接从笔记中读取。”
:::

### 这些命令留下什么

`/model`、`/thinking` 和 `/compact` 的回复显示在块中。Agent 看到的对话中永远没有这些命令。保留这个块时，`[!request]` 记录中没有这些命令。任务笔记也不把它们算作对话的轮次。

## 你的 Pi 命令

在电脑上，如果 Agent 配置是 **你的 Pi 配置 + ICAP**，列表中还有你自己的 Pi 命令：

- 你的 Pi 扩展中的命令，
- 你的提示模板，
- 你的 skills，写作 `/skill:name`。

ICAP 把请求原样发给 Pi。Pi 展开模板或 skill，或运行扩展命令。Agent 在它的指令中得到笔记的上下文。

这些请求是对话的普通轮次。它们会出现在保留的 `[!request]` 记录中。

如果你的某个命令名叫 `model`、`thinking` 或 `compact`，ICAP 使用自己的命令。

:::note
在 **仅 ICAP（隔离）** 模式下，以及在手机或平板上，列表中只有 ICAP 的命令。在隔离模式下，列表显示““仅 ICAP”模式下不加载你自己的 Pi skills 和命令（设置 → Agent 配置）。”
:::

---
title: 笔记格式
description: ICAP 写进笔记的内容，供人阅读，也供其他工具读取。
sidebar:
  order: 3
---

ICAP 写入的是普通的 Obsidian Markdown。卸载插件后，你的笔记仍然可读。本页说明每个部分的意思。面向工具作者的完整约定是仓库中的 [FORMAT.md](https://github.com/EdwinZhanCN/obsidian-icap-agent/blob/main/FORMAT.md)。

当前的格式版本是 **5**。读取这个格式的工具必须忽略它不认识的 callout 类型、注释键和 `kind:` 值。

## 谁写了什么

| 标记 | 谁写的 |
|---|---|
| `> [!gloss] term` | Agent。这是你保留的解释。 |
| `> [!feedback]` | Agent。这是对你的回答或你的文字的反馈。 |
| `> [!practice]` | 你和 Agent。这是保留的测验：问题、你的回答和标记。 |
| `> [!request] topic` | 你和 Agent。`**请求:**` 行是你的，回复是 Agent 的。 |
| 笔记属性 `generated-by: icap-agent` | 这篇笔记是 Agent 新建的。要停用这个标记，在设置中关闭 **标记 Agent 新建的笔记**。 |
| 其他所有文字 | 你。 |

解释、回复和 Agent 新建的笔记，都不能证明你掌握了什么。

## 进行中的块

进行中的块是一个 `icap-ask` 代码块：

````markdown
```icap-ask
id: q7f3a2
kind: recall
---
Explain RAII in your own words.
```
````

- `id` 和 `kind` 必须有。`kind` 是 `recall`、`check`、`quiz`、`agent` 或 `request`。
- 回答和反馈不在文件中，而在插件数据中。工具不能从进行中的块读取任何内容。
- `authored: yes` 表示这个块由人手写。它的正文是第一个问题。测验用 `- [ ] option` 行；多选用 `choose: many`。

保留这个块时，ICAP 用一条记录替换这个代码块。

## 保留的记录

保留的回忆、检查、测验或解释有两部分：一行 `<!-- icap … -->` 注释，和紧接在它下一行的 callout。

### 回忆

先是你最后的文字，下面是反馈。

```markdown
RAII ties a resource's lifetime to an object's lifetime.

<!-- icap recall id=q7f3a2 date=2026-11-06 verdict=holds topic="RAII" -->
> [!feedback] RAII · 2026-11-06 · ✓
> Right. One gap: …
```

### 检查

你的文字本来就在笔记中。ICAP 只加 callout，紧接在被检查的段落后面。

```markdown
<!-- icap check id=c1 date=2026-11-06 verdict=partly topic="Covariance matrix" -->
> [!feedback] Covariance matrix · 2026-11-06 · ≈
> The diagonal is right; the off-diagonal …
```

### 测验

一个 callout 包含整个测验。每个回答有自己的标记。

```markdown
<!-- icap quiz id=z1 date=2026-11-06 holds=2 partly=0 reconsider=1 topic="RAII" -->
> [!practice] 理解检验 — RAII · 2026-11-06
> **1.** What releases the lock?
> *我的回答:* the destructor ✓
```

### 解释

```markdown
<!-- icap gloss id=g4k2 date=2026-11-07 depth=plainer topic="rule of zero" -->
> [!gloss] rule of zero
> A class that owns no resource needs no destructor, copy or move members.
>
> **Plainly.**
> …
```

`**Plainly.**` 一节表示你要了更浅显的解释。`**Deeper.**` 一节表示你要了更深入的解释。这两个标题在所有语言中都是英文。标题最多 60 个字符，注释中保存完整的词条。

### 请求

保留的请求块是一个 `[!request]` callout，上方没有注释。它包含每个请求和它的回复，以及一行 `**文件:**`，列出任务新建、修改或删除的文件。

```markdown
> [!request] C++ 学习路径
> **请求:** 用 Sources/ 中的资料做一条学习路径
>
> 已新建学习路径和 12 篇笔记…
>
> **文件:** 新建 [[Learning/Path|Path]] · 修改 [[C++]]
```

:::note
记录中的标签跟随界面语言。在英文界面中，ICAP 写 `Understanding check — `、`*My answer:*`、`**Request:**` 和 `**Files:**`。callout 类型和注释键总是英文。
:::

## 判定标记

callout 标题的末尾是日期和一个标记。注释用一个词记录同一个判定。

| 标记 | 注释中的判定 | 意思 |
|---|---|---|
| ✓ | `holds` | 你的回答正确。 |
| ≈ | `partly` | 你的回答部分正确。 |
| ? | `reconsider` | 再看一下你的回答。 |

## 注释

```
<!-- icap <kind> id=… date=YYYY-MM-DD [verdict=…] [holds=N partly=N reconsider=N] [depth=…] [paragraphs=N] [topic="…"] -->
```

| 键 | 用于 | 意思 |
|---|---|---|
| `id` | 全部 | 块在进行中时的 id。 |
| `date` | 全部 | 你保留这个块的日期，按本地时间。 |
| `verdict` | 回忆、检查 | Agent 最后一次的判定。Agent 没有给判定时，没有这个键。 |
| `holds`、`partly`、`reconsider` | 测验 | 每种判定的回答数量。 |
| `topic` | 全部 | 记录的主题：选中的文字、小节标题或笔记名。解释记录中是完整的词条。由插件写入，不由模型写入。 |
| `paragraphs` | 回忆 | 你的回答有多个段落时，段落的数量。 |
| `depth` | 解释 | 你要过的追问：`plainer`、`deeper`，或两者都有。 |

标题是给人看的，你可以编辑它。如果标题和注释不一致，工具以注释为准。

## 交互式图示

交互式图示是一个 `icap-ui` 代码块，里面是一个 HTML 文档。它可以在回复中，也可以在 Agent 新建的笔记中。ICAP 不保存图示的状态。图示不是掌握程度的证据。

## 任务笔记

任务笔记记录一个请求或一个写笔记的任务。见[任务笔记](/zh-cn/reference/task-notes/)。

## 旧拼写

插件在早期版本中拼作 ICPA。ICAP 仍然读取这些拼写：

| 现在写入 | 仍然读取 |
|---|---|
| `icap-ask` 代码块 | `icpa-ask` 代码块。ICAP 重写这个块时，代码块改为 `icap-ask`。 |
| `generated-by: icap-agent` | `generated-by: icpa-agent` |

格式 1 之前保留的记录没有注释，标题中也没有日期。ICAP 把它们读作日期未知的证据。

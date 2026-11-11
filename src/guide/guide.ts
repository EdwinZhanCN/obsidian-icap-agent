/**
 * The guide: a real note, created and opened once on first install. It is a tutorial, a
 * demonstration and the learner's first study note at the same time — its subject is ICAP itself,
 * and every interaction in it is one the learner actually performs on that subject.
 *
 * Steps ②–④ are authored ```icap-ask fences (see parseAuthored): they come alive the first time
 * they render, and "start over" resets them instead of deleting them.
 */

export interface GuideNote {
	path: string;
	content: string;
	/** Ids of the authored blocks in it (forgotten when the guide is recreated). */
	blockIds: string[];
}

const IDS = ["guide-quiz", "guide-recall", "guide-agent"];

const fence = (header: string, body: string) => "```icap-ask\n" + header.trim() + "\n---\n" + body.trim() + "\n```";

function zh(mac: boolean): GuideNote {
	const content = `---
tags: [learning, icap]
---
这是你的第一篇学习笔记，讲一个学习理论。读的时候，你会在原地用到插件的每一种交互。读完后，它就是一篇普通笔记：可以接着写，也可以删掉。

## 四种投入方式

ICAP 框架（Chi & Wylie, 2014）把学习时的投入分成四种模式。从前到后，理解越来越深：

- **被动（Passive）**：只接收，例如阅读、听讲。
- **主动（Active）**：处理材料，例如划线、摘抄、重读。
- **建构（Constructive）**：产生材料里没有的东西，例如用自己的话解释、举新例子。
- **互动（Interactive）**：和一个会回应的伙伴一起建构，双方的贡献互相推进。

所以，只给答案的助手会把你推回被动。好的导师提供 scaffolding，而不是讲解。

## 试一试

### ① 解释

选中上一段的 *scaffolding*（双击；手机上长按），然后选 **解释**。解释出现在这一段下面。可以再要 **更深入**、**举个例子** 或 **说浅一点**。选 **留在笔记里** 保留它，选 **丢弃** 则笔记不变。

### ② 测验

选一个答案并提交。Agent 会回应你的选择：答错时，它用一个问题引导你自己找到答案。

${fence(
		`id: guide-quiz
kind: quiz
authored: yes
topic: ICAP 的四种模式`,
		`小林读完一章后合上书，用自己的话写下这一章的主要观点，又举了一个书里没有的例子。按 ICAP，这属于哪种模式？
- [ ] 被动——只是在读书
- [ ] 主动——在整理书里已有的内容
- [ ] 建构——产生了材料之外的解释和例子
- [ ] 互动——写作就是在和作者对话`,
	)}

### ③ 回忆

不往回看，写下你的回答。书写时笔记的其余部分会变模糊（按 Esc 取消）。Agent 指出遗漏并追问，但不替你改写。最后选 **整理成文**，你认可的版本和反馈会留在笔记里。

${fence(
		`id: guide-recall
kind: recall
authored: yes
topic: 建构与互动的区别`,
		`不往回看，用自己的话解释：**建构**和**互动**有什么区别？为什么说互动不只是“轮流说话”？`,
	)}

### ④ 让 Agent 做事

选 **开始**。Agent 会写一篇 ICAP 的概念笔记，并提议在这里加一个链接。只有你选 **应用修改**，这处修改才会写入。

${fence(
		`id: guide-agent
kind: agent
authored: yes
topic: ICAP 框架
start: 开始`,
		`为 **ICAP 框架** 写一篇独立的概念笔记，并把它和这篇笔记连起来。`,
	)}

任务运行时，状态栏右侧有一个小圆点（手机上是侧边栏的按钮）。点它可以看到每个任务的状态和它改动过的文件。

### ⑤ 请求

其余的事，直接对 Agent 说：在命令面板（或右键菜单）运行 *在这里向 Agent 提问*，写下请求，按 ${submitKbd(mac)}。

- 输入 \`[[\` 或 \`@\` 从库里选笔记或 PDF，例如：\`根据 [[某本书.pdf]] 为每一章写一篇笔记。\`
- 以 \`/\` 开头使用命令，例如 \`/model\`。
- Agent 可以在回复里画图表、做白板或交互式图示。也可以直接要：\`画一个能调学习率的梯度下降图\`。
- 完成后选 **保留记录**，块会变成普通的 Markdown。

## 设置

在 **设置 → ICAP Learning Agent** 中：

- **登录…**：用已有的订阅账号（例如 Claude、ChatGPT）登录，或粘贴一个 API Key。手机上只能用 API Key。ICAP 内置 [Pi](https://pi.dev)，不需要另外安装。
- **关于你**：写下你的背景和你喜欢怎样学。**这个库的约定** 会生成一篇 AGENTS.md，告诉 Agent 你在学什么、笔记怎么组织。
- **高级 → Agent 配置**（电脑上）：选 *仅 ICAP（隔离）*，Agent 只能读这个库，不能运行 shell。

## 之后

- 在任何笔记里选中文字，选 **解释**。或在命令面板运行 *凭记忆复述（本节）*、*检验我对本节的理解*。
- 保留下来的内容都是普通 Markdown，卸载插件后也能读。
- 命令 *打开指南* 可以随时找回这篇笔记。
`;
	return { path: "用 ICAP 学习.md", content, blockIds: IDS };
}

function en(mac: boolean): GuideNote {
	const content = `---
tags: [learning, icap]
---
This is your first study note. It is about a theory of learning, and while you read it you use each of the plugin's interactions in place. When you are done, it is an ordinary note: keep writing in it, or delete it.

## Four ways of engaging

The ICAP framework (Chi & Wylie, 2014) sorts how learners engage into four modes. Understanding deepens from the first to the last:

- **Passive**: receiving, such as reading or listening.
- **Active**: handling the material, such as highlighting, copying or re-reading.
- **Constructive**: producing what the material does not contain, such as an explanation in your own words or a new example.
- **Interactive**: constructing with a partner who responds, each contribution building on the other.

So a helper that only gives answers pushes you back to passive. A good tutor provides scaffolding, not lectures.

## Try it

### ① Explanation

Select *scaffolding* in the paragraph above (double-click; on a phone, long-press), then choose **explain**. The explanation appears under that paragraph. Ask for **deeper**, **example** or **plainer** if you like. Choose **keep in note** to keep it, or **dismiss** to leave the note unchanged.

### ② Quiz

Choose an answer and submit. The agent responds to your choice: if it is wrong, a question leads you to the answer yourself.

${fence(
		`id: guide-quiz
kind: quiz
authored: yes
topic: The four ICAP modes`,
		`After reading a chapter, Sam closes the book, writes its main argument in their own words and adds an example the book does not mention. In ICAP terms, what is Sam doing?
- [ ] Passive — just reading
- [ ] Active — reorganising what the book says
- [ ] Constructive — producing explanations and examples beyond the material
- [ ] Interactive — writing is a dialogue with the author`,
	)}

### ③ Recall

Write your answer without looking back. While you write, the rest of the note blurs (Esc lifts it). The agent points out what is missing and asks a follow-up, but does not rewrite your answer. At the end, choose **write it up**: the version you stand behind stays in the note, with the feedback.

${fence(
		`id: guide-recall
kind: recall
authored: yes
topic: Constructive vs. interactive`,
		`Without looking back: what is the difference between **constructive** and **interactive** engagement — and why is interaction more than taking turns?`,
	)}

### ④ Let the agent work

Choose **start**. The agent writes a concept note about ICAP and proposes a link to it here. The change is written only if you choose **apply change**.

${fence(
		`id: guide-agent
kind: agent
authored: yes
topic: ICAP framework
start: start`,
		`Write a separate concept note on the **ICAP framework** and connect it to this note.`,
	)}

While a task runs, a small dot shows at the right of the status bar (on a phone, a button in the ribbon). Click it to see each task's state and the files it changed.

### ⑤ Request

For anything else, tell the agent: run *Ask the agent here* from the command palette (or the context menu), write your request and press ${submitKbd(mac)}.

- Type \`[[\` or \`@\` to pick notes or PDFs, for example: \`From [[Some Book.pdf]], write a note for each chapter.\`
- Start with \`/\` for commands, such as \`/model\`.
- The agent can draw diagrams, make canvases and interactive visuals in its reply. You can also ask: \`draw gradient descent with an adjustable learning rate\`.
- When you are done, choose **keep a record** to turn the block into plain Markdown.

## Settings

In **Settings → ICAP Learning Agent**:

- **Log in…**: sign in with a subscription you have (such as Claude or ChatGPT), or paste an API key. On a phone, use an API key. [Pi](https://pi.dev) is built in, so there is nothing else to install.
- **About you**: write your background and how you like to learn. **This vault's conventions** makes an AGENTS.md that tells the agent what you study and how your notes are organised.
- **Advanced → Agent setup** (desktop): choose *ICAP only (isolated)* if the agent may only read this vault and run no shell.

## Afterwards

- In any note, select text and choose **explain**. Or run *Recall from memory (this section)* or *Check my understanding of this section* from the command palette.
- Everything you keep is plain Markdown, readable without the plugin.
- The command *Open the guide* brings this note back at any time.
`;
	return { path: "Learning with ICAP.md", content, blockIds: IDS };
}

/**
 * The writing line's submit chord as keycaps (Obsidian styles <kbd> in notes): ⌘ ↵ on macOS, Ctrl ↵
 * elsewhere, like the interface's own hints (ui/Keys.svelte).
 */
export function submitKbd(mac: boolean): string {
	return `<kbd>${mac ? "⌘" : "Ctrl"}</kbd> <kbd>↵</kbd>`;
}

/** The guide note in the interface language; `mac` picks the shortcut shown in it (Platform.isMacOS). */
export function guideNote(language: string, mac = true): GuideNote {
	return language.toLowerCase().startsWith("zh") ? zh(mac) : en(mac);
}

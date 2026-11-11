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
这是一篇真正的笔记，不是说明书。它讲的是一个学习理论；读它的时候，你会亲手用到这个插件的全部交互——它们都发生在文档里，就在你读到的地方。读完后它就是你的第一篇学习笔记：可以继续写、保留，或者删掉。

## 四种投入方式

ICAP 框架（Chi & Wylie, 2014）把学习时的投入分成四种外显的模式，并认为从被动到互动，理解依次加深：

- **被动（Passive）**：接收信息——阅读、听讲，但不做额外的处理。
- **主动（Active）**：对材料动手——划线、摘抄、重读、暂停回放。
- **建构（Constructive）**：产生材料里没有的东西——用自己的话解释、举一个新例子、自我解释、比较两个概念。
- **互动（Interactive）**：与一个会回应的伙伴共同建构——互相追问、质疑，在对方的回应上继续推进。

互动的关键不是“轮流说话”，而是双方的贡献互相建立在一起。所以一个只会给答案的助手，会把你推回被动；好的导师做的是 scaffolding，而不是讲解。

## 试一试

### ① 解释：在原地读懂一个词

在上一段里**双击** *scaffolding* 选中它，稍等片刻，选区旁会出现一个小标记——点 **解释**。解释会出现在那一段的正下方，左侧有一道墨线：它属于这篇笔记，而不是另一个窗口。

读完可以继续要 **更深入**、**举个例子**、**说浅一点**；有用就 **留在笔记里**，它会变成一个普通的 callout；否则 **丢弃**，笔记不会留下任何改动。

解释只会建立在你已经知道的东西上：设置里写下的背景、你自己写的笔记、你做过的回忆和检验。你保留过的解释里如果有“说浅一点”或“更深入”，下次 Agent 也会据此调整深浅。

### ② 互动：回答一个问题

选一个答案并提交。之后由 Agent 接手：它会就你的选择给出反馈——如果选错了，它不会直接公布答案，而是追问一个问题让你自己找到——然后再问一两个问题。整个过程都留在这个块里。

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

### ③ 回忆与反馈：用自己的话说

开始写的时候，笔记的其余部分会变模糊——这是刻意的：从记忆里提取，比重读更能巩固理解（按 Esc 取消模糊）。提交后，Agent 会指出遗漏或误解，并追问一个问题，而不是替你改写。最后选 **整理成文**：你认可的那个版本会留在笔记里，下面附上反馈。

${fence(
		`id: guide-recall
kind: recall
authored: yes
topic: 建构与互动的区别`,
		`不往回看，用自己的话解释：**建构**和**互动**有什么区别？为什么说互动不只是“轮流说话”？`,
	)}

### ④ 活动：看 Agent 做了什么

点 **开始**，Agent 会在库里为 ICAP 写一篇概念笔记，并**提议**把这篇指南里第一次出现的“ICAP 框架”改成链接——修改以差异的形式出现在块里，只有你点 **应用修改** 之后才会写入。

${fence(
		`id: guide-agent
kind: agent
authored: yes
topic: ICAP 框架
start: 开始`,
		`为 **ICAP 框架** 写一篇独立的概念笔记，并把它和这篇笔记连起来。`,
	)}

任务进行时，右下角状态栏会有一个小圆点。点开它就是 **活动**：每项任务的状态（进行中、等你回应、完成、已停止），以及 Agent 新建、修改和删除了哪些文件。

### ⑤ 请求：直接对 Agent 说话

上面这些都是预先设计好的动作。其余的事，直接说：把光标放在任意位置，在命令面板里运行 *在这里向 Agent 提问*（或者右键菜单），就地出现一个请求块。写下你想要的，按 ${submitKbd(mac)} 发送。

- 输入 \`[[\`（或 \`@\`）可以从库里挑文件——笔记、PDF 都行——告诉 Agent “就用这几份”。插入的是普通的链接。
- 例如：\`根据 [[某本书.pdf]] 帮我做一条学习路线，再为每一章建一篇资料笔记。\`路线和笔记的形式，由你的请求和你自己的 Agent 配置决定。
- 以 \`/\` 开头可以使用命令：你的 Pi 里的技能（\`/skill:…\`）、提示模板和扩展命令，以及 ICAP 的 \`/model\`、\`/thinking\`（只改变这一个块）和 \`/compact\`。
- 结果、追问、以及 Agent 改动过的文件都留在块里。追问时 Agent 记得这个块里已经做过的事。完成后选 **保留记录**，它会变成一段普通的 Markdown 记录。
- 有时动手试比读一段话更容易懂，Agent 就会在回复（或它新建的笔记）里放一个**交互式图示**：拖动滑块看变化、一步步走一个过程、先预测再揭晓。也可以直接要：\`画一个能调学习率的梯度下降图\`。图示里的按钮会把问题发回给 Agent，接着聊。它在沙箱里运行，不能联网，也碰不到你的笔记；不想要可以在设置里关掉。

## 你的 Agent

ICAP 不自带模型。它内置了 [Pi](https://github.com/earendil-works/pi)，不需要另外安装任何东西，用的是你自己的模型服务商。

- **登录服务商**（设置 → ICAP Learning Agent → 模型服务商 → **登录…**）：用已有的订阅**账号登录**（例如 Claude Pro/Max、ChatGPT、GitHub Copilot），或者粘贴一个 **API Key**（例如 DeepSeek）。凭证由 Pi 保存在 ~/.pi/agent/auth.json，和 Pi 命令行（如果你装了）共用，ICAP 自己不留副本；退出登录也在同一个窗口里。在 shell 配置文件里导出的密钥（例如 \`export DEEPSEEK_API_KEY=…\`）也能直接用。设置页会显示正在用哪个模型、哪些模型可用。
- **Agent 配置**（设置 → ICAP Learning Agent → 高级）：默认是 *你的 Pi 配置 + ICAP*——你的 skills、扩展、AGENTS.md 和工具照常可用，它可以直接改文件，每处改动都会列在活动里。想要更可预期，就选 *仅 ICAP（隔离）*：只读、没有 shell，只能访问这个库和你授权的文件夹。
- **这个库的约定**（设置 → ICAP Learning Agent → 关于你 → 这个库的约定 → **设置…**，或命令 *这个库的约定（AGENTS.md）*）：告诉 Agent 你在这里学什么、笔记怎么组织、哪些地方不要动。选一种学习方式（课程、读书、论文、语言、编程），回答两三个问题，就会在库根目录生成一篇笔记 AGENTS.md，Agent 每次任务都会读它，你可以像普通笔记一样修改。到哪儿都适用的规矩可以写进 Pi 的 ~/.pi/agent/AGENTS.md（隔离模式不读这一份）。库所在目录之上的 AGENTS.md（比如 ~/AGENTS.md）是写给别的工作的，ICAP 不读。
- **你喜欢怎样学**（设置 → ICAP Learning Agent → 关于你）：语言、风格、深浅，每次解释和请求都会遵循。

## 之后

- 在任何笔记里选中文字 → **解释**；或者在命令面板里运行 *凭记忆复述（本节）*、*检验我对本节的理解*、*检查我写的内容*。
- 保留下来的内容都是普通 Markdown，卸载插件也不会丢失。Agent 新建的笔记会在属性里带上 \`generated-by: icap-agent\`，以免以后被当成你自己写的。
- 这篇笔记归你了。命令 *打开指南* 可以随时把它找回来（如果删了，会重新生成一份）。
`;
	return { path: "用 ICAP 学习.md", content, blockIds: IDS };
}

function en(mac: boolean): GuideNote {
	const content = `---
tags: [learning, icap]
---
This is a real note, not a manual. It is about a theory of learning, and while you read it you will use all of this plugin's interactions — each one happens inside the document, right where you are reading. When you are done it is your first study note: keep writing in it, keep it, or delete it.

## Four ways of engaging

The ICAP framework (Chi & Wylie, 2014) sorts how learners engage with material into four overt modes, and predicts that understanding deepens from the first to the last:

- **Passive** — receiving: reading or listening without doing anything else with it.
- **Active** — manipulating the material: highlighting, copying, re-reading, pausing and replaying.
- **Constructive** — generating something the material does not contain: explaining in your own words, inventing an example, self-explaining, comparing two ideas.
- **Interactive** — constructing together with a partner who responds: questioning, challenging, building on each other's contributions.

What makes an exchange interactive is not taking turns but that each contribution builds on the other. A helper that only hands out answers pushes you back to passive; a good tutor provides scaffolding rather than lectures.

## Try it

### ① Explanation — understand a word where it stands

**Double-click** *scaffolding* in the paragraph above to select it. After a moment a small mark appears next to the selection — choose **explain**. The explanation appears directly under that paragraph, with a line of ink in the margin: it belongs to the note, not to another window.

Ask for **deeper**, **example** or **plainer** if you like. **Keep in note** turns it into an ordinary callout; **dismiss** leaves the note exactly as it was.

Explanations build only on what you already know: the background in settings, notes you wrote yourself, the recalls and checks you did. If a kept explanation has a "plainer" or "deeper" part, the agent takes that into account next time.

### ② Interaction — answer a question

Choose an answer and submit. Then the agent takes over: it responds to your choice — if it is wrong, it will not just reveal the answer but ask you something that lets you find it — and asks one or two more questions. All of it stays in this block.

${fence(
		`id: guide-quiz
kind: quiz
authored: yes
topic: The four ICAP modes`,
		`After reading a chapter, Sam closes the book, writes its main argument in their own words and adds an example the book does not mention. In ICAP terms, what is she doing?
- [ ] Passive — she is just reading
- [ ] Active — she is reorganising what the book says
- [ ] Constructive — she produces explanations and examples beyond the material
- [ ] Interactive — writing is a dialogue with the author`,
	)}

### ③ Recall and feedback — in your own words

When you start writing, the rest of the note blurs. That is deliberate: retrieving from memory consolidates understanding better than re-reading (Esc lifts the blur). After you submit, the agent points out what is missing or mistaken and asks a follow-up — it does not rewrite your answer for you. At the end choose **write it up**: the version you now stand behind stays in the note, with the feedback under it.

${fence(
		`id: guide-recall
kind: recall
authored: yes
topic: Constructive vs. interactive`,
		`Without looking back: what is the difference between **constructive** and **interactive** engagement — and why is interaction more than taking turns?`,
	)}

### ④ Activity — see what the agent did

Choose **start**. The agent writes a concept note about ICAP in your vault and **proposes** to turn the first mention of "ICAP framework" in this guide into a link. The change appears in the block as a diff and is written only if you choose **apply change**.

${fence(
		`id: guide-agent
kind: agent
authored: yes
topic: ICAP framework
start: start`,
		`Write a separate concept note on the **ICAP framework** and connect it to this note.`,
	)}

While a task runs, a small dot appears at the right of the status bar. Click it to open **Activity**: every task's state (working, needs you, done, stopped) and the files the agent created, changed or deleted.

### ⑤ Request — just tell the agent

Everything above is a ready-made action. For anything else, just ask: put the cursor anywhere and run *Ask the agent here* from the command palette (or the context menu). A request block appears in place; write what you want and press ${submitKbd(mac)}.

- Type \`[[\` (or \`@\`) to pick files from your vault — notes, PDFs, anything — and tell the agent "use these". What gets inserted is an ordinary link.
- For example: \`From [[Some Book.pdf]], make me a learning path and a note for each chapter.\` The shape of the path and the notes is up to your request and your own agent setup.
- Start with \`/\` for commands: your Pi's skills (\`/skill:…\`), prompt templates and extension commands, and ICAP's \`/model\`, \`/thinking\` (for this block only) and \`/compact\`.
- The result, follow-ups and the files the agent touched stay in the block; in a follow-up the agent remembers what it already did here. When you're done, **keep a record** turns it into plain Markdown.
- When trying something out beats reading about it, the agent puts an **interactive visual** into its reply (or a note it creates): drag a slider and watch, step through a process, predict and then reveal. You can also just ask: \`draw gradient descent with an adjustable learning rate\`. Its buttons send questions back to the agent, so the conversation goes on. It runs in a sandbox — no internet, no access to your notes — and you can turn it off in the settings.

## Your agent

ICAP has no model of its own. [Pi](https://github.com/earendil-works/pi) is built in — nothing else to install — and it uses your own model provider.

- **Log in to a provider** (Settings → ICAP Learning Agent → Model providers → **Log in…**): sign in with a subscription you already have (**Account**: e.g. Claude Pro/Max, ChatGPT, GitHub Copilot) or paste an **API key** (e.g. DeepSeek). Pi saves the credential in ~/.pi/agent/auth.json, shared with the Pi command line if you have it; ICAP keeps no copy, and you log out in the same window. A key exported in your shell profile (e.g. \`export ANTHROPIC_API_KEY=…\`) works too. The settings show which model is used and which are available.
- **Agent setup** (Settings → ICAP Learning Agent → Advanced): by default *Your Pi setup + ICAP* — your skills, extensions, AGENTS.md and tools work as usual; it may change files directly, and every change is listed in Activity. For something more predictable choose *ICAP only (isolated)*: read-only, no shell, only this vault and the folders you allow.
- **This vault's conventions** (Settings → ICAP Learning Agent → About you → This vault's conventions → **Set up…**, or the command *This vault's conventions (AGENTS.md)*): tell the agent what you study here, how your notes are organised and what it must leave alone. Pick a kind of study (a course, a book, papers, a language, programming), answer two or three questions, and a note, AGENTS.md, appears at the vault's root: the agent reads it in every task, and you edit it like any note. Rules for everywhere can go into Pi's ~/.pi/agent/AGENTS.md (isolated mode skips that one). An AGENTS.md above the vault's folder (like ~/AGENTS.md) is written for other work, so ICAP does not read it.
- **How you like to learn** (Settings → ICAP Learning Agent → About you): language, style, depth — followed in every explanation and request.

## Afterwards

- In any note, select text → **explain**; or run *Recall from memory (this section)*, *Check my understanding of this section* or *Check what I wrote* from the command palette.
- Everything you keep is plain Markdown; it stays readable without the plugin. Notes the agent creates carry \`generated-by: icap-agent\` in their properties, so they are never taken for your own writing.
- This note is yours now. The command *Open the guide* brings it back at any time (and recreates it if you deleted it).
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

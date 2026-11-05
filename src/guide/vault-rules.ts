/**
 * The vault's conventions for the agent: an AGENTS.md at the vault's root, which Pi reads in every
 * task (both agent setups, see agent/pi-session.ts). Most learners have never heard of AGENTS.md, so
 * ICAP writes the first version from a few answers and a preset for their kind of study; after that
 * it is an ordinary note they edit. Pure.
 */

export const VAULT_RULES = "AGENTS.md";

export type PresetId = "course" | "book" | "research" | "language" | "programming" | "blank";

export interface RulesPreset {
	id: PresetId;
	name: string;
	hint: string;
	/** Example answer to "what do you study here?". */
	example: string;
	/** "How notes are organised" lines. */
	notes: string[];
	/** "How the agent works here" lines, before the general ones. */
	agent: string[];
}

export interface RulesAnswers {
	preset: PresetId;
	/** What the vault is for, in the learner's words. */
	subject: string;
	/** Vault folder with the study material (books, slides, papers); "" = none. */
	sources: string;
	/** Vault folder the agent must not change; "" = none. */
	protect: string;
}

const ZH: RulesPreset[] = [
	{
		id: "course",
		name: "课程",
		hint: "上课、讲义、作业、考试",
		example: "大学线性代数（MIT 18.06），教材是 Strang 的《线性代数导论》。",
		notes: ["每一讲一篇笔记，标题写成「第 N 讲 主题」。", "每个重要概念一篇概念笔记，标题就是概念名，并链接回出现它的那一讲。", "公式用 LaTeX（`$…$` 和 `$$…$$`）。"],
		agent: ["为一讲写笔记时，在末尾列 3 个自测问题，不附答案。", "帮我做题时先给提示，等我自己试过之后再给完整解答。"],
	},
	{
		id: "book",
		name: "读书",
		hint: "一本或几本书，按章读",
		example: "《思考，快与慢》，丹尼尔·卡尼曼。",
		notes: ["每章一篇笔记，标题写成「书名 · 第 N 章 章名」。", "原文摘录用引用块（>），并注明页码。", "「## 我的想法」这一节只由我来写。"],
		agent: ["把书里说的和你的补充分开：你的补充单独成段，开头写「补充：」。", "不要替我写读后感，也不要总结我的想法。"],
	},
	{
		id: "research",
		name: "研究 / 论文",
		hint: "读论文、做文献综述",
		example: "检索增强生成（RAG），为毕业论文做文献综述。",
		notes: [
			"每篇论文一篇文献笔记，标题写成「第一作者 年份 · 简短标题」。",
			"文献笔记的属性：authors、year、venue、url——只填确知的，不确定就留空。",
			"结构：研究问题、方法、主要结论、局限、与我的研究的关系（最后一节由我来写）。",
		],
		agent: ["比较几篇论文时用表格，并注明每一项出自哪篇、哪一节。", "不确定的地方要说不确定，不要把推测写成论文的结论。"],
	},
	{
		id: "language",
		name: "语言",
		hint: "词汇、语法、阅读",
		example: "日语，目标是 JLPT N3。",
		notes: ["一个词或短语一篇笔记，标题就是这个词：读音、释义、两个例句、常见搭配。", "一个语法点一篇笔记。"],
		agent: ["讲解用我的母语；例句用要学的语言，并附翻译。", "你自己造的例句标注「自造例句」；来自资料的例句注明出处。"],
	},
	{
		id: "programming",
		name: "编程 / 技术",
		hint: "语言、框架、系统",
		example: "现代 C++（C++20），我之前主要写 Python。",
		notes: ["每个概念一篇笔记，带一个最小、能运行的例子，代码块注明语言。", "写明例子适用的版本（语言、库）。"],
		agent: ["先讲为什么，再给代码；代码保持简短，一次只演示一个要点。", "只写笔记，不要改动库之外的代码项目。"],
	},
	{ id: "blank", name: "从空白开始", hint: "我自己写", example: "（一句话：这个库是用来学什么的）", notes: [], agent: [] },
];

const EN: RulesPreset[] = [
	{
		id: "course",
		name: "A course",
		hint: "lectures, slides, problem sets, exams",
		example: "Linear algebra (MIT 18.06), with Strang's Introduction to Linear Algebra.",
		notes: ["One note per lecture, titled “Lecture N – Topic”.", "One concept note per important concept, titled with the concept, linking back to the lecture it comes from.", "Formulas in LaTeX (`$…$` and `$$…$$`)."],
		agent: ["When you write a lecture note, end it with 3 self-test questions, without answers.", "When I work on a problem, give a hint first; give the full solution only after I have tried."],
	},
	{
		id: "book",
		name: "Reading a book",
		hint: "one or a few books, chapter by chapter",
		example: "Thinking, Fast and Slow by Daniel Kahneman.",
		notes: ["One note per chapter, titled “Book · Chapter N – Title”.", "Quotations as block quotes (>), with the page number.", "The “## My thoughts” section is mine alone to write."],
		agent: ["Keep what the book says apart from your additions: put yours in their own paragraph, starting with “Addition:”.", "Do not write my reflections for me or summarise my thoughts."],
	},
	{
		id: "research",
		name: "Research / papers",
		hint: "reading papers, literature reviews",
		example: "Retrieval-augmented generation (RAG), a literature review for my thesis.",
		notes: [
			"One literature note per paper, titled “First author Year · Short title”.",
			"Properties of a literature note: authors, year, venue, url — only what is certain; leave the rest empty.",
			"Sections: research question, method, main findings, limitations, relation to my research (the last one is mine to write).",
		],
		agent: ["Compare papers in a table, noting which paper and section each point comes from.", "Say when something is uncertain; never present a guess as a paper's finding."],
	},
	{
		id: "language",
		name: "A language",
		hint: "vocabulary, grammar, reading",
		example: "Japanese, aiming for JLPT N3.",
		notes: ["One note per word or phrase, titled with it: reading, meaning, two example sentences, common collocations.", "One note per grammar point."],
		agent: ["Explain in my native language; example sentences in the language I am learning, with a translation.", "Mark example sentences you made up as “invented”; cite the source of the others."],
	},
	{
		id: "programming",
		name: "Programming / tech",
		hint: "languages, frameworks, systems",
		example: "Modern C++ (C++20); I mostly wrote Python before.",
		notes: ["One note per concept, with a minimal runnable example; code blocks name their language.", "State which versions (language, libraries) an example is for."],
		agent: ["Explain why before giving code; keep code short, one point per example.", "Only write notes; do not change code projects outside the vault."],
	},
	{ id: "blank", name: "Start blank", hint: "I'll write it myself", example: "(One sentence: what this vault is for.)", notes: [], agent: [] },
];

export function rulesPresets(zh: boolean): RulesPreset[] {
	return zh ? ZH : EN;
}

const folder = (f: string) => "`" + f.replace(/^\/+|\/+$/g, "") + "/`";
const bullets = (lines: string[]) => lines.map((l) => `- ${l}`).join("\n");

/** The AGENTS.md written from the learner's answers. */
export function renderRules(zh: boolean, a: RulesAnswers): string {
	const p = rulesPresets(zh).find((x) => x.id === a.preset) ?? rulesPresets(zh)[0];
	const subject = a.subject.trim();
	const general = zh
		? [
				"新建笔记之前，先在库里找有没有讲同一件事的笔记；有的话就提议修改它，不要再建一篇。",
				"用双链（`[[笔记名]]`）把相关的笔记连起来；只链接已经存在的笔记，或者这次一起新建的笔记。",
				"不要编造出处、引文或数据。",
			]
		: [
				"Before creating a note, look for one in the vault on the same thing; if there is one, propose a change to it instead of creating another.",
				"Connect related notes with links (`[[Note name]]`); link only notes that exist or that you create in the same task.",
				"Never invent sources, quotations or numbers.",
			];
	if (a.protect.trim())
		general.push(
			zh ? `不要修改 ${folder(a.protect)} 里的任何文件；需要改动时先问我。` : `Do not change anything in ${folder(a.protect)}; ask me first if something there needs to change.`,
		);
	const parts: string[] = [
		zh ? "# 这个库" : "# This vault",
		zh ? "> 这篇笔记是写给 Agent 的说明，每次任务前它都会读。你可以随时修改。" : "> This note is for the agent: it reads it before every task. Change it whenever you like.",
		subject || (zh ? "（在这里写一句：这个库是用来学什么的。）" : "(Write one sentence here: what this vault is for.)"),
	];
	if (a.sources.trim())
		parts.push(
			zh ? "## 资料" : "## Material",
			bullets([
				zh
					? `学习资料（书、讲义、论文）在 ${folder(a.sources)} 里。回答问题时优先依据这些资料，并注明出自哪一份。`
					: `The study material (books, slides, papers) is in ${folder(a.sources)}. Base answers on it first, and say which document a point comes from.`,
			]),
		);
	parts.push(
		zh ? "## 笔记怎么组织" : "## How notes are organised",
		p.notes.length ? bullets(p.notes) : zh ? "- （例如：每章一篇笔记，标题怎么写，放在哪个文件夹。）" : "- (For example: one note per chapter, how titles look, which folder they go in.)",
		zh ? "## Agent 在这里怎么做" : "## How the agent works here",
		bullets([...p.agent, ...general]),
	);
	return parts.join("\n\n") + "\n";
}

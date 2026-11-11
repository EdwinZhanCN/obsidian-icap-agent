# How the site is written

The site follows the writing rules of **ASD-STE100 Simplified Technical English** (STE, Issue 9, 2025), the controlled language of aircraft maintenance manuals. STE is written for English, but its rules are about sentences, not about English: we apply the same rules to the Chinese pages. We do not use the STE dictionary (it is available on request from the STE Maintenance Group). In its place, the term list below gives each thing one name in each language.

The reader is a learner who uses Obsidian, may read in a second language, and may use a machine translation. Each rule makes a sentence easier to read once and to translate correctly.

## Words

1. **One word, one meaning.** Use the words in the term list for ICAP's things. Do not use a different word for variety ("block", then "box", then "widget").
2. **One meaning, one word.** Do not use a word for two things ("note" is a Markdown file; it is not also a remark).
3. **Use simple, common words.** "Use", not "utilize". "Start", not "initiate". "Show", not "surface". 中文用常用词：「用」不用「使用于」，「打开」不用「开启并进入」。
4. **No idioms, metaphors or jokes.** They do not translate. 中文不用成语、俗语和网络用语。
5. **Name what is on the screen exactly as the interface names it**, in bold: **Settings → ICAP Learning Agent**. 中文页用中文界面上的名字。
6. **Do not stack nouns.** No more than three nouns in a row ("task note property", not "task note status property value"). 中文同理：一个名词前最多一个「的」字定语。

## Sentences

7. **One topic per sentence.** One instruction per sentence, unless the two actions are done at the same time.
8. **Short sentences.** Instructions: 20 words or fewer. Descriptions: 25 words or fewer. 中文：指令不超过 30 个字，说明不超过 40 个字。
9. **Instructions are commands.** "Select a passage." Not "You can select a passage" or "A passage should be selected". 中文：「选中一段文字。」不用「您可以选中一段文字」。
10. **Active voice.** "The agent writes the feedback below your answer." Not "The feedback is written below your answer". 中文少用「被」「由……进行」。
11. **Condition first, then the instruction.** "If the model list is empty, log in to a provider." 中文：「如果……，……。」
12. **Simple tenses.** Present for what the plugin does ("The plugin records the task"); past only for what happened before; future only when it is really later.
13. **Use articles** ("a", "the") in English. They make the structure of a sentence clear to a translator.

## Paragraphs and pages

14. **One topic per paragraph; no more than six sentences.**
15. **Steps are a numbered list**, one action per step, in the order the reader does them. The result of a step, if the reader must see it, is its own sentence after the step.
16. **Start with what the reader does or gets.** The reason comes after, and only when it helps the reader decide or understand.
17. **Notes and warnings.** A warning (data can be lost) or a caution (a file can change) starts with a short command: "Do not delete the block before you keep it." Use Starlight's `:::caution` and `:::danger` asides for them, and `:::note` for information only.
18. **Both languages say the same thing.** A change to one page is a change to its translation in the same commit.

## Terms

| English | 中文 | What it is |
|---|---|---|
| note | 笔记 | a Markdown file in the vault |
| vault | 库（vault） | the folder Obsidian opens |
| agent | Agent | the model that works for the learner |
| explanation (gloss) | 解释 | the text the agent shows beside a passage; not in the file until kept |
| keep | 保留 | write a gloss or a block's result into the note as Markdown |
| request block | 请求块 | the block made by *Ask the agent here* |
| recall / check / quiz | 回忆 / 检查 / 测验 | the three kinds of question block |
| feedback | 反馈 | what the agent writes about the learner's answer |
| task | 任务 | a request or a note-making job the agent works on |
| task note | 任务笔记 | the note in `ICAP/Tasks/` that records a task |
| activity | 活动 | the list of task notes (`ICAP/Activity.base`) |
| step | 步骤 | one tool call of a task |
| model | 模型 | the language model that runs a task |
| provider | 服务商 | the company or service that serves a model |
| ICAP style | ICAP 样式 | the setting for how ICAP's output looks |
| ink | 笔迹 | ICAP's colour |

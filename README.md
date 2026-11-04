# Obsidian Learning Agent
## 产品设计方案 · Version 1.1

**产品定位：** 基于 ICAP 认知学习框架，以 Obsidian 原生 Markdown 文档为交互界面、Pi Agent 为智能运行时的学习型个人知识库。

**核心理念：Document as Interface, Agent as Runtime.**

---

## 1. 产品愿景

随着大语言模型的发展，知识的获取成本已经显著降低。对于以学习为主要目的的用户而言，个人知识库的价值不再只是收集、保存和检索外部知识，而是帮助用户将外部知识转化为能够独立理解、回忆和应用的内部知识。

传统 AI 笔记插件通常采用 Chat Panel 模式：用户向 AI 提问，AI 在独立窗口回答，用户再决定是否将答案复制到笔记中。

本项目不采用这一模式。

**Markdown 文档本身就是 Agent 的工作空间、结果载体与交互界面。** Agent 产生的解释、练习和反馈直接进入文档，通过原生 Markdown 渲染与扩展交互组件呈现。

产品目标不是提高 AI 生成笔记的数量，而是降低理解成本、促进主动认知参与，并帮助用户建立长期可用的知识。

## 2. 理论基础：ICAP Framework

ICAP 是 Chi 与 Wylie 提出的认知参与框架，将学习活动分为四类：

| 层级 | 认知活动 | 产品中的对应行为 |
|---|---|---|
| **P — Passive** | 接收信息 | 阅读笔记、阅读 Agent 解释 |
| **A — Active** | 操作与处理信息 | 选取概念、标注、整理、补充内容 |
| **C — Constructive** | 生成超出现有材料的理解 | 独立解释、知识重建、主动回忆 |
| **I — Interactive** | 通过实质性互动共同建构理解 | 与 Agent 讨论、回应追问、修正推理 |

ICAP 理论通常预测，在其他条件相当时，更深层次的认知参与能够带来更好的学习效果。但这些层级取决于学习者实际进行的认知活动，而不是 UI 组件名称。例如，点击一个选择题并不自动构成 ICAP 意义上的 Interactive Learning。

### 产品设计原则

**原则一：解释易于获得，理解需要自己完成。**

Agent 应及时消除阅读障碍，但不应默认代替学习者完成复述、推理或知识组织。

**原则二：鼓励从 Passive 向 Constructive 和 Interactive 发展。**

用户可以自由阅读和获取解释。系统提供主动回忆、自我解释和讨论修正的机会，但不强制每次学习都进行测验。

**原则三：根据先验知识调整解释。**

解释应结合当前文档、学习主题和用户已知知识，而不是统一按照初学者或专家水平生成。

**原则四：尊重原生笔记行为。**

学习活动直接发生在 Markdown 文档内，不要求用户频繁离开笔记、切换窗口或进入独立的 AI 工作空间。

## 3. 产品交互架构

第一版确定采用三个基础交互组件。

### 3.1 Explanation Block — 知识解释

**用途：** 解决阅读时遇到的概念障碍。

用户在笔记中选择不理解的术语、句子或段落，触发上下文解释。

Agent 根据当前笔记的语境生成解释，并以内嵌内容块的形式显示在对应位置。

功能要求：

- 支持概念、术语和段落解释。
- 理解选中内容所在的局部上下文及当前学习主题。
- 可以利用明确可得的既有知识提供类比和跨领域解释。
- 默认生成简短、完整的解释。
- 支持进一步深入、举例或对比。
- 保留可用于核查的来源信息；没有可验证来源时不伪造引用。
- 用户可以决定是否将解释永久保留到笔记中。

Explanation Block 使用 Markdown 内容，保持对代码、数学公式、内部链接和常见文档元素的支持。

### 3.2 Interactive Block — 文档内交互

**用途：** 让 Agent 在文档中直接向用户提出问题、收集输入，并根据回答继续工作。

Interactive Block 不限于测验，也承担 Agent 与用户之间的结构化交互。

第一版支持以下输入形式：

- 单选和多选
- 自由文本回答
- 确认与取消
- 提交后反馈

交互流程：

1. Agent 根据当前任务生成 Interactive Block。
2. Block 在当前 Markdown 文档中渲染。
3. 用户直接在 Block 中回答。
4. 用户提交后，答案返回对应的 Agent 任务。
5. Agent 依据回答继续执行，并生成下一步结果。

交互块具有独立身份及生命周期，支持等待、提交、完成、取消等状态。

交互过程中产生的临时 UI 不要求永久保留在文档中；有学习价值的答案、反馈和结论可以转化为持久化内容。

### 3.3 Activity Panel — 任务活动

**用途：** 让用户理解 Agent 正在做什么，以及最终做了什么。

Activity Panel 不承担聊天功能。

它以紧凑的活动入口存在，用户需要时可以展开，查看当前任务及历史结果。

第一版支持：

- 任务进行中（Processing）
- 等待用户输入（Waiting for Input）
- 任务完成（Completed）
- 任务失败（Failed）
- 取消任务（Cancelled）
- 查看 Agent 创建或修改的笔记内容

展示内容以任务级结果为主，例如：

- 已为当前概念添加解释
- 已创建三篇学习笔记
- 正在等待理解检查的回答
- 已完成反馈分析

默认不展示模型思考过程、原始工具调用、内部消息和 Sub Agent 执行细节。

**Activity Panel 是状态界面，不是 Chat Panel。**

## 4. 第一版核心学习功能

### Feature 01 — Contextual Explanation

**ICAP 对应：主要支持 Passive，鼓励进一步的 Active 参与。**

用户阅读技术文章或课程笔记时，可以直接选取陌生概念，获取与当前语境相关的解释。

例如在学习 C++ 时，点击 `pointer`，系统不只是返回通用定义，而是结合当前文章和用户已知的 Python 引用知识进行解释。

用户可以进一步要求深入说明或与其他概念比较。

目标是减少阅读中断，降低概念理解门槛。

### Feature 02 — Active Recall & Feedback

**ICAP 对应：Constructive，支持进一步进入 Interactive。**

用户独立输入对某个概念的理解，然后请求 Agent 进行检查。

Agent 的职责包括：

- 判断解释中是否存在关键概念错误。
- 指出遗漏、不准确之处。
- 解释为什么某种理解可能有问题。
- 必要时提供提示或反例。
- 提出后续问题，帮助用户重新组织理解。

系统不默认替用户重写答案，而是让用户自己完成修正。

支持在不查看原始解释的情况下进行回忆，避免将简单改写误认为真正的提取练习。

### Feature 03 — Interactive Learning

**ICAP 对应：根据实际活动支持 Active、Constructive 或 Interactive。**

Agent 可以围绕当前笔记动态创建练习、提问和讨论。

典型流程：

1. 用户学习完一个概念。
2. Agent 生成理解检查问题。
3. 用户在文档中提交答案。
4. Agent 分析答案。
5. 如果存在误区，Agent 给出针对性提示或追问。
6. 用户修正自己的理解。
7. Agent 生成总结反馈。

其中，只有当双方围绕知识进行实质性的推理、回应和修正时，才将其视为 ICAP 的 Interactive 活动。

### Feature 04 — Agent-Assisted Note Creation

**ICAP 对应：取决于用户参与方式，可支持 Passive、Active 或 Constructive。**

Agent 可以根据当前学习材料，协助创建有助于学习的 Markdown 笔记。

第一版支持：

- 创建概念解释笔记。
- 整理当前材料中的关键概念。
- 生成概念之间的比较和关联说明。
- 将有价值的交互结果整理为学习笔记。
- 将用户修正后的理解保留在知识库中。

Agent 生成的内容直接使用 Obsidian 原生文档结构，而不是先出现在聊天记录中再由用户复制。

用户仍然拥有对文档内容的最终控制权。原有笔记的实质性修改应允许用户审查。

## 5. 已确定的技术与产品选型

第一版只固定必要的架构决策，不预先规定具体实现细节。

| 组成 | 确定方案 | 职责 |
|---|---|---|
| 宿主 | Obsidian Desktop Plugin | 文档、编辑器与工作空间 |
| 内容格式 | Markdown | 持久化知识内容 |
| 扩展协议 | Markdown DSL | 定义特殊内容块和交互块 |
| 渲染 | Obsidian Native Markdown Renderer + Custom UI | 文档内直接呈现 |
| Agent | Pi Agent | 模型推理、任务执行与工具协调 |
| 通信 | Pi RPC | 插件与 Agent 双向通信 |
| 交互管理 | Block Runtime | 管理交互状态、输入及任务关联 |
| 状态界面 | Activity Panel | 展示任务状态和最终产出 |

### Markdown DSL

采用声明式 Markdown 扩展语法，而不是要求 Agent 生成任意可执行 HTML 或 JavaScript。

第一版确定两种扩展块：

**Explanation Block：** 承载可阅读、可保存的 AI 解释及知识内容。

**Interactive Block：** 承载 Agent 动态生成的问题、输入控件与交互状态。

普通笔记内容仍然使用标准 Markdown。特殊 Block 仅在需要额外样式或交互能力时使用。

### Pi Agent

Pi 被视为通用 Agent Runtime，而非产品界面框架。

它负责理解任务、调用必要能力、生成文档内容，以及根据用户交互结果继续执行。

第一版不依赖复杂多智能体系统，也不将 Sub Agent 作为用户可见的产品概念。

V1.1 明确了 Pi 的归属与加载方式：Pi 是用户自己的 Agent，ICPA 以 extension 形式接入，默认使用用户的完整配置。见第 9.5 节。

### RPC Communication

Obsidian 与 Pi 使用 RPC 双向通信。

通信需要支持三个基本方向：

- Obsidian 向 Pi 提供学习任务和上下文。
- Pi 向 Obsidian 返回内容产出及任务状态。
- Obsidian 将 Interactive Block 的用户回答返回 Pi，使任务能够继续执行。

用户不需要接触 RPC、Prompt、工具调用或 Agent 内部事件。

## 6. 第一版的完整用户体验

一个典型学习会话如下：

**第一阶段：阅读（Passive）**

用户打开一篇有关 C++ 内存管理的 Markdown 笔记。

遇到陌生概念 RAII 时，选中概念并触发 Explanation。

Agent 在文档中生成简短解释。

**第二阶段：理解与操作（Active）**

用户继续阅读，展开详细示例，并选择将有价值的解释保留在笔记中。

**第三阶段：自我解释（Constructive）**

用户阅读结束后，尝试不参考原文，自己写出 RAII 的作用及工作机制。

随后请求 Agent 检查理解。

**第四阶段：讨论与修正（Interactive）**

Agent 发现用户混淆了 RAII 与垃圾回收，生成一个针对性的追问。

用户回答并修正原有解释，Agent 再给出反馈。

**第五阶段：知识沉淀**

最终保留下来的不是完整的 AI 对话历史，而是用户的知识表达、必要的解释、经过修正的理解及有价值的反馈。

整个过程始终在同一份 Markdown 文档中完成。

## 7. 第一版明确不包含的功能

以下功能具有后续扩展价值，但不纳入 V1：

- 常驻 Chat Panel 或对话式工作空间
- 完整的个人知识图谱自动构建
- 长期 Knowledge Tracing 和掌握度预测
- 自动化间隔重复调度
- 主动扫描整个知识库并持续生成学习任务
- 复杂 Sub Agent 协作系统
- 独立课程管理或 LMS 功能
- 自动评判用户的全局知识水平
- 自定义多模态交互组件市场
- 替代 Obsidian 原生编辑器

这些能力不作为第一版的架构前提。

## 8. 第一版验收标准

V1 的成功不以插件功能数量或 Agent 工具调用能力衡量，而以以下体验是否成立为标准。

**文档原生性**

用户能够在 Obsidian 中直接阅读 Agent 生成的解释、完成交互，并保留学习成果，而不必使用聊天窗口。

**上下文解释质量**

Agent 能正确利用当前文档语境解释概念，并避免不必要的基础内容重复。系统不得假装知道未经验证的用户知识水平。

**主动学习支持**

用户能够独立撰写理解、请求反馈、根据提示修正答案，而不是只能消费 AI 生成内容。

**交互闭环**

Agent 能动态创建 Interactive Block，接收用户提交的答案，继续执行任务并输出结果。

**执行透明性**

用户能够知道任务是否仍在进行、是否需要输入、最终创建或修改了哪些内容，而不必阅读工具调用日志。

**笔记控制权**

普通 Markdown 的读写体验不受破坏；持久化内容可阅读、可编辑，临时交互不会无意义地污染知识库。

---

## 9. V1.1 — Vault-Native Learning

V1.1 明确三件事：Agent 从哪里获得知识，Agent 如何判断用户已经知道什么，以及 ICPA 与用户的 Agent 之间的边界。

核心立场是**解耦**：Pi 是用户自己的 Agent，用户平时怎么用它，在 Obsidian 里就怎么用。ICPA 只提供 extension（工具与协议）和文档界面，不规定 Agent 如何完成任务，也不规定用户的笔记格式与结构。

### 9.1 决定：取消 Source Ingestion

ICPA 不设立独立的资料导入或知识库建立阶段。

Obsidian Vault 本身就是知识来源。要求用户先把资料导入另一套 Source Library，相当于把 Obsidian 当成 NotebookLM 使用，既增加操作成本，也与「Document as Interface」相矛盾。

取而代之的是两种按需发生的能力：**Knowledge Discovery** 与 **Learner Calibration**。两者都不是需要用户启动的阶段，也不预先扫描整个 Vault，不建立向量数据库或知识图谱。

### 9.2 Knowledge Discovery：能力，而不是阶段

Knowledge Discovery 是 Agent 在执行任务时自己完成的事。它根据任务判断何时查找、查找多深，例如在解释一个术语之前，先查看它的反向链接以及用户是否写过相关笔记。读取 PDF、遍历目录这类事，用户的 Agent 用它自己的工具即可完成。

ICPA 额外提供 Agent 自己难以做准的部分：Obsidian 的语义。为此内置两个只读工具，作为可用的能力，而不是必须遵循的流程。它们由插件直接通过 Obsidian API 实现，不依赖用户安装或启用 Obsidian CLI。

**`obsidian`**：一个工具，`command` 参数沿用 Obsidian CLI 的命令名、参数（`file` 按 wikilink 解析，`path` 为精确路径）与 JSON 输出：

| command | 用途 |
|---|---|
| `search` / `search:context` | 按 Obsidian 的搜索语义查找笔记：所有词都须出现，支持 `path:`、`file:`、`tag:` 运算符（含嵌套标签）；后者返回 `path:line: text` |
| `read` | 读取笔记内容 |
| `links` / `backlinks` | 出链（解析为路径）与反向链接 |
| `outline` | 笔记的标题结构 |
| `properties` / `aliases` / `tags` | 笔记属性、别名与标签；不指定笔记时，`aliases` 与 `tags` 返回全 Vault 的结果 |
| `files` | 按目录或扩展名列出文件 |

**`read_document`**：通过 Obsidian 内置的 PDF.js 读取 PDF：先返回目录（含页码）与总页数，再按页码范围读取文本（每次最多 30 页），引用时使用 `[[book.pdf#page=12]]`。没有文本层的扫描件会如实说明需要 OCR。纯文本文件原样返回。这使隔离模式下也能读取 PDF。

不移植 Obsidian CLI 中的 `eval`、`delete`、`plugin:*`、`dev:*` 等命令。ICPA 自己的写入工具只有 `create_note` 与 `propose_edit`，后者需要用户审查。

**访问范围：** 默认模式下，Agent 的访问范围就是用户的 Pi 本身的权限，ICPA 不额外限制。隔离模式下，Agent 只能读取当前 Vault 与用户在设置中授权的目录，由 ICPA extension 在工具调用层强制执行。

### 9.3 Learner Calibration：证据写在笔记里

这是应对 Expertise Reversal Effect 的关键：同一个概念，对初学者有帮助的解释，对熟练者可能是负担。

Vault 内容只能作为初始线索，不能直接等同于用户的知识水平。ICPA 在系统提示中给 Agent 以下证据强度作为参考：

| 证据 | 能说明什么 | 强度 |
|---|---|---|
| Vault 中存在相关材料（教材、剪藏） | 用户接触过该主题 | 弱 |
| 用户的自述背景（设置中填写） | 用户自认为具备的基础 | 弱 |
| 隐式反馈（要求「深入」或「简单一些」） | 当前解释的深浅是否合适 | 弱，但可持续积累 |
| 用户自己撰写的笔记 | 用户可能理解部分概念 | 中 |
| 已完成的 Recall / Check（原话 + 判定 + 日期） | 用户对该概念的实际掌握情况 | 强 |

**来源元数据。** 只有当 Agent 能区分「用户写的」与「Agent 生成的」内容时，上述分级才成立。否则 Agent 会把自己生成的笔记误读为用户已经理解的证据，形成自我强化的错误。

ICPA 不规定笔记的格式与结构，只在自己的工具写入时记录最少的来源信息：

- `create_note` 创建的笔记在 properties 中记录 `generated-by: icpa-agent`。这是工具层面的元数据，不改变用户的格式，用户可以在设置中关闭（*Mark notes the agent creates*）。
- 用户保留的 Agent 解释使用 ICPA 的 callout 类型（`gloss`）。
- Recall / Check 保留时，记录用户原话与反馈（`feedback`、`practice`）。

用户的 Agent 通过其他方式写入的内容，ICPA 不做标记。

**学习状态即笔记本身。** 校准所需的证据全部以 Markdown 形式存在于 Vault 中，用户可见、可编辑、可删除。ICPA 不维护隐藏的学习者模型数据库。Agent 查找掌握证据的方式，与查找相关知识的方式相同。

**校准保持局部。** 校准只针对具体概念或当前笔记，不形成全局知识水平评分，与第 7 节中「不自动评判用户的全局知识水平」「不做长期 Knowledge Tracing」保持一致。

**诊断保持克制。** 解释始终优先给出，不以诊断题作为前置条件。只有在缺乏证据、且不同水平下的解释差别很大时，Agent 才在解释中提供一个轻量分叉，例如「如果你已经熟悉 X，可以从 Y 开始」。

### 9.4 学习流程：没有「开始学习」

用户不需要执行「建立知识库」或「开始学习」的动作。打开一篇笔记、选中一个概念，ICPA 即开始工作。

**请求块：在文档中直接对 Agent 说话。** 除了解释、Recall、Check 这些固定动作，用户可以在笔记的任意位置插入一个请求块（命令 *Ask the agent here*），写下任意请求，⌘↵ 提交：

1. 发给 Agent 的是用户原话，加上最少的定位信息（当前笔记、所在标题、选中的文字），不附加任何 ICPA 任务提示。
2. Agent 用用户自己的配置和工具完成请求；需要用户回答时，问题出现在这个块里。
3. 新建与修改的文件以链接形式列在块中，同时出现在 Activity Panel。
4. 结果下方可以继续追问，延续同一段对话。
5. 结束后，用户可以把块保留为纯 Markdown 记录（请求原文、回复与文件链接），或直接移除；结果文件留在 Vault 中。

例如：新建一个 Vault，放入一批 PDF，新建一篇「学习 C++」的笔记，在请求块中写「根据 资料/ 帮我做学习路线和资料笔记」。路线与笔记的形式由用户的请求和用户自己的 Agent 配置决定，ICPA 不预设。

**用 `[[` 指明资料。** 在请求或追问中输入 `[[`，可以从 Vault 中选择文件（笔记、PDF 等任何附件），插入的是普通的 wikilink；输入 `@` 也会打开同一个选择器，插入的同样是 `[[…]]`。插件把这些链接按 Obsidian 的规则解析为路径，附在请求中告诉 Agent「指的是这些文件」，只传路径，不传内容，读不读、读多少由 Agent 用自己的工具决定。保留记录后，这些链接成为真实的出链，图谱中可以看到一条学习路线基于哪些资料。（Obsidian 不支持链接到文件夹；需要指一个文件夹时直接写它的名字即可。）

请求块不是 Chat Panel：请求、追问与结果都留在文档中提出请求的位置。固定动作本质上是预先写好请求的请求块。

```
Existing Vault（Markdown · PDF · Links · Properties）
        │  用户的 Agent 按需读取
        ▼
用户的 Pi + ICPA extension
  ├─ Discovery：Agent 自己的工具 + ICPA Vault 工具
  ├─ Calibration：证据分级 + 隐式反馈
  └─ ICAP Learning：Explanation · Recall · Interactive · Notes · 请求块
        │  ask_learner / create_note / propose_edit 写回文档
        │  其他文件变化由插件记录并展示
        ▼
同一份 Markdown 文档：学习结果成为下一次校准的证据
```

**冷启动：** 初次使用时 Vault 中没有 Recall 证据，解释会相对通用。隐式反馈与轻量分叉用于让这一阶段尽快过去。

### 9.5 Agent 运行方式：用户的 Pi，加上 ICPA extension

Pi 是用户自己安装和配置的 Agent，ICPA 不拥有它。

| 归属 | 内容 |
|---|---|
| 用户的 Pi | 模型、认证、内置工具（含 shell），以及用户自己的 skills、extensions、MCP、AGENTS.md、项目信任设置 |
| ICPA extension | 文档交互工具（`ask_learner`、`create_note`、`propose_edit`）、Vault 工具、`read_document` |
| ICPA 系统提示 | 追加在用户的系统提示之后的协议：ICAP 学习规则、不替用户改写答案、修改已有笔记优先使用 `propose_edit`、证据分级参考 |
| Obsidian 插件 | 文档渲染、Block Runtime、请求块、修改审查、文件变化记录、Activity Panel |

**默认：用户的完整配置。** 每个任务以用户的 Pi 配置启动，额外加载 ICPA extension，并把 ICPA 协议追加到系统提示中（不替换）。用户的 skills、extensions、MCP、AGENTS.md 与项目信任设置照常生效。每个固定动作只隐藏与它无关的 ICPA 工具，不限制用户自己的工具。

这意味着用户的 Agent 可以不经 `propose_edit` 直接修改文件，Vault 中的外部内容也可能影响它的行为。这与用户在 Vault 中直接运行 Pi 的处境相同，属于用户自己的选择。

**执行透明性。** 为了让用户始终知道 Agent 做了什么，插件记录 Agent 在 Vault 中造成的文件创建、修改、删除与重命名，适用于所有任务（请求、解释、Recall、Check 等），不只是请求块。归属以工具调用为准：某个任务的 Agent 正在执行工具调用（或刚结束，留 3 秒给文件监听的延迟）时发生的变化，记在该任务上；用户正在编辑的文件与任务所在笔记（插件自己写入块）不计。记录列在请求块中与 Activity Panel 中。插件只记录，不限制。

**用户扩展的对话框。** 用户自己的扩展发起的确认、选择或输入请求（例如权限确认），以问题的形式出现在对应的块中，由用户在文档里回答。

**模型、服务商与 API Key：由 Pi 管理，ICPA 不保存。** 凭证有两个来源，都属于 Pi：

- `pi` 中的 `/login`：OAuth 或 API Key，保存在 `~/.pi/agent/auth.json`；
- 环境变量，例如 `DEEPSEEK_API_KEY`、`ANTHROPIC_API_KEY`。从 Dock 启动的 Obsidian 不继承 shell 配置文件中导出的变量，因此插件启动 Pi 时会读取登录 shell 的完整环境，与用户在终端中运行 Pi 时一致。

默认模型与默认服务商来自 Pi 自己的 `settings.json`。ICPA 设置中的「模型」是一个可选覆盖，下拉列表只列出 Pi 报告的已有凭证的模型（RPC `get_available_models`）；设置页同时显示 Pi 当前会使用哪个模型，没有可用模型时提示用户去 `pi` 中 `/login`。探测不发送任何提示，不产生费用。

**隔离模式（可选）。** 需要可预期行为的用户可以在设置中切换为隔离模式：只加载 ICPA 自己的 extension，不加载用户的 extensions、skills、MCP、prompt templates、context files 与 Vault 中的 `.pi/` 项目资源，Agent 只有只读工具与 ICPA 工具，没有 shell，ICPA 协议替换默认的系统提示。

### 9.6 学习偏好与 AGENTS.md

- **学习偏好**放在 ICPA 设置中：「你喜欢怎样学」（解释语言、讲解风格，追加到 ICPA 协议中，所有解释与请求都遵循）、「你的背景」（自述背景）、「新笔记的位置」。这是学习专用的配置，不与用户为其他 Agent 编写的 AGENTS.md 混用。
- 默认模式下，用户的 AGENTS.md 与 skills 照常加载，用户对格式与结构的偏好通过它们表达。
- **界面语言**跟随 Obsidian 的界面语言（中文 / 英文），包括设置、命令、块与 Activity Panel，以及首次打开的指南笔记。写入笔记的机器标记保持英文（callout 类型、`kind:`、`generated-by`，以及 Agent 用作隐式反馈证据的 “Plainly.” / “Deeper.” 小标题），因此切换语言不会让已有笔记失效；记录中给人读的标签（如「请求」「文件」「理解检验」）随界面语言。
- 隔离模式下不加载 AGENTS.md。Vault 以外的材料在「Vault 之外的文件夹」中授权，由 ICPA extension 的 `tool_call` 拦截与 `read_document` 共同强制执行（见 9.2）。

### 9.7 相对 V1 的变更

| 类型 | 内容 |
|---|---|
| 新增 | 中文界面；Pi 模型与凭证状态；请求块（含 `[[` 指明资料）；文件变化记录；用户扩展对话框的文档内呈现；隔离模式；Vault 工具与 `read_document`；来源元数据；证据分级参考 |
| 调整 | Pi 启动方式改为「用户的完整配置 + ICPA extension，协议追加到系统提示」 |
| 保留 | Markdown DSL、Block Runtime、`ask_learner` / `create_note` / `propose_edit`、Activity Panel |
| 不做 | Source Ingestion、全 Vault 扫描、向量数据库、知识图谱、隐藏的学习者模型 |

## 10. 产品原则总结

本项目不尝试制造一个更复杂的 AI 笔记助手，而是重新定义 AI 与个人知识库之间的关系。

传统模式：

**User → Chat Agent → Generated Answer → Copy into Notes**

本项目：

**User ↔ Markdown Document ↔ Agent Runtime**

Agent 不再通过独立对话界面占据用户注意力，而是直接参与文档中的解释、练习、反馈与知识形成过程。

ICAP 为学习交互提供设计依据；Markdown DSL 为内容与交互提供统一载体；Pi Agent 提供智能执行能力；RPC 负责运行时通信；Activity Panel 保证用户了解执行结果。

最终目标是建立一种 **Learning-Native Personal Knowledge Base**：

**让知识容易获得，让理解主动发生，让学习成果自然沉淀为笔记。**

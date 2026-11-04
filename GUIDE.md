# ICAP Learning Agent — 安装与使用

在 Obsidian 笔记里学习：就地解释、凭记忆复述并得到反馈、在文档中与 Agent 互动。Agent 用的是你自己的 [Pi](https://github.com/earendil-works/pi)。

> 仅支持桌面版 Obsidian（≥ 1.7）。插件尚未上架社区插件市场，目前需要手动安装。

## 1. 准备 Pi

ICPA 不自带模型，所有模型调用都经过你本机的 Pi。

1. 安装 Node.js ≥ 20。
2. 安装 Pi：

   ```bash
   npm i -g @earendil-works/pi-coding-agent
   ```

3. 配置模型凭证，二选一：
   - 在终端运行 `pi`，输入 `/login`，选择服务商并登录。凭证保存在 `~/.pi/agent/auth.json`。
   - 在 shell 配置文件（如 `~/.zshrc`）里导出服务商的密钥，例如 `export DEEPSEEK_API_KEY=sk-…`。
4. 在终端运行 `pi`，随便问一句，确认能正常回答。

ICPA 不保存任何密钥。服务商、默认模型等都在 Pi 里配置（`~/.pi/agent/settings.json`）。

## 2. 安装插件

### 从 Release 安装（推荐）

在 [Releases](https://github.com/EdwinZhanCN/obsidian-icpa-agent/releases) 下载最新版本的 `main.js`、`manifest.json`、`styles.css`，放到你的库的插件目录：

```
<你的库>/.obsidian/plugins/icpa-agent/
├── main.js
├── manifest.json
└── styles.css
```

`icpa-bridge.ts`（ICPA 给 Pi 用的 extension）由插件在首次启用时自动写入这个目录，不需要手动复制。

### 从源码构建

```bash
git clone https://github.com/EdwinZhanCN/obsidian-icpa-agent.git
cd obsidian-icpa-agent
npm install
npm run build          # 在仓库根目录生成 main.js 和 styles.css
```

再把 `main.js`、`manifest.json`、`styles.css` 复制到上面的插件目录。

### 启用

1. Obsidian → 设置 → 第三方插件 → 关闭“安全模式”。
2. 在已安装插件列表里启用 **ICAP Learning Agent**。
3. 首次启用会自动打开一篇指南笔记“用 ICAP 学习”。照着做一遍，就能用到所有交互。

### 开发时

`dev-vault/` 是现成的测试库，它的插件目录通过符号链接指向构建输出。运行 `npm run dev` 后，每次保存都会重新构建。详见 `docs/development.md`。

## 3. 设置

设置 → ICAP Learning Agent：

| 设置 | 作用 |
|---|---|
| 你的背景 | 你已经会什么。解释只建立在这里写的、或你笔记里已有的知识上 |
| 你喜欢怎样学 | 语言、风格、深浅。每次解释和请求都会遵循 |
| Pi | 显示找到的 Pi、正在使用的模型、可用模型数量。没有可用模型时会提示你去 `/login` |
| 模型 | 可选。下拉框只列出已有凭证的模型；“Pi 默认”跟随你的 Pi 设置 |
| Agent 配置 | **你的 Pi 配置 + ICPA**（默认）：你的 skills、扩展、MCP、AGENTS.md、shell 都可用，可以直接改文件，每处改动都列在“活动”里。**仅 ICPA（隔离）**：只读、没有 shell，只能访问这个库和你授权的文件夹 |
| Vault 之外的文件夹 | 仅隔离模式：允许 Agent 读取的外部文件夹 |
| 新笔记的位置、标记 Agent 新建的笔记、墨色、选区标记、回忆时模糊笔记 | 文档中的细节 |

界面语言跟随 Obsidian 的语言（中文 / 英文）。

## 4. 使用

| 想做什么 | 怎么做 |
|---|---|
| 读不懂一个词或一段话 | 选中它 → 旁边的小标记点 **解释**。之后可以要 **更深入**、**举个例子**、**说浅一点**、**对比…**；有用就 **留在笔记里** |
| 检验自己是否真懂 | 命令 *凭记忆复述（本节）*：笔记其余部分会模糊，你凭记忆写，Agent 给反馈并追问 |
| 检查自己写的理解 | 选中你写的段落 → **检查我的说法**，或命令 *检查我写的内容* |
| 做几道题 | 命令 *检验我对本节的理解* / *检验我对整篇笔记的理解* |
| 其他任何事 | 命令 *在这里向 Agent 提问*（或右键菜单）。写下请求，按 ⌘↵ 发送。输入 `[[` 或 `@` 可以挑选库里的文件，例如“根据 `[[某本书.pdf]]` 做一条学习路线，再为每章建一篇资料笔记” |
| 看 Agent 做了什么 | 状态栏右下角的小圆点 → **活动**：每项任务的状态，以及 Agent 新建、修改、删除了哪些文件 |

所有保留下来的内容都是普通 Markdown，卸载插件也能正常阅读。

## 5. 常见问题

- **“找不到 Pi”**：在设置里填 Pi 的完整路径（终端里 `which pi` 的结果）。
- **“没有任何模型配置了凭证”**：在终端运行 `pi` → `/login`；或者在 `~/.zshrc` 中导出密钥，然后在设置里点 ↻。
- **模型和预期不符**：Pi 的默认模型名如果不在可用列表里，Pi 会自动换成别的模型。在设置的“模型”里直接选一个，或修改 Pi 的 `settings.json`。
- **想让 Agent 不要直接改文件**：把“Agent 配置”切到“仅 ICPA（隔离）”。

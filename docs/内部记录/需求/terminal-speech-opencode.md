# terminal-speech：支持 opencode（OpenCode）的“只读最终答复”提取规则

日期：2026-03-04

## 背景
Wave 的终端语音播报（TTS）需要从终端 scrollback 中提取“AI 最终正式回复正文”，并且**不播报**工具调用、状态行、底栏、提示符、错误提示、推理/思考等噪声。

此前提取逻辑主要面向 Codex 的 `›`/`•` 转录格式。现在扩展到 `opencode`（OpenCode）。

## opencode 输出里哪些是“AI 真正的反馈消息”
结合 `opencode` 源码（`packages/opencode/src/cli/cmd/run.ts` 与 `packages/opencode/src/cli/cmd/tui/routes/session/index.tsx`）：
- **需要播报（AI 正式回复）**
  - `text` part：也就是模型的最终正文输出（自然语言/Markdown）。
- **明确不播报（噪声）**
  - `reasoning` part：在 `run` 模式会以 `Thinking: ...` 输出；在 TUI 模式以 “Thinking” 块展示。
  - `tool` part：工具调用与其输出（bash/read/write/edit/grep 等），以及权限请求等状态 UI。
  - TUI/CLI 元信息：例如消息 footer（`▣ Chat · model · duration`）、`permission requested: ...`、分享链接 `~ ...`、一次性 DB migration 提示等。

## Wave 侧提取规则（实现）
文件：`frontend/app/block/terminal-speech.ts`

### 1) 识别 opencode 输出
当 scrollback 中出现 opencode 的 UI 线索时启用 opencode 提取（例如）：
- `Thinking:` 行
- `> agent · model` 头
- `▣ ... · model ...` 的 TUI footer 行
- opencode 工具行（`→/←/$/✱/...`）或 `permission requested: ...` 等

### 2) opencode TUI：只在“已完成”时可播报
opencode TUI 的 assistant 消息会在尾部渲染一行 footer（以 `▣` 开头）。

为了避免播报“还在生成中的回复”，严格模式下：
- **只有当 footer 行包含 duration（例如 `1.2s`/`120ms`/`3m 23s`）或 `interrupted` 时，才认为回复已闭合可播报。**

提取正文时：
- 取“上一条 footer”到“最新 footer”之间的内容段
- 过滤边框/状态/工具/Thinking/提示等噪声行
- 去掉 TUI 固定左侧 padding（按段内最小公共缩进剥离）

### 3) opencode run：忽略 Thinking/tool，并要求 shell 边界（严格模式）
`opencode run` 会打印 `Thinking: ...`，以及带图标的工具行与输出块。

严格模式下：
- 忽略 Thinking/tool/status 行
- 需要在回复后出现 shell prompt（例如 `PS C:\\...>`）或类似提示符边界，才认为回复已闭合可播报。

## 测试
- `frontend/app/block/tests/terminal-speech.test.ts` 增加了 opencode run + opencode TUI 的样例用例。


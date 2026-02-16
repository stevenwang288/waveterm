# WAVE “显示不完整/只剩一小块”根因与修复（2026-02-16）

## 现象（用户现场反馈）
- 启动后界面只剩“东一点西一点”，看不到完整内容。
- AI 回复结束后，看不到之前对话，只剩一小块区域可见。

## 根因（对比官方上游实现）
问题出在终端的 OSC 16162 处理逻辑：当收到 `R`（reset/ready）事件且终端处于 alternate screen 时，我们曾经 **无条件** 发送 `ESC[?1049l` 强制退出 alternate screen。

但 AI CLI（例如 `codex/coder/claude/gemini/...`）在运行时经常使用 alternate screen（全屏 TUI）。无条件退出会把它们的全屏 UI 强行踢出，导致渲染状态错乱，表象就是“只剩一小块/历史被挤没”。

官方上游的处理方式是：遇到 `R` 时 **仅对非 AI 命令** 退出 alternate screen；如果上一条命令是 AI CLI，则跳过退出，保证全屏 UI 状态稳定。

## 修复点
- 文件：`frontend/app/view/term/osc-handlers.ts`
- 变更：
  - 增加 `isAITermCommand()` 判断（基于 `termWrap.lastCommandAtom` 的上一条命令）。
  - 对 `codex/coder/claude/gemini/amp/iflow/opencode/clawx` 等命令跳过 `ESC[?1049l`。
  - 其他普通命令仍保持原行为，避免影响非 AI 的 alternate screen 生命周期。

## 构建与交付
- `npm run build:dev` 已通过。
- `task package` 已通过。
- 安装包更新：
  - `make/WAVE-win32-x64-0.14.0-1.exe`
  - `D:\DESK\WAVE-setup-latest.exe`


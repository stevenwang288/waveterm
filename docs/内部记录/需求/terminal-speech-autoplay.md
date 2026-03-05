# terminal-speech：自动播报（Auto-play）默认开启 + interactive 进程可用

日期：2026-03-04

## 现象
- 语音播报已开启，且“自动播报（Auto-play）”开关为 ON
- **手动播报正常**（点喇叭按钮能读出“AI 最终正式回复正文”）
- 但在 `opencode` / Codex 这类 **interactive / 长运行命令**场景里，**不会自动播报**

## 根因
`frontend/app/block/blockframe-header.tsx` 的 terminal autoplay effect 有一个启动保护：
- 只有观察到 `lastCommandDoneTs` 在本会话里推进（> sessionStartTs）才允许 autoplay

对于 `opencode` / Codex 这类 “命令一直在跑（shellState=running-command）” 的场景：
- `lastCommandDoneTs` 不会推进（命令不结束）
- 结果是 **永远不会触发自动播报**

## 修复
文件：`frontend/app/block/blockframe-header.tsx`

调整启动保护逻辑：
- **当 shell 处于 `running-command`（interactive 命令进行中）时允许 autoplay**
- 仍保留“shell idle（ready）时避免启动就读历史内容”的保护

## 默认行为
文件：`frontend/wave.ts`

`speech:autoplay` 的默认值应为 ON（除非用户显式关闭）。
- 仅对“旧配置缺失该键”的情况做迁移：写入 `speech:autoplay=true` 并标记 `speech:autoplay-migrated=true`
- 不覆盖用户显式设置的 `true/false`


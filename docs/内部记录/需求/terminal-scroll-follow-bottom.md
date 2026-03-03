# 终端滚动条“跟随最新输出”需求（分屏/重排场景）

日期：2026-03-03

## 背景
- 用户在自定义分屏布局下高频使用终端。
- 现象：滚动条经常不在最新位置，导致输出停在历史内容，阅读与交互被打断。

## 期望行为
- 若终端当前位于底部（正在跟随输出），触发 reflow/reload 后仍保持在底部。
- 若用户主动上滑查看历史，触发 reflow/reload 后保持当前位置，不强制跳底。

## 代码约束
- 重排流程必须区分“底部跟随态”和“历史阅读态”。
- 所有早返回路径（例如历史过大、文件不可用、尺寸未变）不得遗留旧的滚动恢复状态。

## 本次实现要点
- 将保存状态从单一 `viewportY` 升级为 `{ viewportY, wasAtBottom }`。
- 恢复阶段：
  - `wasAtBottom=true`：执行 `scrollToBottom()`（含一次 `requestAnimationFrame` 二次兜底）。
  - 否则：按 `viewportY` 恢复。
- `reflowHistoryToCurrentWidth` 的 `finally` 统一清理保存状态，避免旧状态污染后续流程。

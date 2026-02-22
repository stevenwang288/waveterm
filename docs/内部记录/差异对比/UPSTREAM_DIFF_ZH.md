# WaveCN 相对上游 `wavetermdev/waveterm` 的差异说明

> 目的：把我们这个仓库（`stevenwang288/waveterm`，产品名 **WaveCN**）相对上游官方仓库做过的功能改动与实现位置梳理清楚，方便后续排查交互问题、合并上游更新、以及给团队成员/AI 统一“该看哪里”的入口。

## 基线与上游更新状态（重要）

- 本文对比基线（上游快照）：`wavetermdev/waveterm` 提交 `c199f342`（`package.json` 版本为 `0.13.2-alpha.1`）。
  - 复现对比命令：`git diff c199f342`
- 我们当前工作分支：`master`（以 `git rev-parse --short HEAD` 为准；也可能包含未提交改动）。
- 上游最新状态（截至 2026-02-12 撰写时）：上游已更新到 `d42709e8`（tag `v0.14.0`）。
  - 查看 ahead/behind：`git rev-list --left-right --count upstream/main...HEAD`
  - 查看上游从基线后的提交：`git log --oneline c199f342..upstream/main`

> 解释：上游已经往前走了很多提交。为了避免把“上游新增功能/修复”混进“我们 fork 的改动”，本文主要以 `c199f342` 为对比基线来描述**我们做过什么**；上游 `v0.14.0` 的变化单独在前面标注。

## 我们 fork 的核心目标（总结）

1. **中文化（i18n）**：把 UI 可见文本、主进程菜单等集中到 i18n 资源里，提供 `zh-CN` 翻译。
2. **交互增强**：增加右键菜单/按钮（例如：复制路径、Wave AI 面板菜单、服务器面板等），提升长期工作流效率。
3. **工作区侧边栏能力补齐**：收藏/布局/Git/Servers 等面板能力。
4. **稳定性/健壮性补丁**：WebSocket 与前端异步调用更“抗崩”；终端输出写入路径做过性能/稳定性调整（本仓库近期也修过一个长期运行才触发的队列 compaction bug）。

## Wave AI 交互页面（AIPanel）相关差异

### 主要改动点

- **UI 文案全面 i18n 化**：把硬编码英文文案替换为 `i18next` / `useTranslation()`。
  - 代表文件：
    - `frontend/app/aipanel/aipanel.tsx`
    - `frontend/app/aipanel/aipanelheader.tsx`
    - `frontend/app/aipanel/aimessage.tsx`
    - `frontend/app/aipanel/aimode.tsx`
    - `frontend/app/aipanel/aipanel-contextmenu.ts`
    - `frontend/app/aipanel/aitooluse.tsx`
    - `frontend/app/aipanel/restorebackupmodal.tsx`
    - `frontend/app/aipanel/telemetryrequired.tsx`
    - `frontend/app/aipanel/airatelimitstrip.tsx`
- **右键菜单与操作项**：Wave AI 面板支持右键菜单（新聊天、配置模式、最大输出 tokens、隐藏面板等）。
  - 实现入口：`frontend/app/aipanel/aipanel-contextmenu.ts`
- **工具调用（tool use）UI**：工具调用展示/批量审批（读文件等）、审批超时提示、以及写文件工具的“Show Diff / Revert File”等按钮。
  - 实现入口：`frontend/app/aipanel/aitooluse.tsx`
  - Diff/回滚联动：`frontend/app/aipanel/waveai-model.tsx`（`openDiff()` / `restoreBackup()`）
  - Diff 视图：`frontend/app/view/aifilediff/aifilediff.tsx`

### 关键实现方式（便于排查“交互不对”）

- `useChat()` 的 transport 通过 `prepareSendMessagesRequest` 注入 `chatid/widgetaccess/aimode/tabid` 等上下文：
  - 入口：`frontend/app/aipanel/aipanel.tsx`
  - ChatId 持久化：`frontend/app/aipanel/waveai-model.tsx`（读取/写入 `RTInfo` 的 `waveai:chatid`）
- “停止生成”会在停止后从后端重新加载 chat，以避免流式中断导致的 UI 状态不一致：
  - `frontend/app/aipanel/waveai-model.tsx`：`stopResponse()` → `reloadChatFromBackend()`
- 后端 chat 转 UI chat 会做“连续同角色消息合并”（防止 provider 拆分导致 UI 抖动）：
  - `pkg/aiusechat/usechat-utils.go`：`CombineConsecutiveSameRoleMessages()`

> 如果你遇到的现象是“用户发出的消息过一会儿看没了/被合并/顺序不对”，优先从：
> 1) `pkg/aiusechat/usechat-utils.go` 的合并策略，
> 2) `waveai-model.tsx` 的 reload 时机，
> 3) `aipanelmessages.tsx` 的滚动与渲染条件
> 这三处去定位。

## 终端块与标题栏交互增强

- **标题栏路径展示**：终端块标题/标签显示 cwd（你已经确认“路径显示”与“双击收缩/展开”已实现）。
  - 入口：`frontend/app/block/blockframe-header.tsx`
- **路径右键菜单：复制路径**：
  - 入口：`frontend/app/block/connectionbutton.tsx`
  - 菜单项使用 `ContextMenuModel.showContextMenu()`；点击后走 `navigator.clipboard.writeText(...)`

## 终端输出写入队列（termwrap）

我们在 `termwrap` 的“接收后端增量输出 → 写入 xterm”路径上做过批量化处理，用于降低高频输出时的 UI 压力：

- 入口：`frontend/app/view/term/termwrap.ts`
- 核心思路：
  - `handleNewFileSubjectData()` 收到 append 时不直接 `doTerminalWrite()`，而是 `enqueueTerminalBytes()` 入队
  - `flushTerminalWriteQueue()` 在单个 write loop 内按上限（`TerminalWriteBatchMaxBytes`）合并写入
  - 队列 head 前移后做周期性 compaction，避免数组无限增长

> 备注：我们近期修过一个“运行很久才触发”的队列 compaction 逻辑问题：compaction 时机不当会导致 batch 使用旧索引取到错误 chunk，从而写入循环异常退出，表象是终端输出突然停止刷新。

## 服务器面板（Servers Panel）

- 新增服务器侧边栏面板，支持：
  - 列出连接（本地 + 远程）
  - 添加服务器（host/user/port），可选“立即连接”
  - 打开连接配置编辑器
  - 刷新列表/重试
- 入口文件：
  - `frontend/app/workspace/servers-panel.tsx`（UI/交互/调用 `RpcApi.ConnListCommand` 等）
  - `frontend/app/workspace/workspace.tsx`（挂载面板）
  - `frontend/app/tab/tabbar.tsx`（Servers 快捷按钮）

## 收藏 / 布局 / Git 等工作区面板

- 收藏能力与模型：
  - `frontend/app/store/favorites-model.ts`
  - `frontend/app/workspace/favorites.tsx`
  - `frontend/app/workspace/favorites-bar.tsx`
- 布局/工作区面板：
  - `frontend/app/workspace/layouts-panel.tsx`
  - `frontend/util/clilayout.ts`
- Git 面板：
  - `frontend/app/workspace/git-panel.tsx`
  - `frontend/app/workspace/right-sidebar.tsx`（侧边栏聚合）

> 这些面板通常会涉及到频繁渲染/轮询/状态同步。如果你后续要做“后台窗口降频/性能优化”，建议从这些面板的 effect/定时器/订阅点开始逐个梳理。

## 键盘交互（KeyModel）

- 增强了块切换与布局操作快捷键（例如 Ctrl+Tab 循环、方向键切换、Windows 下交换块位置等）。
- 入口：`frontend/app/store/keymodel.ts`

## WebSocket/连接健壮性

- 前端 WS 增加了更稳健的 error handler / safe send / close 逻辑，避免 Node 环境 `ws` 未处理 error 事件导致进程崩溃。
  - 入口：`frontend/app/store/ws.ts`

## 打包/发布/安装脚本与品牌化

- 品牌与包名：
  - `package.json`：`name=waveterm-zhcn`、`productName=WaveCN`、`appId=dev.commandline.waveterm.zhcn`
  - `electron-builder.config.cjs`：Windows/Linux 打包配置
- 脚本：
  - `scripts/install-ubuntu.sh`（Ubuntu/Debian 安装示例脚本）
  - `scripts/smoke-win.ps1`（Windows smoke）

## i18n 资源与扫描脚本

- 前端 i18n 初始化：
  - `frontend/app/i18n.ts`
- 主进程 i18n（菜单等）：
  - `emain/i18n-main.ts`
- 语言包：
  - `public/locales/en/translation.json`
  - `public/locales/zh-CN/translation.json`
- 可见文本扫描辅助：
  - `scripts/i18n-scan-visible.cjs`

## 建议：清理或迁移 `.tmp-fork-audit/`

当前仓库里包含大量 `.tmp-fork-audit/` 的分析产物（体积很大，且属于一次性数据）。建议：

- 方案 A（推荐）：把 `.tmp-fork-audit/` 迁移到单独分支或外部存档，不跟随主分支演进；
- 方案 B：至少加入 `.gitignore` 并从 git 历史里移除（需要额外操作）。

这能显著减少仓库体积、提高 clone/pull 速度，并避免把“临时产物”误认为“正式功能改动”。

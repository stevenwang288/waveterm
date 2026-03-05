# Dev Loop TODO

## Goal
把入口分清楚，避免“墙是什么 / PVE 是什么”反复讨论：
- 左侧 **「墙」**：屏幕墙（PVE Fast Path），默认仅展示 **Running** 的屏幕（不开机的不展示、不启动）
- 左侧 **「PVE」**：PVE Web 管理 UI（支持自动登录持久化）
- 远端/普通服务器：入口在 **Servers 面板**行内按钮（`初始化` → `SSH` → `VNC` → `RDP`），VNC/RDP 在当前分屏右侧打开

## Acceptance
- [x] 启动时不会自动打开 PVE（不自动点左侧 PVE 按钮）
- [x] 点击左侧「墙」打开 `pvescreenwall`（不白屏），默认仅显示 Running 的 VM/LXC
- [x] 点击左侧「PVE」打开 PVE 管理 UI；首次保存凭据后可自动登录（不反复弹登录页）
- [x] Servers 面板：整行左键不触发动作；动作通过按钮条/右键菜单（避免误触）
- [x] Servers 面板：点击 `VNC/RDP` 在当前 Tab 右侧新增分屏（不是新开标签页）
- [x] Servers 面板：PVE 分组标题后有「编辑」图标/右键入口，可填写 PVE 信息（Origin/Token + Web UI 凭据入口）
- [x] Servers 面板：PVE 宿主机 `10.20.0.250` 通过 `connections.json` 配置出现（不硬编码）
- [x] Servers 面板：GUI 图标仅对 `hasGui=true` 显示（`#165` 不显示）
- [x] Servers 面板：状态列显示（PVE `running/stopped`；其他服务器 `online/offline`）
- [x] Servers 面板：自动发现列右对齐；且默认隐藏“其他服务器”的自动发现条目（面板右键可切换显示）
- [x] Servers 面板：右键菜单与按钮条一致（含 `初始化` / `VNC` / `RDP`；PVE 额外电源操作）

## Verify
- [x] `npm test -- --run`
- [x] `npm run build:dev`
- [x] `npm run dev:fresh`（自动截图证据 `.tmp/dev-captures/`）
  - `pic/2026-03-04T09-08-02-272Z-servers-panel.png`（含 `10.20.0.250`）
  - `pic/2026-03-04T09-21-55-771Z-servers-panel-late-frompdf.png`（`#165` 无 GUI 图标）

## Tasks
- [x] 禁用 dev 启动时自动打开 PVE（移除 `WAVETERM_DEV_AUTO_OPEN_PVE`）
- [x] 左侧「墙」按钮打开 `pvescreenwall`（`openWallInNewTab()`）
- [x] 左侧「PVE」按钮打开 PVE 管理 UI（`openPveUiInNewTab()`）
- [x] Servers 面板：行按钮条 + 分组 + 对齐 + 右键操作
- [x] Servers 面板：VNC/RDP 改为当前 Tab 右侧分屏打开
- [x] Servers 面板：PVE 设置编辑入口（分组标题笔图标 + 右键菜单 + 弹窗写入 secrets）
- [x] Servers 面板：PVE `hasGui` 通过 VM config 推断（`vga=serial*|none* → false`）
- [x] Servers 面板：`10.20.0.250` 通过配置（dev seed：`.tmp/dev-fresh/_seed/config/connections.json`）纳入列表
- [x] dev:fresh：稳定 Electron userData（让 secrets 能跨 dev run 持久化）

## Backlog（规划/留档）
- 远程/普通服务器统一墙：主线定为「远控平台（Web）+ Guacamole 网关（RDP/VNC/SSH）+ 可选反向隧道 agent」
  - 设计记录：`docs/内部记录/需求/remote-wall-plan.md`

## Servers 面板（行按钮条）
目标：Servers 列表每行左侧提供按钮条，顺序 `初始化` → `SSH` → `VNC` → `RDP`；并按组展示 `PVE` / `其他服务器`；右键提供常用动作。

### Acceptance
- [x] 远程条目分组：`PVE` / `其他服务器`
- [x] 行内按钮条：`初始化`、`SSH`、`VNC`、`RDP`（列对齐、像表格）
- [x] 右键菜单：SSH、初始化、VNC、RDP、断开连接；PVE VM 额外提供开机/关机/强制关机
- [x] PVE 分组标题：提供编辑入口（笔图标 + 右键菜单），可编辑 PVE Origin/Token，且包含 Web UI 凭据入口

### Verify
- [x] `npm test -- --run`
- [x] `npm run build:dev`
- [x] `npm run dev:fresh`（自动截图证据 `.tmp/dev-captures/`）
  - `.tmp/dev-captures/2026-03-03T07-35-57-504Z-servers-panel.png`
  - `.tmp/dev-captures/2026-03-03T07-36-02-274Z-servers-panel-late.png`

## 终端滚动条跟随最新输出（分屏场景）
目标：在自定义分屏/频繁 reflow 场景下，终端如果原本在底部，重排后应保持在最新输出，不再卡在历史位置。

### Acceptance
- [x] 终端在底部时触发 reflow/reload，滚动条仍在底部（最新输出可见）
- [x] 终端不在底部时触发 reflow/reload，保留用户当前阅读位置
- [x] reflow 早返回路径不会残留旧滚动状态（避免后续错误跳转）

### Verify
- [x] `npm test -- --run`
- [x] `npm run dev:fresh`（启动成功，无明显运行时报错）

## 终端语音播报：opencode 只读最终答复
目标：在使用 `opencode`（OpenCode）时，语音播报只读“AI 最终正式回复正文”，不读 Thinking / tool / 状态 UI；并且在回复未闭合时不播报。

### Acceptance
- [x] opencode run：忽略 `Thinking:` 与工具块输出，只播报最终正文
- [x] opencode TUI：仅当 footer 显示 duration/`interrupted` 时才播报（避免读半截）

### Verify
- [x] `npm test -- --run frontend/app/block/tests/terminal-speech.test.ts frontend/app/block/tests/terminal-speech-play.test.ts`

### Notes
- `docs/内部记录/需求/terminal-speech-opencode.md`

## Servers 面板：列对齐修复（右侧列不抖动）
目标：Servers 列表在每行右侧存在/不存在操作按钮时，**列位置不应发生横向抖动**；看起来像表格一样稳定对齐。

### Acceptance
- [x] 右侧操作列固定宽度，避免 auto 宽度导致的列位移

## Completion
- [ ] ALL_TASKS_COMPLETE

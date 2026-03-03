# Dev Loop TODO

## Goal
让左侧『墙』成为统一入口，并且能**自动甄别**走 PVE 还是远控平台：
- 已配置远控平台（`wall:url` / `WAVETERM_WALL_URL`）→ 打开远控平台页面
- 未配置远控平台 → 回退打开 **PVE 屏幕墙**（展示/操作 PVE VM）

## Acceptance
- [ ] 配置了 `wall:url` 时：点击左侧『墙』打开远控平台页面（不白屏）
- [ ] 未配置 `wall:url` 时：点击左侧『墙』回退打开 **PVE 屏幕墙**（并提示“未配置远控平台，已回退到 PVE 屏幕墙”）
- [ ] 左侧『PVE』按钮默认打开 **PVE 屏幕墙**（不是普通浏览器页）
- [ ] 屏幕墙成员为空时：自动回退展示全部 VM，并在 UI 上提示“自动/未配置成员”（不白屏、不沉默）
- [ ] 打开 **PVE 管理 UI** 时：首次保存凭据后可自动登录（不反复弹登录页）

## Verify
- [x] `npm test -- --run`
- [x] `npm run dev:fresh`（手测 + 截图证据 `.tmp/dev-captures/`）
  - `.tmp/dev-captures/2026-03-03T03-04-20-238Z-gui-toggle-demo.png`
  - `.tmp/dev-captures/2026-03-03T03-04-29-240Z-pve-screenwall-late.png`

## Tasks
- [x] 左侧『墙』按钮改为 `openWallInNewTab()`（远控优先；未配置则回退 PVE）
- [x] 更新 UI 文案：『墙』= 远控优先 + PVE 回退
- [x] 更新 `docs/内部记录/需求/wall-remote-access.md`（写清分流规则与配置项）
- [x] 跑 `npm test -- --run`
- [x] 用 `npm run dev:fresh` 手测并留截图证据（`.tmp/dev-captures/`）

## Backlog（规划/留档）
- 远程/普通服务器统一墙：主线定为「远控平台（Web）+ Guacamole 网关（RDP/VNC/SSH）+ 可选反向隧道 agent」
  - 设计记录：`docs/内部记录/需求/remote-wall-plan.md`

## Servers 面板（行按钮条）
目标：Servers 列表每行左侧提供按钮条，顺序 `初始化` → `SSH` → `VNC` → `RDP`；并按组展示 `PVE` / `其他服务器`；右键提供常用动作。

### Acceptance
- [x] 远程条目分组：`PVE` / `其他服务器`
- [x] 行内按钮条：`初始化`、`SSH`、`VNC`、`RDP`（列对齐、像表格）
- [x] 右键菜单：SSH、断开连接；PVE VM 额外提供开机/关机/强制关机

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

## Completion
- [ ] ALL_TASKS_COMPLETE

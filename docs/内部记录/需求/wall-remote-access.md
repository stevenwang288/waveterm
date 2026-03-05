# 「墙」（屏幕墙）分流：墙=屏幕墙，PVE=管理 UI

> 现状（2026-03-03）：左侧「墙」按钮打开 **屏幕墙**（PVE Fast Path，默认只显示 Running）。左侧「PVE」按钮打开 **PVE Web 管理界面**（支持自动登录持久化）。普通远程服务器的 `SSH/VNC/RDP` 入口在 Servers 面板行内按钮里（优先 per-conn URL，未配置则回退到全局 `wall:url`）。

## 1. 背景与目标
- 早期需求：只控制本地局域网内的 PVE（Proxmox VE），尽量保持与 PVE 原生体验一致（低延迟、接近原生点击/键盘交互）。
- 近期/后续需求：扩展到**控制远程/普通服务器**（不仅限于 PVE VM），希望统一入口覆盖“缩略图墙 → 点击进入控制 → 退出回墙”的工作流。

## 2. 术语与边界
- **PVE Fast Path**：Wave 内置的 PVE 链路（PVE API + ticket/vncwebsocket/noVNC 等），用于性能与稳定性。
- **PVE 屏幕墙**：Wave 的 `pvescreenwall` 视图（面向 PVE VM/LXC 的墙式预览与操作）。
- **远控平台 / 远控墙**：面向普通服务器/远程资产的统一入口，协议栈可能包含 RDP/VNC/SSH 等。
- **agent（远控 agent）**：远控平台的“被控端常驻服务/探针/中继组件”等（用于设备注册、打洞、中继、屏幕/键盘鼠标采集等）。**这里的 agent 不是 AI。**

## 3. 分流规则（如何“甄别目标服务器是 PVE 还是远程服务器”）
> 规则要点：**PVE 走 PVE Fast Path；普通服务器走远控平台。**

### 3.1 左侧按钮行为（用户看到的）
- 点击左侧 **「墙」**：
  - 打开 **屏幕墙**（展示/操作 PVE VM/LXC 的预览；默认仅显示 Running，不会自动启动未开机的）。
- 点击左侧 **「PVE」**：打开 **PVE 管理 UI**（Web 管理界面）。
- 普通远端服务器的 GUI/协议入口：在 **Servers 面板**里通过行内 `SSH / VNC / RDP` 按钮进入（不是左侧「墙」按钮）。

### 3.2 逻辑层面的“甄别”
- **PVE 目标**：由 Wave 内置 PVE 配置与链路承载（PVE API / noVNC relay）。该链路用于局域网 PVE，以获得更接近原生的交互性能。
- **远程/普通服务器目标**：由外部远控平台承载（RDP/VNC/SSH/agent 等），Wave 负责在「墙」中打开该平台。

## 4. 远控平台 URL 配置（避免反复问）
Wave 按优先级取远控平台 URL：
1) `settings.json` → `wall:url`
2) 环境变量 → `WAVETERM_WALL_URL`（兼容旧方式）

`settings.json` 为顶层扁平 key（使用 `:` 分隔层级）：
```json
{
  "wall:url": "http://192.168.1.100:8080",
  "wall:tabname": "远控墙",
  "wall:webpartition": "persist:screen-wall"
}
```

字段说明：
- `wall:url`：远控平台首页 URL（必须是完整 URL，包含协议如 `http://`）。
- `wall:tabname`：打开标签页显示名（默认“墙”）。
- `wall:webpartition`：Electron WebView partition（用于持久化登录态/隔离 cookie/session）。

## 5. 每台服务器的协议覆盖（connections.json，可选）
当你需要“同一个服务器/资产”在 `VNC/RDP/SSH` 按钮里直达某个 URL（例如 Guacamole 的直连地址）时，可以把 URL 写在该连接条目的 meta map 中：
- `wall:sshurl`
- `wall:vncurl`
- `wall:rdpurl`

行为：
- Servers 面板行内按钮优先使用上述 per-conn URL；若未配置，则回退到全局 `wall:url`（打开远控平台首页）。

注意：这些键只保存 URL，不保存账号/密码/token。

## 6. 代码指针（便于后续维护）
- 左侧「墙」按钮 wiring：`frontend/app/workspace/widgets.tsx`（`openScreenwall -> openWallInNewTab`）
- 左侧「PVE」按钮 wiring：`frontend/app/workspace/widgets.tsx`（`openPve -> openPveUiInNewTab`）
- 「墙」打开的屏幕墙：`frontend/util/clilayout.ts`（`openWallInNewTab()`，打开 `pvescreenwall`）
- PVE 屏幕墙（Fast Path）：`frontend/app/view/pve/pvescreenwall.tsx`（默认 `onlyRunning=true`）
- PVE 管理 UI：`frontend/util/clilayout.ts`（`openPveUiInNewTab()`，缺少凭据时会弹出保存凭据的 modal）
- settings schema：`schema/settings.json`（`wall:*` / `wall:url` / `wall:tabname` / `wall:webpartition`）
- Servers 面板的协议入口（远端服务器 / per-conn URL）：`frontend/app/workspace/servers-panel.tsx`（`openRemoteWallForProtocol()` / `openWallUrlInSplit()`）

## 7. 远端服务器怎么做（避免再问）
远端服务器（RDP/VNC/SSH + 可选 agent）的主线方案单独记录在：
- `docs/内部记录/需求/remote-wall-plan.md`

## 8. PVE 登录态持久化（避免每次都要手动登录）
目标：打开 PVE Web 管理界面时，**不反复弹登录页**。

设计约束：
- **不把账号/密码写进 repo、文档或 AI 记忆**。
- 凭据只在本机保存，并使用 Electron `safeStorage` 加密。

实现要点：
- `emain/pve-auth.ts`
  - `storePveCredentials(host, username, password)`：写入加密后的 `pve-auth.json`（位于 Wave config dir）。
  - `ensurePveAuth({partition, origin, lang})`：若有凭据则调用 PVE `/access/ticket` 获取 `PVEAuthCookie` 并注入到对应 WebView partition。
- `frontend/util/clilayout.ts`
  - `openPveUiInNewTab()`：先 `pveEnsureAuth()`，如返回 `missing credentials` 则弹出「PVE 自动登录」modal，保存后重试自动登录。
- `frontend/app/modals/pvecredentialsmodal.tsx`：用户在 UI 里输入一次后，后续自动登录。

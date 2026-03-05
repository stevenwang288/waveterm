# Servers 面板：PVE 分组 + 按钮条 + 对齐 + 右键操作（2026-03-03）

目的：把「Servers」列表的体验做得更像“表格/资产列表”，并且能在列表里直接区分 PVE 虚拟机与普通服务器，同时提供常用右键操作（开机/关机/注销）。

## 1. UI 行为

位置：左侧 `Servers` 面板（本机/远程连接列表）。

### 1.1 分组
- 远程列表分两组：
  - `PVE`：能映射到 PVE VM 的条目（见 “2. 甄别规则”）。
  - `其他服务器`：其余远程条目。

补充（容易反复忘）：**PVE 宿主机（例如 `10.20.0.250`）不是 VM**，因此不会出现在 `PVE` 组里；它应该作为一个普通 SSH 连接出现在 `其他服务器` 组，并且必须通过**配置**管理：
- 推荐：在 `connections.json` 里新增/维护一个连接条目（或在 Servers 面板用“添加服务器”生成该条目），不要在代码里硬编码。
- 如需固定排序到最前/最后：使用 `connections.json` 的 `display:order`（数字越小越靠前）。

### 1.2 列对齐（表格感）
每行固定列（从左到右）：
1) **按钮条**：`初始化` → `SSH` → `VNC` → `RDP`
2) 名称列（PVE 显示 `vmname #vmid`；普通服务器显示 `host[:port]`）
3) 状态列（右对齐）：
   - PVE VM：`running` / `stopped`
   - 其他服务器：`online` / `offline`（来自 TCP check；不代表已登录）
4) 来源列（右对齐）：仅当 `source=discovered` 时显示 `自动发现`
5) 用户列（SSH user，右对齐，固定宽度）
6) 行内操作列（编辑/删除 或 “加入已管理”）

补充（避免反复误会）：
- `自动发现` 来自后端 `ConnListCommand` 的 discovered 列表（历史连接 / ssh config）。
- 默认隐藏“其他服务器”里的 discovered 项；在 Servers 面板空白处右键 → `显示自动发现服务器` 可展开。

交互细节：
- 行内操作列按钮在未 hover 时 `opacity:0` 且 `pointer-events:none`，避免“看不见的按钮吃掉整行点击”。
- 行本身 **左键不触发任何动作**；所有动作统一通过「按钮条」或「右键菜单」触发，避免误触。

### 1.3 行按钮条（初始化/SSH/VNC/RDP）
> 目标：不再进入“屏幕墙/协议选择反复问”的对话；直接在列表行上完成常用动作。

- `初始化`（魔杖/Spinner）：对该条目做“智能初始化”，写入/补全 `connections.json` 的元信息（见 2.2）。
  - 禁用规则：PVE VM 未 `running` 时禁用；其他服务器离线时禁用。
- `SSH`（终端）：打开 Wave 终端块（`term` view，使用该连接）。
  - 禁用规则：连接名为空时禁用；PVE VM 未 `running` 时禁用；其他服务器离线时禁用。
- `VNC`（桌面）：
  - 若是 PVE VM：走 **PVE Fast Path**，打开 `pveconsole`（noVNC relay）
  - 若是其他服务器：走远控平台（`wall:url`）或 per-conn 覆盖 `wall:vncurl`
  - 打开方式：在**当前 Tab**里对当前聚焦 block 做**右侧分屏**（不是新开标签页）
  - 禁用规则：PVE VM 未 `running` 或 `hasGui=false` 时禁用；其他服务器离线时禁用；以及未配置远控平台且未配置 `wall:vncurl` 时禁用。
- `RDP`（窗口）：
  - 若是其他服务器：走远控平台（`wall:url`）或 per-conn 覆盖 `wall:rdpurl`
  - 打开方式：同 VNC（当前 Tab 右侧分屏）
  - 若是 PVE VM：**默认禁用**；只有显式配置了 `wall:rdpurl` 才允许点击（并且要求 `running + hasGui`）

### 1.3 右键菜单
对远程条目右键：
- `SSH`：打开 SSH 终端（Wave term block）
- `初始化`：执行智能初始化（写回 `connections.json`，见 2.2；在线才可用）
- `VNC`：PVE VM 走 `pveconsole`；其他服务器走远控墙（`wall:url` 或 per-conn 覆盖 `wall:vncurl`）
- `RDP`：其他服务器走远控墙（`wall:url` 或 per-conn 覆盖 `wall:rdpurl`）
- `注销（断开连接）`：断开该连接
- 若是 PVE VM（可甄别）：
  - `开机`（start）
  - `关机`（shutdown）
  - `强制关机`（stop）
- 若是已管理条目：额外提供 `编辑服务器` / `删除`
- 若是自动发现条目：额外提供 `添加到已管理列表`

### 1.4 批量开机（PVE）
在 `Servers` 面板头部提供 `电源` 图标（以及面板空白处右键菜单同名入口）：
- `开机（全部）`：对当前 `PVE` 组里 **非 running** 的条目批量触发 `start`（会先弹确认框）

### 1.5 PVE 设置入口（避免反复问“PVE 信息怎么填”）
- `PVE` 分组标题后提供一个小的“编辑”图标（笔）：点击打开 **PVE 设置**弹窗。
- `Servers` 面板空白处右键菜单也提供 `编辑 PVE 设置` 入口（即便 PVE 组暂时为空也能配置）。

弹窗内容：
- **PVE API 配置（Wave 用于拉 VM 列表/开关机）**：写入 secretstore（可在 `WaveConfig → Secrets` 中查看/管理）。
  - `PVE_ORIGIN`：例如 `https://192.168.1.250:8006`
  - `PVE_TOKEN_ID`：例如 `root@pam!wave`
  - `PVE_TOKEN_SECRET`
    - 不回显旧值；若已存在可留空表示“不修改”
  - `PVE_VERIFY_SSL`：`true/false`
- **PVE Web UI 自动登录**：提供按钮打开凭据弹窗（用于 `openPveUiInNewTab()` 的自动登录持久化）。

## 2. 甄别规则（PVE vs 其他服务器）
当前实现为“PVE 清单为准 + 连接尽力附着”：
- **PVE 组的来源**：前端获取 `/wave/pve/vms` 的 VM 列表（包含 `qemu` + `lxc`），并默认过滤 `template=true` 的模板（模板不作为“可连接的机器”展示）。
- **其他服务器组的来源**：`ConnListCommand` 返回的连接列表中，无法映射到任何 PVE VM 的条目。
- **连接→VM 的映射用途**：当某个连接能映射到 VM 时，把该连接“附着”到 VM 行上，从而让 VM 行具备 `SSH/初始化` 等基于连接的能力；否则 VM 行仍可用 `开机/关机/VNC(PVE)` 等纯 PVE 动作。

### 2.1 `hasGui` 的来源（决定 GUI 图标是否显示）
`/wave/pve/vms` 会返回每个 VM 的 `hasGui`：
- `lxc`：固定 `hasGui=false`
- `qemu`：优先通过 PVE API 的 VM config 推断（`/nodes/<node>/qemu/<vmid>/config` 的 `vga`）
  - `vga=serial*` / `vga=none*` → `hasGui=false`
  - 其余 → `hasGui=true`
- 若本机存在 `pve-ui` sqlite db（可选），仍会用于补全 `screenwall_enabled`/`ip_address` 等元信息；但 GUI 判断不依赖它（避免 db 缺失/过期导致误判）。

连接映射为“最佳努力”策略：
- 对每个连接（connName + connections.json 的 ssh:hostname 等元信息）尝试匹配 VM：
  - 若连接 meta 显式包含 `pve:vmid` / `pve:node`：优先按 vmid（+可选 node）精确匹配
  - 若 connName/hostname/解析出的 host 里能解析出 IPv4：优先按 `vm.ipAddress` 精确匹配（避免“IP 尾号≠vmid”导致误分组）
  - 先尝试解析 vmid（数字、IP 最后一段、#123、尾号等）
  - 再按名称匹配（包含/被包含）
- 匹配成功则把该连接附着到 VM 行（VM 行展示 `node/name/vmid/status/hasGui`，并继承该连接的 `ssh:user` 等信息用于展示与操作）。

### 2.2 初始化写入的连接元信息（避免再次遗忘）
`初始化` 会把信息写回 `connections.json`（连接条目的 meta map），用于：对齐展示、减少重复输入、为后续协议/墙分流提供依据。

写入键（均已加入 `schema/connections.json`）：
- `ssh:hostname` / `ssh:user` / `ssh:port`：从 connName/表单解析并补全（仅在缺失时写入）
- `remote:clientos` / `remote:clientarch` / `remote:homedir`：通过 `RemoteGetInfo` 获取（若是 PVE VM 则跳过）
- `remote:hasgui`：Windows/macOS 推断为 true；PVE VM 则用 `hasGui`
- `remote:initts`：初始化时间戳（毫秒）
- `pve:vmid` / `pve:node`：当条目已映射到 PVE VM 时写入（用于后续更强的显式识别）

> 注意：不写入任何凭据/secret。PVE token/secret 仍在 secretstore（`secrets.enc`）中管理。

## 3. PVE 开关机 API（Wave 内置）
新增接口：
- `POST /wave/pve/vm-action`

请求体：
```json
{ "node": "pve-node-name", "vmid": 101, "action": "start|shutdown|stop", "type": "qemu|lxc" }
```

返回体：
```json
{ "upid": "UPID:..." }
```

实现限制：
- 依赖 Wave 的 PVE 配置（token/secret/verifyssl）能正常调用 PVE API；
- `shutdown` 为“优雅关机”（ACPI），`stop` 为强制停止。

## 4. 代码指针
- 前端：
  - `frontend/app/workspace/servers-panel.tsx`
  - i18n：`frontend/locales/zh-CN/translation.json`、`frontend/locales/en/translation.json`
  - connections schema：`schema/connections.json`
- 后端：
  - 路由：`pkg/web/web.go`
  - handler：`pkg/web/pve.go`（`handlePveListVMs`、`handlePveVmAction`）
  - PVE client：`pkg/pve/client.go`（`GetVmConfig`、`VmStatusAction`）
  - GUI 推断：`pkg/pve/pveui_meta.go`（`InferHasGuiFromVmConfigMap`）

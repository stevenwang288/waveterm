# dev:fresh 配置与凭据持久化（Windows）

日期：2026-03-03

## 目的
在不影响用户正在使用的正式 Wave（生产 profile）的前提下，提供一个“隔离但可持续迭代”的开发版启动方式：
- 配置可在 dev runs 间复用（例如 `wall:url`、connections 列表）
- **PVE 自动登录等 secret（`secrets.enc`）也能在 dev runs 间复用**，避免每次都要重配/重输

入口脚本：`scripts/run-dev-fresh.ps1`（对应 `npm run dev:fresh`）

## 目录约定
每次运行会创建新的 run 目录：
- `.tmp/dev-fresh/<runId>/config`
- `.tmp/dev-fresh/<runId>/data`

同时维护一个稳定的 seed：
- `.tmp/dev-fresh/_seed/config`：作为 config seed（包含 `secrets.enc`）
- `.tmp/dev-fresh/_seed/electron-userdata`：作为 **稳定的 Electron userData**（safeStorage 相关）

## 为什么需要稳定的 Electron userData
Wave 的 secretstore（`secrets.enc`）依赖 Electron `safeStorage`/userData 相关密钥。

如果每次 dev:fresh 都使用全新的 Electron userData 目录，则：
- 上一次 run 写入的 `secrets.enc` 可能无法在下一次 run 解密
- 进而导致 PVE 自动登录、PVE 集成等功能表现为“反复要输入/甚至直接失效”

因此 dev:fresh（在默认启用 seed 时）会复用 `.tmp/dev-fresh/_seed/electron-userdata` 作为 Electron userData，从而让 `secrets.enc` 可跨 run 解密与复用。

## 首次启用稳定 userData 的安全处理
如果检测到这是“第一次使用稳定的 electron-userdata”：
- 会删除 seed config 里的旧 `secrets.enc`（避免旧 secrets 由不同密钥加密导致解密失败）
- 之后用户在 dev build 里重新输入一次凭据即可；后续 dev runs 会持久化复用

## 想要完全一次性（不持久化）的方式
`run-dev-fresh.ps1` 支持 `-NoSeed`：
- 不使用 `_seed/config`
- 使用每次 run 自己的 `electron-userdata`
- 适合做“纯净复现 / 不希望任何持久化”的场景

示例：
`npm run dev:fresh -- -NoSeed`

## 并行运行（不顶掉用户正在用的正式 Wave）
dev:fresh 会设置 `WAVETERM_ELECTRON_USER_DATA_HOME` / `WAVETERM_CONFIG_HOME` / `WAVETERM_DATA_HOME`，使开发版使用完全隔离的目录。

为确保在 Windows 上能与用户正在使用的正式 Wave 并行运行（不触发“单实例锁”导致 dev 直接退出），主进程在检测到 `WAVETERM_ELECTRON_USER_DATA_HOME` 时会跳过 `requestSingleInstanceLock`（仅 sidecar/dev:fresh 场景）。

## FreshElectron：只换 userData，不换 config seed
在某些情况下，`_seed/electron-userdata` 可能会被残留进程占用（例如 `lockfile` 仍被打开），导致新一轮 dev:fresh 复用该 userData 时启动失败。

为此 `run-dev-fresh.ps1` 支持 `-FreshElectron`：
- 仍使用 `_seed/config` 作为 config seed（保留服务器列表/墙配置等）
- 但 Electron userData 改为每次 run 使用 `<runId>/electron-userdata`（避免锁冲突）

代价：
- safeStorage key 不固定，`secrets.enc` **不保证**跨 run 可解密
- 适合 smoke test / 自动截图验证（不依赖 secret 持久化）

示例：
`npm run dev:fresh -- -FreshElectron`

## 注意事项
- `.tmp/` 为本地一次性产物（gitignore），不应进入版本库。
- **不要把账号/密码/token 写进 repo/文档/AI 记忆**；只应通过 UI 输入并由本机 secretstore 加密保存。

# Windows：版本一致性与 TTS 端口排查（2026-02-25）

本文件用于解决一类高频误判：**“我已经装了新包，但行为完全不像你说的”**。根因通常是：
- 旧版进程还在后台跑（或安装没覆盖成功）
- 同版本号但不同 BuildTime 的二进制混用
- `127.0.0.1:5050/5051` 被错误进程占用，导致 TTS 请求被接走

## 1) 先确认：你现在到底在跑哪一个 WAVE？

### A. 已安装版（Programs\WAVE）
- 程序路径：`%LOCALAPPDATA%\Programs\WAVE\WAVE.exe`
- 后端路径：`%LOCALAPPDATA%\Programs\WAVE\resources\app.asar.unpacked\dist\bin\wavesrv.x64.exe`

### B. 仓库 dev（electron-vite）
- 通过 `npm run dev` / `npm run dev:fresh` 启动
- 后端通常来自仓库 `dist/bin/wavesrv.x64.exe`

### C. 免安装 sidecar（win-unpacked）
- 通过 `make/<version>/win-unpacked/WAVE.exe` 直接运行（不安装）
- 适合做“和已安装版隔离”的对照测试

## 2) 用 BuildTime 锁死“是不是同一套”

PowerShell 执行（示例）：

```powershell
go version -m "$env:LOCALAPPDATA\Programs\WAVE\resources\app.asar.unpacked\dist\bin\wavesrv.x64.exe" | Select-String BuildTime
go version -m ".\dist\bin\wavesrv.x64.exe" | Select-String BuildTime
```

判定规则：
- 两者 BuildTime 不同：**行为可能完全不同**（即使版本号一样）
- 安装态 BuildTime 旧：先彻底退出 WAVE（别留后台）再重新安装

## 3) TTS 端口冲突：一眼确认“谁占了 5050/5051”

```powershell
Get-NetTCPConnection -LocalPort 5050,5051 | Select-Object LocalPort,State,OwningProcess
Get-Process -Id <OwningProcess> | Select-Object Id,ProcessName,Path,MainWindowTitle
```

判定规则：
- 你在设置里选“本地/Edge TTS”且 Endpoint 留空时，前端会默认请求 `5050`（Edge）/`5051`（Melo）。
- 如果 `5050/5051` 被旧版 WAVE 占用：新启动的 dev/sidecar 会把请求打到旧版上，表现为“设置没生效/音质很差”。

## 4) 推荐的“可重复工作流”（避免再乱）

### A. 开发态（隔离配置，避免脏状态）
```powershell
npm run dev:fresh
```
特点：
- 每次运行都会在仓库 `.tmp/dev-fresh/<runId>/` 下生成独立 config/data
- 输出会写入 `dev.log`（方便回看）

### B. 免安装 sidecar（隔离于已安装版）
```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-wave-sidecar.ps1 .\make\0.14.0-7\win-unpacked\WAVE.exe
```
特点：
- 使用独立的 Electron userData/config/data，不会抢占已安装版的单实例锁

### C. 需要留证据时（抓 stdout/stderr）
```powershell
powershell -ExecutionPolicy Bypass -File scripts/run-wave-sidecar-captured.ps1 .\make\0.14.0-7\win-unpacked\WAVE.exe -KeepRunning
```

## 5) TTS 播报日志（判断到底读了什么/用的哪个 endpoint）

```powershell
powershell -ExecutionPolicy Bypass -File scripts/show-tts-log.ps1 -Tail 60
```

重点看字段：
- `endpoint`：是否是你预期的本地服务地址
- `model` / `voice`：是否与设置一致
- `text`：是否出现 reconnect/502/进度噪声（属于需要过滤/禁播的内容）


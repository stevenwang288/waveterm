# Windows 回归验证（WaveCN）

本文件用于在 Windows 上打包后做一轮快速回归，避免“能打包但运行/交互已坏”的情况。

## 1) 打包

在仓库根目录执行：

```powershell
task package
```

产物位于 `make/`，例如：
- `make/WaveCN-win32-x64-<version>.exe`（安装包）
- `make/win-unpacked/WaveCN.exe`（免安装目录）

## 2) 自动烟雾测试（推荐每次都跑）

```powershell
powershell -ExecutionPolicy Bypass -File scripts/smoke-win.ps1
```

说明：
- 脚本默认启动 `make/win-unpacked/WaveCN.exe`，并将 `WAVETERM_CONFIG_HOME` / `WAVETERM_DATA_HOME` 指向临时目录，避免污染你真实配置。
- 只验证“能启动且不会秒退”，不覆盖 UI 交互验收。

## 3) 手工 UI 重点验收（建议 2–3 分钟）

- **布局/分屏**：布局侧边栏能打开；点 2/3/4/6/8/9 分屏会新开标签页；保存/恢复正常。
- **路径标题**：每个分屏标题显示“路径最后一段”（远程连接显示服务器名）；双击标题空白处可放大/缩小。
- **未读提示**：终端输出/BEL 后该分屏标题出现未读高亮；聚焦后恢复；右下角通知点击可跳转到对应标签页+分屏。
- **右键菜单**：终端右键“加入布局/收藏/用指定 AI 打开/翻译”可用。
- **快捷键**：`Alt+1..9` 能切换标签页；放大/缩小按钮可用。
- **滚轮**：鼠标滚轮逐行滚动（触控板保持平滑）。

# Wave Terminal 旧版（waveterm-local） vs 新版（wavetermdev/waveterm upstream）功能差异清单

> 旧版: stevenwang288/waveterm-local (commit 4132248, 0.14.0-15)
> 新版: wavetermdev/waveterm upstream/main (最新官方版)
> 对比日期: 2026-08-19

---

## ✅ 已完成：汉化 (i18n) 已迁移到新版

| 模块 | 文件 | 状态 |
|------|------|------|
| i18n 基础设施 | i18next + react-i18next 依赖 | ✅ 已安装 |
| 前端 i18n 初始化 | frontend/app/i18n.ts | ✅ 已创建 |
| 主进程 i18n 初始化 | emain/i18n-main.ts | ✅ 已创建 |
| 翻译文件 (en) | locales/en/translation.json (30+ 命名空间) | ✅ 已复制 |
| 翻译文件 (zh-CN) | locales/zh-CN/translation.json (完整汉化) | ✅ 已复制 |
| 公开翻译文件 | public/locales/en + zh-CN | ✅ 已复制 |
| 主菜单汉化 | emain/emain-menu.ts (全部菜单项) | ✅ 已完成 |
| 退出对话框汉化 | emain/emain.ts | ✅ 已完成 |
| 前端入口加载 | frontend/app/app.tsx | ✅ 已完成 |
| i18n 扫描脚本 | scripts/i18n-scan-visible.cjs | ✅ 已复制 |
| 待办: 前端 UI 全量翻译 | 65 文件, 507 字符串 | 🔄 进行中 |

---

## 📋 旧版独有功能清单（新版无）

### 1. 语音朗读 (TTS) — 大模块
- **终端语音朗读**: frontend/app/block/terminal-speech.ts (1496行)
- **AI 语音朗读**: frontend/app/aipanel/aispeech.ts (382行)
- **语音运行时**: frontend/app/aipanel/speechruntime.ts (466行)
- **语音设置面板**: frontend/app/view/waveconfig/speechsettingscontent.tsx (441行)
- **自动播放**: frontend/app/aipanel/aipanel-autoplay.ts (88行)
- **本地 Edge TTS**: emain/local-tts-edge.ts (91行)
- **测试文件**: 6个测试文件, smoke 脚本 (smoke-local-tts-sidecar.ps1, smoke-waveai-tts-cdp.mjs 等)
- **后端**: pkg/waveai/ 下的 AI 后端 provider

### 2. 收藏夹 (Favorites) 系统
- favorites.tsx (366行), favorites-bar.tsx (122行), favorites-model.ts (282行)
- 收藏夹面板 + 右键菜单 "添加到收藏夹"

### 3. 路径历史 (Path History) 面板
- path-history-panel.tsx (204行), local-path-history-model.ts (254行)
- 终端路径自动追踪 (cwdlabel.ts, launchcwd.ts)

### 4. 服务器管理面板 (Servers Panel)
- servers-panel.tsx (1097行), servers-refresh.ts (298行)
- 远程服务器发现、CRUD、PVE 自动同步

### 5. PVE 远程管理
- pve-auth.ts (1125行) — PVE 认证/API 交互
- pvevnc.tsx (238行) — PVE VNC 桌面
- remote-gui.ts (113行) — 远程 GUI 切换
- connectionbutton-* (3 文件) — 连接按钮组件

### 6. Codex 集成
- codex-resume.ts (235行), codextranslate-modal.tsx (90行)
- codexconfig.go (383行) — Go 后端 Codex 配置
- workbench-integrations.ts (732行) — 工作台集成

### 7. Goose 集成
- goose-runtime.ts (360行), goose.tsx (88行)
- preload-goose.ts (287行), goose-promptoptimizer-bridge.ts (319行)

### 8. Prompt Optimizer
- promptoptimizer.tsx (86行), promptoptimizer-bridge.ts (8行)

### 9. 通知系统 (Notification)
- notificationbubbles.tsx (82行), notificationitem.tsx (111行)
- notificationpopover.tsx (111行), updatenotifier.tsx (100行)
- usenotification.tsx (164行)

### 10. 文件资源管理器 (Explorer)
- explorer-directory.tsx (2134行) — 自研文件管理器
- 文件操作: 复制/移动/重命名/覆盖确认

### 11. 工作台 (Workbench) 重写
- workbench.tsx (5634行) — 大模块重写
- workbench-agent-layout/spec, workbench-gateway, workbench-integrations
- workbench-input-parser/types, workbench-mode, workbench-router, workbench-scroll
- workbench-source.ts (145行)

### 12. 中文输入法优化
- composition-input.ts (227行) — 中文合成输入处理

### 13. 自定义主题色
- accent-color.ts (109行), logo-color.ts (103行)
- 自定义 Logo 颜色 + 主题颜色

### 14. CC Switch 同步
- ccswitch-sync.ts (547行) — Claude Code Switch 同步

### 15. 终端增强
- term-scroll.ts (98行), term-cache.ts (24行)
- term-settings-menu.ts (591行) — 终端设置菜单
- terminal-speech.ts (1496行) — 终端朗读

### 16. 布局预设 (Layout Presets)
- clilayout.ts (377行) — 快速分屏布局保存/恢复

### 17. 业务✖️ 你真棒

### 18. 浏览器嵌入式 URL 工具
- embedded-browser-url.ts (27行)
- new-window-utils.ts, site-preferences.ts, title-utils.ts, url-utils.ts

### 19. schema-summary.ts
- Monaco 编辑器 Schema 摘要

### 20. i18n 扫描脚本
- i18n-scan-visible.cjs (210行) — 自动扫描未汉化文本

### 21. Windows 构建/发布脚本
- build-backend-windows.ps1 (161行), release-win.ps1 (70行)
- wave-windows-common.ps1 (295行), dev-instance.ps1 (812行)
- smoke-win.ps1, run-wave-sidecar.ps1 等

### 22. 后端 AI Provider (pkg/waveai/)
- anthropicbackend.go (316行), cloudbackend.go (135行)
- codexconfig.go (383行), googlebackend.go (117行)
- openaibackend.go (847行), perplexitybackend.go (193行)
- waveai.go (155行)

### 23. 其他后端新增
- tabindicator.go (88行) — 标签页指示器
- settingsconfig_test.go (97行)
- blockcontroller cwd 测试

---

## 📝 旧版移除/简化的功能（新版有）

| 功能 | 旧版状态 | 说明 |
|------|----------|------|
| preview/ 预览系统 | 旧版删除 | 新版有独立的 preview 目录 |
| tabcontextmenu.ts | 旧版删除 | 合并进 tab.tsx |
| treeview.tsx | 旧版删除 | 新版有树视图组件 |
| vtab/vtabbar 虚拟标签 | 旧版删除 | 新版保留 |
| processviewer (Go) | 旧版删除 | pkg/wshrpc/wshremote/processviewer.go |
| badge 系统 | 旧版不同 | 新版有 badge 模块 |
| wshcmd-tab.go | 旧版删除 | 新版有 wsh tab 命令 |

---

## 🔄 迁移建议

### 高优先级（建议迁移）
1. **汉化 i18n** — ✅ 已完成基础设施，📋 前端 UI 翻译进行中
2. **Windows 构建脚本** — 新版 Windows 构建体验需要这些脚本
3. **终端增强** (term-settings-menu, term-scroll) — 用户体验提升明显

### 中优先级（可选）
4. **收藏夹** — 实用功能，但不算核心
5. **路径历史** — 导航辅助
6. **通知系统** — 升级通知等

### 低优先级（依赖特定生态）
7. **PVE 集成** — 如果你用 PVE 才需要
8. **Codex/Goose 集成** — 如果你用这些 AI 工具
9. **CC Switch 同步** — 如果你用 Claude Code Switch
10. **TTS 语音朗读** — 如果需要语音功能
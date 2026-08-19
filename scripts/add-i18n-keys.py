#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""添加 onboarding 升级通知 v0140/v0141/v0142/v0144/v0145 + durable + starask 的翻译 key"""
import json, io, sys, copy

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

REPO = r"D:\OneDrive\steven\code\ai\13IDE\wave"

EN = {
    "v0140": {
        "summary": "Wave v0.14 introduces Durable Sessions. Enable them to keep your remote sessions alive through network interruptions, computer sleep, and restarts — they'll automatically reconnect when your connection is restored.",
        "durableSessions": {
            "title": "Durable SSH Sessions",
            "seeDocs": "[see docs]",
            "bullet1": "<0>Session Protection</0> - Programs and shell state survive disconnects",
            "bullet2": "<0>Visual Status Indicators</0> - Shield icons show status",
            "bullet3": "<0>Flexible Configuration</0> - Enable globally, per-connection, or per-terminal",
        },
        "connectionMonitoring": {
            "title": "Enhanced Connection Monitoring",
            "bullet1": "<0>Connection Keepalives</0> - Active monitoring with keepalive probes",
            "bullet2": "<0>Stalled Connection Detection</0> - Visual feedback for network issues",
        },
        "waveAi": {
            "title": "Wave AI Updates",
            "bullet1": "<0>Image Support</0> - Vision capabilities for BYOK providers",
            "bullet2": "<0>Stop Generation</0> - Ability to stop AI responses mid-generation",
            "bullet3": "<0>Improved Auto-scrolling</0>",
        },
        "terminal": {
            "title": "Terminal Improvements",
            "bullet1": "<0>Enhanced Context Menu</0> - Quick access to splits, themes, and more",
            "bullet2": "<0>OSC 52 Clipboard Support</0> - CLI apps can copy to system clipboard",
        },
    },
    "v0141": {
        "summary": "Wave v0.14.1 fixes several high-impact terminal bugs and adds new config options for focus, cursor style, and block navigation.",
        "terminalFixes": {
            "title": "Terminal Fixes",
            "bullet1": "<0>Claude Code Scroll Fix</0> - Fixed unexpected terminal scroll jumps",
            "bullet2": "<0>IME Fix</0> - Fixed Korean/CJK input losing or sticking characters",
            "bullet3": "<0>Scroll Position on Resize</0> - Terminal stays at bottom across resizes",
            "bullet4": "<0>Terminal Scrollback Save</0> - New context menu item and <1>wsh</1> command to save scrollback to a file",
        },
        "newConfig": {
            "title": "New Config Options",
            "bullet1": "<0>Focus Follows Cursor</0> - New <1>app:focusfollowscursor</1> setting (off/on/term)",
            "bullet2": "<0>Terminal Cursor Style &amp; Blink</0> - Configure cursor shape and blink per-block",
            "bullet3": "<0>Vim-Style Block Navigation</0> - Ctrl+Shift+H/J/K/L to navigate blocks",
            "bullet4": "<0>New AI Providers</0> - Added Groq and NanoGPT as built-in presets",
        },
    },
    "v0142": {
        "summary": "Wave v0.14.2 introduces a new block badge system for at-a-glance status, along with directory preview improvements and bug fixes. v0.14.3 is a patch release fixing a showstopper bug in onboarding.",
        "badges": {
            "title": "Block & Tab Badges",
            "bullet1": "<0>Block Badges Roll Up to Tabs</0> - Blocks can display icon badges (with color and priority) that are visible in the tab bar for at-a-glance status",
            "bullet2": "<0>Bell Indicator On by Default</0> - Terminal bell badge now lights up the block and tab when your terminal rings (controlled by <1>term:bellindicator</1>)",
            "bullet3": "<0><1>wsh badge</1></0> - New command to set or clear badges from the CLI. Supports icons, colors, priorities, and PID-linked badges",
            "bullet4": "<0>Claude Code Integration</0> - Use <1>wsh badge</1> with Claude Code hooks to surface AI task status as tab bar notifications",
            "seeDocs": "[see docs]",
        },
        "other": {
            "title": "Other Changes",
            "bullet1": "<0>[v0.14.3] </0>[bugfix] Fixed a showstopper onboarding bug",
            "bullet2": "<0>Directory Preview</0> - Improved mod time formatting, zebra-striped rows, better default sort, and YAML file support",
            "bullet3": "<0>Search Bar</0> - Clipboard and focus improvements",
            "bullet4": "[bugfix] Fixed \"New Window\" hanging on GNOME desktops",
            "bullet5": "[bugfix] Fixed \"Save Session As...\" focused window tracking bug",
        },
    },
    "v0144": {
        "summary": "Wave v0.14.4 introduces vertical tabs, upgrades to xterm.js v6, and includes bug fixes and UI improvements.",
        "verticalTabs": {
            "title": "Vertical Tab Bar",
            "bullet1": "<0>New Vertical Tab Bar Option</0> - Tabs can now be displayed vertically along the side of the window for more horizontal space. Toggle between horizontal and vertical layouts in settings.",
        },
        "terminal": {
            "title": "Terminal Improvements",
            "bullet1": "<0>xterm.js v6.0.0 Upgrade</0> - Improved terminal compatibility and rendering, resolving quirks with tools like Claude Code",
        },
        "other": {
            "title": "Other Changes",
            "bullet1": "<0>macOS First Click</0> - First click now focuses the clicked widget",
            "bullet2": "<0><1>backgrounds.json</1></0> - Renamed <1>presets/bg.json</1> to <1>backgrounds.json</1>",
            "bullet3": "<0>Config Errors Moved</0> - Config errors to the WaveConfig view for less clutter",
            "bullet4": "WaveConfig now warns on Unsaved Changes",
            "bullet5": "Preview streaming fixes for images/videos",
            "bullet6": "Deprecated legacy AI widget has been removed",
            "bullet7": "[bugfix] Fixed focus bug for newly created blocks",
        },
    },
    "v0145": {
        "summary": "Wave v0.14.5 introduces a new Process Viewer widget, several quality-of-life improvements, and a fix for creating new config files from the Settings widget.",
        "processViewer": {
            "title": "Process Viewer",
            "desc": "New widget that displays running processes on local and remote machines, with CPU and memory usage and sortable columns.",
        },
        "other": {
            "title": "Other Changes",
            "bullet1": "<0>Quake Mode</0> &mdash; global hotkey (<1>app:globalhotkey</1>) now toggles a Wave window visible and invisible",
            "bullet2": "<0>Drag &amp; Drop Files into Terminal</0> to paste their quoted path",
            "bullet3": "New <0>app:showsplitbuttons</0> setting adds split buttons to block headers",
            "bullet4": "Toggle the widgets sidebar on and off from the View menu",
            "bullet5": "F2 to rename the active tab",
            "bullet6": "Mouse back/forward buttons now navigate in web widgets",
            "bullet7": "<0>[bugfix]</0> Config files that didn&apos;t exist yet couldn&apos;t be created or edited from the Settings widget",
        },
    },
}

ZH = {
    "v0140": {
        "summary": "Wave v0.14 引入持久会话（Durable Sessions）。启用后，即使网络中断、电脑休眠或重启，你的远程会话也能保持存活——连接恢复后会自动重连。",
        "durableSessions": {
            "title": "持久 SSH 会话",
            "seeDocs": "[查看文档]",
            "bullet1": "<0>会话保护</0> - 程序和 Shell 状态在断开后依然保留",
            "bullet2": "<0>可视状态指示</0> - 盾牌图标显示会话状态",
            "bullet3": "<0>灵活配置</0> - 可全局、按连接或按终端启用",
        },
        "connectionMonitoring": {
            "title": "增强的连接监控",
            "bullet1": "<0>连接保活</0> - 通过保活探测主动监控连接",
            "bullet2": "<0>连接停滞检测</0> - 网络问题时有可视化反馈",
        },
        "waveAi": {
            "title": "Wave AI 更新",
            "bullet1": "<0>图像支持</0> - BYOK 提供方支持视觉能力",
            "bullet2": "<0>停止生成</0> - 可在 AI 回复生成中途停止",
            "bullet3": "<0>改进的自动滚动</0>",
        },
        "terminal": {
            "title": "终端改进",
            "bullet1": "<0>增强的右键菜单</0> - 快速访问分屏、主题等",
            "bullet2": "<0>OSC 52 剪贴板支持</0> - CLI 应用可复制到系统剪贴板",
        },
    },
    "v0141": {
        "summary": "Wave v0.14.1 修复了多个高影响的终端 Bug，并为聚焦、光标样式和块导航新增了配置选项。",
        "terminalFixes": {
            "title": "终端修复",
            "bullet1": "<0>Claude Code 滚动修复</0> - 修复终端意外滚动跳变",
            "bullet2": "<0>输入法修复</0> - 修复韩文/CJK 输入丢失或卡字符问题",
            "bullet3": "<0>调整大小时的滚动位置</0> - 调整大小时终端保持在底部",
            "bullet4": "<0>终端回滚保存</0> - 新增右键菜单项和 <1>wsh</1> 命令，可将回滚内容保存到文件",
        },
        "newConfig": {
            "title": "新增配置选项",
            "bullet1": "<0>光标聚焦跟随</0> - 新增 <1>app:focusfollowscursor</1> 设置（off/on/term）",
            "bullet2": "<0>终端光标样式与闪烁</0> - 可逐块配置光标形状和闪烁",
            "bullet3": "<0>Vim 风格块导航</0> - 使用 Ctrl+Shift+H/J/K/L 在块之间导航",
            "bullet4": "<0>新增 AI 提供方</0> - 内置 Groq 和 NanoGPT 预设",
        },
    },
    "v0142": {
        "summary": "Wave v0.14.2 引入新的块徽章系统，可一目了然查看状态，同时改进了目录预览并修复了 Bug。v0.14.3 是补丁版本，修复了 onboarding 中的一个致命 Bug。",
        "badges": {
            "title": "块与标签页徽章",
            "bullet1": "<0>块徽章汇总到标签页</0> - 块可显示图标徽章（带颜色和优先级），在标签栏中即可一目了然查看状态",
            "bullet2": "<0>响铃指示默认开启</0> - 终端响铃时，铃铛徽章会点亮块和标签页（由 <1>term:bellindicator</1> 控制）",
            "bullet3": "<0><1>wsh badge</1></0> - 新命令，可从 CLI 设置或清除徽章。支持图标、颜色、优先级和绑定 PID 的徽章",
            "bullet4": "<0>Claude Code 集成</0> - 可通过 Claude Code 钩子使用 <1>wsh badge</1>，将 AI 任务状态显示为标签栏通知",
            "seeDocs": "[查看文档]",
        },
        "other": {
            "title": "其他变更",
            "bullet1": "<0>[v0.14.3] </0>[bugfix] 修复 onboarding 中的致命 Bug",
            "bullet2": "<0>目录预览</0> - 改进修改时间格式、斑马纹行、更好的默认排序，并支持 YAML 文件",
            "bullet3": "<0>搜索栏</0> - 剪贴板和焦点改进",
            "bullet4": "[bugfix] 修复 GNOME 桌面上 \"新建窗口\" 卡住的问题",
            "bullet5": "[bugfix] 修复 \"另存会话为...\" 窗口聚焦跟踪 Bug",
        },
    },
    "v0144": {
        "summary": "Wave v0.14.4 引入垂直标签页，升级到 xterm.js v6，并包含多项 Bug 修复与 UI 改进。",
        "verticalTabs": {
            "title": "垂直标签栏",
            "bullet1": "<0>新增垂直标签栏选项</0> - 标签页现在可沿窗口侧面垂直显示，腾出更多水平空间。可在设置中切换水平/垂直布局。",
        },
        "terminal": {
            "title": "终端改进",
            "bullet1": "<0>xterm.js v6.0.0 升级</0> - 改进终端兼容性和渲染，解决 Claude Code 等工具的使用问题",
        },
        "other": {
            "title": "其他变更",
            "bullet1": "<0>macOS 首次点击</0> - 首次点击现在会聚焦被点击的小部件",
            "bullet2": "<0><1>backgrounds.json</1></0> - 将 <1>presets/bg.json</1> 重命名为 <1>backgrounds.json</1>",
            "bullet3": "<0>配置错误位置调整</0> - 配置错误移至 WaveConfig 视图，减少干扰",
            "bullet4": "WaveConfig 现在会在未保存更改时发出警告",
            "bullet5": "修复图片/视频的预览流式加载问题",
            "bullet6": "已移除废弃的旧版 AI 小部件",
            "bullet7": "[bugfix] 修复新建块的焦点 Bug",
        },
    },
    "v0145": {
        "summary": "Wave v0.14.5 引入新的进程查看器小部件、多项体验改进，并修复了从设置小部件创建新配置文件的问题。",
        "processViewer": {
            "title": "进程查看器",
            "desc": "新小部件：显示本地和远程机器上运行的进程，含 CPU 和内存占用，支持列排序。",
        },
        "other": {
            "title": "其他变更",
            "bullet1": "<0>Quake 模式</0> &mdash; 全局热键（<1>app:globalhotkey</1>）现在可切换 Wave 窗口的显示与隐藏",
            "bullet2": "<0>拖放文件到终端</0> 以粘贴其带引号的路径",
            "bullet3": "新增 <0>app:showsplitbuttons</0> 设置，在块标题栏添加分屏按钮",
            "bullet4": "可从“视图”菜单开关小部件侧边栏",
            "bullet5": "按 F2 重命名当前标签页",
            "bullet6": "鼠标后退/前进按钮现在可在网页小部件中导航",
            "bullet7": "<0>[bugfix]</0> 尚不存在的配置文件无法从设置小部件创建或编辑",
        },
    },
}

def merge(dst, src, path=""):
    for k, v in src.items():
        if isinstance(v, dict):
            merge(dst.setdefault(k, {}), v, path + "." + k)
        else:
            dst[k] = v

for lang, data in [("en", EN), ("zh-CN", ZH)]:
    fpath = f"locales/{lang}/translation.json"
    with open(fpath, encoding="utf-8") as f:
        d = json.load(f)
    upgrade = d["onboarding"]["upgrade"]
    for ver, content in data.items():
        merge(upgrade.setdefault(ver, {}), content)
    with open(fpath, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
    print(f"✅ {fpath} 已更新 ({ver} 等 key 添加)")

# 同样给 public/locales 下也更新（如有）
import os
for lang in ["en", "zh-CN"]:
    fpath = f"public/locales/{lang}/translation.json"
    if os.path.exists(fpath):
        with open(fpath, encoding="utf-8") as f:
            d = json.load(f)
        upgrade = d["onboarding"]["upgrade"]
        for ver, content in data.items():
            merge(upgrade.setdefault(ver, {}), content)
        with open(fpath, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=2)
        print(f"✅ {fpath} 已同步")

# 验证
for lang in ["en", "zh-CN"]:
    with open(f"locales/{lang}/translation.json", encoding="utf-8") as f:
        json.load(f)
    print(f"✅ {lang} JSON 合法")
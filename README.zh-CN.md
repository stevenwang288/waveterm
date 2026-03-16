# Wave Terminal 中文使用说明

本文件是当前仓库的中文维护说明，不覆盖原始 [README.md](./README.md)。

## 当前仓库的关键结论

- 当前 Git 分支只有一条在用：`main`
- 这次反复“改了但打包后还是旧样子”的根因，不是 Git 分支混乱，而是同一个 block 头部会按 `view` 走不同视图模型
- `term` 路径显示和 `webview` 路径显示原来不是同一条渲染链，所以之前只改 terminal 头部时，`webview` 头部的 URL 省略号不会跟着变

## 这次收敛后的唯一规则

当前“头部尾部显示”已经收敛成一套共享规则：

- 共享逻辑入口：`frontend/app/block/header-tail.ts`
- 共享样式入口：`frontend/app/block/block.scss`
- terminal 头部调用点：`frontend/app/block/connectionbutton.tsx`
- webview 头部调用点：`frontend/app/view/webview/webview.tsx`

目标行为：

- 显示不开时，只隐藏左边
- 右边尾部必须保留
- 不再显示 `...`

## 本地开发

推荐使用隔离开发实例：

```powershell
npm run dev:linked
```

如果当前会话环境带沙箱，`electron-vite dev` 可能起不来。此时建议从正常桌面环境直接启动当前构建产物的隔离开发副本：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-built-dev-sidecar.ps1
```

也可以直接双击：

```text
scripts\start-built-dev-sidecar.cmd
```

查看状态：

```powershell
npm run dev:linked:status
```

停止：

```powershell
npm run dev:linked:stop
```

开发实例数据目录：

- 状态目录：`.tmp/dev-linked/current`
- 日志文件：`.tmp/dev-linked/current/dev.log`
- 临时数据：`.tmp/dev-linked/current/data`

## 当前常用快捷键

以下是当前仓库里和这次排查最相关的快捷键。

### 全局 / block 级

- 放大或还原当前 block
  - Windows: `Alt+M`
  - Windows: `Alt+Q`
  - Windows: `Ctrl+Q`
- 新建标签页
  - Windows: `Alt+T`
- 打开连接切换器
  - Windows: `Alt+G`
- 在 block 之间切换
  - `Tab`
  - `Shift+Tab`
- 把当前 block 切到 launcher
  - `Ctrl+Shift+X`
- 开关终端多播输入
  - `Ctrl+Shift+I`

说明：

- 代码里 `Cmd:*` 在 Windows 上会映射到 `Alt+*`
- 因此 `Cmd:m` 在 Windows 上等价于 `Alt+M`

### 终端滚动相关

- 滚到最底部：`Shift+End`
- 滚到最顶部：`Shift+Home`
- 上翻一页：`Shift+PageUp`
- 下翻一页：`Shift+PageDown`

## 缩放后的终端行为

当前约定：

- 不做定时 5 秒抢焦点
- 不做强制抢输入焦点
- 当 block 进入或退出 magnify 时，终端会在重排后回到底部，并按当前宽度 reflow 一次

实现位置：

- `frontend/app/view/term/term.tsx`

## Windows 打包输出

### 原始构建输出

Electron Builder 仍然先输出到：

```text
make/<version>/
```

配置位置：

- `electron-builder.config.cjs`

### 额外复制到 D 盘桌面目录

Windows 发布脚本会把安装包额外复制到：

```text
D:\DeSK
```

脚本位置：

- `scripts/release-win.ps1`

生成文件名格式：

```text
WAVE-win32-x64-<version>-fix-<gitsha>.exe
```

手动执行发布脚本：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\release-win.ps1 -AllowDirty
```

## 这次修复涉及的文件

- `frontend/app/block/header-tail.ts`
- `frontend/app/block/block.scss`
- `frontend/app/block/connectionbutton.tsx`
- `frontend/app/view/webview/webview.tsx`
- `frontend/app/view/webview/webview.scss`
- `frontend/app/view/term/term.tsx`
- `scripts/dev-instance.ps1`

## 说明

如果再次出现“源码已改、打包后像没改”的情况，先确认：

1. 当前问题属于 `term`、`webview` 还是 `pvevnc`
2. 修改是否落在实际 `view` 对应的视图模型上
3. 安装包是否来自当前代码重新构建，而不是旧的 `make/<version>/` 产物

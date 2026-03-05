# 终端路径显示不一致（AI 命令 `--cd` / `-C`）

## 现象
- 终端分屏的小标题/小窗口里显示的路径（Wave 的 terminal label）与右侧 AI/TUI（如 Codex/OpenCode）的 `cwd` 状态栏不一致。
- 表现为：右侧显示的是实际工作目录（例如 `E:\\code\\cx:master`），左侧却显示成别的目录（例如 `C:/Users/...`）。

## 根因
Wave 在 AI 命令运行期间会用 `term:virtualcwd` 覆盖显示路径，该值来自对命令行参数的解析：
- 旧逻辑只解析 `--cd`，且会取到“第一个”匹配的 `--cd`。
- 当命令使用 `-C <path>`（常见 git-like）或出现多个 `--cd` 时，会导致 `term:virtualcwd` 解析错误，从而左侧显示错误路径。

## 修复
- 抽出并统一 cwd 解析：`frontend/app/view/term/cwd-utils.ts`
  - 支持 `--cd` 与 `-C` 两种写法
  - 多次出现时取“最后一次”（更符合多数 CLI 的覆盖语义）
- `frontend/app/view/term/termwrap.ts` 改为复用该工具函数。

## 验证
- 单测：`npm test -- --run frontend/app/view/term/tests/cwd-utils.test.ts`
- 全量：`npm test -- --run`
- UI（隔离 profile）：`npm run dev:fresh`

## 备注
如果在**非 AI 命令运行期间**仍出现路径不更新，通常是 `cmd:cwd` 没有收到 OSC 7（shell integration）或未能从 `cd/Set-Location` 推断更新，需要进一步检查 shell integration 是否启用。


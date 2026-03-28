# waveterm-main Repo Rules

## Runtime Validation

- 对 `frontend/`、`Electron`、终端交互、快捷按钮、输入注入、滚动行为这类改动，不能只靠静态阅读或单元测试。
- 必须启动隔离开发实例做真实运行验证：
  - 启动：`npm run dev:linked`
  - 状态：`npm run dev:linked:status`
  - 停止：`npm run dev:linked:stop`
- 如果开发实例没在运行，不要假设“应该没问题”；先启动再测。
- 验证时默认优先复用隔离 dev 实例，不要把生产/常用实例当测试环境。

## Terminal Interaction Changes

- 任何会向终端自动发送命令、按键、粘贴内容、恢复会话、切换 follow 状态的需求，都要做真实交互验证。
- 这类功能评估时，要先确认：
  - 命令是否有稳定的非交互参数
  - 当前终端是否处于可安全注入输入的状态
  - 是否会误伤正在运行的前台程序或 TUI
- 如果存在稳定的非交互命令路径，优先走非交互方案，不要优先做脆弱的 TUI 选单自动化。

## Progress Doc

- 继续维护 `docs/当前任务进展.md`。
- 每个有实际结论的新需求评估或实现批次，都要把当前结论和下一步补进去。

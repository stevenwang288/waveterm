# 外部 Fork 功能扫描（仅 Fork 本体）

- 口径：不看你仓库，不看官方仓库；只看他人 fork 仓库当前分支相对 upstream/main 的新增改动。
- 生成时间：2026-02-07 21:31:07

| Fork | 价值 | 发现功能 | ahead/files | 代表提交 |
|---|---|---|---|---|
| ivikasavnish/waveterm | 高 | SSH 端口转发（后端+前端） | 10/11 | Initial plan |
| netixc/waveterm | 高 | AI 工具调用扩展（widget 控制、终端执行） | 27/22 | Add missing dependencies for recharts and ai SDK |
| akari2600/waveterm | 中高 | Claude Max OAuth / 设置面板 / 预设模型 | 6/22 | Change magnify keybinding from Cmd+M to Cmd+Shift+M |
| robinvandernoord/waveterm-hujson | 中高 | HuJSON 配置解析增强（容错更好） | 6/4 | Add `hujson` support to parsing wave config files |
| Salnika/waveterm | 中 | AI 配置增加 max tokens 字段 | 3/6 | feat: add maxtokensfield |
| mrancier/waveterm | 中 | 前端测试基础设施与测试样例 | 3/12 | [mpt] Add comprehensive frontend test suite |
| bklieger-groq/waveterm-groq | 中 | GROQ Provider 与命令日志组件 | 5/27 | feat: switch to groq, change color theme |
| tabiznet/wavetermGROK | 中 | Grok Code provider 接入 | 2/9 | Add Grok Code support to Waveterm |
| draco28/FlowTerminal_wave | 低 | 以品牌重构为主，非核心能力增益 | 2/37 | feat: Add Claude Code CLI backend for FlowTerminal |

## 结论（只看外部 fork）

1. 最值得借鉴：`ivikasavnish/waveterm`（SSH 端口转发）与 `netixc/waveterm`（AI 工具能力扩展）。
2. 次优先：`akari2600/waveterm`（Claude Max 相关）、`robinvandernoord/waveterm-hujson`（配置容错）。
3. 可选：`Salnika/waveterm`（max tokens 字段）、`mrancier/waveterm`（测试建设）。
4. 风险较高：大改 UI/品牌化 fork（如 FlowTerminal）不建议直接搬。

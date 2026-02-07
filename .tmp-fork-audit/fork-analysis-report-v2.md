# waveterm fork 改进审计报告（修正版）

- 生成时间：2026-02-07 20:34:06
- 上游：wavetermdev/waveterm
- 扫描 fork 总数：776
- 可比较：671；无改动（ahead=0）：634；有改动（ahead>0）：37；比较失败：105

## 一、优先关注（按借鉴价值）

- stevenvo/waveterm | 高：优先借鉴（有上游验证） | ahead=32, files=24, openPR=4, mergedPR=2
  - 标签：UI/前端, AI/模型, CLI/WSH, 终端内核
  - 提交样例：f76712c Add AI-powered automatic tab title generation
  - 链接：https://github.com/stevenvo/waveterm
- DepsCian/waveterm | 高：优先借鉴（有上游验证） | ahead=4, files=1, openPR=2, mergedPR=0
  - 标签：UI/前端
  - 提交样例：639086b fix: add WebSocket polyfill for Electron main process
  - 链接：https://github.com/DepsCian/waveterm
- rnunley-nmg/waveterm | 高：优先借鉴（有上游验证） | ahead=1, files=18, openPR=1, mergedPR=0
  - 标签：UI/前端, AI/模型
  - 提交样例：3e13210 add workspace directory feature
  - 链接：https://github.com/rnunley-nmg/waveterm
- sters/waveterm | 高：优先借鉴（有上游验证） | ahead=1, files=1, openPR=1, mergedPR=0
  - 标签：UI/前端, 终端内核
  - 提交样例：0a9036e change IME composing handling order to support implicitly confirming IME
  - 链接：https://github.com/sters/waveterm
- sarumaj/waveterm | 高：优先借鉴（有上游验证） | ahead=7, files=7, openPR=1, mergedPR=0
  - 标签：UI/前端, SSH/远程, CLI/WSH, 文档
  - 提交样例：b204f73 sysinfo: add support for amd and nvidia gpus
  - 链接：https://github.com/sarumaj/waveterm
- HAHA741/waveterm | 高：优先借鉴（有上游验证） | ahead=3, files=3, openPR=0, mergedPR=1
  - 标签：UI/前端
  - 提交样例：7b6e316 字体大小修改
  - 链接：https://github.com/HAHA741/waveterm
- L1l1thLY/waveterm | 高：优先借鉴（有上游验证） | ahead=6, files=2, openPR=0, mergedPR=1
  - 标签：AI/模型
  - 提交样例：936ee19 feat: Claude AI configuration supports custom base URL
  - 链接：https://github.com/L1l1thLY/waveterm
- sgeraldes/waveterm | 中高：可借鉴（先拆小验证） | ahead=178, files=300, openPR=3, mergedPR=0
  - 标签：UI/前端, AI/模型, SSH/远程, CLI/WSH, 终端内核, 文档, 构建/配置
  - 提交样例：5622d24 feat: Tab base directory with VS Code style redesign
  - 链接：https://github.com/sgeraldes/waveterm

## 二、37 个有改动 fork 逐个结论

| Fork | ahead | files | 标签 | Open PR | Merged PR | 建议 |
|---|---:|---:|---|---:|---:|---|
| smallkiller1/waveterm | 1 | 1 | 终端内核 | 0 | 0 | 中：可选借鉴（需本地验证） |
| sgeraldes/waveterm | 178 | 300 | UI/前端, AI/模型, SSH/远程, CLI/WSH, 终端内核, 文档, 构建/配置 | 3 | 0 | 中高：可借鉴（先拆小验证） |
| akari2600/waveterm | 6 | 22 | UI/前端, AI/模型, CLI/WSH, 文档 | 0 | 0 | 中：可选借鉴（需本地验证） |
| gracie007-cloud/wave-terminal | 2 | 2 | 其他 | 0 | 0 | 低：收益有限 |
| liatrio-labs/waveterm | 78 | 300 | UI/前端, AI/模型, SSH/远程, CLI/WSH, 终端内核, 文档, 构建/配置 | 0 | 0 | 低：分叉过大，谨慎借鉴 |
| GlacierEQ/waveterm | 6 | 39 | UI/前端, AI/模型, CLI/WSH, 终端内核, 文档, 构建/配置 | 0 | 0 | 中：可选借鉴（需本地验证） |
| tabiznet/wavetermGROK | 2 | 9 | AI/模型, 文档 | 0 | 0 | 中：可选借鉴（需本地验证） |
| mexyusef/waveterm | 1 | 5 | 构建/配置 | 0 | 0 | 低：收益有限 |
| sters/waveterm | 1 | 1 | UI/前端, 终端内核 | 1 | 0 | 高：优先借鉴（有上游验证） |
| rnunley-nmg/waveterm | 1 | 18 | UI/前端, AI/模型 | 1 | 0 | 高：优先借鉴（有上游验证） |
| mrancier/waveterm | 3 | 12 | UI/前端 | 0 | 0 | 中：可选借鉴（需本地验证） |
| stevenvo/waveterm | 32 | 24 | UI/前端, AI/模型, CLI/WSH, 终端内核 | 4 | 2 | 高：优先借鉴（有上游验证） |
| a5af/waveterm | 24 | 70 | 其他 | 0 | 0 | 低：收益有限 |
| wuyueerhao/waveterm | 2 | 1 | 其他 | 0 | 0 | 低：收益有限 |
| netixc/waveterm | 27 | 22 | 其他 | 0 | 0 | 低：收益有限 |
| ivikasavnish/waveterm | 10 | 11 | UI/前端, SSH/远程, CLI/WSH | 0 | 0 | 中：可选借鉴（需本地验证） |
| draco28/FlowTerminal_wave | 2 | 37 | AI/模型, 终端内核, 文档, 构建/配置 | 0 | 0 | 中：可选借鉴（需本地验证） |
| Dev-ZC/alfred | 2 | 24 | UI/前端, AI/模型, 构建/配置 | 0 | 0 | 中：可选借鉴（需本地验证） |
| devicemanager/waveterm | 1 | 2 | 文档, 构建/配置 | 0 | 0 | 低：收益有限 |
| sarumaj/waveterm | 7 | 7 | UI/前端, SSH/远程, CLI/WSH, 文档 | 1 | 0 | 高：优先借鉴（有上游验证） |
| DepsCian/waveterm | 4 | 1 | UI/前端 | 2 | 0 | 高：优先借鉴（有上游验证） |
| 10x-smitty/waveterm | 1 | 1 | 构建/配置 | 0 | 0 | 低：收益有限 |
| L1l1thLY/waveterm | 6 | 2 | AI/模型 | 0 | 1 | 高：优先借鉴（有上游验证） |
| xuzhounan/waveterm | 171 | 167 | UI/前端, AI/模型, CLI/WSH, 终端内核, 文档, 构建/配置 | 0 | 0 | 低：分叉过大，谨慎借鉴 |
| Salnika/waveterm | 3 | 6 | UI/前端, 文档, 构建/配置 | 0 | 0 | 中：可选借鉴（需本地验证） |
| testdriverai/waveterm | 5 | 2 | 其他 | 0 | 0 | 低：收益有限 |
| Icarus-B4/waveterm | 2 | 10 | UI/前端, 文档, 构建/配置 | 0 | 0 | 中：可选借鉴（需本地验证） |
| Bhaktabahadurthapa/waveterm | 3 | 17 | 文档 | 0 | 0 | 低：收益有限 |
| xxyy2024/waveterm_aipy | 2052 | 300 | UI/前端, AI/模型, CLI/WSH, 终端内核, 文档, 构建/配置 | 0 | 0 | 低：分叉过大，谨慎借鉴 |
| Malaeu/waveterm | 1 | 3 | AI/模型, 构建/配置 | 0 | 0 | 中：可选借鉴（需本地验证） |
| bklieger-groq/waveterm-groq | 5 | 27 | UI/前端, AI/模型, 终端内核, 文档, 构建/配置 | 0 | 0 | 中：可选借鉴（需本地验证） |
| HAHA741/waveterm | 3 | 3 | UI/前端 | 0 | 1 | 高：优先借鉴（有上游验证） |
| kartikone/waveterm | 7 | 8 | UI/前端 | 0 | 0 | 中：可选借鉴（需本地验证） |
| coders33123/waveterm | 7 | 6 | AI/模型, 文档 | 0 | 0 | 中：可选借鉴（需本地验证） |
| robinvandernoord/waveterm-hujson | 6 | 4 | UI/前端, 构建/配置 | 0 | 0 | 中：可选借鉴（需本地验证） |
| starbucknathan/waveterm | 1 | 1 | 其他 | 0 | 0 | 低：收益有限 |
| zecreh/waveterm | 1 | 1 | 文档 | 0 | 0 | 低：收益有限 |

## 三、你的偏好下的可借鉴方向

1. IDE 风格：sgeraldes/waveterm 的 VS Code 风格思路可参考，但改动很大，建议拆分吸收。
2. 低风险 UI 改进：stevenvo 系列 PR（2678/2742/2717/2681）非常适合逐个落地。
3. AI 对话与执行分区：DepsCian #2103 可作为交互分层参考（对话区 vs 执行日志区）。
4. SSH 稳定性：andya1lan #2748/#2749 + 已合并 #2644 属于高价值后端稳定性增强。
5. 大分叉仓库（ahead 超大）只建议摘取单功能，不建议整仓对齐。

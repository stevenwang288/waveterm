# waveterm fork 改进审计报告

- 生成时间：2026-02-07 20:29:24
- 上游：wavetermdev/waveterm
- 扫描 fork 总数：776
- 可比较：671；无改动（ahead=0）：634；有改动（ahead>0）：37；比较失败：105

## 一、优先关注（高/中高）

- sgeraldes/waveterm | 中高：可借鉴（先拆小验证） | ahead=178, files=300, openPR=3, mergedPR=1
  - 标签：UI/前端,AI/模型,SSH/远程,CLI/WSH,终端内核,文档,构建/配置
  - 提交样例：5622d24 feat: Tab base directory with VS Code style redesign
  - 链接：https://github.com/sgeraldes/waveterm
- xuzhounan/waveterm | 中高：可借鉴（先拆小验证） | ahead=171, files=167, openPR=1, mergedPR=1
  - 标签：UI/前端,AI/模型,CLI/WSH,终端内核,文档,构建/配置
  - 提交样例：2d7646e feat: 增强原生终端功能并清理 Modern Terminal 代码
  - 链接：https://github.com/xuzhounan/waveterm
- liatrio-labs/waveterm | 中高：可借鉴（先拆小验证） | ahead=78, files=300, openPR=1, mergedPR=1
  - 标签：UI/前端,AI/模型,SSH/远程,CLI/WSH,终端内核,文档,构建/配置
  - 提交样例：f53d691 feat: Rebrand to Liatrio Code and add welcome screen foundation
  - 链接：https://github.com/liatrio-labs/waveterm
- xxyy2024/waveterm_aipy | 中高：可借鉴（先拆小验证） | ahead=2052, files=300, openPR=1, mergedPR=1
  - 标签：UI/前端,AI/模型,CLI/WSH,终端内核,文档,构建/配置
  - 提交样例：cbc50da Fix quicktips getting cut off (#1857)
  - 链接：https://github.com/xxyy2024/waveterm_aipy
- stevenvo/waveterm | 高：优先借鉴（有上游验证） | ahead=32, files=24, openPR=4, mergedPR=2
  - 标签：UI/前端,AI/模型,CLI/WSH,终端内核
  - 提交样例：f76712c Add AI-powered automatic tab title generation
  - 链接：https://github.com/stevenvo/waveterm
- DepsCian/waveterm | 高：优先借鉴（有上游验证） | ahead=4, files=1, openPR=2, mergedPR=1
  - 标签：UI/前端
  - 提交样例：639086b fix: add WebSocket polyfill for Electron main process
  - 链接：https://github.com/DepsCian/waveterm
- Icarus-B4/waveterm | 高：优先借鉴（有上游验证） | ahead=2, files=10, openPR=1, mergedPR=1
  - 标签：UI/前端,文档,构建/配置
  - 提交样例：41f5d78 chore: update yarn configuration and package manager version
  - 链接：https://github.com/Icarus-B4/waveterm
- zecreh/waveterm | 高：优先借鉴（有上游验证） | ahead=1, files=1, openPR=1, mergedPR=1
  - 标签：文档
  - 提交样例：9c2ab44 Update README.md
  - 链接：https://github.com/zecreh/waveterm
- L1l1thLY/waveterm | 高：优先借鉴（有上游验证） | ahead=6, files=2, openPR=1, mergedPR=1
  - 标签：AI/模型
  - 提交样例：936ee19 feat: Claude AI configuration supports custom base URL
  - 链接：https://github.com/L1l1thLY/waveterm
- 10x-smitty/waveterm | 高：优先借鉴（有上游验证） | ahead=1, files=1, openPR=1, mergedPR=1
  - 标签：构建/配置
  - 提交样例：e58a8de Update package.json
  - 链接：https://github.com/10x-smitty/waveterm
- Salnika/waveterm | 高：优先借鉴（有上游验证） | ahead=3, files=6, openPR=1, mergedPR=1
  - 标签：UI/前端,文档,构建/配置
  - 提交样例：d5d1986 feat: add maxtokensfield
  - 链接：https://github.com/Salnika/waveterm
- testdriverai/waveterm | 高：优先借鉴（有上游验证） | ahead=5, files=2, openPR=1, mergedPR=1
  - 标签：其他
  - 提交样例：41a03c7 remove unused cmds
  - 链接：https://github.com/testdriverai/waveterm
- Bhaktabahadurthapa/waveterm | 高：优先借鉴（有上游验证） | ahead=3, files=17, openPR=1, mergedPR=1
  - 标签：文档
  - 提交样例：dc272fe Add comprehensive DevOps contribution guide for Wave Terminal project
  - 链接：https://github.com/Bhaktabahadurthapa/waveterm
- coders33123/waveterm | 高：优先借鉴（有上游验证） | ahead=7, files=6, openPR=1, mergedPR=1
  - 标签：AI/模型,文档
  - 提交样例：aba2b10 Create Acro-Geniu .py
  - 链接：https://github.com/coders33123/waveterm
- robinvandernoord/waveterm-hujson | 高：优先借鉴（有上游验证） | ahead=6, files=4, openPR=1, mergedPR=1
  - 标签：UI/前端,构建/配置
  - 提交样例：a7e13ea Add `hujson` support to parsing wave config files
  - 链接：https://github.com/robinvandernoord/waveterm-hujson
- starbucknathan/waveterm | 高：优先借鉴（有上游验证） | ahead=1, files=1, openPR=1, mergedPR=1
  - 标签：其他
  - 提交样例：3dc2b20 Create main.yml
  - 链接：https://github.com/starbucknathan/waveterm
- kartikone/waveterm | 高：优先借鉴（有上游验证） | ahead=7, files=8, openPR=1, mergedPR=1
  - 标签：UI/前端
  - 提交样例：639086b fix: add WebSocket polyfill for Electron main process
  - 链接：https://github.com/kartikone/waveterm
- Malaeu/waveterm | 高：优先借鉴（有上游验证） | ahead=1, files=3, openPR=1, mergedPR=1
  - 标签：AI/模型,构建/配置
  - 提交样例：9a44c9c fix: resolve OpenAI backend compatibility issues and build failures
  - 链接：https://github.com/Malaeu/waveterm
- bklieger-groq/waveterm-groq | 高：优先借鉴（有上游验证） | ahead=5, files=27, openPR=1, mergedPR=1
  - 标签：UI/前端,AI/模型,终端内核,文档,构建/配置
  - 提交样例：3130106 feat: switch to groq, change color theme
  - 链接：https://github.com/bklieger-groq/waveterm-groq
- HAHA741/waveterm | 高：优先借鉴（有上游验证） | ahead=3, files=3, openPR=1, mergedPR=1
  - 标签：UI/前端
  - 提交样例：7b6e316 字体大小修改
  - 链接：https://github.com/HAHA741/waveterm
- mexyusef/waveterm | 高：优先借鉴（有上游验证） | ahead=1, files=5, openPR=1, mergedPR=1
  - 标签：构建/配置
  - 提交样例：7a492eb feat: add Cerebras, SambaNova, Hyperbolic, and Groq as LLM providers
  - 链接：https://github.com/mexyusef/waveterm
- tabiznet/wavetermGROK | 高：优先借鉴（有上游验证） | ahead=2, files=9, openPR=1, mergedPR=1
  - 标签：AI/模型,文档
  - 提交样例：93d400a Add Grok Code support to Waveterm
  - 链接：https://github.com/tabiznet/wavetermGROK
- rnunley-nmg/waveterm | 高：优先借鉴（有上游验证） | ahead=1, files=18, openPR=1, mergedPR=1
  - 标签：UI/前端,AI/模型
  - 提交样例：3e13210 add workspace directory feature
  - 链接：https://github.com/rnunley-nmg/waveterm
- sters/waveterm | 高：优先借鉴（有上游验证） | ahead=1, files=1, openPR=1, mergedPR=1
  - 标签：UI/前端,终端内核
  - 提交样例：0a9036e change IME composing handling order to support implicitly confirming IME
  - 链接：https://github.com/sters/waveterm
- akari2600/waveterm | 高：优先借鉴（有上游验证） | ahead=6, files=22, openPR=1, mergedPR=1
  - 标签：UI/前端,AI/模型,CLI/WSH,文档
  - 提交样例：0283764 Change magnify keybinding from Cmd+M to Cmd+Shift+M
  - 链接：https://github.com/akari2600/waveterm
- smallkiller1/waveterm | 高：优先借鉴（有上游验证） | ahead=1, files=1, openPR=1, mergedPR=1
  - 标签：终端内核
  - 提交样例：46a8fd1 Add files via upload
  - 链接：https://github.com/smallkiller1/waveterm
- GlacierEQ/waveterm | 高：优先借鉴（有上游验证） | ahead=6, files=39, openPR=1, mergedPR=1
  - 标签：UI/前端,AI/模型,CLI/WSH,终端内核,文档,构建/配置
  - 提交样例：4471b6c REPO_DIR="/Users/macarena1/Downloads/GIT/FILEBOSS"
  - 链接：https://github.com/GlacierEQ/waveterm
- gracie007-cloud/wave-terminal | 高：优先借鉴（有上游验证） | ahead=2, files=2, openPR=1, mergedPR=1
  - 标签：其他
  - 提交样例：51b4bca Create webpack.yml
  - 链接：https://github.com/gracie007-cloud/wave-terminal
- mrancier/waveterm | 高：优先借鉴（有上游验证） | ahead=3, files=12, openPR=1, mergedPR=1
  - 标签：UI/前端
  - 提交样例：1abab3b [mpt] Add comprehensive frontend test suite
  - 链接：https://github.com/mrancier/waveterm
- Dev-ZC/alfred | 高：优先借鉴（有上游验证） | ahead=2, files=24, openPR=1, mergedPR=1
  - 标签：UI/前端,AI/模型,构建/配置
  - 提交样例：8796606 Implemented tect to speech and speech to text ai funcionality
  - 链接：https://github.com/Dev-ZC/alfred
- draco28/FlowTerminal_wave | 高：优先借鉴（有上游验证） | ahead=2, files=37, openPR=1, mergedPR=1
  - 标签：AI/模型,终端内核,文档,构建/配置
  - 提交样例：e61b08d feat: Add Claude Code CLI backend for FlowTerminal
  - 链接：https://github.com/draco28/FlowTerminal_wave
- sarumaj/waveterm | 高：优先借鉴（有上游验证） | ahead=7, files=7, openPR=1, mergedPR=1
  - 标签：UI/前端,SSH/远程,CLI/WSH,文档
  - 提交样例：b204f73 sysinfo: add support for amd and nvidia gpus
  - 链接：https://github.com/sarumaj/waveterm
- devicemanager/waveterm | 高：优先借鉴（有上游验证） | ahead=1, files=2, openPR=1, mergedPR=1
  - 标签：文档,构建/配置
  - 提交样例：db1b482 Add sharp dependency to docs package.json
  - 链接：https://github.com/devicemanager/waveterm
- wuyueerhao/waveterm | 高：优先借鉴（有上游验证） | ahead=2, files=1, openPR=1, mergedPR=1
  - 标签：其他
  - 提交样例：6b0e853 Create sync-fork-auto.yml
  - 链接：https://github.com/wuyueerhao/waveterm
- a5af/waveterm | 高：优先借鉴（有上游验证） | ahead=24, files=70, openPR=1, mergedPR=1
  - 标签：其他
  - 提交样例：
  - 链接：https://github.com/a5af/waveterm
- ivikasavnish/waveterm | 高：优先借鉴（有上游验证） | ahead=10, files=11, openPR=1, mergedPR=1
  - 标签：UI/前端,SSH/远程,CLI/WSH
  - 提交样例：2a0eb65 Initial plan
  - 链接：https://github.com/ivikasavnish/waveterm
- netixc/waveterm | 高：优先借鉴（有上游验证） | ahead=27, files=22, openPR=1, mergedPR=1
  - 标签：其他
  - 提交样例：
  - 链接：https://github.com/netixc/waveterm

## 二、37 个有改动 fork 逐个结论

| Fork | ahead | files | 标签 | Open PR | Merged PR | 建议 |
|---|---:|---:|---|---:|---:|---|
| smallkiller1/waveterm | 1 | 1 | 终端内核 | 1 | 1 | 高：优先借鉴（有上游验证） |
| sgeraldes/waveterm | 178 | 300 | UI/前端, AI/模型, SSH/远程, CLI/WSH, 终端内核, 文档, 构建/配置 | 3 | 1 | 中高：可借鉴（先拆小验证） |
| akari2600/waveterm | 6 | 22 | UI/前端, AI/模型, CLI/WSH, 文档 | 1 | 1 | 高：优先借鉴（有上游验证） |
| gracie007-cloud/wave-terminal | 2 | 2 | 其他 | 1 | 1 | 高：优先借鉴（有上游验证） |
| liatrio-labs/waveterm | 78 | 300 | UI/前端, AI/模型, SSH/远程, CLI/WSH, 终端内核, 文档, 构建/配置 | 1 | 1 | 中高：可借鉴（先拆小验证） |
| GlacierEQ/waveterm | 6 | 39 | UI/前端, AI/模型, CLI/WSH, 终端内核, 文档, 构建/配置 | 1 | 1 | 高：优先借鉴（有上游验证） |
| tabiznet/wavetermGROK | 2 | 9 | AI/模型, 文档 | 1 | 1 | 高：优先借鉴（有上游验证） |
| mexyusef/waveterm | 1 | 5 | 构建/配置 | 1 | 1 | 高：优先借鉴（有上游验证） |
| sters/waveterm | 1 | 1 | UI/前端, 终端内核 | 1 | 1 | 高：优先借鉴（有上游验证） |
| rnunley-nmg/waveterm | 1 | 18 | UI/前端, AI/模型 | 1 | 1 | 高：优先借鉴（有上游验证） |
| mrancier/waveterm | 3 | 12 | UI/前端 | 1 | 1 | 高：优先借鉴（有上游验证） |
| stevenvo/waveterm | 32 | 24 | UI/前端, AI/模型, CLI/WSH, 终端内核 | 4 | 2 | 高：优先借鉴（有上游验证） |
| a5af/waveterm | 24 | 70 | 其他 | 1 | 1 | 高：优先借鉴（有上游验证） |
| wuyueerhao/waveterm | 2 | 1 | 其他 | 1 | 1 | 高：优先借鉴（有上游验证） |
| netixc/waveterm | 27 | 22 | 其他 | 1 | 1 | 高：优先借鉴（有上游验证） |
| ivikasavnish/waveterm | 10 | 11 | UI/前端, SSH/远程, CLI/WSH | 1 | 1 | 高：优先借鉴（有上游验证） |
| draco28/FlowTerminal_wave | 2 | 37 | AI/模型, 终端内核, 文档, 构建/配置 | 1 | 1 | 高：优先借鉴（有上游验证） |
| Dev-ZC/alfred | 2 | 24 | UI/前端, AI/模型, 构建/配置 | 1 | 1 | 高：优先借鉴（有上游验证） |
| devicemanager/waveterm | 1 | 2 | 文档, 构建/配置 | 1 | 1 | 高：优先借鉴（有上游验证） |
| sarumaj/waveterm | 7 | 7 | UI/前端, SSH/远程, CLI/WSH, 文档 | 1 | 1 | 高：优先借鉴（有上游验证） |
| DepsCian/waveterm | 4 | 1 | UI/前端 | 2 | 1 | 高：优先借鉴（有上游验证） |
| 10x-smitty/waveterm | 1 | 1 | 构建/配置 | 1 | 1 | 高：优先借鉴（有上游验证） |
| L1l1thLY/waveterm | 6 | 2 | AI/模型 | 1 | 1 | 高：优先借鉴（有上游验证） |
| xuzhounan/waveterm | 171 | 167 | UI/前端, AI/模型, CLI/WSH, 终端内核, 文档, 构建/配置 | 1 | 1 | 中高：可借鉴（先拆小验证） |
| Salnika/waveterm | 3 | 6 | UI/前端, 文档, 构建/配置 | 1 | 1 | 高：优先借鉴（有上游验证） |
| testdriverai/waveterm | 5 | 2 | 其他 | 1 | 1 | 高：优先借鉴（有上游验证） |
| Icarus-B4/waveterm | 2 | 10 | UI/前端, 文档, 构建/配置 | 1 | 1 | 高：优先借鉴（有上游验证） |
| Bhaktabahadurthapa/waveterm | 3 | 17 | 文档 | 1 | 1 | 高：优先借鉴（有上游验证） |
| xxyy2024/waveterm_aipy | 2052 | 300 | UI/前端, AI/模型, CLI/WSH, 终端内核, 文档, 构建/配置 | 1 | 1 | 中高：可借鉴（先拆小验证） |
| Malaeu/waveterm | 1 | 3 | AI/模型, 构建/配置 | 1 | 1 | 高：优先借鉴（有上游验证） |
| bklieger-groq/waveterm-groq | 5 | 27 | UI/前端, AI/模型, 终端内核, 文档, 构建/配置 | 1 | 1 | 高：优先借鉴（有上游验证） |
| HAHA741/waveterm | 3 | 3 | UI/前端 | 1 | 1 | 高：优先借鉴（有上游验证） |
| kartikone/waveterm | 7 | 8 | UI/前端 | 1 | 1 | 高：优先借鉴（有上游验证） |
| coders33123/waveterm | 7 | 6 | AI/模型, 文档 | 1 | 1 | 高：优先借鉴（有上游验证） |
| robinvandernoord/waveterm-hujson | 6 | 4 | UI/前端, 构建/配置 | 1 | 1 | 高：优先借鉴（有上游验证） |
| starbucknathan/waveterm | 1 | 1 | 其他 | 1 | 1 | 高：优先借鉴（有上游验证） |
| zecreh/waveterm | 1 | 1 | 文档 | 1 | 1 | 高：优先借鉴（有上游验证） |

## 三、可借鉴方向（按你的偏好：IDE 风格 + AI 对话/执行分区）

1. UI/IDE 风格：优先看 sgeraldes/waveterm（含 VS Code 风格相关 PR #2789）。
2. 交互安全性：stevenvo/waveterm 的标签页确认/拖拽/状态保持这类小改动，适合低风险移植。
3. SSH 稳定性：andya1lan 系列 PR（在上游可见）对 SSH agent/IdentitiesOnly 值得直接参考。
4. AI 供应商扩展：bklieger-groq/waveterm-groq、tabiznet/wavetermGROK 可参考 provider 接入层，不建议整仓迁移。
5. 大分叉谨慎：xxyy2024/waveterm_aipy、xuzhounan/waveterm 差异过大，建议只摘取具体模块而非直接合并。

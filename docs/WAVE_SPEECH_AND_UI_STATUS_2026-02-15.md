# WAVE 当前版本收口状态（2026-02-15）

## 1. 已完成（代码已合并）

- 语音播报设置面板：
  - 在 WaveConfig 左侧新增 `Speech` 板块（可视化页面）。
  - 支持总开关、自动播报、手动按钮开关。
  - 支持本地/兼容 API 两种来源。
  - 支持本地引擎选择（`browser` / `edge` / `melo`）。
  - 支持本地模型目录、本地模型名配置与目录扫描。
  - 支持 Endpoint / Model 配置。
  - 支持按角色配置声音（assistant / user / system）。
  - 支持 URL/路径/代码过滤开关。

- 手动播报按钮位置：
  - 已在窗口头部图标区加入朗读按钮。
  - 顺序为（从右往左）：`关闭` -> `放大` -> `设置` -> `朗读`。
  - 即朗读按钮位于齿轮左侧。

- 自动播报行为：
  - 已实现“仅在回复流式完成后自动播报”。
  - 避免首次加载历史消息时误触发自动播报。

- 语音运行时统一：
  - 新增统一 `speechruntime`，统一处理本地播报/API 播报、停止、播放状态订阅。
  - 本地引擎 `edge/melo` 走 OpenAI 兼容音频接口模式；浏览器引擎走 `speechSynthesis`。

- 配置后端闭环：
  - `speech:*` 新键已加入后端配置结构、默认配置、schema、前端类型和常量生成链路。
  - 新增键：
    - `speech:voiceassistant`
    - `speech:voiceuser`
    - `speech:voicesystem`
    - `speech:autoplay`
    - `speech:manualbutton`
    - `speech:localengine`
    - `speech:localmodel`
    - `speech:localmodelpath`

- 汉化补漏：
  - `"Automatically install for all connections"` 已补中文 `"为所有连接自动安装"`。

## 2. 打包与构建状态

- 已通过：
  - `npm run build:dev`
  - `task --force build:backend:quickdev:windows`
  - `task package`

- 安装包产物：
  - `make/WAVE-win32-x64-0.14.0-1.exe`

## 3. 已知限制（非代码错误）

- 本机当前未检测到本地 TTS HTTP 服务监听：
  - `http://127.0.0.1:5050/v1/audio/speech`（edge）
  - `http://127.0.0.1:5051/v1/audio/speech`（melo）
- 因此本次自动化验证侧重于编译与打包通过，`edge/melo` 的真实发声依赖本地服务先启动。

## 4. 建议测试清单（手工）

- 打开 WaveConfig -> `Speech`：
  - 切换自动播报开关，确认新回复是否自动读。
  - 切换手动按钮开关，确认齿轮左侧按钮显隐。
  - 切换 local/api + endpoint/model/voice 并验证生效。
  - 验证 URL/路径/代码过滤读法是否符合预期。


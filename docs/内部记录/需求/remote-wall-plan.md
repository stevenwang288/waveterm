# 远端服务器「墙」方案（RDP/VNC/SSH + 可选 Agent）

> 目的：在不牺牲 PVE Fast Path 的前提下，把**远端/普通服务器**纳入同一个「墙」入口，实现“缩略图墙 → 点击进入控制 → 返回墙”的工作流，并且支持 **RDP / VNC / SSH**（允许安装 agent）。

## 结论（先定一条主线，避免反复讨论/遗忘）
**远端服务器走“远控平台（Web）”这条主线**，Wave 负责打开它（`wall:url`），不在 Wave 内部从零实现 RDP/VNC 协议栈。

推荐的开源基座：
- **Apache Guacamole**：作为 RDP/VNC/SSH 的 Web 网关（guacd + webapp），满足“三种协议都有”的硬需求。
- **可选 Agent（仅做连通性，不替代协议）**：用反向隧道把远端的 RDP/VNC/SSH 端口安全地“带回”到 Guacamole 可达的网络里（例如 rathole/frp 这类反向代理/隧道）。

说明：
- 这里的 **agent 不是 AI**；它是“被控端常驻的连通性/中继组件”（用于跨网、NAT、无公网 IP 等场景）。

## Wave 侧集成方式（当前仓库范围）
- Wave 只做两件事：
  1) 甄别入口：**PVE 走 PVE Fast Path**；**远端服务器走 wall:url**。
  2) 打开远控平台：用 `wall:webpartition` 让远控平台登录态可持久化（cookie/session 不丢）。

补充（当前实现约定，避免再误解）：
- 左侧 **「墙」**按钮是 **PVE 屏幕墙**（屏幕拼墙本体）。
- 远端服务器的入口在 **Servers 面板**：行内 `SSH / VNC / RDP` 按钮会打开远控平台（优先 per-conn URL；否则回退到全局 `wall:url`），并且在**当前分屏**里新增一个 Web 分屏（不是新开标签页）。

配置项（Wave）：
```json
{
  "wall:url": "https://your-remote-wall.example/",
  "wall:tabname": "墙",
  "wall:webpartition": "persist:screen-wall"
}
```

## 远控平台侧（不在 Wave 仓库内，但这是必须的交付物）
为了满足“像 PVE 一样的墙”，远控平台需要提供一个 **Wall 页面**：
- 展示资产卡片/缩略图（至少能快速进入会话；缩略图可以先做静态/低频刷新，后续再做实时预览）。
- 点击卡片进入该资产的 RDP/VNC/SSH 会话（由 Guacamole 提供会话能力或由平台封装）。
- 明确区分资产类型（PVE vs 普通服务器）由 Wave 入口分流，而不是在同一个会话里猜。

## 为什么不直接把开源项目“编译进 Wave”？
- **RDP/VNC/SSH** 不是一个单 JS 库就能安全稳定解决的：需要网关、鉴权、会话管理、录像/审计（可选）等。
- Guacamole 的价值在于“把三种协议统一到 Web 会话模型”——Wave 只需要打开它即可。
- agent 只解决“跨网可达性”，不改变你要求的“三种协议”事实。

## 验收点（远端部分）
- Wave：配置 `wall:url` 后，在 **Servers 面板**点击 `VNC/RDP` 能稳定进入远控平台（登录态持久化，分屏打开）。
- 平台：至少能从墙进入 RDP/VNC/SSH 任一会话；后续再迭代缩略图墙的实时预览与批量操作。

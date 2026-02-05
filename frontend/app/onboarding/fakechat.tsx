// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveStreamdown } from "@/app/element/streamdown";
import { memo, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface ChatConfig {
    userPrompt: string;
    toolName: string;
    toolDescription: string;
    markdownResponse: string;
}

const chatConfigs: ChatConfig[] = [
    {
        userPrompt: "看看 ~/waveterm，帮我总结一下这个项目：它做什么、代码是怎么组织的？",
        toolName: "read_dir",
        toolDescription: "正在读取目录 \"~/waveterm\"",
        markdownResponse: `下面是一个基于目录结构的快速概览（Wave Terminal）：

## 这是什么
- Electron + React 前端，Go 后端（"wavesrv"）。提供带 GUI 小部件、预览、Web 与 AI 的终端。（README.md）
- Apache-2.0 许可证。（LICENSE）

## 架构一览
- **Electron 主进程：** \`emain/*.ts\` 负责窗口、菜单、preload 脚本、更新器，并通过本地 RPC 与 Go 后端交互。（\`emain/\`）
- **渲染进程 UI：** React/TS + Vite + Tailwind。（\`frontend/\`、\`index.html\`、\`electron.vite.config.ts\`）
- **Go 后端（"wavesrv"）：** 启动服务、HTTP/WS 监听、遥测循环、配置监控、本地 RPC、文件存储与基于 SQLite 的对象存储。（\`cmd/server/main-server.go\`、\`pkg/*\`）
- **CLI/辅助工具（"wsh"）：** 多平台构建；用于 Shell 集成与远程操作。（\`cmd/wsh/\`、\`Taskfile.yml build:wsh\`）

## 关键目录
- **cmd/**：入口与生成器
  - \`server/\`：wavesrv 主程序
  - \`generategs/\`、\`generatego/\`：TS/Go 绑定生成
  - \`wsh/\`：Shell 辅助工具

- **pkg/**：后端包
  - \`wcore/\`：启动协调、初始化数据、窗口/工作区创建
  - \`web/\`：HTTP + WS 服务、Unix listener
  - \`waveai/\`：AI 后端（OpenAI、Anthropic、Google、Perplexity）
  - \`wshrpc\`、\`wshutil\`、\`wslconn\`、\`remote/*\`：本地/远程 RPC、WSL、SSH、文件共享
  - \`wstore/\`：持久化存储（SQLite via sqlx）；\`waveobj/\`：对象模型
  - \`filestore/\`：本地文件缓存/存储
  - \`telemetry/\`：指标/事件与周期上报`,
    },
    {
        userPrompt: "你能分析一下我终端里的日志输出吗？",
        toolName: "term_get_scrollback",
        toolDescription: "从小部件读取终端输出",
        markdownResponse: `这是日志中最关键的点：

- 18:06:51 正常启动/初始化（router/register、DBGetAllObjsByType、Stat/Read）。
- 大量 FocusWindow 事件：正常的界面交互。
- 18:08:28.558 WebSocket ReadPump error: close 1001 (going away)：通常是标签/应用重载、睡眠或短暂网络抖动。
- 18:08:29 重新初始化并建立新的 WebSocket 连接：自动重连成功。
- SetMetaCommand 与周期性 filestore flush 的 err:：正常；未见失败。
- 未发现 panic/fatal；主要是一次短暂断连。

如果这次断连不符合预期，可以检查 18:08:28 左右是否有重载/休眠，并观察是否反复出现。

需要更深入排查？可以运行下面命令并把结果贴给我：

\`\`\`bash
# 1) 扫描最近日志中的异常
grep -Ei 'error|panic|fatal|websocket|1006|1011' \\
  "$HOME/Library/Application Support/waveterm-dev/waveapp.log" | tail -n 200

# 2) 查看断连时间窗口附近
awk '($0 ~ /2025-10-10 18:08:2[0-9]/){print}' \\
  "$HOME/Library/Application Support/waveterm-dev/waveapp.log"

# 3) 实时跟踪是否重复掉线
tail -f "$HOME/Library/Application Support/waveterm-dev/waveapp.log" \\
  | grep -Ei 'error|panic|fatal|websocket|close'
\`\`\`

需要我看更长的一段（例如最后 1000 行）或换一个时间范围吗？`,
    },
];

const AIThinking = memo(() => {
    const { t } = useTranslation();

    return (
        <div className="flex items-center gap-2">
            <div className="animate-pulse flex items-center">
                <i className="fa fa-circle text-[10px]"></i>
                <i className="fa fa-circle text-[10px] mx-1"></i>
                <i className="fa fa-circle text-[10px]"></i>
            </div>
            <span className="text-sm text-gray-400">{t("onboarding.fakeChat.thinking")}</span>
        </div>
    );
});

AIThinking.displayName = "AIThinking";

const FakeToolCall = memo(({ toolName, toolDescription }: { toolName: string; toolDescription: string }) => {
    return (
        <div className="flex items-start gap-1 p-2 rounded bg-zinc-800 border border-gray-700 text-success">
            <span className="font-bold">✓</span>
            <div className="flex-1">
                <div className="font-semibold">{toolName}</div>
                <div className="text-sm text-gray-400">{toolDescription}</div>
            </div>
        </div>
    );
});

FakeToolCall.displayName = "FakeToolCall";

const FakeUserMessage = memo(({ userPrompt }: { userPrompt: string }) => {
    return (
        <div className="flex justify-end">
            <div className="px-2 py-2 rounded-lg bg-zinc-700 text-white max-w-[calc(100%-20px)]">
                <div className="whitespace-pre-wrap break-words">{userPrompt}</div>
            </div>
        </div>
    );
});

FakeUserMessage.displayName = "FakeUserMessage";

const FakeAssistantMessage = memo(({ config, onComplete }: { config: ChatConfig; onComplete?: () => void }) => {
    const [phase, setPhase] = useState<"thinking" | "tool" | "streaming">("thinking");
    const [streamedText, setStreamedText] = useState("");

    useEffect(() => {
        const timeouts: NodeJS.Timeout[] = [];
        let streamInterval: NodeJS.Timeout | null = null;

        const runAnimation = () => {
            setPhase("thinking");
            setStreamedText("");

            timeouts.push(
                setTimeout(() => {
                    setPhase("tool");
                }, 2000)
            );

            timeouts.push(
                setTimeout(() => {
                    setPhase("streaming");
                }, 4000)
            );

            timeouts.push(
                setTimeout(() => {
                    let currentIndex = 0;
                    streamInterval = setInterval(() => {
                        if (currentIndex >= config.markdownResponse.length) {
                            if (streamInterval) {
                                clearInterval(streamInterval);
                                streamInterval = null;
                            }
                            if (onComplete) {
                                onComplete();
                            }
                            return;
                        }
                        currentIndex += 10;
                        setStreamedText(config.markdownResponse.slice(0, currentIndex));
                    }, 100);
                }, 4000)
            );
        };

        runAnimation();

        return () => {
            timeouts.forEach(clearTimeout);
            if (streamInterval) {
                clearInterval(streamInterval);
            }
        };
    }, [config.markdownResponse, onComplete]);

    return (
        <div className="flex justify-start">
            <div className="px-2 py-2 rounded-lg">
                {phase === "thinking" && <AIThinking />}
                {phase === "tool" && (
                    <>
                        <div className="mb-2">
                            <FakeToolCall toolName={config.toolName} toolDescription={config.toolDescription} />
                        </div>
                        <AIThinking />
                    </>
                )}
                {phase === "streaming" && (
                    <>
                        <div className="mb-2">
                            <FakeToolCall toolName={config.toolName} toolDescription={config.toolDescription} />
                        </div>
                        <WaveStreamdown text={streamedText} parseIncompleteMarkdown={true} className="text-gray-100" />
                    </>
                )}
            </div>
        </div>
    );
});

FakeAssistantMessage.displayName = "FakeAssistantMessage";

const FakeAIPanelHeader = memo(() => {
    const { t } = useTranslation();

    return (
        <div className="py-2 pl-3 pr-1 border-b border-gray-600 flex items-center justify-between min-w-0 bg-zinc-900">
            <h2 className="text-white text-sm font-semibold flex items-center gap-2 flex-shrink-0 whitespace-nowrap">
                <i className="fa fa-sparkles text-accent"></i>
                {t("aipanel.header")}
            </h2>

            <div className="flex items-center flex-shrink-0 whitespace-nowrap">
                <div className="flex items-center text-sm whitespace-nowrap">
                    <span className="text-gray-300 mr-1 text-[12px]">{t("aipanel.context")}</span>
                    <button
                        className="relative inline-flex h-6 w-14 items-center rounded-full transition-colors bg-accent-600"
                        title={t("onboarding.fakeChat.widgetAccessOnTitle")}
                    >
                        <span className="absolute inline-block h-4 w-4 transform rounded-full bg-white transition-transform translate-x-8" />
                        <span className="relative z-10 text-xs text-white transition-all ml-2.5 mr-6 text-left font-bold">
                            {t("aipanel.widgetContextOn")}
                        </span>
                    </button>
                </div>

                <button
                    className="text-gray-400 transition-colors p-1 rounded flex-shrink-0 ml-2 focus:outline-none"
                    title={t("common.moreOptions")}
                >
                    <i className="fa fa-ellipsis-vertical"></i>
                </button>
            </div>
        </div>
    );
});

FakeAIPanelHeader.displayName = "FakeAIPanelHeader";

export const FakeChat = memo(() => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [chatIndex, setChatIndex] = useState(1);
    const config = chatConfigs[chatIndex] || chatConfigs[0];

    useEffect(() => {
        const interval = setInterval(() => {
            if (scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    const handleComplete = () => {
        setTimeout(() => {
            setChatIndex((prev) => (prev + 1) % chatConfigs.length);
        }, 2000);
    };

    return (
        <div className="flex flex-col w-full h-full">
            <FakeAIPanelHeader />
            <div className="flex-1 overflow-hidden">
                <div ref={scrollRef} className="flex flex-col gap-1 p-2 h-full overflow-y-auto bg-zinc-900">
                    <FakeUserMessage userPrompt={config.userPrompt} />
                    <FakeAssistantMessage config={config} onComplete={handleComplete} />
                </div>
            </div>
        </div>
    );
});

FakeChat.displayName = "FakeChat";

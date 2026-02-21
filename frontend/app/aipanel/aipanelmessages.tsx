// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { AIMessage } from "./aimessage";
import { AIModeDropdown } from "./aimode";
import { type WaveUIMessage } from "./aitypes";
import { WaveAIModel } from "./waveai-model";

interface AIPanelMessagesProps {
    messages: WaveUIMessage[];
    status: string;
    onContextMenu?: (e: React.MouseEvent) => void;
}

export const AIPanelMessages = memo(({ messages, status, onContextMenu }: AIPanelMessagesProps) => {
    const model = WaveAIModel.getInstance();
    const isPanelOpen = useAtomValue(model.getPanelVisibleAtom());
    const isWaveAIFocused = useAtomValue(model.isWaveAIFocusedAtom);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const messagesContainerRef = useRef<HTMLDivElement>(null);
    const messagesContentRef = useRef<HTMLDivElement>(null);
    const prevStatusRef = useRef<string>(status);
    const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
    const shouldAutoScrollRef = useRef(true);
    const lineScrollPx = 24;

    const checkIfAtBottom = useCallback(() => {
        const container = messagesContainerRef.current;
        if (!container) return true;

        const threshold = 50;
        const scrollBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
        return scrollBottom <= threshold;
    }, []);

    const handleScroll = useCallback(() => {
        const atBottom = checkIfAtBottom();
        setShouldAutoScroll(atBottom);
    }, [checkIfAtBottom]);

    const scrollToBottom = useCallback(() => {
        const container = messagesContainerRef.current;
        if (container) {
            messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
            container.scrollTop = container.scrollHeight;
            container.scrollLeft = 0;
            setShouldAutoScroll(true);
        }
    }, []);

    const scrollByLine = useCallback((direction: "up" | "down") => {
        const container = messagesContainerRef.current;
        if (!container) {
            return;
        }
        const delta = direction === "up" ? -lineScrollPx : lineScrollPx;
        container.scrollTop += delta;
        setShouldAutoScroll(checkIfAtBottom());
    }, [checkIfAtBottom]);

    useEffect(() => {
        shouldAutoScrollRef.current = shouldAutoScroll;
    }, [shouldAutoScroll]);

    useEffect(() => {
        const container = messagesContainerRef.current;
        if (!container) return;

        container.addEventListener("scroll", handleScroll);
        return () => container.removeEventListener("scroll", handleScroll);
    }, []);

    useEffect(() => {
        model.registerScrollToBottom(scrollToBottom);
        model.registerScrollByLine(scrollByLine);
    }, [model, scrollByLine, scrollToBottom]);

    useEffect(() => {
        const content = messagesContentRef.current;
        const container = messagesContainerRef.current;
        if (!content || !container) {
            return;
        }
        if (typeof ResizeObserver === "undefined") {
            return;
        }
        const observer = new ResizeObserver(() => {
            if (!shouldAutoScrollRef.current) {
                return;
            }
            // The content can grow asynchronously (streaming updates, fonts, images). Keep the view pinned.
            requestAnimationFrame(() => scrollToBottom());
        });
        observer.observe(content);
        return () => observer.disconnect();
    }, [scrollToBottom]);

    useEffect(() => {
        const onWindowKeyDown = (event: KeyboardEvent) => {
            if (!isPanelOpen || !isWaveAIFocused) {
                return;
            }
            if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
                return;
            }
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
                return;
            }
            const target = event.target as HTMLElement | null;
            if (target != null) {
                const tagName = target.tagName;
                const isEditor =
                    tagName === "TEXTAREA" ||
                    tagName === "INPUT" ||
                    tagName === "SELECT" ||
                    target.isContentEditable;
                if (isEditor) {
                    return;
                }
            }
            scrollByLine(event.key === "ArrowUp" ? "up" : "down");
            event.preventDefault();
        };
        window.addEventListener("keydown", onWindowKeyDown);
        return () => {
            window.removeEventListener("keydown", onWindowKeyDown);
        };
    }, [isPanelOpen, isWaveAIFocused]);

    useEffect(() => {
        if (shouldAutoScroll) {
            scrollToBottom();
        }
    }, [messages, shouldAutoScroll]);

    useEffect(() => {
        if (isPanelOpen) {
            scrollToBottom();
        }
    }, [isPanelOpen]);

    useEffect(() => {
        const wasStreaming = prevStatusRef.current === "streaming";
        const isNowNotStreaming = status !== "streaming";

        if (wasStreaming && isNowNotStreaming) {
            requestAnimationFrame(() => {
                scrollToBottom();
            });
        }

        prevStatusRef.current = status;
    }, [status]);

    return (
        <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-2" onContextMenu={onContextMenu}>
            <div ref={messagesContentRef} className="space-y-4">
                <div className="mb-2">
                    <AIModeDropdown compatibilityMode={true} />
                </div>
                {messages.map((message, index) => {
                    const isLastMessage = index === messages.length - 1;
                    const isStreaming = status === "streaming" && isLastMessage && message.role === "assistant";
                    return <AIMessage key={message.id} message={message} isStreaming={isStreaming} />;
                })}

                {status === "streaming" &&
                    (messages.length === 0 || messages[messages.length - 1].role !== "assistant") && (
                        <AIMessage
                            key="last-message"
                            message={{ role: "assistant", parts: [], id: "last-message" } as any}
                            isStreaming={true}
                        />
                    )}

                <div ref={messagesEndRef} />
            </div>
        </div>
    );
});

AIPanelMessages.displayName = "AIPanelMessages";

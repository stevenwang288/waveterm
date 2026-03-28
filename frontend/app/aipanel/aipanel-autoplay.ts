// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { ChatStatus } from "ai";
import { hasAssistantRenderableContent, isAssistantMessageLikelyIncomplete } from "./aimessage";
import type { WaveUIMessage } from "./aitypes";

export type AssistantAutoPlayTarget = {
    messageId: string;
    text: string;
};

const CurrentTabStateTailPattern = /\s*<current_tab_state>\s*[\s\S]*$/i;

export function getAssistantMessageText(message: WaveUIMessage | null | undefined): string {
    if (message?.role !== "assistant") {
        return "";
    }
    return (message.parts ?? [])
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("\n\n")
        .trim();
}

export function sanitizeAssistantAutoPlayText(text: string): string {
    return text.trim().replace(CurrentTabStateTailPattern, "").trim();
}

export function findLatestAssistantMessage(messages: WaveUIMessage[]): WaveUIMessage | null {
    for (let idx = messages.length - 1; idx >= 0; idx--) {
        const message = messages[idx];
        if (message?.role === "assistant") {
            return message;
        }
    }
    return null;
}

export function resolveAssistantAutoPlayTarget(input: {
    initialLoadDone: boolean;
    status: ChatStatus;
    prevStatus: ChatStatus;
    isAIStreaming: boolean;
    latestAssistantMessage: WaveUIMessage | null;
    latestAssistantMessageText: string;
    lastAutoPlayedMessageId: string | null | undefined;
}): AssistantAutoPlayTarget | null {
    const {
        initialLoadDone,
        status,
        prevStatus,
        isAIStreaming,
        latestAssistantMessage,
        latestAssistantMessageText,
        lastAutoPlayedMessageId,
    } = input;

    if (!initialLoadDone || isAIStreaming || status !== "ready" || prevStatus === "ready") {
        return null;
    }
    if (!latestAssistantMessage?.id || latestAssistantMessage.role !== "assistant") {
        return null;
    }
    if (lastAutoPlayedMessageId === latestAssistantMessage.id) {
        return null;
    }
    if (
        !hasAssistantRenderableContent(latestAssistantMessage) ||
        isAssistantMessageLikelyIncomplete(latestAssistantMessage)
    ) {
        return null;
    }

    const text = sanitizeAssistantAutoPlayText(getAssistantMessageText(latestAssistantMessage));
    const latestText = sanitizeAssistantAutoPlayText(latestAssistantMessageText || "");
    if (!text) {
        return null;
    }
    if (latestText && text !== latestText) {
        return null;
    }

    return {
        messageId: latestAssistantMessage.id,
        text,
    };
}

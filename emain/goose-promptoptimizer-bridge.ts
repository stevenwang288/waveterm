// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getGooseAppConfig, getGooseBaseUrl, getGooseSecretKey } from "./goose-runtime";

type GoosePromptOptimizationRequest = {
    prompt: string;
    provider?: string;
    model?: string;
};

type GooseMessageContent = {
    type?: string;
    text?: string;
};

type GooseMessage = {
    id?: string;
    role?: string;
    content?: GooseMessageContent[];
};

type GooseReplyEvent = {
    type?: string;
    error?: string;
    message?: GooseMessage;
};

type GooseSession = {
    id?: string;
};

type GooseProviderSelection = {
    model: string;
    provider: string;
};

const PromptOptimizerInstruction = `你现在只做一件事：把用户原始输入优化成更清晰、更可直接发送给 AI 的提示词。

要求：
- 保持用户原始意图不变
- 消除模糊表达和歧义
- 补充必要但不过度的上下文
- 如果原文已经足够清晰，只做最小必要改动
- 不要回答原问题
- 不要解释
- 不要加标题
- 不要用代码块
- 不要加引号
- 只输出优化后的提示词正文

待优化原文：
`;

function getGooseWorkingDir(): string {
    const envDir = process.env.WAVE_GOOSE_WORKING_DIR?.trim();
    return envDir || process.cwd();
}

function resolveGooseProviderSelection(request: GoosePromptOptimizationRequest): GooseProviderSelection {
    const appConfig = getGooseAppConfig() as Record<string, unknown>;
    const provider =
        request.provider?.trim() ||
        (typeof appConfig.GOOSE_DEFAULT_PROVIDER === "string" ? appConfig.GOOSE_DEFAULT_PROVIDER.trim() : "");
    const model =
        request.model?.trim() ||
        (typeof appConfig.GOOSE_DEFAULT_MODEL === "string" ? appConfig.GOOSE_DEFAULT_MODEL.trim() : "");

    if (!provider || !model) {
        throw new Error("Goose 当前 provider 或 model 未设置。");
    }

    return { provider, model };
}

async function getGooseBridgeHeaders(): Promise<Record<string, string>> {
    const secretKey = await getGooseSecretKey();
    return {
        "Content-Type": "application/json",
        "X-Secret-Key": secretKey,
    };
}

async function fetchGoose(pathname: string, init?: RequestInit): Promise<Response> {
    const baseUrl = await getGooseBaseUrl();
    return fetch(`${baseUrl}${pathname}`, {
        ...init,
        headers: {
            ...(await getGooseBridgeHeaders()),
            ...(init?.headers ?? {}),
        },
    });
}

async function fetchGooseJson<T>(pathname: string, init?: RequestInit): Promise<T> {
    const response = await fetchGoose(pathname, init);
    if (!response.ok) {
        const errorText = (await response.text()).trim();
        throw new Error(
            `Goose 接口请求失败: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`
        );
    }
    return (await response.json()) as T;
}

function createGooseUserMessage(text: string) {
    return {
        role: "user",
        created: Math.floor(Date.now() / 1000),
        content: [
            {
                type: "text",
                text,
            },
        ],
        metadata: {
            userVisible: true,
            agentVisible: true,
        },
    };
}

function extractGooseMessageText(message: unknown, options?: { trim?: boolean }): string {
    if (message == null || typeof message !== "object") {
        return "";
    }
    const typedMessage = message as GooseMessage;
    if (!Array.isArray(typedMessage.content)) {
        return "";
    }
    const text = typedMessage.content
        .map((item) => {
            if (item != null && typeof item === "object" && typeof item.text === "string") {
                return item.text;
            }
            return "";
        })
        .join("");
    return options?.trim === false ? text : text.trim();
}

function unwrapOptimizedPrompt(text: string): string {
    let next = text.trim();
    if (next.startsWith("```") && next.endsWith("```")) {
        next = next.replace(/^```[^\n]*\n?/, "").replace(/\n?```$/, "").trim();
    }
    if ((next.startsWith("\"") && next.endsWith("\"")) || (next.startsWith("'") && next.endsWith("'"))) {
        next = next.slice(1, -1).trim();
    }
    return next;
}

function resolveGooseAssistantMessageKey(message: GooseMessage, previousKey: string | null): string {
    const messageId = typeof message.id === "string" ? message.id.trim() : "";
    if (messageId) {
        return messageId;
    }
    return previousKey || "__assistant__";
}

function drainSseEvents(buffer: string): { events: string[]; rest: string } {
    const events: string[] = [];
    let remaining = buffer;
    while (true) {
        const separatorIndex = remaining.indexOf("\n\n");
        if (separatorIndex < 0) {
            break;
        }
        const rawEvent = remaining.slice(0, separatorIndex);
        remaining = remaining.slice(separatorIndex + 2);
        const dataLines = rawEvent
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .filter(Boolean);
        if (dataLines.length > 0) {
            events.push(dataLines.join("\n"));
        }
    }
    return { events, rest: remaining };
}

async function startTemporaryGooseSession(): Promise<string> {
    const session = await fetchGooseJson<GooseSession>("/agent/start", {
        method: "POST",
        body: JSON.stringify({
            working_dir: getGooseWorkingDir(),
            extension_overrides: [],
        }),
    });
    const sessionId = session.id?.trim();
    if (!sessionId) {
        throw new Error("Goose 临时优化会话创建失败。");
    }
    return sessionId;
}

async function updateTemporaryGooseSessionProvider(
    sessionId: string,
    selection: GooseProviderSelection
): Promise<void> {
    const response = await fetchGoose("/agent/update_provider", {
        method: "POST",
        body: JSON.stringify({
            session_id: sessionId,
            provider: selection.provider,
            model: selection.model,
        }),
    });
    if (response.ok) {
        return;
    }
    const errorText = (await response.text()).trim();
    throw new Error(
        `Goose provider 初始化失败: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`
    );
}

async function deleteTemporaryGooseSession(sessionId: string): Promise<void> {
    const response = await fetchGoose(`/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
    }).catch(() => null);
    if (response == null || response.ok || response.status === 404) {
        return;
    }
    const errorText = (await response.text()).trim();
    console.warn(
        `[goose-optimizer] failed to delete temp session ${sessionId}: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`
    );
}

async function optimizePromptViaTemporarySession(
    prompt: string,
    selection: GooseProviderSelection
): Promise<string> {
    const sessionId = await startTemporaryGooseSession();
    try {
        await updateTemporaryGooseSessionProvider(sessionId, selection);

        const response = await fetchGoose("/reply", {
            method: "POST",
            body: JSON.stringify({
                session_id: sessionId,
                user_message: createGooseUserMessage(`${PromptOptimizerInstruction}${prompt}`),
            }),
        });

        if (!response.ok) {
            const errorText = (await response.text()).trim();
            throw new Error(
                `Goose 优化请求失败: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`
            );
        }

        if (response.body == null) {
            throw new Error("Goose 优化请求未返回响应体。");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        const assistantMessageText = new Map<string, string>();
        let lastAssistantMessageKey: string | null = null;

        while (true) {
            const { done, value } = await reader.read();
            pending += decoder.decode(value ?? new Uint8Array(), { stream: !done });

            const { events, rest } = drainSseEvents(pending);
            pending = rest;

            for (const rawEvent of events) {
                const event = JSON.parse(rawEvent) as GooseReplyEvent;
                if (event.type === "Error") {
                    throw new Error(event.error?.trim() || "Goose 优化失败。");
                }
                if (event.type === "Message" && event.message?.role === "assistant") {
                    const messageKey = resolveGooseAssistantMessageKey(event.message, lastAssistantMessageKey);
                    const messageChunk = extractGooseMessageText(event.message, { trim: false });
                    lastAssistantMessageKey = messageKey;
                    if (messageChunk.length > 0) {
                        assistantMessageText.set(
                            messageKey,
                            `${assistantMessageText.get(messageKey) ?? ""}${messageChunk}`
                        );
                    }
                }
            }

            if (done) {
                break;
            }
        }

        const optimizedPrompt = unwrapOptimizedPrompt(
            lastAssistantMessageKey == null
                ? ""
                : (assistantMessageText.get(lastAssistantMessageKey) ?? "")
        );
        if (!optimizedPrompt) {
            throw new Error("Goose 优化结果为空。");
        }
        return optimizedPrompt;
    } finally {
        await deleteTemporaryGooseSession(sessionId);
    }
}

export async function optimizePromptViaGooseBackend(request: GoosePromptOptimizationRequest): Promise<string> {
    const normalizedPrompt = request.prompt.trim();
    if (!normalizedPrompt) {
        return request.prompt;
    }
    return optimizePromptViaTemporarySession(normalizedPrompt, resolveGooseProviderSelection(request));
}

export async function optimizeEmbeddedGoosePromptInput(request: GoosePromptOptimizationRequest): Promise<string> {
    return optimizePromptViaGooseBackend(request);
}

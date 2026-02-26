// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const MaxSpeechInputLength = 4096;
const MinSpeechRate = 0.5;
const MaxSpeechRate = 2;

export const DefaultOpenAICompatibleSpeechEndpoint = "https://api.openai.com/v1/audio/speech";
export const DefaultOpenAICompatibleSpeechModel = "gpt-4o-mini-tts";
export const DefaultOpenAICompatibleSpeechVoice = "alloy";

export type SpeechFilterOptions = {
    filterUrls?: boolean;
    filterPaths?: boolean;
    filterCode?: boolean;
};

export type OpenAICompatibleSpeechConfig = {
    endpoint: string;
    model?: string;
    token?: string;
    voice?: string;
    speed?: number;
};

export function normalizeSpeechRate(rate: unknown, fallback = 1): number {
    if (typeof rate !== "number" || Number.isNaN(rate) || !Number.isFinite(rate)) {
        return fallback;
    }
    return Math.min(MaxSpeechRate, Math.max(MinSpeechRate, rate));
}

function stripSpeechNoise(text: string, filterOptions?: SpeechFilterOptions): string {
    const filterUrls = filterOptions?.filterUrls ?? true;
    const filterPaths = filterOptions?.filterPaths ?? true;
    const filterCode = filterOptions?.filterCode ?? true;
    let cleaned = text;

    if (filterCode) {
        cleaned = cleaned.replace(/```[\s\S]*?```/g, " ");
        cleaned = cleaned.replace(/`[^`]*`/g, " ");
    }

    if (filterUrls) {
        cleaned = cleaned.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|www\.[^)]+)\)/gi, "$1");
        cleaned = cleaned.replace(/\bhttps?:\/\/\S+/gi, " ");
        cleaned = cleaned.replace(/\bwww\.\S+/gi, " ");
    }

    if (filterPaths) {
        cleaned = cleaned.replace(/\b[a-zA-Z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g, " ");
        cleaned = cleaned.replace(/\\\\[^\s\\]+\\[^\s]+/g, " ");
        cleaned = cleaned.replace(/(?:^|[\s(])(?:~\/|\/)(?:[^\s)]+\/)+[^\s)]+/g, " ");
        cleaned = cleaned.replace(/\b(?:[A-Za-z0-9_.-]+\/){2,}[A-Za-z0-9_.-]+\b/g, " ");
        cleaned = cleaned.replace(
            /\b[\w.-]+\.(?:ts|tsx|js|jsx|go|rs|py|json|yaml|yml|md|txt|log|exe|dll|so|dylib|png|jpg|jpeg|gif|webp)\b/gi,
            " "
        );
    }
    return cleaned;
}

function normalizeSpeechInput(text: string, filterOptions?: SpeechFilterOptions): string {
    return stripSpeechNoise(text, filterOptions).replace(/\s+/g, " ").trim().slice(0, MaxSpeechInputLength);
}

function normalizeSpeechInputForChunking(text: string, filterOptions?: SpeechFilterOptions): string {
    return stripSpeechNoise(text, filterOptions)
        .replace(/\r\n?/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function findSpeechChunkSplitIndex(text: string, maxLen: number): number {
    const hardEnd = Math.min(maxLen, text.length);
    if (hardEnd <= 0) {
        return 0;
    }
    if (hardEnd >= text.length) {
        return text.length;
    }

    const windowSize = 240;
    const windowStart = Math.max(0, hardEnd - windowSize);
    const windowText = text.slice(windowStart, hardEnd);

    const paraIdx = windowText.lastIndexOf("\n\n");
    if (paraIdx >= 0 && windowStart+paraIdx > 0) {
        return windowStart + paraIdx + 2;
    }

    const lineIdx = windowText.lastIndexOf("\n");
    if (lineIdx >= 0 && windowStart+lineIdx > 0) {
        return windowStart + lineIdx + 1;
    }

    const punctuationChars = "。！？.!?；;:：";
    for (let idx = windowText.length - 1; idx >= 0; idx--) {
        if (punctuationChars.includes(windowText[idx])) {
            return windowStart + idx + 1;
        }
    }

    const spaceIdx = windowText.lastIndexOf(" ");
    if (spaceIdx >= 0 && windowStart+spaceIdx > 0) {
        return windowStart + spaceIdx + 1;
    }

    return hardEnd;
}

export function chunkSpeechInput(text: string, filterOptions?: SpeechFilterOptions): string[] {
    const normalized = normalizeSpeechInputForChunking(text, filterOptions);
    if (!normalized) {
        return [];
    }
    if (normalized.length <= MaxSpeechInputLength) {
        return [normalized];
    }

    const chunks: string[] = [];
    let remaining = normalized;
    let safety = 0;
    while (remaining.length > MaxSpeechInputLength && safety < 10_000) {
        const splitIdx = findSpeechChunkSplitIndex(remaining, MaxSpeechInputLength);
        const safeSplitIdx = splitIdx > 0 ? splitIdx : Math.min(MaxSpeechInputLength, remaining.length);
        const chunk = remaining.slice(0, safeSplitIdx).trim();
        if (chunk) {
            chunks.push(chunk);
        }
        remaining = remaining.slice(safeSplitIdx).trim();
        safety += 1;
    }
    if (remaining) {
        chunks.push(remaining);
    }
    return chunks;
}

export function resolveOpenAICompatibleSpeechEndpoint(rawEndpoint?: string, token?: string): string | null {
    const endpoint = rawEndpoint?.trim();
    if (!endpoint) {
        if (token?.trim()) {
            return DefaultOpenAICompatibleSpeechEndpoint;
        }
        return null;
    }
    let url: URL;
    try {
        url = new URL(endpoint);
    } catch {
        return null;
    }

    const path = url.pathname.toLowerCase();
    if (path.endsWith("/audio/speech")) {
        url.search = "";
        url.hash = "";
        return url.toString();
    }
    if (path.endsWith("/chat/completions")) {
        url.pathname = url.pathname.replace(/\/chat\/completions$/i, "/audio/speech");
    } else if (path.endsWith("/responses")) {
        url.pathname = url.pathname.replace(/\/responses$/i, "/audio/speech");
    } else if (path.endsWith("/v1")) {
        url.pathname = `${url.pathname.replace(/\/$/, "")}/audio/speech`;
    } else if (url.pathname === "" || url.pathname === "/") {
        url.pathname = "/v1/audio/speech";
    } else {
        url.pathname = `${url.pathname.replace(/\/$/, "")}/audio/speech`;
    }

    url.search = "";
    url.hash = "";
    return url.toString();
}

async function safeReadText(response: Response): Promise<string> {
    try {
        return (await response.text()).trim();
    } catch {
        return "";
    }
}

type MainProcessSpeechResponse = {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    bodyBase64: string;
};

function hasMainProcessSpeechRequestApi(): boolean {
    if (typeof window === "undefined") {
        return false;
    }
    const api = (window as any).api;
    return typeof api?.speechRequest === "function";
}

function decodeBase64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64 || "");
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let idx = 0; idx < binary.length; idx++) {
        bytes[idx] = binary.charCodeAt(idx);
    }
    return bytes;
}

function decodeBytesToText(bytes: Uint8Array): string {
    try {
        return new TextDecoder().decode(bytes).trim();
    } catch {
        return "";
    }
}

function getHeaderCaseInsensitive(headers: Record<string, string> | null | undefined, key: string): string {
    if (!headers) {
        return "";
    }
    const loweredKey = key.toLowerCase();
    for (const [headerKey, headerValue] of Object.entries(headers)) {
        if (headerKey.toLowerCase() === loweredKey) {
            return headerValue ?? "";
        }
    }
    return "";
}

export async function requestOpenAICompatibleSpeechAudio(
    text: string,
    config: OpenAICompatibleSpeechConfig,
    signal?: AbortSignal,
    filterOptions?: SpeechFilterOptions
): Promise<Blob> {
    const input = normalizeSpeechInput(text, filterOptions);
    if (input === "") {
        throw new Error("No text content to read.");
    }
    if (!config.endpoint) {
        throw new Error("Speech endpoint is not configured.");
    }
    let endpointUrl: URL | null = null;
    try {
        endpointUrl = new URL(config.endpoint);
    } catch {
        endpointUrl = null;
    }

    if (!endpointUrl) {
        throw new Error("Invalid speech endpoint url.");
    }

    // Edge-only build: do not allow external endpoints. This prevents accidental downgrade to
    // low-quality OS/browser TTS or misconfigured API providers.
    if (endpointUrl.protocol !== "wave:" || endpointUrl.hostname.toLowerCase() !== "edge-tts") {
        throw new Error("仅支持内置 Edge TTS（wave://edge-tts/v1/audio/speech）。");
    }

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };
    const token = config.token?.trim();
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    const payload = {
        model: config.model?.trim() || DefaultOpenAICompatibleSpeechModel,
        input,
        voice: config.voice?.trim() || DefaultOpenAICompatibleSpeechVoice,
        speed: normalizeSpeechRate(config.speed, 1),
        response_format: "mp3",
        format: "mp3",
    };

    if (signal?.aborted) {
        throw new Error("Speech request aborted.");
    }

    if (hasMainProcessSpeechRequestApi()) {
        const response = (await (window as any).api.speechRequest({
            url: config.endpoint,
            method: "POST",
            headers,
            body: JSON.stringify(payload),
        })) as MainProcessSpeechResponse;
        if (signal?.aborted) {
            throw new Error("Speech request aborted.");
        }

        const responseBytes = decodeBase64ToBytes(response?.bodyBase64 || "");
        const details = decodeBytesToText(responseBytes);
        const status = Number(response?.status ?? 0);
        const statusText = response?.statusText ?? "";
        if (!(status >= 200 && status < 300)) {
            throw new Error(`Speech request failed (${status}): ${details || statusText}`);
        }
        const contentType = getHeaderCaseInsensitive(response?.headers, "content-type");
        const normalizedContentType = contentType.toLowerCase();
        if (normalizedContentType.includes("application/json")) {
            throw new Error(details || "Speech request returned JSON instead of audio.");
        }
        if (
            normalizedContentType &&
            !normalizedContentType.includes("audio/") &&
            !normalizedContentType.includes("application/octet-stream")
        ) {
            throw new Error(
                details ||
                    `Speech request returned non-audio content type: ${contentType}.`
            );
        }
        if (responseBytes.byteLength === 0) {
            throw new Error("Speech request returned empty audio.");
        }
        const mimeType = contentType && !normalizedContentType.includes("json") ? contentType : "audio/mpeg";
        return new Blob([responseBytes.buffer as ArrayBuffer], { type: mimeType });
    }

    throw new Error("内置语音需要桌面版（main-process speechRequest）。");
}

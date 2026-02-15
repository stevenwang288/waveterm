// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const MaxSpeechInputLength = 4096;

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
};

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

export function canUseLocalSpeechSynthesis(): boolean {
    return (
        typeof window !== "undefined" &&
        typeof window.speechSynthesis !== "undefined" &&
        typeof window.SpeechSynthesisUtterance !== "undefined"
    );
}

export function stopLocalSpeechSynthesis(): void {
    if (!canUseLocalSpeechSynthesis()) {
        return;
    }
    window.speechSynthesis.cancel();
}

export function speakLocally(
    text: string,
    handlers?: {
        onDone?: () => void;
        onError?: (message: string) => void;
    },
    filterOptions?: SpeechFilterOptions
): boolean {
    if (!canUseLocalSpeechSynthesis()) {
        handlers?.onError?.("Speech synthesis is not available.");
        return false;
    }
    const input = normalizeSpeechInput(text, filterOptions);
    if (input === "") {
        handlers?.onError?.("No text content to read.");
        return false;
    }

    let finished = false;
    const finalize = () => {
        if (finished) {
            return;
        }
        finished = true;
        handlers?.onDone?.();
    };

    const utterance = new SpeechSynthesisUtterance(input);
    utterance.lang = navigator.language || "en-US";
    utterance.onend = () => finalize();
    utterance.onerror = (event: SpeechSynthesisErrorEvent) => {
        handlers?.onError?.(event.error || "Speech synthesis failed.");
        finalize();
    };

    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    return true;
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
        response_format: "mp3",
        format: "mp3",
    };

    const response = await fetch(config.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal,
    });
    if (!response.ok) {
        const details = await safeReadText(response);
        throw new Error(`Speech API request failed (${response.status}): ${details || response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
        const details = await safeReadText(response);
        throw new Error(details || "Speech API returned JSON instead of audio.");
    }

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0) {
        throw new Error("Speech API returned empty audio.");
    }

    const mimeType = contentType && !contentType.includes("json") ? contentType : "audio/mpeg";
    return new Blob([bytes], { type: mimeType });
}

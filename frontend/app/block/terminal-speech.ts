// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { speechRuntime } from "@/app/aipanel/speechruntime";
import type { ResolvedSpeechSettings } from "@/app/aipanel/speechsettings";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";

const AnsiEscapePattern = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const IFlowExecutionInfoStartPattern = /^\s*<Execution Info>\s*$/i;
const IFlowExecutionInfoEndPattern = /^\s*<\/Execution Info>\s*$/i;
const NodeDeprecationWarningPattern = /^\s*\(node:\d+\)\s+\[dep\d+\]/i;
const NodeTraceHintPattern = /^\s*\(use `node --trace-deprecation[^)]*\)\s*$/i;
const CodexToolCallIntroPattern = /^(called|calling)\b/i;
const CodexToolCallLinePattern = /^\s*[•●]?\s*(called|calling)\b/i;
const CodexWorkingStatusLinePattern = /^\s*[•●]?\s*working\b.*\besc\s+to\s+interrupt\b.*$/i;
const TerminalBoxLinePattern = /^\s*[│┃╭╮╰╯├┤┬┴┼─━╶╴╷╵]+\s*.*$/;
const TerminalSeparatorPattern = /^\s*[─━]{10,}\s*$/;
const CodexBrandLinePattern = /^\s*>_\s*OpenAI\s+Codex\b/i;
const CodexModelLinePattern = /^\s*(?:模型|model)\s*[:：]\s*.+$/i;
const CodexDirectoryLinePattern = /^\s*(?:目录|directory|cwd)\s*[:：]\s*.+$/i;
const CtrlCKeywordPattern = /\bctrl\s*\+\s*c\b/i;
const CtrlCCountOrOrdinalPattern =
    /(第一次|第二次|第三次|第四次|第[一二三四五六七八九十0-9]+次|\b(first|second|third|fourth|fifth)\b|\b\d+\s*(?:\/|of)\s*\d+\b)/i;
const CtrlCRepeatHintPattern = /\bagain\b|再次|再按|再按一次|再按下/i;

function isCodexUserPromptLine(line: string): boolean {
    return /^\s*[›❯](?:\s+.*)?$/.test(line) || /^\s*>\s+.+$/.test(line);
}

function isCodexAssistantReplyLine(line: string): boolean {
    return /^\s*[•●]\s+/.test(line);
}

function isLikelyShellPromptLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed) {
        return false;
    }
    if (/^(?:PS\s+)?[A-Za-z]:\\.*>\s*$/.test(trimmed)) {
        return true;
    }
    if (/^[^@\s]+@[^:\s]+:.*[$#]\s*$/.test(trimmed)) {
        return true;
    }
    if (/^[A-Za-z0-9_.-]+>\s*$/.test(trimmed) && trimmed.length <= 24) {
        return true;
    }
    return false;
}

function isTerminalStatusNoiseLine(line: string): boolean {
    const lowered = line.toLowerCase();
    const stripped = line.replace(/^\s*[•●]\s+/, "").trim();
    if (TerminalBoxLinePattern.test(line) || TerminalSeparatorPattern.test(line)) {
        return true;
    }
    if (CodexWorkingStatusLinePattern.test(line)) {
        return true;
    }
    // Codex progress/status lines often include "esc to interrupt" and should never be spoken.
    if (lowered.includes("esc to interrupt")) {
        return true;
    }
    if (CodexBrandLinePattern.test(line) || CodexModelLinePattern.test(line) || CodexDirectoryLinePattern.test(line)) {
        return true;
    }
    // Ctrl+C repeat / multi-press status lines should never be spoken (they are not assistant replies).
    if (CtrlCKeywordPattern.test(stripped) && (CtrlCRepeatHintPattern.test(stripped) || CtrlCCountOrOrdinalPattern.test(stripped))) {
        return true;
    }
    if (lowered.includes("for shortcuts") || lowered.includes("context left")) {
        return true;
    }
    if (NodeDeprecationWarningPattern.test(lowered) || NodeTraceHintPattern.test(lowered)) {
        return true;
    }
    return false;
}

function hasCodexUiCues(lines: string[]): boolean {
    for (const line of lines) {
        if (!line) {
            continue;
        }
        const lowered = line.toLowerCase();
        if (isCodexAssistantReplyLine(line)) {
            return true;
        }
        if (CodexToolCallLinePattern.test(line)) {
            return true;
        }
        if (CodexBrandLinePattern.test(line) || CodexModelLinePattern.test(line) || CodexDirectoryLinePattern.test(line)) {
            return true;
        }
        if (lowered.includes("openai codex") || lowered.includes("for shortcuts") || lowered.includes("context left")) {
            return true;
        }
    }
    return false;
}

function normalizeTerminalScrollbackLines(lines: string[]): string[] {
    const normalized = lines
        .map((line) => line.replace(AnsiEscapePattern, "").replace(/\r/g, "").replace(/\s+$/g, ""))
        .map((line) => line.trimEnd());
    while (normalized.length > 0 && normalized[normalized.length - 1].trim() === "") {
        normalized.pop();
    }
    return normalized;
}

function removeIFlowExecutionInfo(lines: string[]): { lines: string[]; hadExecutionInfo: boolean } {
    const cleaned: string[] = [];
    let inExecutionInfo = false;
    let hadExecutionInfo = false;
    for (const line of lines) {
        if (IFlowExecutionInfoStartPattern.test(line)) {
            inExecutionInfo = true;
            hadExecutionInfo = true;
            continue;
        }
        if (IFlowExecutionInfoEndPattern.test(line)) {
            inExecutionInfo = false;
            continue;
        }
        if (inExecutionInfo) {
            continue;
        }
        cleaned.push(line);
    }
    return { lines: cleaned, hadExecutionInfo };
}

function trimLineList(lines: string[]): string[] {
    let start = 0;
    let end = lines.length;
    while (start < end && lines[start].trim() === "") {
        start++;
    }
    while (end > start && lines[end - 1].trim() === "") {
        end--;
    }
    return lines.slice(start, end);
}

function buildCodexReplyFromSegment(lines: string[]): string {
    if (lines.length === 0) {
        return "";
    }
    const cleaned: string[] = [];
    for (let idx = 0; idx < lines.length; idx++) {
        if (isTerminalStatusNoiseLine(lines[idx])) {
            continue;
        }
        if (isCodexUserPromptLine(lines[idx])) {
            continue;
        }
        if (isLikelyShellPromptLine(lines[idx])) {
            continue;
        }
        let line = lines[idx];
        if (idx === 0) {
            line = line.replace(/^\s*[•●]\s+/, "");
        }
        cleaned.push(line);
    }
    const trimmed = trimLineList(cleaned);
    if (trimmed.length === 0) {
        return "";
    }
    if (CodexToolCallIntroPattern.test(trimmed[0].trim())) {
        return "";
    }
    return trimmed.join("\n").trim();
}

function buildPlainReplyFromSegment(lines: string[]): string {
    if (lines.some((line) => CodexToolCallLinePattern.test(line))) {
        return "";
    }
    const cleaned = lines.filter((line) => {
        if (isTerminalStatusNoiseLine(line)) {
            return false;
        }
        if (isCodexUserPromptLine(line)) {
            return false;
        }
        if (isLikelyShellPromptLine(line)) {
            return false;
        }
        return true;
    });
    return trimLineList(cleaned).join("\n").trim();
}

function extractLatestCodexBulletReply(lines: string[], requirePromptAfterReply: boolean): string {
    let latestReplyIdx = -1;
    for (let idx = lines.length - 1; idx >= 0; idx--) {
        if (isCodexAssistantReplyLine(lines[idx])) {
            latestReplyIdx = idx;
            break;
        }
    }
    if (latestReplyIdx === -1) {
        return "";
    }
    let endIdx = lines.length;
    let hasPromptAfterReply = false;
    for (let nextIdx = latestReplyIdx + 1; nextIdx < lines.length; nextIdx++) {
        if (isCodexUserPromptLine(lines[nextIdx])) {
            hasPromptAfterReply = true;
            endIdx = nextIdx;
            break;
        }
    }
    if (requirePromptAfterReply && !hasPromptAfterReply) {
        return "";
    }
    return buildCodexReplyFromSegment(lines.slice(latestReplyIdx, endIdx));
}

type PlainReplyCandidate = {
    reply: string;
    startIdx: number;
    endIdx: number;
};

function extractLatestPlainReplyCandidate(lines: string[]): PlainReplyCandidate | null {
    for (let idx = lines.length - 1; idx >= 0; idx--) {
        const line = lines[idx];
        if (!line || line.trim() === "") {
            continue;
        }
        if (isTerminalStatusNoiseLine(line) || isCodexUserPromptLine(line) || isLikelyShellPromptLine(line)) {
            continue;
        }
        let startIdx = idx;
        for (let prevIdx = idx - 1; prevIdx >= 0; prevIdx--) {
            const prev = lines[prevIdx];
            if (!prev || prev.trim() === "") {
                break;
            }
            if (isTerminalStatusNoiseLine(prev) || isCodexUserPromptLine(prev) || isLikelyShellPromptLine(prev)) {
                break;
            }
            startIdx = prevIdx;
        }
        const reply = buildPlainReplyFromSegment(lines.slice(startIdx, idx + 1));
        if (reply) {
            return { reply, startIdx, endIdx: idx };
        }
    }
    return null;
}

function hasPromptBoundaryBeforeIndex(lines: string[], boundaryIdx: number): boolean {
    for (let idx = boundaryIdx - 1; idx >= 0; idx--) {
        const line = lines[idx];
        if (!line || line.trim() === "") {
            continue;
        }
        if (isTerminalStatusNoiseLine(line)) {
            continue;
        }
        return isCodexUserPromptLine(line);
    }
    return false;
}

function hasPromptBoundaryAfterIndex(lines: string[], boundaryIdx: number): boolean {
    for (let idx = boundaryIdx + 1; idx < lines.length; idx++) {
        const line = lines[idx];
        if (!line || line.trim() === "") {
            continue;
        }
        if (isTerminalStatusNoiseLine(line)) {
            continue;
        }
        if (isCodexUserPromptLine(line)) {
            return true;
        }
    }
    return false;
}

function looksLikeAssistantFinalReply(text: string): boolean {
    if (!text) {
        return false;
    }
    if (text.includes("\n")) {
        return true;
    }
    if (/[。！？.!?;；:：]/.test(text)) {
        return true;
    }
    if (/[\u4E00-\u9FFF]/.test(text) && text.length >= 4) {
        return true;
    }
    return text.length >= 18;
}

function extractLatestPlainReply(lines: string[], allowLooseFallback: boolean, requirePromptAfterReply: boolean): string {
    const candidate = extractLatestPlainReplyCandidate(lines);
    if (!candidate) {
        return "";
    }
    if (requirePromptAfterReply && !hasPromptBoundaryAfterIndex(lines, candidate.endIdx)) {
        return "";
    }
    if (allowLooseFallback) {
        return looksLikeAssistantFinalReply(candidate.reply) ? candidate.reply : "";
    }
    if (hasPromptBoundaryBeforeIndex(lines, candidate.startIdx)) {
        return looksLikeAssistantFinalReply(candidate.reply) ? candidate.reply : "";
    }
    return "";
}

type ExtractLatestTerminalFormalReplyOptions = {
    requirePromptAfterCodexReply?: boolean;
};

export function extractLatestTerminalFormalReply(
    lines: string[],
    options?: ExtractLatestTerminalFormalReplyOptions
): string {
    const requirePromptAfterCodexReply = options?.requirePromptAfterCodexReply ?? false;
    const normalized = normalizeTerminalScrollbackLines(lines);
    const { lines: withoutIFlowExecutionInfo, hadExecutionInfo } = removeIFlowExecutionInfo(normalized);
    const codexReply = extractLatestCodexBulletReply(withoutIFlowExecutionInfo, requirePromptAfterCodexReply);
    if (codexReply) {
        return codexReply;
    }
    if (requirePromptAfterCodexReply) {
        // Strict mode: for Codex-like screens, only accept finalized assistant-bullet replies.
        // Do not fall back to plain-text snapshots such as model/status lines.
        if (hasCodexUiCues(withoutIFlowExecutionInfo)) {
            return "";
        }
    }
    return extractLatestPlainReply(withoutIFlowExecutionInfo, hadExecutionInfo, requirePromptAfterCodexReply);
}

type LoadLatestTerminalFormalReplyOptions = {
    blockId: string;
    onError?: (message: string) => void;
    preferLastCommand?: boolean;
    fallbackLineCount?: number;
    minLastUpdatedTs?: number;
    requirePromptAfterCodexReply?: boolean;
};

export type TerminalFormalReplyPayload = {
    id: string;
    text: string;
    outputTs: number;
};

export type LoadLatestTerminalFormalReplyPayloadOptions = LoadLatestTerminalFormalReplyOptions & {
    outputTs?: number;
};

function canUseScrollbackSnapshot(lastUpdated: unknown, minLastUpdatedTs: number): boolean {
    const minTs = Number(minLastUpdatedTs);
    if (!Number.isFinite(minTs) || minTs <= 0) {
        return true;
    }
    const updatedTs = Number(lastUpdated);
    if (!Number.isFinite(updatedTs) || updatedTs <= 0) {
        return false;
    }
    return updatedTs >= minTs;
}

function hashTextFNV1a32(input: string): string {
    let hash = 0x811c9dc5;
    for (let idx = 0; idx < input.length; idx++) {
        hash ^= input.charCodeAt(idx);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

export function makeTerminalFormalReplyPayloadId(outputTs: number, text: string): string {
    const safeOutputTs = Number.isFinite(outputTs) && outputTs > 0 ? Math.floor(outputTs) : 0;
    const normalizedText = (text ?? "").trim();
    return `${safeOutputTs}:${hashTextFNV1a32(normalizedText)}:${normalizedText.length}`;
}

export async function getLatestTerminalFormalReplyText(options: LoadLatestTerminalFormalReplyOptions): Promise<string> {
    const {
        blockId,
        onError,
        preferLastCommand = true,
        fallbackLineCount = 1200,
        minLastUpdatedTs = 0,
        requirePromptAfterCodexReply = false,
    } = options;
    const route = `feblock:${blockId}`;
    let lines: string[] = [];

    if (preferLastCommand) {
        try {
            const result = await RpcApi.TermGetScrollbackLinesCommand(
                TabRpcClient,
                { linestart: 0, lineend: 0, lastcommand: true },
                { route }
            );
            if (canUseScrollbackSnapshot(result?.lastupdated, minLastUpdatedTs)) {
                lines = result?.lines ?? [];
                if (lines.length > 0) {
                    const extracted = extractLatestTerminalFormalReply(lines, { requirePromptAfterCodexReply });
                    if (extracted) {
                        return extracted;
                    }
                }
            }
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            if (!errMsg.toLowerCase().includes("shell integration")) {
                onError?.(errMsg);
            }
        }
    }

    try {
        const fallback = await RpcApi.TermGetScrollbackLinesCommand(
            TabRpcClient,
            { linestart: 0, lineend: fallbackLineCount, lastcommand: false },
            { route }
        );
        if (!canUseScrollbackSnapshot(fallback?.lastupdated, minLastUpdatedTs)) {
            return "";
        }
        lines = fallback?.lines ?? [];
    } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        onError?.(fallbackMessage);
        return "";
    }

    const extracted = extractLatestTerminalFormalReply(lines, { requirePromptAfterCodexReply });
    if (extracted) {
        return extracted;
    }
    return "";
}

export async function loadLatestTerminalFormalReplyPayload(
    options: LoadLatestTerminalFormalReplyPayloadOptions
): Promise<TerminalFormalReplyPayload | null> {
    const {
        outputTs = 0,
        blockId,
        onError,
        preferLastCommand = true,
        fallbackLineCount = 1200,
        minLastUpdatedTs = 0,
        requirePromptAfterCodexReply = true,
    } = options;
    const formalReplyText = await getLatestTerminalFormalReplyText({
        blockId,
        onError,
        preferLastCommand,
        fallbackLineCount,
        minLastUpdatedTs,
        requirePromptAfterCodexReply,
    });
    const normalizedText = formalReplyText.trim();
    if (!normalizedText) {
        return null;
    }
    const normalizedOutputTs = Number.isFinite(outputTs) && outputTs > 0 ? Math.floor(outputTs) : Date.now();
    return {
        id: makeTerminalFormalReplyPayloadId(normalizedOutputTs, normalizedText),
        text: normalizedText,
        outputTs: normalizedOutputTs,
    };
}

type SpeakLatestTerminalFormalReplyOptions = {
    blockId: string;
    speechSettings: ResolvedSpeechSettings;
    ownerId?: string;
    onError?: (message: string) => void;
    preferLastCommand?: boolean;
    minLastUpdatedTs?: number;
    requirePromptAfterCodexReply?: boolean;
    allowRelaxedFallback?: boolean;
};

type PlayTerminalFormalReplyPayloadOptions = {
    payload: TerminalFormalReplyPayload;
    speechSettings: ResolvedSpeechSettings;
    ownerId?: string;
    onError?: (message: string) => void;
};

export async function playTerminalFormalReplyPayload(options: PlayTerminalFormalReplyPayloadOptions): Promise<boolean> {
    const { payload, speechSettings, ownerId, onError } = options;
    const text = payload?.text?.trim() ?? "";
    if (!text) {
        onError?.("没有检测到可播报的 AI 正式回复。");
        return false;
    }
    return await speechRuntime.play(
        text,
        speechSettings,
        "assistant",
        (errorMessage) => {
            onError?.(errorMessage);
        },
        { ownerId }
    );
}

export async function speakLatestTerminalFormalReply(options: SpeakLatestTerminalFormalReplyOptions): Promise<boolean> {
    const {
        blockId,
        speechSettings,
        ownerId,
        onError,
        preferLastCommand = true,
        minLastUpdatedTs = 0,
        requirePromptAfterCodexReply = false,
        allowRelaxedFallback = false,
    } = options;
    let formalReplyText = await getLatestTerminalFormalReplyText({
        blockId,
        onError,
        preferLastCommand,
        minLastUpdatedTs,
        requirePromptAfterCodexReply,
    });
    if (!formalReplyText && requirePromptAfterCodexReply && allowRelaxedFallback) {
        formalReplyText = await getLatestTerminalFormalReplyText({
            blockId,
            onError,
            preferLastCommand,
            minLastUpdatedTs,
            requirePromptAfterCodexReply: false,
        });
    }
    if (!formalReplyText) {
        onError?.("没有检测到可播报的 AI 正式回复。");
        return false;
    }

    return await speechRuntime.play(
        formalReplyText,
        speechSettings,
        "assistant",
        (errorMessage) => {
            onError?.(errorMessage);
        },
        { ownerId }
    );
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { speechRuntime } from "@/app/aipanel/speechruntime";
import type { ResolvedSpeechSettings } from "@/app/aipanel/speechsettings";
import { fetchWaveFile, globalStore } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { bufferLinesToText } from "@/app/view/term/termutil";

const AnsiEscapePattern = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const IFlowExecutionInfoStartPattern = /^\s*<Execution Info>\s*$/i;
const IFlowExecutionInfoEndPattern = /^\s*<\/Execution Info>\s*$/i;
const NodeDeprecationWarningPattern = /^\s*\(node:\d+\)\s+\[dep\d+\]/i;
const NodeTraceHintPattern = /^\s*\(use `node --trace-deprecation[^)]*\)\s*$/i;
const CodexToolCallIntroPattern = /^(called|calling)\b/i;
const CodexToolCallLinePattern = /^\s*[•●]?\s*(called|calling)\b/i;
// Codex TUI uses "• ..." for many non-assistant, non-final lines (exec/tool/status UI).
// These should never be spoken as the "final formal reply".
const CodexMetaBulletLinePattern =
    /^\s*[•●]?\s*(?:Ran|Exploring|Explored|Searched|Updated Plan|Updated|Added|Deleted)\b/i;
const CodexWorkingStatusLinePattern = /^\s*[•●]?\s*working\b.*\besc\s+to\s+interrupt\b.*$/i;
const CodexWorkingLinePattern = /^\s*[•●]?\s*working\b/i;
const CodexWorkedSeparatorLinePattern = /^\s*[─━—–-]+\s*(?:worked\s+for|耗时)\b.*[─━—–-]*\s*$/i;
const CodexRuntimeSeparatorLinePattern =
    /^\s*[─━—–-]+\s*.*(?:ttft|tbt|inference|streams?|推理|流式|websocket|本地工具|responses\s*api)\b.*[─━—–-]*\s*$/i;
const CodexMcpServerStatusLinePattern =
    /^\s*(?:(?:starting|stopping|restarting|checking)\s+mcp\s+servers?\b|(?:正在)?(?:启动|停止|重启|检测|检查|自检)\s*mcp\s*服务器(?:$|[\s（(：:，,]))/i;
const CodexInferenceFooterPattern =
    /^\s*[─━—–-]*\s*(?:inference|推理)[:：]\s*\d+.*(?:call(?:s)?|次(?:调用)?|调用).*(?:streams?|流)[:：]\s*\d+.*(?:events?|事件)\b.*$/i;
const CodexBottomStatusLinePattern =
    /^\s*(?:gpt-[\w.-]+|o\d(?:-[\w.-]+)?|claude[\w.-]*|gemini[\w.-]*|qwen[\w.-]*|deepseek[\w.-]*)\b.*[•·]\s*\d+%\s+left\b.*$/i;
const CodexConversationInterruptedLinePattern = /^\s*conversation interrupted\b/i;
const CodexSomethingWentWrongLinePattern = /^\s*something went wrong\?\s*$/i;
const CodexFeedbackReportIssueLinePattern =
    /^\s*(?:something went wrong\?\s*)?hit\s+`?\/feedback`?\s+to\s+report\s+the\s+issue\.?\s*$/i;
const CodexEscInterruptHintPattern = /\besc\b.*(?:interrupt|中断|打断)\b/i;
const CodexElapsedEscInterruptLinePattern =
    /^\s*[（(]?\s*(?:(?:\d+\s*[hms]\s*){1,4}|\d+\s*[:：]\s*\d+(?:\s*[:：]\s*\d+)?)\s*\besc\b.*(?:interrupt|中断|打断)\s*[）)]?\s*$/i;
const LeadingStatusDecorationPattern = /^[\s•●◦∙·\u2800-\u28ff|\/\\]+/u;
const TerminalBoxLinePattern = /^\s*[│┃╭╮╰╯├┤┬┴┼─━╶╴╷╵]+\s*.*$/;
const TerminalSeparatorPattern = /^\s*[─━]{10,}\s*$/;
const CodexBrandLinePattern = /^\s*>_\s*OpenAI\s+Codex\b/i;
const CodexModelLinePattern = /^\s*(?:模型|model)\s*[:：]\s*.+$/i;
const CodexDirectoryLinePattern = /^\s*(?:目录|directory|cwd)\s*[:：]\s*.+$/i;
const CtrlQuitKeyPattern = /\bctrl(?:\s*[\+\-]\s*|\s+)(?:c|d)\b/i;
const CtrlQuitCountOrOrdinalPattern =
    /(第一次|第二次|第三次|第四次|第\s*[一二三四五六七八九十0-9]+\s*次|\b(first|second|third|fourth|fifth)\b|\b\d+\s*(?:\/|of)\s*\d+\b|\b\d+\s*x\b)/i;
const CtrlQuitRepeatHintPattern =
    /\bagain\b|\bonce\s+more\b|\bone\s+more(?:\s+time)?\b|\bconsecutive(?:ly)?\b|再次|再按|再按一次|再按下|连续/i;
const CodexFooterHintPattern = /\bagain to (?:quit|edit previous message)\b/i;
const CodexFooterHintZhPattern = /再次.*(?:退出|编辑上(?:一|1)条)/i;
const CodexCommentaryLeadPattern =
    /^(?:i(?:['’]m| am)?\s+(?:going\s+to|need\s+to|should|will|want\s+to)\b|let['’]?s\b|analyzing\b|assessing\b|evaluating\b|reviewing\b|checking\b|planning\b|exploring\b)/i;
const CodexCommentaryLeadZhPattern = /^(?:我(?:先|会先|正在|需要先|打算|准备)|接下来(?:我)?|让我先)/;
const TerminalFormalReplyImagePlaceholderPattern = /\[(?:image)\s*#\d+\]/gi;
const TerminalFormalReplyEmojiPattern = /[\p{Extended_Pictographic}\uFE0F\u200D]/gu;
const TerminalFormalReplyLeadingLabelPattern =
    /^\s*(?:(?:正式回复|最终回复|最终答案|formal reply|final reply|final answer)\s*[：:>\-]*\s*)+/i;
const TerminalFormalReplyNoiseOnlyTokenPattern = /^[*#_\-=~\/\\|.]+$/;
const TerminalFormalReplyHotkeyTokenPattern =
    /^(?:ctrl|cmd|alt|shift|esc|escape|enter|return|tab|option|space)(?:[\-+].*|\+*)?$/i;
const TerminalFormalReplyFilenameExtensions = new Set([
    "rs",
    "md",
    "toml",
    "json",
    "yaml",
    "yml",
    "ts",
    "tsx",
    "js",
    "jsx",
    "py",
    "go",
    "java",
    "cs",
    "cpp",
    "c",
    "h",
    "hpp",
    "sh",
    "cmd",
    "ps1",
    "exe",
    "lock",
    "snap",
]);

function normalizeTerminalLine(line: string): string {
    return line.replace(AnsiEscapePattern, "").replace(/\r/g, "").replace(/\s+$/g, "").trimEnd();
}

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

function stripLeadingStatusDecorations(line: string): string {
    return line.replace(LeadingStatusDecorationPattern, "").trim();
}

function isTerminalStatusNoiseLine(line: string): boolean {
    const lowered = line.toLowerCase();
    const stripped = stripLeadingStatusDecorations(line);
    if (TerminalBoxLinePattern.test(line) || TerminalSeparatorPattern.test(line)) {
        return true;
    }
    if (CodexWorkedSeparatorLinePattern.test(stripped) || CodexRuntimeSeparatorLinePattern.test(stripped)) {
        return true;
    }
    // Codex "meta" bullet rows: exec summaries, search summaries, plan updates, patch summaries.
    if (CodexMetaBulletLinePattern.test(stripped)) {
        return true;
    }
    // Codex working/progress status lines should never be spoken (not a formal reply).
    if (
        CodexWorkingLinePattern.test(line) ||
        CodexWorkingStatusLinePattern.test(line) ||
        CodexWorkingLinePattern.test(stripped) ||
        CodexWorkingStatusLinePattern.test(stripped)
    ) {
        return true;
    }
    // Codex MCP server startup/shutdown status lines are never a formal reply.
    if (CodexMcpServerStatusLinePattern.test(stripped)) {
        return true;
    }
    // Codex footer timing line (Inference/Streams) is telemetry, never assistant content.
    if (CodexInferenceFooterPattern.test(stripped)) {
        return true;
    }
    // Codex bottom status row: "model • 95% left • cwd" is not assistant content.
    if (CodexBottomStatusLinePattern.test(stripped)) {
        return true;
    }
    // Codex CLI transient errors/hints should never be spoken.
    if (
        CodexConversationInterruptedLinePattern.test(stripped) ||
        CodexSomethingWentWrongLinePattern.test(stripped) ||
        CodexFeedbackReportIssueLinePattern.test(stripped)
    ) {
        return true;
    }
    // Codex progress/status lines often include interrupt hints and should never be spoken.
    if (
        lowered.includes("esc to interrupt") ||
        CodexEscInterruptHintPattern.test(stripped) ||
        CodexElapsedEscInterruptLinePattern.test(stripped)
    ) {
        return true;
    }
    if (CodexBrandLinePattern.test(line) || CodexModelLinePattern.test(line) || CodexDirectoryLinePattern.test(line)) {
        return true;
    }
    // Ctrl+C repeat / multi-press status lines should never be spoken (they are not assistant replies).
    if (
        CtrlQuitKeyPattern.test(stripped) &&
        (CtrlQuitRepeatHintPattern.test(stripped) || CtrlQuitCountOrOrdinalPattern.test(stripped))
    ) {
        return true;
    }
    if (CodexFooterHintPattern.test(stripped) || CodexFooterHintZhPattern.test(stripped)) {
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
    const normalized = lines.map((line) => normalizeTerminalLine(line));
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

function stripTerminalFormalReplyLabels(line: string): string {
    const stripped = line.replace(TerminalFormalReplyLeadingLabelPattern, "");
    return stripped.trim() ? stripped : line;
}

function trimTerminalFormalReplyToken(token: string): string {
    let cleaned = token.replace(/^[\s"'()[\]{}<>“”‘’,，。:：;；!！?？]+/g, "");
    if (countCjkCharacters(cleaned) > 0) {
        return cleaned.replace(/[\s"'()[\]{}<>“”‘’]+$/g, "");
    }
    return cleaned.replace(/[\s"'()[\]{}<>“”‘’,，。:：;；!！?？]+$/g, "");
}

function countCjkCharacters(token: string): number {
    return Array.from(token).filter((ch) => {
        const code = ch.charCodeAt(0);
        return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf);
    }).length;
}

function isTerminalFormalReplyNoiseToken(token: string): boolean {
    if (!token) {
        return true;
    }
    if (token === "星号" || token.toLowerCase() === "asterisk" || token.toLowerCase() === "image") {
        return true;
    }
    if (/^#\d+$/.test(token)) {
        return true;
    }
    if (TerminalFormalReplyNoiseOnlyTokenPattern.test(token)) {
        return true;
    }

    const cjkCount = countCjkCharacters(token);
    const asciiNonSpace = Array.from(token).filter((ch) => ch.charCodeAt(0) <= 0x7f && !/\s/.test(ch)).length;
    const asciiAlpha = Array.from(token).filter((ch) => /[A-Za-z]/.test(ch)).length;
    const lowerToken = token.toLowerCase();
    const looksLikeDrivePath =
        token.length >= 3 &&
        /[A-Za-z]/.test(token[0] ?? "") &&
        token[1] === ":" &&
        (token[2] === "\\" || token[2] === "/");
    const looksLikeUrl = lowerToken.startsWith("http://") || lowerToken.startsWith("https://");
    const hasPathSeparator = cjkCount === 0 && (token.includes("\\") || token.includes("/"));
    const hasCodeJoiner = cjkCount === 0 && (token.includes("::") || token.includes("->") || token.includes("=>"));
    const looksLikeFilename =
        cjkCount === 0 &&
        token.includes(".") &&
        TerminalFormalReplyFilenameExtensions.has(token.split(".").pop()?.toLowerCase() ?? "");
    const looksLikeLongCodeToken =
        cjkCount === 0 &&
        asciiNonSpace >= 8 &&
        asciiAlpha >= 4 &&
        (token.includes("_") || token.includes("-") || token.includes(".") || token.includes(":"));
    const looksLikeDenseAsciiCodeToken =
        cjkCount === 0 &&
        asciiNonSpace >= 20 &&
        asciiAlpha >= 4 &&
        /\d/.test(token) &&
        /^[A-Za-z0-9+/=_-]+$/.test(token);
    const looksLikeWindowsEnvPlaceholder = /^%[A-Za-z0-9_-]+%$/.test(token);
    const looksLikeShellEnvReference = /^\$(?:env:)?\{?[A-Za-z0-9_-]+\}?$/i.test(token);
    const looksLikeFunctionKey = /^[Ff]\d+$/.test(token);
    const looksLikeHotkeyToken = TerminalFormalReplyHotkeyTokenPattern.test(token);

    return (
        looksLikeDrivePath ||
        looksLikeUrl ||
        hasPathSeparator ||
        hasCodeJoiner ||
        looksLikeFilename ||
        looksLikeLongCodeToken ||
        looksLikeDenseAsciiCodeToken ||
        looksLikeWindowsEnvPlaceholder ||
        looksLikeShellEnvReference ||
        looksLikeFunctionKey ||
        looksLikeHotkeyToken
    );
}

function sanitizeTerminalFormalReplyLine(line: string): string {
    const sanitizedLine = stripTerminalFormalReplyLabels(
        line
            .replace(TerminalFormalReplyImagePlaceholderPattern, " ")
            .replace(TerminalFormalReplyEmojiPattern, " ")
            .replace(/[*`]/g, " ")
    );
    const cleanedTokens: string[] = [];
    for (const rawToken of sanitizedLine.split(/\s+/)) {
        const token = trimTerminalFormalReplyToken(rawToken);
        if (!token || isTerminalFormalReplyNoiseToken(token)) {
            continue;
        }
        cleanedTokens.push(token);
    }
    return cleanedTokens.join(" ");
}

function getSpeakableTerminalFormalReplyText(text: string): string {
    if (!text) {
        return "";
    }
    const normalizeWhitespace = (value: string) =>
        value
            .replace(/\s+/g, " ")
            .replace(/([，。！？；：])\s+/g, "$1")
            .trim();
    const normalizedLines = text
        .split(/\r?\n/)
        .map((line) => sanitizeTerminalFormalReplyLine(line.trim()))
        .filter((line) => line.length > 0);
    if (normalizedLines.length === 0) {
        return normalizeWhitespace(sanitizeTerminalFormalReplyLine(text));
    }
    return normalizeWhitespace(normalizedLines.join(" "));
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
    if (lines.some((line) => CodexToolCallLinePattern.test(line) || isCodexAssistantReplyLine(line))) {
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

export type TerminalParagraphKind = "assistant" | "user";

export type TerminalParagraphByLineResult = {
    kind: TerminalParagraphKind;
    text: string;
    startLine: number;
    endLine: number;
};

type TerminalConversationSegment = {
    kind: TerminalParagraphKind;
    startLine: number;
    endLineExclusive: number;
};

function buildUserPromptFromSegment(lines: string[]): string {
    if (lines.length === 0) {
        return "";
    }
    const cleaned: string[] = [];
    for (let idx = 0; idx < lines.length; idx++) {
        if (isTerminalStatusNoiseLine(lines[idx])) {
            continue;
        }
        let line = lines[idx];
        if (idx === 0 && isCodexUserPromptLine(line)) {
            line = line.replace(/^\s*[›❯]\s*/, "").replace(/^\s*>\s+/, "");
        }
        if (isLikelyShellPromptLine(line)) {
            continue;
        }
        cleaned.push(line);
    }
    return trimLineList(cleaned).join("\n").trim();
}

function buildConversationSegments(lines: string[]): TerminalConversationSegment[] {
    const segments: TerminalConversationSegment[] = [];
    let current: TerminalConversationSegment | null = null;
    for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx] ?? "";
        let nextKind: TerminalParagraphKind | null = null;
        if (isCodexUserPromptLine(line)) {
            nextKind = "user";
        } else if (isCodexAssistantReplyLine(line) && !isTerminalStatusNoiseLine(line)) {
            nextKind = "assistant";
        }
        if (!nextKind) {
            continue;
        }
        if (current) {
            current.endLineExclusive = idx;
            segments.push(current);
        }
        current = {
            kind: nextKind,
            startLine: idx,
            endLineExclusive: lines.length,
        };
    }
    if (current) {
        segments.push(current);
    }
    return segments;
}

function extractSegmentText(lines: string[], segment: TerminalConversationSegment): string {
    const segmentLines = lines.slice(segment.startLine, segment.endLineExclusive);
    if (segment.kind === "assistant") {
        return buildCodexReplyFromSegment(segmentLines);
    }
    return buildUserPromptFromSegment(segmentLines);
}

function collectSegmentIndexesInPriorityOrder(
    segments: TerminalConversationSegment[],
    targetLine: number
): number[] {
    if (segments.length === 0) {
        return [];
    }
    let activeIdx = segments.findIndex((segment) => targetLine >= segment.startLine && targetLine < segment.endLineExclusive);
    if (activeIdx < 0) {
        for (let idx = segments.length - 1; idx >= 0; idx--) {
            if (segments[idx].startLine <= targetLine) {
                activeIdx = idx;
                break;
            }
        }
        if (activeIdx < 0) {
            activeIdx = 0;
        }
    }
    const indexes: number[] = [];
    for (let idx = activeIdx; idx >= 0; idx--) {
        indexes.push(idx);
    }
    for (let idx = activeIdx + 1; idx < segments.length; idx++) {
        indexes.push(idx);
    }
    return indexes;
}

export function extractTerminalParagraphByLine(lines: string[], lineIndex: number): TerminalParagraphByLineResult | null {
    if (!lines || lines.length === 0) {
        return null;
    }
    const normalizedLines = lines.map((line) => normalizeTerminalLine(line));
    const segments = buildConversationSegments(normalizedLines);
    if (segments.length === 0) {
        return null;
    }
    const maxLine = normalizedLines.length - 1;
    const clampedLine =
        Number.isFinite(lineIndex) && lineIndex >= 0 ? Math.min(Math.floor(lineIndex), maxLine) : maxLine;
    const candidateIndexes = collectSegmentIndexesInPriorityOrder(segments, clampedLine);
    for (const segmentIdx of candidateIndexes) {
        const segment = segments[segmentIdx];
        const text = extractSegmentText(normalizedLines, segment).trim();
        if (!text) {
            continue;
        }
        return {
            kind: segment.kind,
            text,
            startLine: segment.startLine,
            endLine: Math.max(segment.startLine, segment.endLineExclusive - 1),
        };
    }
    return null;
}

function extractLatestCodexBulletReply(lines: string[], requirePromptAfterReply: boolean): string {
    let latestReplyIdx = -1;
    for (let idx = lines.length - 1; idx >= 0; idx--) {
        if (isCodexAssistantReplyLine(lines[idx]) && !isTerminalStatusNoiseLine(lines[idx])) {
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
    const reply = buildCodexReplyFromSegment(lines.slice(latestReplyIdx, endIdx));
    if (!isLikelyCodexFinalReply(reply, hasPromptAfterReply)) {
        return "";
    }
    return reply;
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

function firstMeaningfulLine(text: string): string {
    for (const rawLine of text.split("\n")) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }
        return line.replace(/^\s*[•●]\s+/, "").trim();
    }
    return "";
}

function isCodexCommentaryLikeReply(text: string): boolean {
    const lead = firstMeaningfulLine(text);
    if (!lead) {
        return false;
    }
    return CodexCommentaryLeadPattern.test(lead) || CodexCommentaryLeadZhPattern.test(lead);
}

function isLikelyCodexFinalReply(text: string, hasPromptAfterReply: boolean): boolean {
    if (!text) {
        return false;
    }
    if (isCodexCommentaryLikeReply(text)) {
        return false;
    }
    if (hasPromptAfterReply) {
        return true;
    }
    return looksLikeAssistantFinalReply(text);
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
    const { lines: withoutIFlowExecutionInfo } = removeIFlowExecutionInfo(normalized);
    const codexReply = extractLatestCodexBulletReply(withoutIFlowExecutionInfo, requirePromptAfterCodexReply);
    if (codexReply) {
        return codexReply;
    }
    if (requirePromptAfterCodexReply) {
        const plainReply = extractLatestPlainReply(withoutIFlowExecutionInfo, false, requirePromptAfterCodexReply);
        if (plainReply) {
            return plainReply;
        }
    }
    return "";
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

export type TerminalFormalReplySourceMode = "terminal" | "workbench";

export type TerminalSpeechShellState = "ready" | "running-command" | null;

export type TerminalSpeechCompletionAnchor = {
    freshnessTs: number;
    payloadTs: number;
    source: "command-done" | "last-output";
};

type TerminalSpeechTimestampContext = {
    shellState: TerminalSpeechShellState;
    lastCommandDoneTs?: number;
    lastOutputTs?: number;
};

type ShouldAutoPlayTerminalFormalReplyOptions = {
    payload: TerminalFormalReplyPayload | null;
    sourceMode?: TerminalFormalReplySourceMode;
    shellState: TerminalSpeechShellState;
    sessionStartTs?: number;
    lastCommandDoneTs?: number;
    lastOutputTs?: number;
    baselineTs?: number;
    lastSpokenPayloadId?: string;
    pendingPayloadId?: string;
    speechActive?: boolean;
};

const TerminalFormalReplyRefreshDelaysMs = [180, 420, 900, 1800] as const;
const TerminalFormalReplyAutoPlayCueWindowMs = 250;
const TerminalFormalReplyAutoPlayCueDurationSec = 0.18;
const TerminalFormalReplyAutoPlayCueSampleRate = 22050;
const TerminalFormalReplyAutoPlayCueVolume = 0.42;
const TerminalFormalReplyAutoPlayCueMarks = new Map<string, number>();
let terminalFormalReplyAutoPlayCueDataUrl: string | null = null;

function pruneTerminalFormalReplyAutoPlayCueMarks(now: number): void {
    for (const [payloadId, markedAt] of TerminalFormalReplyAutoPlayCueMarks.entries()) {
        if (now - markedAt > TerminalFormalReplyAutoPlayCueWindowMs) {
            TerminalFormalReplyAutoPlayCueMarks.delete(payloadId);
        }
    }
}

function markTerminalFormalReplyAutoPlayCue(payloadId: string): void {
    if (!payloadId) {
        return;
    }
    const now = Date.now();
    pruneTerminalFormalReplyAutoPlayCueMarks(now);
    TerminalFormalReplyAutoPlayCueMarks.set(payloadId, now);
}

function consumeTerminalFormalReplyAutoPlayCue(payloadId: string): boolean {
    if (!payloadId) {
        return false;
    }
    const now = Date.now();
    pruneTerminalFormalReplyAutoPlayCueMarks(now);
    const markedAt = TerminalFormalReplyAutoPlayCueMarks.get(payloadId);
    if (markedAt == null || now - markedAt > TerminalFormalReplyAutoPlayCueWindowMs) {
        TerminalFormalReplyAutoPlayCueMarks.delete(payloadId);
        return false;
    }
    TerminalFormalReplyAutoPlayCueMarks.delete(payloadId);
    return true;
}

async function playTerminalFormalReplyAutoPlayCue(): Promise<void> {
    try {
        await playTerminalFormalReplyAutoPlayCueViaAudioElement();
        return;
    } catch {
        // Fall back to the lightweight WebAudio chirp path below when the renderer
        // cannot play inline audio or rejects autoplay for the cue element.
    }
    await playTerminalFormalReplyAutoPlayCueViaAudioContext();
}

function writeWavUint16(buffer: Uint8Array, offset: number, value: number): void {
    buffer[offset] = value & 0xff;
    buffer[offset + 1] = (value >> 8) & 0xff;
}

function writeWavUint32(buffer: Uint8Array, offset: number, value: number): void {
    buffer[offset] = value & 0xff;
    buffer[offset + 1] = (value >> 8) & 0xff;
    buffer[offset + 2] = (value >> 16) & 0xff;
    buffer[offset + 3] = (value >> 24) & 0xff;
}

function writeAsciiString(buffer: Uint8Array, offset: number, value: string): void {
    for (let idx = 0; idx < value.length; idx++) {
        buffer[offset + idx] = value.charCodeAt(idx);
    }
}

function encodeBytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}

function getTerminalFormalReplyAutoPlayCueDataUrl(): string {
    if (terminalFormalReplyAutoPlayCueDataUrl) {
        return terminalFormalReplyAutoPlayCueDataUrl;
    }

    const sampleRate = TerminalFormalReplyAutoPlayCueSampleRate;
    const attackSec = 0.015;
    const releaseSec = 0.045;
    const segments = [
        { durationSec: 0.09, freqHz: 1046.5, gain: 0.95 },
        { durationSec: 0.04, freqHz: 0, gain: 0 },
        { durationSec: 0.11, freqHz: 1396.91, gain: 1.0 },
    ] as const;
    const totalSamples = segments.reduce((sum, segment) => sum + Math.round(segment.durationSec * sampleRate), 0);
    const pcmBytes = new Uint8Array(totalSamples * 2);

    let sampleIndex = 0;
    for (const segment of segments) {
        const segmentSamples = Math.round(segment.durationSec * sampleRate);
        for (let idx = 0; idx < segmentSamples; idx++, sampleIndex++) {
            let amplitude = 0;
            if (segment.freqHz > 0) {
                const t = idx / sampleRate;
                const attackProgress = Math.min(1, attackSec > 0 ? t / attackSec : 1);
                const releaseProgress =
                    releaseSec > 0 ? Math.min(1, Math.max(0, (segment.durationSec - t) / releaseSec)) : 1;
                const envelope = Math.min(attackProgress, releaseProgress);
                amplitude = Math.sin(2 * Math.PI * segment.freqHz * t) * envelope * segment.gain;
            }
            const sampleValue = Math.max(-1, Math.min(1, amplitude));
            const pcmValue = Math.round(sampleValue * 32767);
            const byteOffset = sampleIndex * 2;
            pcmBytes[byteOffset] = pcmValue & 0xff;
            pcmBytes[byteOffset + 1] = (pcmValue >> 8) & 0xff;
        }
    }

    const wavBytes = new Uint8Array(44 + pcmBytes.length);
    writeAsciiString(wavBytes, 0, "RIFF");
    writeWavUint32(wavBytes, 4, 36 + pcmBytes.length);
    writeAsciiString(wavBytes, 8, "WAVE");
    writeAsciiString(wavBytes, 12, "fmt ");
    writeWavUint32(wavBytes, 16, 16);
    writeWavUint16(wavBytes, 20, 1);
    writeWavUint16(wavBytes, 22, 1);
    writeWavUint32(wavBytes, 24, sampleRate);
    writeWavUint32(wavBytes, 28, sampleRate * 2);
    writeWavUint16(wavBytes, 32, 2);
    writeWavUint16(wavBytes, 34, 16);
    writeAsciiString(wavBytes, 36, "data");
    writeWavUint32(wavBytes, 40, pcmBytes.length);
    wavBytes.set(pcmBytes, 44);

    terminalFormalReplyAutoPlayCueDataUrl = `data:audio/wav;base64,${encodeBytesToBase64(wavBytes)}`;
    return terminalFormalReplyAutoPlayCueDataUrl;
}

async function playTerminalFormalReplyAutoPlayCueViaAudioElement(): Promise<void> {
    const AudioCtor = (globalThis as typeof globalThis & { Audio?: typeof Audio }).Audio;
    if (typeof AudioCtor !== "function") {
        throw new Error("Audio constructor unavailable");
    }

    const cueAudio = new AudioCtor(getTerminalFormalReplyAutoPlayCueDataUrl());
    cueAudio.volume = TerminalFormalReplyAutoPlayCueVolume;
    cueAudio.preload = "auto";
    cueAudio.currentTime = 0;

    await new Promise<void>((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
            cueAudio.onended = null;
            cueAudio.onerror = null;
        };
        const finishResolve = () => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            resolve();
        };
        const finishReject = (error: unknown) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            reject(error instanceof Error ? error : new Error(String(error)));
        };

        cueAudio.onended = () => finishResolve();
        cueAudio.onerror = () => finishReject(new Error("auto-play cue audio error"));

        Promise.resolve(cueAudio.play())
            .then(() => {
                // Some Electron audio paths resolve play() without reliably firing onended on very
                // short inline wavs, so provide a small deterministic tail fallback.
                globalThis.setTimeout(finishResolve, 320);
            })
            .catch(finishReject);
    });
}

async function playTerminalFormalReplyAutoPlayCueViaAudioContext(): Promise<void> {
    const globalWithAudio = globalThis as typeof globalThis & {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
    };
    const AudioContextCtor = globalWithAudio.AudioContext ?? globalWithAudio.webkitAudioContext;
    if (typeof AudioContextCtor !== "function") {
        return;
    }

    const audioContext = new AudioContextCtor();
    try {
        if (audioContext.state === "suspended" && typeof audioContext.resume === "function") {
            await audioContext.resume();
        }
        const cueMidpointSec = Math.min(0.08, TerminalFormalReplyAutoPlayCueDurationSec * 0.5);

        const gainNode = audioContext.createGain();
        gainNode.connect(audioContext.destination);
        gainNode.gain.setValueAtTime(0.0001, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.14, audioContext.currentTime + cueMidpointSec);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + TerminalFormalReplyAutoPlayCueDurationSec);

        const oscillator = audioContext.createOscillator();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
        oscillator.frequency.linearRampToValueAtTime(1318.51, audioContext.currentTime + cueMidpointSec);
        oscillator.frequency.linearRampToValueAtTime(
            1046.5,
            audioContext.currentTime + TerminalFormalReplyAutoPlayCueDurationSec
        );
        oscillator.connect(gainNode);

        const ended = new Promise<void>((resolve) => {
            oscillator.onended = () => resolve();
        });

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + TerminalFormalReplyAutoPlayCueDurationSec);
        await ended;
    } finally {
        await Promise.resolve(audioContext.close());
    }
}

function normalizePositiveTerminalTs(value: unknown): number {
    const ts = Number(value);
    return Number.isFinite(ts) && ts > 0 ? Math.floor(ts) : 0;
}

function getTerminalFormalReplyAutoPlaySourcePolicy(
    sourceMode: TerminalFormalReplySourceMode
): "require-terminal-completion" | "payload-only" {
    return sourceMode === "workbench" ? "payload-only" : "require-terminal-completion";
}

export function getTerminalSpeechCompletionAnchor(
    context: TerminalSpeechTimestampContext
): TerminalSpeechCompletionAnchor | null {
    const doneTs = normalizePositiveTerminalTs(context.lastCommandDoneTs);
    const outputTs = normalizePositiveTerminalTs(context.lastOutputTs);
    if (context.shellState === "running-command") {
        return null;
    }
    if (context.shellState === "ready" && doneTs > 0) {
        return {
            freshnessTs: doneTs,
            payloadTs: doneTs,
            source: "command-done",
        };
    }
    if (outputTs > 0) {
        return {
            freshnessTs: outputTs,
            payloadTs: outputTs,
            source: "last-output",
        };
    }
    return null;
}

export function getTerminalSpeechAutoPlayBaselineTs(
    context: TerminalSpeechTimestampContext,
    fallbackTs: number
): number {
    const anchor = getTerminalSpeechCompletionAnchor(context);
    if (anchor) {
        return anchor.payloadTs;
    }
    return normalizePositiveTerminalTs(fallbackTs);
}

export function getTerminalFormalReplyRefreshDelayMs(attempt: number): number | null {
    const normalizedAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
    return TerminalFormalReplyRefreshDelaysMs[normalizedAttempt] ?? null;
}

export function shouldAutoPlayTerminalFormalReply(options: ShouldAutoPlayTerminalFormalReplyOptions): boolean {
    const payload = options.payload;
    const normalizedText = payload?.text?.trim() ?? "";
    if (!payload?.id || !normalizedText) {
        return false;
    }
    const sourceMode = options.sourceMode ?? "terminal";
    const sourcePolicy = getTerminalFormalReplyAutoPlaySourcePolicy(sourceMode);
    const sessionStartTs = normalizePositiveTerminalTs(options.sessionStartTs);
    const commandDoneTs = normalizePositiveTerminalTs(options.lastCommandDoneTs);
    const lastOutputTs = normalizePositiveTerminalTs(options.lastOutputTs);
    if (sourcePolicy === "require-terminal-completion") {
        if (options.shellState === "running-command") {
            return false;
        }
        // Shell integration can be absent or delayed for some terminal-backed AI flows.
        // In that case, a fresh append timestamp is the safest runtime signal that a new
        // reply happened during this session without replaying startup-restored history.
        const completionTs = Math.max(commandDoneTs, lastOutputTs);
        if (completionTs <= 0) {
            return false;
        }
        if (sessionStartTs > 0 && completionTs <= sessionStartTs) {
            return false;
        }
    }
    const baselineTs = normalizePositiveTerminalTs(options.baselineTs);
    if (baselineTs > 0 && normalizePositiveTerminalTs(payload.outputTs) <= baselineTs) {
        return false;
    }
    if (payload.id === (options.lastSpokenPayloadId ?? "")) {
        return false;
    }
    if (payload.id === (options.pendingPayloadId ?? "")) {
        return false;
    }
    if (options.speechActive) {
        return false;
    }
    markTerminalFormalReplyAutoPlayCue(payload.id);
    return true;
}

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

function isMissingFeBlockRouteError(message: string): boolean {
    const normalized = (message ?? "").toLowerCase();
    return normalized.includes("no route for") && normalized.includes("feblock:");
}

type ActiveTerminalWrapLike = {
    blockId?: string;
    terminal?: {
        buffer?: {
            active?: {
                length?: number;
                getLine?: (index: number) => unknown;
            };
        };
    };
    promptMarkers?: Array<{ line?: number }>;
    shellIntegrationStatusAtom?: unknown;
    lastUpdated?: number;
};

function getActiveTerminalWrap(blockId: string): ActiveTerminalWrapLike | null {
    const globalAny = globalThis as { term?: ActiveTerminalWrapLike; window?: { term?: ActiveTerminalWrapLike } };
    const activeTerm = globalAny.window?.term ?? globalAny.term;
    if (!activeTerm || activeTerm.blockId !== blockId) {
        return null;
    }
    const buffer = activeTerm.terminal?.buffer?.active;
    if (!buffer || typeof buffer.length !== "number" || typeof buffer.getLine !== "function") {
        return null;
    }
    return activeTerm;
}

function readActiveTerminalScrollbackLines(
    blockId: string,
    options: { lastCommand: boolean; fallbackLineCount: number }
): { lines: string[]; lastupdated: number } | null {
    const termWrap = getActiveTerminalWrap(blockId);
    const buffer = termWrap?.terminal?.buffer?.active;
    if (!termWrap || !buffer || typeof buffer.length !== "number") {
        return null;
    }
    const totalLines = Math.max(0, Math.floor(buffer.length));
    if (options.lastCommand) {
        if (!termWrap.shellIntegrationStatusAtom) {
            return null;
        }
        const shellState = globalStore.get(
            termWrap.shellIntegrationStatusAtom as { read?: unknown; write?: unknown; init?: unknown }
        ) as TerminalSpeechShellState;
        if (shellState == null) {
            return null;
        }
        let startBufferIndex = 0;
        let endBufferIndex = totalLines;
        const promptMarkers = Array.isArray(termWrap.promptMarkers) ? termWrap.promptMarkers : [];
        if (promptMarkers.length > 0) {
            let markerIdx = promptMarkers.length - 1;
            if (shellState === "ready" && markerIdx > 0) {
                markerIdx -= 1;
            }
            const startMarkerLine = Number(promptMarkers[markerIdx]?.line);
            if (Number.isFinite(startMarkerLine)) {
                startBufferIndex = Math.max(0, Math.min(totalLines, Math.floor(startMarkerLine)));
            }
            if (shellState === "ready" && markerIdx + 1 < promptMarkers.length) {
                const endMarkerLine = Number(promptMarkers[markerIdx + 1]?.line);
                if (Number.isFinite(endMarkerLine)) {
                    endBufferIndex = Math.max(startBufferIndex, Math.min(totalLines, Math.floor(endMarkerLine) + 1));
                }
            }
        }
        let lines = bufferLinesToText(buffer as never, startBufferIndex, endBufferIndex);
        if (lines.length > 1000) {
            lines = lines.slice(lines.length - 1000);
        }
        return {
            lines,
            lastupdated: Number(termWrap.lastUpdated) || 0,
        };
    }

    const endLine = options.fallbackLineCount === 0 ? totalLines : Math.min(totalLines, options.fallbackLineCount);
    const startBufferIndex = Math.max(0, totalLines - endLine);
    const endBufferIndex = totalLines;
    return {
        lines: bufferLinesToText(buffer as never, startBufferIndex, endBufferIndex),
        lastupdated: Number(termWrap.lastUpdated) || 0,
    };
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
    const extractFromActiveTerminal = (lastCommand: boolean): string => {
        const snapshot = readActiveTerminalScrollbackLines(blockId, {
            lastCommand,
            fallbackLineCount,
        });
        if (!snapshot || !canUseScrollbackSnapshot(snapshot.lastupdated, minLastUpdatedTs)) {
            return "";
        }
        return extractLatestTerminalFormalReply(snapshot.lines, { requirePromptAfterCodexReply });
    };

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
            if (isMissingFeBlockRouteError(errMsg)) {
                const extracted = extractFromActiveTerminal(true);
                if (extracted) {
                    return extracted;
                }
            }
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
            const extractedFromActive = extractFromActiveTerminal(false);
            if (extractedFromActive) {
                return extractedFromActive;
            }
            return "";
        }
        lines = fallback?.lines ?? [];
    } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        if (isMissingFeBlockRouteError(fallbackMessage)) {
            const extracted = extractFromActiveTerminal(false);
            if (extracted) {
                return extracted;
            }
        }
        const extractedFromActive = extractFromActiveTerminal(false);
        if (extractedFromActive) {
            return extractedFromActive;
        }
        onError?.(fallbackMessage);
        return "";
    }

    const extracted = extractLatestTerminalFormalReply(lines, { requirePromptAfterCodexReply });
    if (extracted) {
        return extracted;
    }
    const extractedFromActive = extractFromActiveTerminal(false);
    if (extractedFromActive) {
        return extractedFromActive;
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

export async function loadLatestWorkbenchFormalReplyPayload(options: {
    blockId: string;
    outputTs?: number;
    onError?: (message: string) => void;
    requireLatestEntryAssistant?: boolean;
}): Promise<TerminalFormalReplyPayload | null> {
    const { blockId, outputTs = 0, onError, requireLatestEntryAssistant = false } = options;
    try {
        const { data, fileInfo } = await fetchWaveFile(blockId, "aidata");
        if (!data) {
            return null;
        }
        const history = JSON.parse(new TextDecoder().decode(data)) as Array<{ role?: string; content?: string }>;
        const latestEntry = Array.isArray(history) && history.length > 0 ? history[history.length - 1] : null;
        if (requireLatestEntryAssistant) {
            const latestRole = String(latestEntry?.role ?? "").trim();
            const latestText = String(latestEntry?.content ?? "").trim();
            if (latestRole !== "assistant" || !latestText) {
                return null;
            }
        }
        for (let idx = history.length - 1; idx >= 0; idx--) {
            const entry = history[idx];
            if (entry?.role !== "assistant") {
                continue;
            }
            const normalizedText = String(entry.content ?? "").trim();
            if (!normalizedText) {
                continue;
            }
            const fileModTs = Number(fileInfo?.modts);
            const normalizedOutputTs =
                Number.isFinite(outputTs) && outputTs > 0
                    ? Math.floor(outputTs)
                    : Number.isFinite(fileModTs) && fileModTs > 0
                      ? Math.floor(fileModTs)
                      : Date.now();
            return {
                id: makeTerminalFormalReplyPayloadId(normalizedOutputTs, normalizedText),
                text: normalizedText,
                outputTs: normalizedOutputTs,
            };
        }
    } catch (error) {
        onError?.(error instanceof Error ? error.message : String(error));
    }
    return null;
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
    autoPlayCue?: boolean;
};

export async function playTerminalFormalReplyPayload(options: PlayTerminalFormalReplyPayloadOptions): Promise<boolean> {
    const { payload, speechSettings, ownerId, onError } = options;
    const text = getSpeakableTerminalFormalReplyText(payload?.text ?? "");
    if (!text) {
        onError?.("没有检测到可播报的 AI 正式回复。");
        return false;
    }
    const shouldPlayAutoPlayCue = options.autoPlayCue ?? consumeTerminalFormalReplyAutoPlayCue(payload?.id ?? "");
    if (shouldPlayAutoPlayCue) {
        try {
            await playTerminalFormalReplyAutoPlayCue();
        } catch {
            // Best-effort cue only; keep the existing TTS path available.
        }
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
    const normalizedText = getSpeakableTerminalFormalReplyText(formalReplyText);
    if (!normalizedText) {
        onError?.("没有检测到可播报的 AI 正式回复。");
        return false;
    }

    return await speechRuntime.play(
        normalizedText,
        speechSettings,
        "assistant",
        (errorMessage) => {
            onError?.(errorMessage);
        },
        { ownerId }
    );
}

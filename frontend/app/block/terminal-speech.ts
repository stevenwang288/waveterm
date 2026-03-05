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
// Codex TUI uses "• ..." for many non-assistant, non-final lines (exec/tool/status UI).
// These should never be spoken as the "final formal reply".
const CodexMetaBulletLinePattern =
    /^\s*[•●]?\s*(?:Ran|Exploring|Explored|Searched|Updated Plan|Updated|Added|Deleted)\b/i;
const CodexWorkingStatusLinePattern = /^\s*[•●]?\s*working\b.*\besc\s+to\s+interrupt\b.*$/i;
const CodexWorkingLinePattern = /^\s*[•●]?\s*working\b/i;
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
// Match both English ("interrupt") and Chinese ("中断"/"打断") without relying on word-boundaries for CJK.
const CodexEscInterruptHintPattern = /\besc\b.*(?:interrupt\b|中断|打断)/i;
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

// Opencode (OpenCode) CLI prints structured-ish TUI/stream output.
// We treat only "text" parts as the "formal reply" and ignore tool/reasoning/status UI.
const OpencodeThinkingLinePattern = /^\s*(?:_?thinking_?\s*[:：]\s*|thinking\.\.\.\s*$)/i;
const OpencodeRunHeaderLinePattern = /^\s*>\s+.+\s+·\s+.+$/;
const OpencodePermissionRequestedLinePattern = /^\s*permission requested:\s*/i;
const OpencodeShareLinePattern = /^\s*~\s+\S+/;
const OpencodeToolHeaderLinePattern = /^\s*(?:⚙|✱|→|←|%|◇|◈|\$|#|✓|✗|•)\s+\S/;
const OpencodeTuiMessageFooterLinePattern = /^\s*▣\s+.+\s+·\s+.+$/;
const OpencodeToolCallsSummaryPattern = /\btoolcalls\b/i;
const OpencodeViewSubagentsPattern = /\bview subagents\b/i;
const OpencodeQueuedBadgePattern = /排队中|queued/i;
const OpencodeCompactionPattern = /压缩|compaction/i;
const OpencodeSqliteMigrationPattern = /^\s*performing one time database migration\b/i;
const OpencodeDatabaseMigrationCompletePattern = /^\s*database migration complete\b/i;

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
        if (
            CodexBrandLinePattern.test(line) ||
            CodexModelLinePattern.test(line) ||
            CodexDirectoryLinePattern.test(line)
        ) {
            return true;
        }
        if (lowered.includes("openai codex") || lowered.includes("for shortcuts") || lowered.includes("context left")) {
            return true;
        }
    }
    return false;
}

function hasOpencodeUiCues(lines: string[]): boolean {
    for (const line of lines) {
        if (!line) {
            continue;
        }
        const stripped = stripLeadingStatusDecorations(line);
        if (OpencodeTuiMessageFooterLinePattern.test(stripped)) {
            return true;
        }
        if (OpencodeRunHeaderLinePattern.test(stripped)) {
            return true;
        }
        if (OpencodeThinkingLinePattern.test(stripped)) {
            return true;
        }
        if (OpencodePermissionRequestedLinePattern.test(stripped)) {
            return true;
        }
        if (OpencodeShareLinePattern.test(stripped)) {
            return true;
        }
        if (OpencodeToolHeaderLinePattern.test(stripped)) {
            return true;
        }
        if (OpencodeToolCallsSummaryPattern.test(stripped)) {
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

function stripCommonLeadingSpaces(lines: string[], maxSpacesToStrip: number): string[] {
    let minLeadingSpaces = Infinity;
    for (const line of lines) {
        if (!line || line.trim() === "") {
            continue;
        }
        const match = line.match(/^ */);
        const count = match ? match[0].length : 0;
        minLeadingSpaces = Math.min(minLeadingSpaces, count);
    }
    if (!Number.isFinite(minLeadingSpaces) || minLeadingSpaces <= 0) {
        return lines;
    }
    const toStrip = Math.min(minLeadingSpaces, Math.max(0, Math.floor(maxSpacesToStrip)));
    if (toStrip <= 0) {
        return lines;
    }
    const prefix = " ".repeat(toStrip);
    return lines.map((line) => (line.startsWith(prefix) ? line.slice(toStrip) : line));
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

function collectSegmentIndexesInPriorityOrder(segments: TerminalConversationSegment[], targetLine: number): number[] {
    if (segments.length === 0) {
        return [];
    }
    let activeIdx = segments.findIndex(
        (segment) => targetLine >= segment.startLine && targetLine < segment.endLineExclusive
    );
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

export function extractTerminalParagraphByLine(
    lines: string[],
    lineIndex: number
): TerminalParagraphByLineResult | null {
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

function hasShellBoundaryAfterIndex(lines: string[], boundaryIdx: number): boolean {
    for (let idx = boundaryIdx + 1; idx < lines.length; idx++) {
        const line = lines[idx];
        if (!line || line.trim() === "") {
            continue;
        }
        if (isTerminalStatusNoiseLine(line)) {
            continue;
        }
        const stripped = stripLeadingStatusDecorations(line);
        if (OpencodeThinkingLinePattern.test(stripped)) {
            continue;
        }
        if (OpencodeToolHeaderLinePattern.test(stripped)) {
            continue;
        }
        if (isCodexUserPromptLine(line) || isLikelyShellPromptLine(line)) {
            return true;
        }
    }
    return false;
}

function isOpencodeTuiFinalFooterLine(line: string): boolean {
    const stripped = stripLeadingStatusDecorations(line);
    if (!OpencodeTuiMessageFooterLinePattern.test(stripped)) {
        return false;
    }
    // Opencode shows message duration only when the assistant message is finalized (finish != tool-calls/unknown).
    // Duration formatting examples: "120ms", "1.2s", "3m 23s", "1h 2m", "2d 3h".
    const hasDuration =
        /\b\d+ms\b/.test(stripped) ||
        /\b\d+(?:\.\d+)?s\b/.test(stripped) ||
        /\b\d+m\s+\d+s\b/.test(stripped) ||
        /\b\d+h\s+\d+m\b/.test(stripped) ||
        /\b\d+d\s+\d+h\b/.test(stripped);
    if (hasDuration) {
        return true;
    }
    return /\binterrupted\b/i.test(stripped);
}

function extractLatestOpencodeTuiReply(lines: string[], requireFinalReply: boolean): string {
    let footerIdx = -1;
    for (let idx = lines.length - 1; idx >= 0; idx--) {
        const stripped = stripLeadingStatusDecorations(lines[idx] ?? "");
        if (OpencodeTuiMessageFooterLinePattern.test(stripped)) {
            footerIdx = idx;
            break;
        }
    }
    if (footerIdx === -1) {
        return "";
    }
    if (requireFinalReply && !isOpencodeTuiFinalFooterLine(lines[footerIdx] ?? "")) {
        return "";
    }

    let startIdx = 0;
    for (let idx = footerIdx - 1; idx >= 0; idx--) {
        const stripped = stripLeadingStatusDecorations(lines[idx] ?? "");
        if (OpencodeTuiMessageFooterLinePattern.test(stripped)) {
            startIdx = idx + 1;
            break;
        }
    }

    const segmentLines = lines.slice(startIdx, footerIdx);
    const cleaned: string[] = [];
    for (const line of segmentLines) {
        if (!line || line.trim() === "") {
            continue;
        }
        if (isTerminalStatusNoiseLine(line)) {
            continue;
        }
        if (isCodexUserPromptLine(line) || isLikelyShellPromptLine(line)) {
            continue;
        }
        const stripped = stripLeadingStatusDecorations(line);
        if (
            OpencodeThinkingLinePattern.test(stripped) ||
            OpencodeRunHeaderLinePattern.test(stripped) ||
            OpencodePermissionRequestedLinePattern.test(stripped) ||
            OpencodeShareLinePattern.test(stripped) ||
            OpencodeToolCallsSummaryPattern.test(stripped) ||
            OpencodeViewSubagentsPattern.test(stripped) ||
            OpencodeQueuedBadgePattern.test(stripped) ||
            OpencodeCompactionPattern.test(stripped) ||
            OpencodeSqliteMigrationPattern.test(stripped) ||
            OpencodeDatabaseMigrationCompletePattern.test(stripped)
        ) {
            continue;
        }
        // Ignore obvious opencode tool header rows that may appear in the transcript area.
        if (OpencodeToolHeaderLinePattern.test(stripped)) {
            continue;
        }
        cleaned.push(line);
    }
    const reply = trimLineList(stripCommonLeadingSpaces(cleaned, 6)).join("\n").trim();
    return looksLikeAssistantFinalReply(reply) ? reply : "";
}

function extractLatestOpencodeRunReply(lines: string[], requireFinalReply: boolean): string {
    // Mask opencode tool blocks and reasoning/status lines so we can safely pick the latest text block.
    const ignored = new Set<number>();
    const blockIcons = new Set(["$", "←", "#"]);

    for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx] ?? "";
        const stripped = stripLeadingStatusDecorations(line);
        if (
            OpencodeThinkingLinePattern.test(stripped) ||
            OpencodeRunHeaderLinePattern.test(stripped) ||
            OpencodePermissionRequestedLinePattern.test(stripped) ||
            OpencodeShareLinePattern.test(stripped) ||
            OpencodeSqliteMigrationPattern.test(stripped) ||
            OpencodeDatabaseMigrationCompletePattern.test(stripped)
        ) {
            ignored.add(idx);
            continue;
        }

        if (OpencodeToolHeaderLinePattern.test(stripped)) {
            ignored.add(idx);
            const icon = stripped.trim().slice(0, 1);
            const isBlock = blockIcons.has(icon);
            if (!isBlock) {
                continue;
            }
            // Best-effort: skip the output rows printed by opencode's `block(...)` helper.
            // It prints: empty line, tool header, output (possibly multiline), empty line.
            // Tool output may contain blank lines, so we scan until we hit a clear boundary.
            let blankRun = 0;
            let sawNonEmptyOutput = false;
            for (let j = idx + 1; j < lines.length; j++) {
                const outLine = lines[j] ?? "";
                const trimmed = outLine.trim();
                if (isCodexUserPromptLine(outLine) || isLikelyShellPromptLine(outLine)) {
                    break;
                }
                const outStripped = stripLeadingStatusDecorations(outLine);
                if (
                    OpencodeToolHeaderLinePattern.test(outStripped) ||
                    OpencodeThinkingLinePattern.test(outStripped) ||
                    OpencodeRunHeaderLinePattern.test(outStripped) ||
                    OpencodePermissionRequestedLinePattern.test(outStripped) ||
                    OpencodeShareLinePattern.test(outStripped)
                ) {
                    break;
                }

                ignored.add(j);

                if (!trimmed) {
                    blankRun += 1;
                    // Some opencode blocks only print a header (no output). In that case the first
                    // blank line we encounter is very likely the boundary before the assistant text.
                    if (!sawNonEmptyOutput) {
                        break;
                    }
                    // Between opencode blocks there are often two consecutive blank lines
                    // (one emitted by the previous block, one by the next). Use that as a boundary.
                    if (blankRun >= 2) {
                        break;
                    }
                    continue;
                }
                blankRun = 0;
                sawNonEmptyOutput = true;
            }
        }
    }

    // Find the latest non-ignored block of text.
    let endIdx = -1;
    for (let idx = lines.length - 1; idx >= 0; idx--) {
        const line = lines[idx] ?? "";
        if (ignored.has(idx)) {
            continue;
        }
        if (!line || line.trim() === "") {
            continue;
        }
        if (isTerminalStatusNoiseLine(line) || isCodexUserPromptLine(line) || isLikelyShellPromptLine(line)) {
            continue;
        }
        endIdx = idx;
        break;
    }
    if (endIdx === -1) {
        return "";
    }
    let startIdx = endIdx;
    for (let idx = endIdx - 1; idx >= 0; idx--) {
        const line = lines[idx] ?? "";
        if (ignored.has(idx)) {
            break;
        }
        if (!line || line.trim() === "") {
            break;
        }
        if (isTerminalStatusNoiseLine(line) || isCodexUserPromptLine(line) || isLikelyShellPromptLine(line)) {
            break;
        }
        startIdx = idx;
    }

    if (requireFinalReply && !hasShellBoundaryAfterIndex(lines, endIdx)) {
        return "";
    }

    const segmentLines = lines.slice(startIdx, endIdx + 1);
    const reply = segmentLines.join("\n").trim();
    return looksLikeAssistantFinalReply(reply) ? reply : "";
}

function extractLatestOpencodeReply(lines: string[], requireFinalReply: boolean): string {
    const hasFooter = lines.some((line) =>
        OpencodeTuiMessageFooterLinePattern.test(stripLeadingStatusDecorations(line))
    );
    if (hasFooter) {
        return extractLatestOpencodeTuiReply(lines, requireFinalReply);
    }
    return extractLatestOpencodeRunReply(lines, requireFinalReply);
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

function extractLatestPlainReply(
    lines: string[],
    allowLooseFallback: boolean,
    requirePromptAfterReply: boolean
): string {
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
    if (hasOpencodeUiCues(withoutIFlowExecutionInfo)) {
        const opencodeReply = extractLatestOpencodeReply(withoutIFlowExecutionInfo, requirePromptAfterCodexReply);
        if (opencodeReply) {
            return opencodeReply;
        }
    }

    // Codex-style bullet transcripts (› prompts + • assistant replies).
    // Keep this after opencode detection because opencode tools may render bullets (e.g. "•") that should not
    // be treated as a Codex assistant reply.
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

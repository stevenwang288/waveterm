// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { formatCwdForDisplay } from "@/util/cwdlabel";
import { isBlank, isLocalConnName } from "@/util/util";

const AnsiEscapePattern = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const TerminalDirectoryLinePattern = /^\s*(?:目录|directory|cwd)\s*[:：]\s*(.+?)\s*$/i;
const TerminalStatusPathLinePattern =
    /^\s*(?:gpt-[\w.-]+|o\d(?:-[\w.-]+)?|claude[\w.-]*|gemini[\w.-]*|qwen[\w.-]*|deepseek[\w.-]*).*?[•·]\s*\d+%\s+(?:left|context left)\s*[•·]\s*(.+?)\s*$/i;
const OrderedDictionaryPlaceholder = "System.Collections.Specialized.OrderedDictionary";

function normalizeCwdMetaValue(value: unknown): string {
    if (typeof value !== "string") {
        return "";
    }
    const trimmed = value.trim();
    if (!trimmed || trimmed === OrderedDictionaryPlaceholder) {
        return "";
    }
    return trimmed;
}

function normalizeTerminalLine(line: string): string {
    return String(line ?? "")
        .replace(AnsiEscapePattern, "")
        .replace(/\r/g, "")
        .trim();
}

type TerminalDisplayBufferLine = string | { text?: string; wrapped?: boolean };

function collapseWrappedTerminalLines(lines?: TerminalDisplayBufferLine[]): string[] {
    if (!Array.isArray(lines) || lines.length === 0) {
        return [];
    }

    const collapsed: string[] = [];
    let currentLine = "";

    for (const entry of lines) {
        const text = typeof entry === "string" ? entry : String(entry?.text ?? "");
        const isWrapped = typeof entry === "object" && entry != null ? entry.wrapped === true : false;

        if (!isWrapped) {
            if (!isBlank(currentLine)) {
                collapsed.push(currentLine);
            }
            currentLine = text;
            continue;
        }

        currentLine += text;
    }

    if (!isBlank(currentLine)) {
        collapsed.push(currentLine);
    }

    return collapsed;
}

function isLikelyDisplayPath(value: string): boolean {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) {
        return false;
    }
    return (
        /^[A-Za-z]:[\\/]/.test(trimmed) ||
        trimmed.startsWith("/") ||
        trimmed.startsWith("~") ||
        trimmed.startsWith("\\\\")
    );
}

function isAbsoluteTerminalPath(value: string): boolean {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) {
        return false;
    }
    return /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("\\\\");
}

export function getTerminalInheritableCwd(meta?: Record<string, any>): string {
    const cwd = normalizeCwdMetaValue(meta?.["cmd:cwd"]);
    if (!isBlank(cwd)) {
        return cwd;
    }
    const connName = typeof meta?.connection === "string" ? meta.connection.trim() : "";
    if (!isLocalConnName(connName)) {
        return "";
    }
    const displayCwd = normalizeCwdMetaValue(meta?.["display:launchcwd"]);
    return isBlank(displayCwd) ? "" : formatCwdForDisplay(displayCwd);
}

export function getTerminalDisplayCwd(meta?: Record<string, any>): string {
    const explicitTermDisplayCwd = normalizeCwdMetaValue(meta?.["term:displaycwd"]);
    const normalizedTermDisplayCwd = formatCwdForDisplay(explicitTermDisplayCwd);
    if (!isBlank(normalizedTermDisplayCwd)) {
        return normalizedTermDisplayCwd;
    }

    const normalizedCmdCwd = formatCwdForDisplay(getTerminalInheritableCwd(meta));
    if (!isBlank(normalizedCmdCwd)) {
        return normalizedCmdCwd;
    }

    const connName = typeof meta?.connection === "string" ? meta.connection.trim() : "";
    if (!isLocalConnName(connName)) {
        return "";
    }

    const explicitDisplayCwd = normalizeCwdMetaValue(meta?.["display:launchcwd"]);
    return formatCwdForDisplay(explicitDisplayCwd);
}

export function resolveTerminalActionCwd(meta?: Record<string, any>, liveDisplayCwd?: string | null): string {
    const normalizedLiveDisplayCwd = formatCwdForDisplay(normalizeCwdMetaValue(liveDisplayCwd));
    const persistedDisplayCwd = getTerminalDisplayCwd(meta);
    if (isBlank(normalizedLiveDisplayCwd)) {
        return persistedDisplayCwd;
    }
    if (isBlank(persistedDisplayCwd)) {
        return normalizedLiveDisplayCwd;
    }
    if (
        persistedDisplayCwd.length > normalizedLiveDisplayCwd.length &&
        persistedDisplayCwd.endsWith(normalizedLiveDisplayCwd)
    ) {
        return persistedDisplayCwd;
    }
    if (isAbsoluteTerminalPath(persistedDisplayCwd) && !isAbsoluteTerminalPath(normalizedLiveDisplayCwd)) {
        return persistedDisplayCwd;
    }
    return normalizedLiveDisplayCwd;
}

export function extractTerminalDisplayCwdFromBufferLines(lines?: TerminalDisplayBufferLine[]): string {
    const logicalLines = collapseWrappedTerminalLines(lines);
    if (logicalLines.length === 0) {
        return "";
    }

    const startIndex = Math.max(0, logicalLines.length - 40);
    for (let idx = logicalLines.length - 1; idx >= startIndex; idx--) {
        const normalizedLine = normalizeTerminalLine(logicalLines[idx]);
        if (!normalizedLine) {
            continue;
        }

        const directoryMatch = normalizedLine.match(TerminalDirectoryLinePattern);
        if (directoryMatch?.[1] && isLikelyDisplayPath(directoryMatch[1])) {
            return formatCwdForDisplay(directoryMatch[1]);
        }

        const statusMatch = normalizedLine.match(TerminalStatusPathLinePattern);
        if (statusMatch?.[1] && isLikelyDisplayPath(statusMatch[1])) {
            return formatCwdForDisplay(statusMatch[1]);
        }
    }

    return "";
}

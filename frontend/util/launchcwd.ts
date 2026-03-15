// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { formatCwdForDisplay } from "@/util/cwdlabel";
import { isBlank, isLocalConnName } from "@/util/util";

const AnsiEscapePattern = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const TerminalDirectoryLinePattern = /^\s*(?:目录|directory|cwd)\s*[:：]\s*(.+?)\s*$/i;
const TerminalStatusPathLinePattern =
    /^\s*(?:gpt-[\w.-]+|o\d(?:-[\w.-]+)?|claude[\w.-]*|gemini[\w.-]*|qwen[\w.-]*|deepseek[\w.-]*).*?[•·]\s*\d+%\s+(?:left|context left)\s*[•·]\s*(.+?)\s*$/i;

function normalizeTerminalLine(line: string): string {
    return String(line ?? "")
        .replace(AnsiEscapePattern, "")
        .replace(/\r/g, "")
        .trim();
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

export function getTerminalInheritableCwd(meta?: Record<string, any>): string {
    const cwd = typeof meta?.["cmd:cwd"] === "string" ? String(meta["cmd:cwd"]).trim() : "";
    if (!isBlank(cwd)) {
        return cwd;
    }
    const connName = typeof meta?.connection === "string" ? meta.connection.trim() : "";
    if (!isLocalConnName(connName)) {
        return "";
    }
    const displayCwd = typeof meta?.["display:launchcwd"] === "string" ? String(meta["display:launchcwd"]).trim() : "";
    return isBlank(displayCwd) ? "" : formatCwdForDisplay(displayCwd);
}

export function getTerminalDisplayCwd(meta?: Record<string, any>): string {
    const normalizedCmdCwd = formatCwdForDisplay(getTerminalInheritableCwd(meta));
    if (!isBlank(normalizedCmdCwd)) {
        return normalizedCmdCwd;
    }

    const connName = typeof meta?.connection === "string" ? meta.connection.trim() : "";
    if (!isLocalConnName(connName)) {
        return "";
    }

    const explicitDisplayCwd = typeof meta?.["display:launchcwd"] === "string" ? meta["display:launchcwd"] : "";
    return formatCwdForDisplay(explicitDisplayCwd);
}

export function extractTerminalDisplayCwdFromBufferLines(lines?: string[]): string {
    if (!Array.isArray(lines) || lines.length === 0) {
        return "";
    }

    const startIndex = Math.max(0, lines.length - 40);
    for (let idx = lines.length - 1; idx >= startIndex; idx--) {
        const normalizedLine = normalizeTerminalLine(lines[idx]);
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

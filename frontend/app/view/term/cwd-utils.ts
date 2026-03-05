// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isBlank } from "@/util/util";

function normalizeCwdPath(pathValue: string): string {
    const rawPath = String(pathValue ?? "").trim();
    if (isBlank(rawPath)) {
        return "";
    }
    let normalizedPath = rawPath.replace(/\\/g, "/");
    const isUncPath = normalizedPath.startsWith("//");
    if (isUncPath) {
        normalizedPath = `//${normalizedPath.slice(2).replace(/\/{2,}/g, "/")}`;
    } else {
        normalizedPath = normalizedPath.replace(/\/{2,}/g, "/");
    }
    if (normalizedPath.length > 1) {
        normalizedPath = normalizedPath.replace(/\/+$/, "");
    }
    if (/^[a-zA-Z]:$/.test(normalizedPath)) {
        normalizedPath = `${normalizedPath}/`;
    }
    return normalizedPath;
}

function resolveRelativePath(basePath: string, relativePath: string): string {
    const normalizedBase = normalizeCwdPath(basePath);
    const normalizedRelative = normalizeCwdPath(relativePath);
    if (isBlank(normalizedBase) || isBlank(normalizedRelative)) {
        return "";
    }

    let prefix = "";
    let baseTail = normalizedBase;

    if (normalizedBase.startsWith("//")) {
        const uncMatch = normalizedBase.match(/^\/\/[^/]+\/[^/]+/);
        if (uncMatch) {
            prefix = uncMatch[0];
            baseTail = normalizedBase.slice(prefix.length) || "/";
        } else {
            prefix = "//";
            baseTail = normalizedBase.slice(2);
        }
    } else if (/^[a-zA-Z]:\//.test(normalizedBase)) {
        prefix = normalizedBase.slice(0, 2);
        baseTail = normalizedBase.slice(2) || "/";
    } else if (normalizedBase.startsWith("~")) {
        prefix = "~";
        baseTail = normalizedBase.slice(1) || "/";
    } else if (normalizedBase.startsWith("/")) {
        prefix = "/";
        baseTail = normalizedBase.slice(1);
    }

    const baseSegments = baseTail
        .split("/")
        .filter((segment) => !isBlank(segment) && segment !== ".");
    const nextSegments = normalizedRelative.split("/").filter((segment) => !isBlank(segment) && segment !== ".");
    const mergedSegments = [...baseSegments];
    for (const segment of nextSegments) {
        if (segment === "..") {
            if (mergedSegments.length > 0) {
                mergedSegments.pop();
            }
            continue;
        }
        mergedSegments.push(segment);
    }

    if (prefix === "~") {
        return `~/${mergedSegments.join("/")}`.replace(/\/+$/, "") || "~";
    }
    if (prefix === "/") {
        return `/${mergedSegments.join("/")}`.replace(/\/+$/, "") || "/";
    }
    if (/^[a-zA-Z]:$/.test(prefix)) {
        const suffix = mergedSegments.length > 0 ? `/${mergedSegments.join("/")}` : "/";
        return `${prefix}${suffix}`;
    }
    if (prefix.startsWith("//")) {
        const suffix = mergedSegments.length > 0 ? `/${mergedSegments.join("/")}` : "";
        return `${prefix}${suffix}`;
    }
    return mergedSegments.join("/");
}

function extractLeadingPathArgument(rawArgument: string): string {
    const trimmedArgument = String(rawArgument ?? "").trim();
    if (isBlank(trimmedArgument)) {
        return "";
    }
    const quotedDoubleMatch = trimmedArgument.match(/^"([^"]*)"/);
    if (quotedDoubleMatch) {
        return quotedDoubleMatch[1].trim();
    }
    const quotedSingleMatch = trimmedArgument.match(/^'([^']*)'/);
    if (quotedSingleMatch) {
        return quotedSingleMatch[1].trim();
    }
    const tokenMatch = trimmedArgument.match(/^([^\s]+)/);
    return tokenMatch?.[1]?.trim() ?? "";
}

function extractCwdTargetFromCommand(commandText: string): string {
    const trimmedCommand = String(commandText ?? "").trim();
    if (isBlank(trimmedCommand)) {
        return "";
    }
    const commandWithoutTail = trimmedCommand.replace(/\s*(?:&&|\|\||;).*/i, "").trim();
    if (isBlank(commandWithoutTail)) {
        return "";
    }

    const basicCommandMatch = commandWithoutTail.match(/^(cd|pushd)\s+(.+)$/i);
    if (basicCommandMatch) {
        let pathArg = basicCommandMatch[2].trim();
        if (/^\/d\s+/i.test(pathArg)) {
            pathArg = pathArg.replace(/^\/d\s+/i, "");
        }
        return extractLeadingPathArgument(pathArg);
    }

    const setLocationMatch = commandWithoutTail.match(/^(set-location|sl|chdir)\s+(.+)$/i);
    if (!setLocationMatch) {
        return "";
    }
    let setLocationArgs = setLocationMatch[2].trim();
    setLocationArgs = setLocationArgs.replace(/^-+(?:path|literalpath)\s+/i, "");
    setLocationArgs = setLocationArgs.replace(/^-+(?:path|literalpath):/i, "");
    return extractLeadingPathArgument(setLocationArgs);
}

function extractCdFlagTargetFromCommand(commandText: string): string {
    const trimmedCommand = String(commandText ?? "").trim();
    if (isBlank(trimmedCommand)) {
        return "";
    }
    const commandWithoutTail = trimmedCommand.replace(/\s*(?:&&|\|\||;).*/i, "").trim();
    if (isBlank(commandWithoutTail)) {
        return "";
    }

    type FlagMatch = { idx: number; target: string };
    const matches: FlagMatch[] = [];

    const pushMatch = (idx: number, target: string) => {
        const trimmed = String(target ?? "").trim();
        if (isBlank(trimmed)) {
            return;
        }
        matches.push({ idx, target: trimmed });
    };

    // Capture the flag argument in a single match so we don't have to guess token boundaries later.
    // We intentionally pick the *last* match in the command, since many CLIs treat later flags as overriding earlier ones.
    const cdRegex = /(?:^|\s)--cd(?:=|\s+)(?:"([^"]*)"|'([^']*)'|([^\s]+))/gi;
    let m: RegExpExecArray | null = null;
    while ((m = cdRegex.exec(commandWithoutTail)) !== null) {
        const target = (m[1] ?? m[2] ?? m[3] ?? "").trim();
        pushMatch(m.index ?? 0, target);
    }

    // Support common "-C <path>" style (git-like); case-sensitive to avoid matching unrelated "-c" flags.
    const capCRegex = /(?:^|\s)-C(?:=|\s+)(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
    while ((m = capCRegex.exec(commandWithoutTail)) !== null) {
        const target = (m[1] ?? m[2] ?? m[3] ?? "").trim();
        pushMatch(m.index ?? 0, target);
    }

    if (matches.length === 0) {
        return "";
    }
    matches.sort((a, b) => a.idx - b.idx);
    return matches[matches.length - 1].target;
}

export function resolveVirtualCwdFromCdFlag(commandText: string, currentCwd: string): string {
    const targetPath = extractCdFlagTargetFromCommand(commandText);
    if (isBlank(targetPath) || targetPath === "-") {
        return "";
    }

    const normalizedCurrent = normalizeCwdPath(currentCwd);
    const normalizedTarget = normalizeCwdPath(targetPath);
    if (isBlank(normalizedTarget)) {
        return "";
    }

    if (
        normalizedTarget.startsWith("/") ||
        normalizedTarget.startsWith("//") ||
        normalizedTarget.startsWith("~") ||
        /^[a-zA-Z]:\//.test(normalizedTarget)
    ) {
        return normalizedTarget;
    }

    if (isBlank(normalizedCurrent)) {
        return "";
    }
    return resolveRelativePath(normalizedCurrent, normalizedTarget);
}

export function inferNextCwdFromCommand(commandText: string, currentCwd: string): string {
    const targetPath = extractCwdTargetFromCommand(commandText);
    if (isBlank(targetPath) || targetPath === "-") {
        return "";
    }

    const normalizedCurrent = normalizeCwdPath(currentCwd);
    const normalizedTarget = normalizeCwdPath(targetPath);
    if (isBlank(normalizedTarget)) {
        return "";
    }

    if (
        normalizedTarget.startsWith("/") ||
        normalizedTarget.startsWith("//") ||
        normalizedTarget.startsWith("~") ||
        /^[a-zA-Z]:\//.test(normalizedTarget)
    ) {
        return normalizedTarget;
    }

    if (isBlank(normalizedCurrent)) {
        return "";
    }
    return resolveRelativePath(normalizedCurrent, normalizedTarget);
}


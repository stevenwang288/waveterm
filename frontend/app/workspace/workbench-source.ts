// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getTerminalDisplayCwd } from "@/util/launchcwd";
import { isBlank } from "@/util/util";

export const WORKBENCH_SOURCE_META_KEYS = [
    "connection",
    "cmd:cwd",
    "display:launchcwd",
    "term:displaycwd",
    "cwd",
] as const;
const WORKBENCH_SOURCE_PATH_META_KEYS = ["cmd:cwd", "display:launchcwd", "term:displaycwd", "cwd"] as const;

function trimWorkbenchSourceMetaValue(value: unknown): string {
    const normalize = (text: string): string => {
        const trimmed = text.trim();
        if (trimmed === "System.Collections.Specialized.OrderedDictionary") {
            return "";
        }
        return trimmed;
    };
    if (typeof value === "string") {
        return normalize(value);
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return normalize(String(value));
    }
    return "";
}

function resolveWorkbenchSourcePath(meta: MetaType, liveDisplayCwd?: string | null): string {
    const normalizedLiveDisplayCwd = trimWorkbenchSourceMetaValue(liveDisplayCwd);
    const metaWithLiveDisplayCwd = isBlank(normalizedLiveDisplayCwd)
        ? meta
        : {
              ...meta,
              "term:displaycwd": normalizedLiveDisplayCwd,
          };
    const displayCwd = getTerminalDisplayCwd(metaWithLiveDisplayCwd);
    return (
        normalizedLiveDisplayCwd ||
        displayCwd ||
        trimWorkbenchSourceMetaValue(meta["term:displaycwd"]) ||
        trimWorkbenchSourceMetaValue(meta["display:launchcwd"]) ||
        trimWorkbenchSourceMetaValue(meta["cmd:cwd"]) ||
        trimWorkbenchSourceMetaValue(meta.cwd)
    );
}

export function normalizeWorkbenchSourceMeta(
    meta: MetaType | null | undefined,
    liveDisplayCwd?: string | null
): MetaType | null {
    if (meta == null) {
        return null;
    }
    const resolvedPath = resolveWorkbenchSourcePath(meta, liveDisplayCwd);
    if (isBlank(resolvedPath)) {
        return meta;
    }
    return {
        ...meta,
        "cmd:cwd": resolvedPath,
        "display:launchcwd": resolvedPath,
        "term:displaycwd": resolvedPath,
        cwd: resolvedPath,
    };
}

export function getWorkbenchSourceMetaPatch(
    meta: MetaType | null | undefined,
    liveDisplayCwd?: string | null
): MetaType {
    const normalizedMeta = normalizeWorkbenchSourceMeta(meta, liveDisplayCwd);
    const patch: MetaType = {};
    if (normalizedMeta == null) {
        return patch;
    }
    for (const key of WORKBENCH_SOURCE_META_KEYS) {
        const value = normalizedMeta[key];
        if (!isBlank(trimWorkbenchSourceMetaValue(value))) {
            patch[key] = value;
        }
    }
    return patch;
}

export function hasWorkbenchSourceContext(meta: MetaType | null | undefined): boolean {
    if (meta == null) {
        return false;
    }
    return WORKBENCH_SOURCE_META_KEYS.some((key) => !isBlank(trimWorkbenchSourceMetaValue(meta[key])));
}

function hasWorkbenchSourcePath(meta: MetaType | null | undefined): boolean {
    if (meta == null) {
        return false;
    }
    return WORKBENCH_SOURCE_PATH_META_KEYS.some((key) => !isBlank(trimWorkbenchSourceMetaValue(meta[key])));
}

type ResolveWorkbenchSourceMetaOptions = {
    activeTabBlockIds?: string[] | null;
    focusedBlockId?: string | null;
    getBlockMeta: (blockId: string) => MetaType | null | undefined;
    getDisplayCwd: (blockId: string) => string;
};

export function resolveWorkbenchSourceMeta({
    activeTabBlockIds,
    focusedBlockId,
    getBlockMeta,
    getDisplayCwd,
}: ResolveWorkbenchSourceMetaOptions): MetaType | null {
    const candidateBlockIds: string[] = [];
    const seen = new Set<string>();
    let fallbackSourceMeta: MetaType | null = null;
    const addCandidate = (blockId: string | null | undefined) => {
        const trimmed = String(blockId ?? "").trim();
        if (isBlank(trimmed) || seen.has(trimmed)) {
            return;
        }
        seen.add(trimmed);
        candidateBlockIds.push(trimmed);
    };

    addCandidate(focusedBlockId);
    for (const blockId of activeTabBlockIds ?? []) {
        addCandidate(blockId);
    }

    for (const blockId of candidateBlockIds) {
        const sourceMeta = normalizeWorkbenchSourceMeta(getBlockMeta(blockId), getDisplayCwd(blockId));
        if (hasWorkbenchSourcePath(sourceMeta)) {
            return sourceMeta;
        }
        if (fallbackSourceMeta == null && hasWorkbenchSourceContext(sourceMeta)) {
            fallbackSourceMeta = sourceMeta;
        }
    }

    return fallbackSourceMeta;
}

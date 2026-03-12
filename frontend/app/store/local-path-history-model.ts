// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { formatCwdForDisplay } from "@/util/cwdlabel";

export interface LocalPathHistoryEntry {
    path: string;
    hitCount: number;
    lastAccessed: number;
}

export interface LocalPathHistoryData {
    entries: LocalPathHistoryEntry[];
    lastUpdated: number;
}

export interface CurrentLocalPathItem {
    path: string;
    blockId?: string;
    isActive?: boolean;
    order?: number;
}

export interface LocalPathHistoryGroups {
    currentItems: CurrentLocalPathItem[];
    historyItems: LocalPathHistoryEntry[];
}

const STORAGE_KEY = "waveterm-local-path-history";
const MAX_ENTRIES = 200;

export const LOCAL_PATH_HISTORY_UPDATED_EVENT = "local-path-history-updated";

function makeDefaultData(): LocalPathHistoryData {
    return { entries: [], lastUpdated: Date.now() };
}

export function normalizeLocalPath(path: string): string {
    return formatCwdForDisplay(String(path ?? ""));
}

function makePathSignature(path: string): string {
    const normalized = normalizeLocalPath(path);
    if (!normalized) {
        return "";
    }
    if (/^(?:[A-Za-z]:|\\\\|\/\/)/.test(normalized)) {
        return normalized.toLowerCase();
    }
    return normalized;
}

function normalizeEntry(entry: Partial<LocalPathHistoryEntry> | null | undefined): LocalPathHistoryEntry | null {
    const path = normalizeLocalPath(entry?.path ?? "");
    if (!path) {
        return null;
    }
    return {
        path,
        hitCount:
            typeof entry?.hitCount === "number" && Number.isFinite(entry.hitCount) && entry.hitCount > 0
                ? Math.floor(entry.hitCount)
                : 1,
        lastAccessed:
            typeof entry?.lastAccessed === "number" && Number.isFinite(entry.lastAccessed) && entry.lastAccessed > 0
                ? entry.lastAccessed
                : 0,
    };
}

function sortEntries(entries: LocalPathHistoryEntry[]): LocalPathHistoryEntry[] {
    return [...entries].sort((a, b) => {
        if (b.lastAccessed !== a.lastAccessed) {
            return b.lastAccessed - a.lastAccessed;
        }
        if (b.hitCount !== a.hitCount) {
            return b.hitCount - a.hitCount;
        }
        return a.path.localeCompare(b.path);
    });
}

function normalizeData(data: Partial<LocalPathHistoryData> | null | undefined): LocalPathHistoryData {
    const entries = Array.isArray(data?.entries)
        ? data.entries
              .map((entry) => normalizeEntry(entry))
              .filter((entry): entry is LocalPathHistoryEntry => entry != null)
        : [];
    return {
        entries: sortEntries(entries).slice(0, MAX_ENTRIES),
        lastUpdated: typeof data?.lastUpdated === "number" ? data.lastUpdated : Date.now(),
    };
}

export function recordPathHistoryEntry(
    entries: LocalPathHistoryEntry[],
    path: string,
    now = Date.now()
): LocalPathHistoryEntry[] {
    const normalizedPath = normalizeLocalPath(path);
    if (!normalizedPath) {
        return entries;
    }

    const nextEntries = entries
        .map((entry) => normalizeEntry(entry))
        .filter((entry): entry is LocalPathHistoryEntry => entry != null);
    const signature = makePathSignature(normalizedPath);
    const existingIndex = nextEntries.findIndex((entry) => makePathSignature(entry.path) === signature);

    if (existingIndex === -1) {
        nextEntries.push({
            path: normalizedPath,
            hitCount: 1,
            lastAccessed: now,
        });
    } else {
        const existing = nextEntries[existingIndex];
        nextEntries[existingIndex] = {
            path: normalizedPath,
            hitCount: existing.hitCount + 1,
            lastAccessed: now,
        };
    }

    return sortEntries(nextEntries).slice(0, MAX_ENTRIES);
}

function normalizeCurrentItems(items: CurrentLocalPathItem[]): CurrentLocalPathItem[] {
    const normalized = items
        .map((item, index) => {
            const path = normalizeLocalPath(item.path);
            if (!path) {
                return null;
            }
            return {
                path,
                blockId: item.blockId,
                isActive: !!item.isActive,
                order: item.order ?? index,
            };
        })
        .filter((item): item is CurrentLocalPathItem => item != null)
        .sort((a, b) => {
            if (a.isActive !== b.isActive) {
                return a.isActive ? -1 : 1;
            }
            const aOrder = a.order ?? Number.MAX_SAFE_INTEGER;
            const bOrder = b.order ?? Number.MAX_SAFE_INTEGER;
            if (aOrder !== bOrder) {
                return aOrder - bOrder;
            }
            return a.path.localeCompare(b.path);
        });

    const deduped: CurrentLocalPathItem[] = [];
    const seen = new Set<string>();
    for (const item of normalized) {
        const signature = makePathSignature(item.path);
        if (seen.has(signature)) {
            continue;
        }
        seen.add(signature);
        deduped.push(item);
    }
    return deduped;
}

export function splitCurrentAndHistoryEntries(
    currentItems: CurrentLocalPathItem[],
    historyEntries: LocalPathHistoryEntry[]
): LocalPathHistoryGroups {
    const normalizedCurrentItems = normalizeCurrentItems(currentItems);
    const currentSignatures = new Set(normalizedCurrentItems.map((item) => makePathSignature(item.path)));
    const normalizedHistoryItems = sortEntries(
        historyEntries
            .map((entry) => normalizeEntry(entry))
            .filter((entry): entry is LocalPathHistoryEntry => entry != null)
    ).filter((entry) => !currentSignatures.has(makePathSignature(entry.path)));

    return {
        currentItems: normalizedCurrentItems,
        historyItems: normalizedHistoryItems,
    };
}

export class LocalPathHistoryModel {
    private static instance: LocalPathHistoryModel | null = null;

    private data: LocalPathHistoryData;

    private constructor() {
        this.data = this.loadFromStorage();
    }

    static getInstance(): LocalPathHistoryModel {
        if (LocalPathHistoryModel.instance == null) {
            LocalPathHistoryModel.instance = new LocalPathHistoryModel();
        }
        return LocalPathHistoryModel.instance;
    }

    private loadFromStorage(): LocalPathHistoryData {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                return normalizeData(JSON.parse(raw));
            }
        } catch (e) {
            console.error("Failed to load local path history from storage:", e);
        }
        return makeDefaultData();
    }

    private saveToStorage(): void {
        try {
            this.data.lastUpdated = Date.now();
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
        } catch (e) {
            console.error("Failed to save local path history to storage:", e);
        }
    }

    private notifyUpdated(): void {
        if (typeof window === "undefined") {
            return;
        }
        window.dispatchEvent(new Event(LOCAL_PATH_HISTORY_UPDATED_EVENT));
    }

    getEntries(): LocalPathHistoryEntry[] {
        return sortEntries(this.data.entries);
    }

    recordPath(path: string, now = Date.now()): boolean {
        const nextEntries = recordPathHistoryEntry(this.data.entries, path, now);
        if (nextEntries === this.data.entries) {
            return false;
        }
        this.data = {
            entries: nextEntries,
            lastUpdated: now,
        };
        this.saveToStorage();
        this.notifyUpdated();
        return true;
    }

    clear(): void {
        this.data = makeDefaultData();
        this.saveToStorage();
        this.notifyUpdated();
    }
}

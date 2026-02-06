// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export interface FavoriteItem {
    id: string;
    label: string;
    path: string;
    icon?: string;
    children?: FavoriteItem[];
}

export interface FavoritesData {
    items: FavoriteItem[];
    lastUpdated: number;
}

const STORAGE_KEY_PREFIX = "waveterm-favorites";
const GLOBAL_SCOPE_ID = "global";

function makeStorageKey(scopeId?: string): string {
    const effectiveScopeId = scopeId && scopeId.trim() ? scopeId.trim() : GLOBAL_SCOPE_ID;
    if (effectiveScopeId === GLOBAL_SCOPE_ID) {
        return STORAGE_KEY_PREFIX;
    }
    return `${STORAGE_KEY_PREFIX}:${effectiveScopeId}`;
}

function makeDefaultFavorites(): FavoritesData {
    return { items: [], lastUpdated: Date.now() };
}

function defaultLabelForPath(path: string): string {
    if (!path) {
        return "";
    }
    const trimmed = path.replace(/[\\/]+$/, "");
    if (!trimmed) {
        return path;
    }
    const parts = trimmed.split(/[\\/]/);
    return parts[parts.length - 1] || trimmed || path;
}

export class FavoritesModel {
    private static instances: Map<string, FavoritesModel> = new Map();

    private scopeId: string;
    private storageKey: string;
    private data: FavoritesData;

    private constructor(scopeId: string) {
        this.scopeId = scopeId && scopeId.trim() ? scopeId.trim() : GLOBAL_SCOPE_ID;
        this.storageKey = makeStorageKey(this.scopeId);
        this.data = this.loadFromStorage();
    }

    static getInstance(scopeId?: string): FavoritesModel {
        const effectiveScopeId = scopeId && scopeId.trim() ? scopeId.trim() : GLOBAL_SCOPE_ID;
        const storageKey = makeStorageKey(effectiveScopeId);
        const existing = FavoritesModel.instances.get(storageKey);
        if (existing) {
            return existing;
        }
        const instance = new FavoritesModel(effectiveScopeId);
        FavoritesModel.instances.set(storageKey, instance);
        return instance;
    }

    private loadFromStorage(): FavoritesData {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                return JSON.parse(stored);
            }

            // Migration/fallback: if this is a scoped favorites list and no data exists yet,
            // seed it from the global favorites so users don't "lose" existing items.
            if (this.scopeId !== GLOBAL_SCOPE_ID) {
                const globalStored = localStorage.getItem(makeStorageKey(GLOBAL_SCOPE_ID));
                if (globalStored) {
                    const parsed = JSON.parse(globalStored) as FavoritesData;
                    const seeded: FavoritesData = {
                        items: JSON.parse(JSON.stringify(parsed?.items ?? [])),
                        lastUpdated: Date.now(),
                    };
                    try {
                        localStorage.setItem(this.storageKey, JSON.stringify(seeded));
                    } catch {
                        // ignore
                    }
                    return seeded;
                }
            }
        } catch (e) {
            console.error("Failed to load favorites from storage:", e);
        }
        return makeDefaultFavorites();
    }

    private saveToStorage(): void {
        try {
            this.data.lastUpdated = Date.now();
            localStorage.setItem(this.storageKey, JSON.stringify(this.data));
        } catch (e) {
            console.error("Failed to save favorites to storage:", e);
        }
    }

    getItems(): FavoriteItem[] {
        return this.data.items;
    }

    addFavorite(path: string, label?: string, parentId?: string): void {
        const id = `fav-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const displayLabel = label || defaultLabelForPath(path) || path;

        const newItem: FavoriteItem = {
            id,
            label: displayLabel,
            path,
            icon: "folder",
            children: [],
        };

        if (parentId) {
            const parent = this.findItemById(this.data.items, parentId);
            if (parent) {
                if (!parent.children) {
                    parent.children = [];
                }
                parent.children.push(newItem);
            }
        } else {
            this.data.items.push(newItem);
        }

        this.saveToStorage();
    }

    removeFavorite(id: string): void {
        this.data.items = this.removeItemById(this.data.items, id);
        this.saveToStorage();
    }

    updateFavorite(id: string, label: string): void {
        const item = this.findItemById(this.data.items, id);
        if (item) {
            item.label = label;
            this.saveToStorage();
        }
    }

    moveFavorite(itemId: string, newParentId?: string): void {
        // Remove from current location
        const item = this.findItemById(this.data.items, itemId);
        if (!item) return;

        this.data.items = this.removeItemById(this.data.items, itemId);

        // Add to new location
        if (newParentId) {
            const newParent = this.findItemById(this.data.items, newParentId);
            if (newParent) {
                if (!newParent.children) {
                    newParent.children = [];
                }
                newParent.children.push(item);
            }
        } else {
            this.data.items.push(item);
        }

        this.saveToStorage();
    }

    private findItemById(items: FavoriteItem[], id: string): FavoriteItem | undefined {
        for (const item of items) {
            if (item.id === id) {
                return item;
            }
            if (item.children) {
                const found = this.findItemById(item.children, id);
                if (found) {
                    return found;
                }
            }
        }
        return undefined;
    }

    private removeItemById(items: FavoriteItem[], id: string): FavoriteItem[] {
        return items.filter((item) => {
            if (item.id === id) {
                return false;
            }
            if (item.children) {
                item.children = this.removeItemById(item.children, id);
            }
            return true;
        });
    }

    clear(): void {
        this.data = makeDefaultFavorites();
        this.saveToStorage();
    }
}

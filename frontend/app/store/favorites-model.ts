// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export interface FavoriteItem {
    id: string;
    label: string;
    path: string;
    connection?: string;
    autoCmd?: string;
    icon?: string;
    children?: FavoriteItem[];
}

export interface FavoritesData {
    items: FavoriteItem[];
    lastUpdated: number;
}

const STORAGE_KEY_PREFIX = "waveterm-favorites";
const STORAGE_KEY = STORAGE_KEY_PREFIX;
const SCOPED_STORAGE_KEY_PREFIX = `${STORAGE_KEY_PREFIX}:`;

function makeDefaultFavorites(): FavoritesData {
    return { items: [], lastUpdated: Date.now() };
}

function normalizeFavoritePath(path: string): string {
    if (!path) {
        return "";
    }
    const trimmed = path.trim();
    if (!trimmed) {
        return "";
    }
    if (trimmed === "/" || trimmed === "\\" || trimmed === "~") {
        return trimmed;
    }
    return trimmed.replace(/[\\/]+$/, "");
}

function normalizeConnection(connection?: string): string | undefined {
    const cleaned = connection?.trim();
    return cleaned ? cleaned : undefined;
}

function defaultLabelForPath(path: string): string {
    if (!path) {
        return "";
    }
    const normalized = normalizeFavoritePath(path);
    if (!normalized) {
        return path;
    }
    const parts = normalized.split(/[\\/]/);
    return parts[parts.length - 1] || normalized;
}

function cloneFavoriteItem(item: FavoriteItem): FavoriteItem {
    return {
        id: item.id,
        label: item.label,
        path: normalizeFavoritePath(item.path),
        connection: normalizeConnection(item.connection),
        autoCmd: typeof item.autoCmd === "string" ? item.autoCmd.trim() || undefined : undefined,
        icon: item.icon,
        children: item.children?.map(cloneFavoriteItem) ?? [],
    };
}

function makeFavoriteSignature(item: FavoriteItem): string {
    return `${normalizeConnection(item.connection) ?? "local"}::${normalizeFavoritePath(item.path)}`;
}

function mergeFavoriteItems(target: FavoriteItem[], source: FavoriteItem[]): void {
    for (const sourceItem of source) {
        const normalizedSource = cloneFavoriteItem(sourceItem);
        const signature = makeFavoriteSignature(normalizedSource);
        const existing = target.find((targetItem) => makeFavoriteSignature(targetItem) === signature);
        if (!existing) {
            target.push(normalizedSource);
            continue;
        }
        if (normalizedSource.children?.length) {
            if (!existing.children) {
                existing.children = [];
            }
            mergeFavoriteItems(existing.children, normalizedSource.children);
        }
    }
}

function normalizeFavoritesData(data: Partial<FavoritesData> | null | undefined): FavoritesData {
    const normalizedItems = Array.isArray(data?.items) ? data.items.map(cloneFavoriteItem) : [];
    return {
        items: normalizedItems,
        lastUpdated: typeof data?.lastUpdated === "number" ? data.lastUpdated : Date.now(),
    };
}

export class FavoritesModel {
    private static instance: FavoritesModel | null = null;

    private storageKey: string;
    private data: FavoritesData;

    private constructor() {
        this.storageKey = STORAGE_KEY;
        this.data = this.loadFromStorage();
    }

    static getInstance(_scopeId?: string): FavoritesModel {
        if (FavoritesModel.instance) {
            return FavoritesModel.instance;
        }
        FavoritesModel.instance = new FavoritesModel();
        return FavoritesModel.instance;
    }

    private loadFromStorage(): FavoritesData {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                return normalizeFavoritesData(JSON.parse(stored));
            }

            const migrated = this.migrateScopedFavorites();
            if (migrated.items.length > 0) {
                localStorage.setItem(this.storageKey, JSON.stringify(migrated));
                return migrated;
            }
        } catch (e) {
            console.error("Failed to load favorites from storage:", e);
        }
        return makeDefaultFavorites();
    }

    private migrateScopedFavorites(): FavoritesData {
        const merged = makeDefaultFavorites();

        try {
            const scopedKeys: string[] = [];
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith(SCOPED_STORAGE_KEY_PREFIX)) {
                    scopedKeys.push(key);
                }
            }

            scopedKeys.sort();
            for (const key of scopedKeys) {
                const raw = localStorage.getItem(key);
                if (!raw) {
                    continue;
                }
                const parsed = normalizeFavoritesData(JSON.parse(raw));
                mergeFavoriteItems(merged.items, parsed.items);
            }

            if (merged.items.length > 0) {
                merged.lastUpdated = Date.now();
            }
        } catch (e) {
            console.error("Failed to migrate scoped favorites:", e);
        }

        return merged;
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

    addFavorite(path: string, label?: string, parentId?: string, connection?: string, autoCmd?: string): void {
        const normalizedPath = normalizeFavoritePath(path);
        if (!normalizedPath) {
            return;
        }

        const normalizedConnection = normalizeConnection(connection);
        const normalizedAutoCmd = typeof autoCmd === "string" ? autoCmd.trim() || undefined : undefined;
        const displayLabel = label || defaultLabelForPath(normalizedPath) || normalizedPath;

        const parent = parentId ? this.findItemById(this.data.items, parentId) : undefined;
        const targetItems = parent ? (parent.children ??= []) : this.data.items;

        const duplicated = targetItems.some(
            (item) =>
                normalizeFavoritePath(item.path) === normalizedPath &&
                normalizeConnection(item.connection) === normalizedConnection
        );
        if (duplicated) {
            return;
        }

        const id = `fav-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
        const newItem: FavoriteItem = {
            id,
            label: displayLabel,
            path: normalizedPath,
            connection: normalizedConnection,
            autoCmd: normalizedAutoCmd,
            icon: "folder",
            children: [],
        };

        targetItems.push(newItem);
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

    updateFavoriteAutoCmd(id: string, autoCmd?: string): void {
        const item = this.findItemById(this.data.items, id);
        if (!item) {
            return;
        }
        const normalized = typeof autoCmd === "string" ? autoCmd.trim() : "";
        item.autoCmd = normalized ? normalized : undefined;
        this.saveToStorage();
    }

    moveFavorite(itemId: string, newParentId?: string): void {
        const item = this.findItemById(this.data.items, itemId);
        if (!item) {
            return;
        }

        this.data.items = this.removeItemById(this.data.items, itemId);

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

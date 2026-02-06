// Copyright 2026, Command Line Inc.
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

const STORAGE_KEY = "waveterm-favorites";
const DEFAULT_FAVORITES: FavoritesData = {
    items: [],
    lastUpdated: Date.now(),
};

export class FavoritesModel {
    private static instance: FavoritesModel;
    private data: FavoritesData;

    private constructor() {
        this.data = this.loadFromStorage();
    }

    static getInstance(): FavoritesModel {
        if (!FavoritesModel.instance) {
            FavoritesModel.instance = new FavoritesModel();
        }
        return FavoritesModel.instance;
    }

    private loadFromStorage(): FavoritesData {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                return JSON.parse(stored);
            }
        } catch (e) {
            console.error("Failed to load favorites from storage:", e);
        }
        return DEFAULT_FAVORITES;
    }

    private saveToStorage(): void {
        try {
            this.data.lastUpdated = Date.now();
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
        } catch (e) {
            console.error("Failed to save favorites to storage:", e);
        }
    }

    getItems(): FavoriteItem[] {
        return this.data.items;
    }

    addFavorite(path: string, label?: string, parentId?: string): void {
        const id = `fav-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        const displayLabel = label || path.split("/").pop() || path;

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

    clear(): void {
        this.data = { ...DEFAULT_FAVORITES };
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
}

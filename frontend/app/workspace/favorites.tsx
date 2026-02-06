// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import { FavoriteItem, FavoritesModel } from "@/app/store/favorites-model";
import clsx from "clsx";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

interface FavoritesUIState {
    items: FavoriteItem[];
    expandedIds: Set<string>;
}

function dispatchNavigateToPath(path: string) {
    window.dispatchEvent(new CustomEvent("navigate-to-path", { detail: { path } }));
}

const FavoritesItemRow = memo(
    ({
        item,
        level,
        isExpanded,
        onToggleExpand,
        onRemove,
    }: {
        item: FavoriteItem;
        level: number;
        isExpanded: boolean;
        onToggleExpand: (id: string) => void;
        onRemove: (id: string) => void;
    }) => {
        const hasChildren = (item.children?.length ?? 0) > 0;

        const handleOpen = useCallback(() => {
            dispatchNavigateToPath(item.path);
        }, [item.path]);

        const handleContextMenu = useCallback(
            (e: React.MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();

                const menu: ContextMenuItem[] = [
                    {
                        label: "Open",
                        click: handleOpen,
                    },
                    { type: "separator" },
                    {
                        label: "Remove",
                        click: () => onRemove(item.id),
                    },
                ];

                ContextMenuModel.showContextMenu(menu, e);
            },
            [handleOpen, item.id, onRemove]
        );

        return (
            <div>
                <div
                    className="flex items-center px-3 py-1.5 text-sm hover:bg-hover rounded cursor-pointer"
                    style={{ marginLeft: `${level * 12}px` }}
                    onContextMenu={handleContextMenu}
                    onDoubleClick={handleOpen}
                >
                    <div
                        className={clsx(
                            "flex-shrink-0 w-4 text-xs text-secondary mr-1",
                            hasChildren ? "cursor-pointer" : "opacity-0"
                        )}
                        onClick={(e) => {
                            if (!hasChildren) return;
                            e.stopPropagation();
                            onToggleExpand(item.id);
                        }}
                    >
                        <i className={clsx("fas", isExpanded ? "fa-chevron-down" : "fa-chevron-right")}></i>
                    </div>
                    <div className="flex-shrink-0 mr-2 text-yellow-500">
                        <i className="fas fa-star"></i>
                    </div>
                    <div className="flex-1 truncate text-ellipsis">{item.label}</div>
                </div>

                {hasChildren && isExpanded && (
                    <div>
                        {item.children!.map((child) => (
                            <FavoritesItemRow
                                key={child.id}
                                item={child}
                                level={level + 1}
                                isExpanded={false}
                                onToggleExpand={onToggleExpand}
                                onRemove={onRemove}
                            />
                        ))}
                    </div>
                )}
            </div>
        );
    }
);

FavoritesItemRow.displayName = "FavoritesItemRow";

const FavoritesPanel = memo(() => {
    const favoritesModel = useMemo(() => FavoritesModel.getInstance(), []);
    const [state, setState] = useState<FavoritesUIState>({
        items: [],
        expandedIds: new Set(),
    });

    useEffect(() => {
        const updateFavorites = () => {
            setState((prev) => ({
                ...prev,
                items: favoritesModel.getItems(),
            }));
        };

        updateFavorites();
        window.addEventListener("favorites-updated", updateFavorites);
        return () => window.removeEventListener("favorites-updated", updateFavorites);
    }, [favoritesModel]);

    const handleToggleExpand = useCallback((id: string) => {
        setState((prev) => {
            const expandedIds = new Set(prev.expandedIds);
            if (expandedIds.has(id)) {
                expandedIds.delete(id);
            } else {
                expandedIds.add(id);
            }
            return { ...prev, expandedIds };
        });
    }, []);

    const handleRemove = useCallback(
        (id: string) => {
            favoritesModel.removeFavorite(id);
            window.dispatchEvent(new Event("favorites-updated"));
        },
        [favoritesModel]
    );

    return (
        <div className="flex flex-col h-full bg-zinc-950 border-l border-zinc-800 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 flex-shrink-0">
                <div className="flex items-center gap-2">
                    <i className="fas fa-star text-yellow-500"></i>
                    <span className="text-sm font-semibold">Favorites</span>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto">
                {state.items.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-secondary text-sm px-4 text-center">
                        Right-click a file/folder in the file browser and choose “Add to Favorites”.
                    </div>
                ) : (
                    <div>
                        {state.items.map((item) => (
                            <FavoritesItemRow
                                key={item.id}
                                item={item}
                                level={0}
                                isExpanded={state.expandedIds.has(item.id)}
                                onToggleExpand={handleToggleExpand}
                                onRemove={handleRemove}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
});

FavoritesPanel.displayName = "FavoritesPanel";

export { FavoritesPanel };

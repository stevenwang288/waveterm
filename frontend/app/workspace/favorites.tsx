// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { FavoriteItem, FavoritesModel } from "@/app/store/favorites-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { makeIconClass } from "@/util/util";
import {
    FloatingPortal,
    autoUpdate,
    offset,
    shift,
    useDismiss,
    useFloating,
    useInteractions,
} from "@floating-ui/react";
import clsx from "clsx";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface FavoritesUIState {
    items: FavoriteItem[];
    expandedIds: Set<string>;
}

const FavoritesItem = memo(
    ({
        item,
        level,
        isExpanded,
        onToggleExpand,
        onRemove,
        onNavigate,
    }: {
        item: FavoriteItem;
        level: number;
        isExpanded: boolean;
        onToggleExpand: (id: string) => void;
        onRemove: (id: string) => void;
        onNavigate: (path: string) => void;
    }) => {
        const { t } = useTranslation();
        const hasChildren = item.children && item.children.length > 0;

        const handleContextMenu = useCallback(
            (e: React.MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();

                const menu: ContextMenuItem[] = [
                    {
                        label: t("common.open"),
                        click: () => onNavigate(item.path),
                    },
                    {
                        type: "separator",
                    },
                    {
                        label: "新建分类",
                        click: () => {
                            const label = prompt("输入分类名称:");
                            if (label) {
                                const model = FavoritesModel.getInstance();
                                model.addFavorite(`${item.path}/__category__`, label, item.id);
                                // Trigger re-render
                                window.dispatchEvent(new Event("favorites-updated"));
                            }
                        },
                    },
                    {
                        type: "separator",
                    },
                    {
                        label: t("common.delete"),
                        click: () => onRemove(item.id),
                    },
                ];

                ContextMenuModel.showContextMenu(menu, e.nativeEvent);
            },
            [item, t, onRemove, onNavigate]
        );

        return (
            <div>
                <div
                    className="flex items-center px-3 py-1.5 text-sm hover:bg-hover rounded cursor-pointer"
                    style={{ marginLeft: `${level * 12}px` }}
                    onContextMenu={handleContextMenu}
                    onDoubleClick={() => onNavigate(item.path)}
                >
                    {hasChildren && (
                        <div
                            className="flex-shrink-0 w-4 text-xs text-secondary mr-1 cursor-pointer"
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleExpand(item.id);
                            }}
                        >
                            <i className={clsx("fas", isExpanded ? "fa-chevron-down" : "fa-chevron-right")}></i>
                        </div>
                    )}
                    {!hasChildren && <div className="flex-shrink-0 w-4"></div>}
                    <div className="flex-shrink-0 mr-2 text-yellow-500">
                        <i className={clsx("fas", "fa-star")}></i>
                    </div>
                    <div className="flex-1 truncate text-ellipsis">{item.label}</div>
                </div>
                {hasChildren && isExpanded && (
                    <div>
                        {item.children!.map((child) => (
                            <FavoritesItem
                                key={child.id}
                                item={child}
                                level={level + 1}
                                isExpanded={false}
                                onToggleExpand={onToggleExpand}
                                onRemove={onRemove}
                                onNavigate={onNavigate}
                            />
                        ))}
                    </div>
                )}
            </div>
        );
    }
);

FavoritesItem.displayName = "FavoritesItem";

const FavoritesPanel = memo(() => {
    const { t } = useTranslation();
    const [state, setState] = useState<FavoritesUIState>({
        items: [],
        expandedIds: new Set(),
    });
    const favoritesModel = FavoritesModel.getInstance();

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
    }, []);

    const handleToggleExpand = useCallback((id: string) => {
        setState((prev) => {
            const newExpanded = new Set(prev.expandedIds);
            if (newExpanded.has(id)) {
                newExpanded.delete(id);
            } else {
                newExpanded.add(id);
            }
            return { ...prev, expandedIds: newExpanded };
        });
    }, []);

    const handleRemove = useCallback((id: string) => {
        favoritesModel.removeFavorite(id);
        window.dispatchEvent(new Event("favorites-updated"));
    }, []);

    const handleNavigate = useCallback((path: string) => {
        // Get the preview model from global store and navigate
        try {
            window.dispatchEvent(new CustomEvent("navigate-to-path", { detail: { path } }));
        } catch (e) {
            console.error("Failed to navigate:", e);
        }
    }, []);

    return (
        <div className="flex flex-col h-full bg-zinc-950 border-l border-zinc-800 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 flex-shrink-0">
                <div className="flex items-center gap-2">
                    <i className="fas fa-star text-yellow-500"></i>
                    <span className="text-sm font-semibold">{t("favorites.title") || "收藏夹"}</span>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto">
                {state.items.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-secondary text-sm">
                        {t("favorites.empty") || "右键点击文件夹可添加到收藏夹"}
                    </div>
                ) : (
                    <div>
                        {state.items.map((item) => (
                            <FavoritesItem
                                key={item.id}
                                item={item}
                                level={0}
                                isExpanded={state.expandedIds.has(item.id)}
                                onToggleExpand={handleToggleExpand}
                                onRemove={handleRemove}
                                onNavigate={handleNavigate}
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

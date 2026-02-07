// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import type { FavoriteItem } from "@/app/store/favorites-model";
import { FavoritesModel } from "@/app/store/favorites-model";
import { createBlock } from "@/store/global";
import { fireAndForget } from "@/util/util";
import clsx from "clsx";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type FavoritesBarState = {
    items: FavoriteItem[];
};

function isCategoryPath(path: string): boolean {
    return path.endsWith("/__category__") || path.endsWith("\\__category__");
}

const FavoritesBar = memo(() => {
    const { t } = useTranslation();
    const favoritesModel = useMemo(() => FavoritesModel.getInstance(), []);
    const [state, setState] = useState<FavoritesBarState>({ items: [] });

    useEffect(() => {
        const update = () => {
            setState({ items: favoritesModel.getItems() });
        };
        update();
        window.addEventListener("favorites-updated", update);
        return () => window.removeEventListener("favorites-updated", update);
    }, [favoritesModel]);

    const getDisplayLabel = useCallback((path: string): string => {
        const trimmed = path.replace(/[\\/]+$/, "");
        if (!trimmed) {
            return path;
        }
        const parts = trimmed.split(/[\\/]/);
        return parts[parts.length - 1] || trimmed || path;
    }, []);

    const openFavorite = useCallback((item: FavoriteItem) => {
        if (isCategoryPath(item.path)) {
            return;
        }
        const meta: Record<string, any> = {
            controller: "shell",
            view: "term",
            "cmd:cwd": item.path,
        };
        if (item.connection) {
            meta.connection = item.connection;
        }
        createBlock({ meta });
    }, []);

    const showItemContextMenu = useCallback(
        (e: React.MouseEvent, item: FavoriteItem) => {
            e.preventDefault();
            e.stopPropagation();
            const menu: ContextMenuItem[] = [
                {
                    label: t("common.open") || "打开",
                    click: () => openFavorite(item),
                },
                {
                    label: t("favorites.copyFullPath") || "复制完整路径",
                    click: () => fireAndForget(() => navigator.clipboard.writeText(item.path)),
                },
                {
                    type: "separator",
                },
                {
                    label: t("common.delete") || "删除",
                    click: () => {
                        favoritesModel.removeFavorite(item.id);
                        window.dispatchEvent(new Event("favorites-updated"));
                    },
                },
            ];
            ContextMenuModel.showContextMenu(menu, e);
        },
        [favoritesModel, openFavorite, t]
    );

    return (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-zinc-950 border-b border-zinc-800 select-none">
            <div className="text-yellow-500 text-xs">
                <i className="fas fa-star" />
            </div>
            <div className="flex-1 overflow-x-auto whitespace-nowrap scrollbar-hide-until-hover">
                {state.items.length === 0 ? (
                    <span className="text-xs text-secondary">
                        {t("favorites.hint") || "在文件列表里右键选择“添加到收藏夹”"}
                    </span>
                ) : (
                    state.items.map((item) => (
                        <span
                            key={item.id}
                            className={clsx(
                                "inline-flex items-center gap-1.5 px-2 py-1 mr-2 rounded w-32",
                                "bg-zinc-900 text-secondary hover:bg-zinc-800 hover:text-primary cursor-pointer text-xs"
                            )}
                            onClick={() => openFavorite(item)}
                            onContextMenu={(e) => showItemContextMenu(e, item)}
                            title={item.connection ? `${item.connection} · ${item.path}` : item.path}
                        >
                            <i className="fas fa-folder-open text-zinc-400" />
                            <span className="flex-1 truncate align-middle">{getDisplayLabel(item.path)}</span>
                        </span>
                    ))
                )}
            </div>
        </div>
    );
});

FavoritesBar.displayName = "FavoritesBar";

export { FavoritesBar };

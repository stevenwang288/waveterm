// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import type { FavoriteItem } from "@/app/store/favorites-model";
import { FavoritesModel } from "@/app/store/favorites-model";
import { createBlock } from "@/store/global";
import clsx from "clsx";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

type FavoritesBarState = {
    items: FavoriteItem[];
};

const FavoritesBar = memo(() => {
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

    const openFavorite = useCallback((path: string) => {
        createBlock({
            meta: {
                view: "preview",
                file: path,
            },
        });
    }, []);

    const showItemContextMenu = useCallback(
        (e: React.MouseEvent, item: FavoriteItem) => {
            e.preventDefault();
            e.stopPropagation();
            const menu: ContextMenuItem[] = [
                {
                    label: "Open",
                    click: () => openFavorite(item.path),
                },
                { type: "separator" },
                {
                    label: "Remove",
                    click: () => {
                        favoritesModel.removeFavorite(item.id);
                        window.dispatchEvent(new Event("favorites-updated"));
                    },
                },
            ];
            ContextMenuModel.showContextMenu(menu, e);
        },
        [favoritesModel, openFavorite]
    );

    return (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-zinc-950 border-b border-zinc-800 select-none">
            <div className="text-yellow-500 text-xs">
                <i className="fas fa-star" />
            </div>
            <div className="flex-1 overflow-x-auto whitespace-nowrap scrollbar-hide-until-hover">
                {state.items.length === 0 ? (
                    <span className="text-xs text-secondary">
                        Right-click a file/folder in the file browser and choose “Add to Favorites”.
                    </span>
                ) : (
                    state.items.map((item) => (
                        <span
                            key={item.id}
                            className={clsx(
                                "inline-flex items-center gap-1.5 px-2 py-1 mr-2 rounded",
                                "bg-zinc-900 text-secondary hover:bg-zinc-800 hover:text-primary cursor-pointer text-xs"
                            )}
                            onClick={() => openFavorite(item.path)}
                            onContextMenu={(e) => showItemContextMenu(e, item)}
                            title={item.path}
                        >
                            <i className="fas fa-folder-open text-zinc-400" />
                            <span className="max-w-[240px] truncate align-middle">{item.label}</span>
                        </span>
                    ))
                )}
            </div>
        </div>
    );
});

FavoritesBar.displayName = "FavoritesBar";

export { FavoritesBar };

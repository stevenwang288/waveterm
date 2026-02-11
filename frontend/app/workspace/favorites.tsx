// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import { FavoriteItem, FavoritesModel } from "@/app/store/favorites-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { atoms, createBlock, getFocusedBlockId, globalStore, WOS } from "@/store/global";
import { fireAndForget, isBlank, stringToBase64 } from "@/util/util";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface FavoritesUIState {
    items: FavoriteItem[];
    expandedIds: Set<string>;
}

const AI_LAUNCH_COMMANDS: Array<{ label: string; command: string }> = [
    { label: "Codex", command: "codex" },
    { label: "Claude", command: "claude" },
    { label: "Gemini", command: "gemini" },
    { label: "Amp", command: "amp" },
    { label: "IFlow", command: "iflow" },
    { label: "OpenCode", command: "opencode" },
];

function isCategoryPath(path: string): boolean {
    return path.endsWith("/__category__") || path.endsWith("\\__category__");
}

const FavoritesItemNode = memo(
    ({
        item,
        level,
        expandedIds,
        onToggleExpand,
        onRemove,
        onNavigate,
        onOpenInFileManager,
        onCopyPath,
        onApplyToTerminal,
    }: {
        item: FavoriteItem;
        level: number;
        expandedIds: Set<string>;
        onToggleExpand: (id: string) => void;
        onRemove: (id: string) => void;
        onNavigate: (item: FavoriteItem) => void;
        onOpenInFileManager: (item: FavoriteItem) => void;
        onCopyPath: (item: FavoriteItem) => void;
        onApplyToTerminal: (item: FavoriteItem, cliCommand?: string) => void;
    }) => {
        const { t } = useTranslation();
        const hasChildren = (item.children?.length ?? 0) > 0;
        const isExpanded = expandedIds.has(item.id);

        const handleContextMenu = useCallback(
            (e: React.MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();

                const defaultCmd = typeof item.autoCmd === "string" ? item.autoCmd.trim() : "";
                const currentMarker = t("favorites.currentMarker");
                const menu: ContextMenuItem[] = [
                    {
                        label: t("common.open"),
                        click: () => onNavigate(item),
                    },
                    {
                        label: t("preview.openTerminalHere"),
                        click: () => onNavigate(item),
                    },
                    {
                        label: t("explorer.openView"),
                        click: () => onOpenInFileManager(item),
                    },
                    {
                        label: t("preview.copyFullPath"),
                        click: () => onCopyPath(item),
                    },
                    {
                        label: t("favorites.applyToCurrentTerminal"),
                        click: () => onApplyToTerminal(item),
                    },
                    {
                        label: t("favorites.defaultCommand"),
                        submenu: [
                            ...AI_LAUNCH_COMMANDS.map((cmd) => ({
                                label:
                                    !isBlank(defaultCmd) && defaultCmd === cmd.command
                                        ? `${cmd.label}${currentMarker}`
                                        : cmd.label,
                                click: () => {
                                    const model = FavoritesModel.getInstance();
                                    model.updateFavoriteAutoCmd(item.id, cmd.command);
                                    window.dispatchEvent(new Event("favorites-updated"));
                                },
                            })),
                            ...(!isBlank(defaultCmd)
                                ? ([
                                      { type: "separator" as const },
                                      {
                                          label: t("favorites.clearDefaultCommand"),
                                          click: () => {
                                              const model = FavoritesModel.getInstance();
                                              model.updateFavoriteAutoCmd(item.id, undefined);
                                              window.dispatchEvent(new Event("favorites-updated"));
                                          },
                                      },
                                  ] as ContextMenuItem[])
                                : []),
                        ],
                    },
                    {
                        label: t("favorites.autoCommand"),
                        submenu: AI_LAUNCH_COMMANDS.map((cmd) => ({
                            label: cmd.label,
                            click: () => onApplyToTerminal(item, cmd.command),
                        })),
                    },
                    {
                        type: "separator",
                    },
                    {
                        label: t("favorites.addCategory"),
                        click: () => {
                            const label = prompt(t("favorites.enterCategoryName"));
                            if (!label?.trim()) {
                                return;
                            }
                            const model = FavoritesModel.getInstance();
                            model.addFavorite(`${item.path}/__category__`, label.trim(), item.id, item.connection);
                            window.dispatchEvent(new Event("favorites-updated"));
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

                ContextMenuModel.showContextMenu(menu, e);
            },
            [item, onApplyToTerminal, onCopyPath, onNavigate, onOpenInFileManager, onRemove, t]
        );

        return (
            <div>
                <div
                    className="flex items-center px-3 py-1.5 text-sm hover:bg-hover rounded cursor-pointer"
                    style={{ marginLeft: `${level * 12}px` }}
                    onContextMenu={handleContextMenu}
                    onDoubleClick={() => onNavigate(item)}
                    title={item.connection ? `${item.connection} · ${item.path}` : item.path}
                >
                    {hasChildren ? (
                        <div
                            className="flex-shrink-0 w-4 text-xs text-secondary mr-1 cursor-pointer"
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleExpand(item.id);
                            }}
                        >
                            <i className={clsx("fas", isExpanded ? "fa-chevron-down" : "fa-chevron-right")}></i>
                        </div>
                    ) : (
                        <div className="flex-shrink-0 w-4"></div>
                    )}
                    <div className="flex-shrink-0 mr-2 text-yellow-500">
                        <i className={clsx("fas", isCategoryPath(item.path) ? "fa-folder-tree" : "fa-star")}></i>
                    </div>
                    <div className="flex-1 truncate text-ellipsis">{item.label}</div>
                    {!!item.connection && (
                        <div className="ml-2 text-[10px] text-blue-300/90 truncate max-w-28">{item.connection}</div>
                    )}
                </div>
                {hasChildren && isExpanded && (
                    <div>
                        {item.children!.map((child) => (
                            <FavoritesItemNode
                                key={child.id}
                                item={child}
                                level={level + 1}
                                expandedIds={expandedIds}
                                onToggleExpand={onToggleExpand}
                                onRemove={onRemove}
                                onNavigate={onNavigate}
                                onOpenInFileManager={onOpenInFileManager}
                                onCopyPath={onCopyPath}
                                onApplyToTerminal={onApplyToTerminal}
                            />
                        ))}
                    </div>
                )}
            </div>
        );
    }
);

FavoritesItemNode.displayName = "FavoritesItemNode";

const FavoritesPanel = memo(() => {
    const { t } = useTranslation();
    const [state, setState] = useState<FavoritesUIState>({
        items: [],
        expandedIds: new Set(),
    });
    const favoritesModel = FavoritesModel.getInstance();
    const layoutModel = useMemo(() => getLayoutModelForStaticTab(), []);
    const focusedLayoutNode = useAtomValue(layoutModel.focusedNode);
    const lastFocusedTermBlockIdRef = useRef<string>(null);

    const getBlockById = useCallback((blockId: string): Block | null => {
        if (isBlank(blockId)) {
            return null;
        }
        const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
        return globalStore.get(blockAtom);
    }, []);

    useEffect(() => {
        const focusedBlockId = focusedLayoutNode?.data?.blockId;
        if (isBlank(focusedBlockId)) {
            return;
        }
        const focusedBlock = getBlockById(focusedBlockId);
        if (focusedBlock?.meta?.view === "term") {
            lastFocusedTermBlockIdRef.current = focusedBlockId;
        }
    }, [focusedLayoutNode, getBlockById]);

    const findTargetTerminalBlockId = useCallback((): string => {
        const focusedBlockId = getFocusedBlockId();
        const focusedBlock = getBlockById(focusedBlockId);
        if (focusedBlock?.meta?.view === "term") {
            return focusedBlockId;
        }

        const lastFocusedTermBlockId = lastFocusedTermBlockIdRef.current;
        const lastFocusedTermBlock = getBlockById(lastFocusedTermBlockId);
        if (lastFocusedTermBlock?.meta?.view === "term") {
            return lastFocusedTermBlockId;
        }

        const staticTabId = globalStore.get(atoms.staticTabId);
        if (isBlank(staticTabId)) {
            return null;
        }
        const tabAtom = WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", staticTabId));
        const tabData = globalStore.get(tabAtom);
        const blockIds = tabData?.blockids ?? [];
        for (const blockId of blockIds) {
            const blockData = getBlockById(blockId);
            if (blockData?.meta?.view === "term") {
                return blockId;
            }
        }
        return null;
    }, [getBlockById]);

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
            const nextExpanded = new Set(prev.expandedIds);
            if (nextExpanded.has(id)) {
                nextExpanded.delete(id);
            } else {
                nextExpanded.add(id);
            }
            return { ...prev, expandedIds: nextExpanded };
        });
    }, []);

    const handleRemove = useCallback(
        (id: string) => {
            favoritesModel.removeFavorite(id);
            window.dispatchEvent(new Event("favorites-updated"));
        },
        [favoritesModel]
    );

    const handleNavigate = useCallback((item: FavoriteItem) => {
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
        const autoCmd = typeof item.autoCmd === "string" ? item.autoCmd.trim() : "";
        if (!isBlank(autoCmd)) {
            meta["term:autoCmd"] = autoCmd;
            meta["cmd:initscript"] = `${autoCmd}\n`;
        }
        createBlock({ meta });
    }, []);

    const handleOpenInFileManager = useCallback((item: FavoriteItem) => {
        if (isCategoryPath(item.path)) {
            return;
        }
        const meta: Record<string, any> = {
            view: "preview",
            file: item.path,
            "preview:explorer": true,
        };
        if (item.connection) {
            meta.connection = item.connection;
        }
        createBlock({ meta });
    }, []);

    const handleCopyPath = useCallback((item: FavoriteItem) => {
        if (isCategoryPath(item.path) || !item.path) {
            return;
        }
        navigator.clipboard?.writeText(item.path).catch(() => {
            // ignore
        });
    }, []);

    const handleApplyToTerminal = useCallback(
        (item: FavoriteItem, cliCommand?: string) => {
            if (isCategoryPath(item.path)) {
                return;
            }
            const normalizedPath = item.path?.trim() ?? "";
            if (isBlank(normalizedPath)) {
                return;
            }
            const targetTermBlockId = findTargetTerminalBlockId();
            if (isBlank(targetTermBlockId)) {
                return;
            }

            const escapedPath = normalizedPath.replace(/"/g, '\\"');
            const command = typeof cliCommand === "string" ? cliCommand.trim() : "";
            const inputScript = isBlank(command) ? `cd "${escapedPath}"\n` : `cd "${escapedPath}"\n${command}\n`;

            fireAndForget(async () => {
                const meta: Record<string, any> = {
                    "cmd:cwd": normalizedPath,
                };
                if (!isBlank(command)) {
                    meta["term:autoCmd"] = command;
                }
                await RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", targetTermBlockId),
                    meta,
                });
                await RpcApi.ControllerInputCommand(TabRpcClient, {
                    blockid: targetTermBlockId,
                    inputdata64: stringToBase64(inputScript),
                });
                if (!isBlank(command)) {
                    favoritesModel.updateFavoriteAutoCmd(item.id, command);
                    window.dispatchEvent(new Event("favorites-updated"));
                }
            });
        },
        [findTargetTerminalBlockId]
    );

    return (
        <div className="flex flex-col h-full bg-zinc-950 border-r border-zinc-800 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 flex-shrink-0">
                <div className="flex items-center gap-2">
                    <i className="fas fa-star text-yellow-500"></i>
                    <span className="text-sm font-semibold">{t("favorites.title")}</span>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto">
                {state.items.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-secondary text-sm px-4 text-center">
                        {t("favorites.hint")}
                    </div>
                ) : (
                    <div>
                        {state.items.map((item) => (
                            <FavoritesItemNode
                                key={item.id}
                                item={item}
                                level={0}
                                expandedIds={state.expandedIds}
                                onToggleExpand={handleToggleExpand}
                                onRemove={handleRemove}
                                onNavigate={handleNavigate}
                                onOpenInFileManager={handleOpenInFileManager}
                                onCopyPath={handleCopyPath}
                                onApplyToTerminal={handleApplyToTerminal}
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

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    CurrentLocalPathItem,
    LocalPathHistoryEntry,
    LocalPathHistoryModel,
    LOCAL_PATH_HISTORY_UPDATED_EVENT,
    splitCurrentAndHistoryEntries,
} from "@/app/store/local-path-history-model";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { atoms, createBlock, globalStore, refocusNode, WOS } from "@/store/global";
import { getTerminalDisplayCwd } from "@/util/launchcwd";
import { isBlank, isLocalConnName } from "@/util/util";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

function getPathLeafLabel(path: string): string {
    const trimmed = String(path ?? "").trim();
    if (!trimmed) {
        return "";
    }
    if (trimmed === "/" || trimmed === "\\") {
        return trimmed;
    }
    if (/^[A-Za-z]:\\?$/.test(trimmed)) {
        return trimmed;
    }
    const parts = trimmed.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || trimmed;
}

function buildCurrentLocalPathItems(tabData: Tab | null, focusedBlockId: string): CurrentLocalPathItem[] {
    const blockIds = Array.isArray(tabData?.blockids) ? tabData.blockids : [];
    const orderedBlockIds = focusedBlockId
        ? [focusedBlockId, ...blockIds.filter((blockId) => blockId !== focusedBlockId)]
        : blockIds;

    return orderedBlockIds
        .map((blockId, index) => {
            const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
            const blockData = globalStore.get(blockAtom);
            if (blockData?.meta?.view !== "term") {
                return null;
            }
            const connName = typeof blockData?.meta?.connection === "string" ? String(blockData.meta.connection).trim() : "";
            if (!isLocalConnName(connName)) {
                return null;
            }
            const path = getTerminalDisplayCwd(blockData.meta as Record<string, any>);
            if (isBlank(path)) {
                return null;
            }
            return {
                path,
                blockId,
                isActive: blockId === focusedBlockId,
                order: index,
            };
        })
        .filter((item): item is CurrentLocalPathItem => item != null);
}

const PathHistoryRow = memo(
    ({
        item,
        kind,
        onOpen,
    }: {
        item: CurrentLocalPathItem | LocalPathHistoryEntry;
        kind: "current" | "history";
        onOpen: (item: CurrentLocalPathItem | LocalPathHistoryEntry) => void;
    }) => {
        const { t } = useTranslation();
        const currentItem = kind === "current" ? (item as CurrentLocalPathItem) : null;
        const historyItem = kind === "history" ? (item as LocalPathHistoryEntry) : null;
        const badgeText = currentItem ? (currentItem.isActive ? t("pathHistory.currentBadge") : t("pathHistory.openBadge")) : null;
        const hitCountText = historyItem && historyItem.hitCount > 1 ? `x${historyItem.hitCount}` : null;

        return (
            <button
                type="button"
                className="w-full px-3 py-2 text-left hover:bg-hover rounded-md transition-colors"
                onClick={() => onOpen(item)}
                title={item.path}
            >
                <div className="flex items-start gap-2">
                    <div
                        className={clsx(
                            "pt-0.5 text-sm",
                            kind === "current" ? "text-emerald-400" : "text-zinc-400"
                        )}
                    >
                        <i className={clsx("fas", kind === "current" ? "fa-folder-open" : "fa-history")} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <div className="truncate text-sm text-primary">{getPathLeafLabel(item.path) || item.path}</div>
                            {badgeText && (
                                <span className="shrink-0 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                                    {badgeText}
                                </span>
                            )}
                            {hitCountText && (
                                <span className="shrink-0 text-[10px] text-secondary">{hitCountText}</span>
                            )}
                        </div>
                        <div className="truncate text-[11px] text-secondary">{item.path}</div>
                    </div>
                </div>
            </button>
        );
    }
);

PathHistoryRow.displayName = "PathHistoryRow";

const PathHistoryPanel = memo(() => {
    const { t } = useTranslation();
    const pathHistoryModel = useMemo(() => LocalPathHistoryModel.getInstance(), []);
    const layoutModel = useMemo(() => getLayoutModelForStaticTab(), []);
    const focusedLayoutNode = useAtomValue(layoutModel.focusedNode);
    const staticTabId = useAtomValue(atoms.staticTabId);
    const [revision, setRevision] = useState(0);
    const [tabData] = WOS.useWaveObjectValue<Tab>(staticTabId ? WOS.makeORef("tab", staticTabId) : null);

    useEffect(() => {
        const handleUpdate = () => {
            setRevision((value) => value + 1);
        };
        window.addEventListener(LOCAL_PATH_HISTORY_UPDATED_EVENT, handleUpdate);
        return () => window.removeEventListener(LOCAL_PATH_HISTORY_UPDATED_EVENT, handleUpdate);
    }, []);

    const focusedBlockId = focusedLayoutNode?.data?.blockId ?? "";
    const { currentItems, historyItems } = useMemo(() => {
        const current = buildCurrentLocalPathItems(tabData, focusedBlockId);
        return splitCurrentAndHistoryEntries(current, pathHistoryModel.getEntries());
    }, [focusedBlockId, pathHistoryModel, revision, tabData]);

    const handleOpenPath = useCallback((item: CurrentLocalPathItem | LocalPathHistoryEntry) => {
        if ("blockId" in item && !isBlank(item.blockId)) {
            refocusNode(item.blockId);
            return;
        }
        void createBlock({
            meta: {
                controller: "shell",
                view: "term",
                "cmd:cwd": item.path,
            },
        });
    }, []);

    return (
        <div className="flex h-full flex-col overflow-hidden border-r border-zinc-800 bg-zinc-950">
            <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
                <i className="fas fa-history text-amber-400" />
                <span className="text-sm font-semibold">{t("pathHistory.title")}</span>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2">
                {currentItems.length === 0 && historyItems.length === 0 ? (
                    <div className="flex h-full items-center justify-center px-4 text-center text-sm text-secondary">
                        {t("pathHistory.hint")}
                    </div>
                ) : (
                    <div className="space-y-4">
                        {currentItems.length > 0 && (
                            <section>
                                <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-secondary">
                                    {t("pathHistory.current")}
                                </div>
                                <div className="space-y-1">
                                    {currentItems.map((item) => (
                                        <PathHistoryRow key={`current:${item.path}`} item={item} kind="current" onOpen={handleOpenPath} />
                                    ))}
                                </div>
                            </section>
                        )}
                        {historyItems.length > 0 && (
                            <section>
                                <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-secondary">
                                    {t("pathHistory.history")}
                                </div>
                                <div className="space-y-1">
                                    {historyItems.map((item) => (
                                        <PathHistoryRow key={`history:${item.path}`} item={item} kind="history" onOpen={handleOpenPath} />
                                    ))}
                                </div>
                            </section>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
});

PathHistoryPanel.displayName = "PathHistoryPanel";

export { PathHistoryPanel };

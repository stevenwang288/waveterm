// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import { createBlock, globalStore } from "@/app/store/global";
import { FavoritesModel } from "@/app/store/favorites-model";
import { uxCloseBlock } from "@/app/store/keymodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { PLATFORM, PlatformWindows } from "@/util/platformutil";
import { fireAndForget, isBlank } from "@/util/util";
import clsx from "clsx";
import { useAtom, useAtomValue } from "jotai";
import { Fragment, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SpecializedViewProps } from "./preview";
import { DirectoryPreview } from "./preview-directory";

type ExplorerItem = {
    icon: string;
    label: string;
    path: string;
};

type ExplorerNavItem = ExplorerItem & {
    favoriteId?: string;
};

type BreadcrumbSegment = {
    label: string;
    path: string;
};

type TreeNodeState = {
    children?: ExplorerItem[];
    loading?: boolean;
    error?: string;
};

function getLeafLabel(path: string): string {
    const trimmed = path.replace(/[\\/]+$/, "");
    if (!trimmed) {
        return path;
    }
    const parts = trimmed.split(/[\\/]/);
    return parts[parts.length - 1] || trimmed || path;
}

function getBreadcrumbSegments(path: string): BreadcrumbSegment[] {
    if (!path) {
        return [];
    }

    const joinSep = path.includes("\\") ? "\\" : "/";
    const trimmed = path.replace(/[\\/]+$/, "");

    if (trimmed === "" && path.startsWith("/")) {
        return [{ label: "/", path: "/" }];
    }
    if (trimmed === "" && path.startsWith("\\")) {
        return [{ label: "\\", path: "\\" }];
    }
    if (trimmed === "~") {
        return [{ label: "~", path: "~" }];
    }

    const driveMatch = trimmed.match(/^([A-Za-z]:)(.*)$/);
    if (driveMatch) {
        const drive = driveMatch[1];
        const rest = driveMatch[2].replace(/^[\\/]+/, "");
        const restParts = rest ? rest.split(/[\\/]+/).filter(Boolean) : [];
        const segments: BreadcrumbSegment[] = [];
        let curPath = drive + joinSep;
        segments.push({ label: drive, path: curPath });
        for (const part of restParts) {
            curPath = curPath.replace(/[\\/]+$/, "") + joinSep + part;
            segments.push({ label: part, path: curPath });
        }
        return segments;
    }

    if (trimmed.startsWith("~")) {
        const rest = trimmed === "~" ? "" : trimmed.slice(1).replace(/^[\\/]+/, "");
        const restParts = rest ? rest.split(/[\\/]+/).filter(Boolean) : [];
        const segments: BreadcrumbSegment[] = [{ label: "~", path: "~" }];
        let curPath = "~";
        for (const part of restParts) {
            curPath = curPath.replace(/[\\/]+$/, "") + joinSep + part;
            segments.push({ label: part, path: curPath });
        }
        return segments;
    }

    if (trimmed.startsWith("/")) {
        const restParts = trimmed.slice(1).split(/[\\/]+/).filter(Boolean);
        const segments: BreadcrumbSegment[] = [{ label: "/", path: "/" }];
        let curPath = "";
        for (const part of restParts) {
            curPath = curPath === "" ? "/" + part : curPath + joinSep + part;
            segments.push({ label: part, path: curPath });
        }
        return segments;
    }

    const parts = trimmed.split(/[\\/]+/).filter(Boolean);
    const segments: BreadcrumbSegment[] = [];
    let curPath = "";
    for (const part of parts) {
        curPath = curPath ? curPath + joinSep + part : part;
        segments.push({ label: part, path: curPath });
    }
    return segments;
}

function normalizeExplorerPath(path: string): string {
    if (!path) {
        return "";
    }
    const trimmed = path.trim();
    if (!trimmed) {
        return "";
    }
    if (trimmed === "~") {
        return "~";
    }
    if (trimmed === "/" || trimmed === "\\") {
        return trimmed;
    }
    const driveRootMatch = trimmed.match(/^([A-Za-z]:)[\\/]*$/);
    if (driveRootMatch) {
        return `${driveRootMatch[1]}\\`;
    }
    const uncRootMatch = trimmed.match(/^(\\\\[^\\]+\\[^\\]+)[\\/]?$/);
    if (uncRootMatch) {
        return `${uncRootMatch[1]}\\`;
    }
    return trimmed.replace(/[\\/]+$/, "");
}

function isProbablyWindowsPath(path: string): boolean {
    if (!path) {
        return false;
    }
    return /^[A-Za-z]:/.test(path) || path.startsWith("\\\\") || path.includes("\\");
}

function normalizeExplorerPathForCompare(path: string): string {
    const normalized = normalizeExplorerPath(path);
    return isProbablyWindowsPath(normalized) ? normalized.toLowerCase() : normalized;
}

function isSameExplorerPath(a: string, b: string): boolean {
    return normalizeExplorerPathForCompare(a) === normalizeExplorerPathForCompare(b);
}

function isExplorerPathAncestor(ancestor: string, path: string): boolean {
    const a = normalizeExplorerPathForCompare(ancestor);
    const p = normalizeExplorerPathForCompare(path);
    if (!a || !p) {
        return false;
    }
    if (a === p) {
        return true;
    }
    if (a === "~") {
        return p.startsWith("~/") || p.startsWith("~\\");
    }
    const sep = a.includes("\\") ? "\\" : "/";
    const prefix = a.endsWith(sep) ? a : a + sep;
    return p.startsWith(prefix);
}

function formatBytes(bytes?: number): string {
    if (bytes == null) {
        return "";
    }
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    const units = ["KB", "MB", "GB", "TB"];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    const digits = value >= 10 ? 0 : 1;
    return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function clampNumber(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
        return min;
    }
    return Math.min(max, Math.max(min, value));
}

function ExplorerDirectoryPreview({ model }: SpecializedViewProps) {
    const { t } = useTranslation();
    const favoritesModel = useMemo(() => FavoritesModel.getInstance(model.tabModel.tabId), [model.tabModel.tabId]);
    const [drives, setDrives] = useState<ExplorerItem[]>([]);
    const [drivesLoading, setDrivesLoading] = useState(false);
    const currentFileInfo = useAtomValue(model.statFile);
    const currentPath = currentFileInfo?.path ?? "";
    const connection = useAtomValue(model.connectionImmediate);
    const explorerStateScope = useMemo(() => (connection && connection.trim() ? connection.trim() : "local"), [connection]);
    const isMagnified = useAtomValue(model.nodeModel.isMagnified);
    const [showHiddenFiles, setShowHiddenFiles] = useAtom(model.showHiddenFiles);
    const [searchText, setSearchText] = useState("");
    const [selectedPath, setSelectedPath] = useState("");
    const [addressMode, setAddressMode] = useState<"crumbs" | "edit">("crumbs");
    const [addressText, setAddressText] = useState("");
    const addressInputRef = useRef<HTMLInputElement>(null);
    const [showCopiedToast, setShowCopiedToast] = useState(false);
    const copiedToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const treeNodesRef = useRef<Record<string, TreeNodeState>>({});
    const treeRequestSeqRef = useRef<Record<string, number>>({});
    const loadedSidebarSectionsKeyRef = useRef<string | null>(null);
    const loadedTreeExpandedKeyRef = useRef<string | null>(null);
    const showDetailsKey = "waveterm-explorer-show-details";
    const [showDetails, setShowDetails] = useState(() => {
        try {
            return localStorage.getItem(showDetailsKey) === "1";
        } catch {
            return false;
        }
    });
    const [detailsInfo, setDetailsInfo] = useState<FileInfo | null>(null);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [detailsError, setDetailsError] = useState<string | null>(null);
    const sidebarHiddenKey = "waveterm-explorer-sidebar-hidden";
    const [sidebarHidden, setSidebarHidden] = useState(() => {
        try {
            return localStorage.getItem(sidebarHiddenKey) === "1";
        } catch {
            return false;
        }
    });
    const sidebarWidthKey = "waveterm-explorer-sidebar-width";
    const [sidebarWidth, setSidebarWidth] = useState(() => {
        try {
            const raw = localStorage.getItem(sidebarWidthKey);
            const parsed = raw ? Number(raw) : NaN;
            if (!Number.isFinite(parsed)) {
                return 200;
            }
            return clampNumber(parsed, 48, 520);
        } catch {
            return 200;
        }
    });
    const searchWidthKey = "waveterm-explorer-search-width";
    const [searchWidth, setSearchWidth] = useState(() => {
        try {
            const raw = localStorage.getItem(searchWidthKey);
            const parsed = raw ? Number(raw) : NaN;
            if (!Number.isFinite(parsed)) {
                return 224;
            }
            return clampNumber(parsed, 120, 520);
        } catch {
            return 224;
        }
    });
    const sidebarSectionsKey = `waveterm-explorer-sidebar-sections:${explorerStateScope}`;
    const [collapsedSections, setCollapsedSections] = useState<Record<"quickAccess" | "thisPC", boolean>>(() => {
        try {
            const raw = localStorage.getItem(sidebarSectionsKey);
            if (!raw) {
                return { quickAccess: false, thisPC: false };
            }
            const parsed = JSON.parse(raw) as Record<string, boolean>;
            return {
                quickAccess: !!parsed.quickAccess,
                thisPC: !!parsed.thisPC,
            };
        } catch {
            return { quickAccess: false, thisPC: false };
        }
    });
    const treeExpandedKey = `waveterm-explorer-tree-expanded:${explorerStateScope}`;
    const [expandedTreePaths, setExpandedTreePaths] = useState<Set<string>>(() => {
        try {
            const raw = localStorage.getItem(treeExpandedKey);
            if (!raw) {
                return new Set();
            }
            const parsed = JSON.parse(raw) as string[];
            if (!Array.isArray(parsed)) {
                return new Set();
            }
            return new Set(parsed.map((path) => normalizeExplorerPath(path)).filter(Boolean));
        } catch {
            return new Set();
        }
    });
    const [treeNodes, setTreeNodes] = useState<Record<string, TreeNodeState>>({});
    const normalizedCurrentPath = useMemo(() => normalizeExplorerPath(currentPath), [currentPath]);

    const flashCopiedToast = useCallback(() => {
        setShowCopiedToast(true);
        if (copiedToastTimeoutRef.current) {
            clearTimeout(copiedToastTimeoutRef.current);
        }
        copiedToastTimeoutRef.current = setTimeout(() => {
            setShowCopiedToast(false);
            copiedToastTimeoutRef.current = null;
        }, 2000);
    }, []);

    useEffect(() => {
        return () => {
            if (copiedToastTimeoutRef.current) {
                clearTimeout(copiedToastTimeoutRef.current);
                copiedToastTimeoutRef.current = null;
            }
        };
    }, []);

    const quickAccessItems: ExplorerItem[] = useMemo(
        () => {
            const items: ExplorerItem[] = [
                { icon: "house", label: t("preview.bookmarks.home"), path: "~" },
                { icon: "desktop", label: t("preview.bookmarks.desktop"), path: "~/Desktop" },
                { icon: "download", label: t("preview.bookmarks.downloads"), path: "~/Downloads" },
                { icon: "file-lines", label: t("preview.bookmarks.documents"), path: "~/Documents" },
            ];
            if (PLATFORM !== PlatformWindows) {
                items.push({ icon: "hard-drive", label: t("preview.bookmarks.root"), path: "/" });
            }
            return items;
        },
        [t]
    );

    const breadcrumbSegments = useMemo(() => getBreadcrumbSegments(currentPath), [currentPath]);

    useEffect(() => {
        treeNodesRef.current = treeNodes;
    }, [treeNodes]);

    useLayoutEffect(() => {
        try {
            const raw = localStorage.getItem(sidebarSectionsKey);
            if (raw) {
                const parsed = JSON.parse(raw) as Record<string, boolean>;
                setCollapsedSections({
                    quickAccess: !!parsed?.quickAccess,
                    thisPC: !!parsed?.thisPC,
                });
            } else {
                setCollapsedSections({ quickAccess: false, thisPC: false });
            }
            loadedSidebarSectionsKeyRef.current = sidebarSectionsKey;
        } catch {
            setCollapsedSections({ quickAccess: false, thisPC: false });
            loadedSidebarSectionsKeyRef.current = sidebarSectionsKey;
        }
    }, [sidebarSectionsKey]);

    useLayoutEffect(() => {
        try {
            const raw = localStorage.getItem(treeExpandedKey);
            if (raw) {
                const parsed = JSON.parse(raw) as string[];
                if (Array.isArray(parsed)) {
                    setExpandedTreePaths(new Set(parsed.map((path) => normalizeExplorerPath(path)).filter(Boolean)));
                } else {
                    setExpandedTreePaths(new Set());
                }
            } else {
                setExpandedTreePaths(new Set());
            }
            loadedTreeExpandedKeyRef.current = treeExpandedKey;
        } catch {
            setExpandedTreePaths(new Set());
            loadedTreeExpandedKeyRef.current = treeExpandedKey;
        }
    }, [treeExpandedKey]);

    useEffect(() => {
        try {
            localStorage.setItem(sidebarWidthKey, String(sidebarWidth));
        } catch {
            // ignore
        }
    }, [sidebarWidth]);

    useEffect(() => {
        try {
            localStorage.setItem(sidebarHiddenKey, sidebarHidden ? "1" : "0");
        } catch {
            // ignore
        }
    }, [sidebarHidden]);

    useEffect(() => {
        try {
            localStorage.setItem(searchWidthKey, String(searchWidth));
        } catch {
            // ignore
        }
    }, [searchWidth]);

    useEffect(() => {
        try {
            localStorage.setItem(showDetailsKey, showDetails ? "1" : "0");
        } catch {
            // ignore
        }
    }, [showDetails]);

    useEffect(() => {
        try {
            if (loadedSidebarSectionsKeyRef.current !== sidebarSectionsKey) {
                return;
            }
            localStorage.setItem(sidebarSectionsKey, JSON.stringify(collapsedSections));
        } catch {
            // ignore
        }
    }, [collapsedSections, sidebarSectionsKey]);

    useEffect(() => {
        try {
            if (loadedTreeExpandedKeyRef.current !== treeExpandedKey) {
                return;
            }
            localStorage.setItem(treeExpandedKey, JSON.stringify(Array.from(expandedTreePaths.values())));
        } catch {
            // ignore
        }
    }, [expandedTreePaths, treeExpandedKey]);

    useEffect(() => {
        if (PLATFORM !== PlatformWindows) {
            setDrives([]);
            return;
        }
        let cancelled = false;
        setDrivesLoading(true);
        fireAndForget(async () => {
            const found: ExplorerItem[] = [];
            const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
            for (const letter of letters) {
                const drivePath = `${letter}:\\`;
                try {
                    const remotePath = await model.formatRemoteUri(drivePath, globalStore.get);
                    const finfo = await RpcApi.FileInfoCommand(
                        TabRpcClient,
                        { info: { path: remotePath } },
                        { timeout: 500 }
                    );
                    if (finfo?.isdir) {
                        found.push({ icon: "hard-drive", label: `${letter}:`, path: drivePath });
                    }
                } catch {
                    // ignore missing drives
                }
            }
            if (cancelled) {
                return;
            }
            setDrives(found);
            setDrivesLoading(false);
        });
        return () => {
            cancelled = true;
        };
    }, [model]);

    useEffect(() => {
        setTreeNodes({});
        treeRequestSeqRef.current = {};
    }, [connection]);

    useEffect(() => {
        setTreeNodes({});
        treeRequestSeqRef.current = {};
    }, [showHiddenFiles]);

    useEffect(() => {
        if (addressMode !== "edit") {
            setAddressText(currentPath);
        }
    }, [addressMode, currentPath]);

    useEffect(() => {
        setSearchText("");
    }, [currentPath]);

    useEffect(() => {
        if (addressMode !== "edit") {
            return;
        }
        const raf = requestAnimationFrame(() => {
            addressInputRef.current?.focus();
            addressInputRef.current?.select();
        });
        return () => cancelAnimationFrame(raf);
    }, [addressMode]);

    const navigate = useCallback(
        (path: string) => {
            const normalized = normalizeExplorerPath(path);
            if (isBlank(normalized)) {
                return;
            }
            setAddressMode("crumbs");
            fireAndForget(() => model.goHistory(normalized));
        },
        [model]
    );

    const addToFavorites = useCallback(
        (path: string) => {
            const normalized = normalizeExplorerPath(path);
            if (isBlank(normalized)) {
                return;
            }
            favoritesModel.addFavorite(normalized);
            window.dispatchEvent(new Event("favorites-updated"));
        },
        [favoritesModel]
    );

    const openTerminalAtPath = useCallback(
        (path: string) => {
            const normalized = normalizeExplorerPath(path);
            if (isBlank(normalized)) {
                return;
            }
            const meta: Record<string, any> = {
                controller: "shell",
                view: "term",
                "cmd:cwd": normalized,
            };
            if (!isBlank(connection)) {
                meta.connection = connection;
            }
            fireAndForget(() => createBlock({ meta }));
        },
        [connection]
    );

    const copyToClipboard = useCallback(
        (text: string) => {
            if (isBlank(text)) {
                return;
            }
            fireAndForget(async () => {
                try {
                    await navigator.clipboard.writeText(text);
                    flashCopiedToast();
                } catch (e) {
                    console.error("Failed to copy to clipboard:", e);
                }
            });
        },
        [flashCopiedToast]
    );

    const handleAddressContextMenu = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const menu: ContextMenuItem[] = [
                {
                    label: t("preview.copyFullPath"),
                    click: () => copyToClipboard(currentPath),
                },
                {
                    label: t("favorites.add"),
                    click: () => addToFavorites(currentPath),
                },
                {
                    label: t("preview.openTerminalHere"),
                    click: () => openTerminalAtPath(currentPath),
                },
            ];
            ContextMenuModel.showContextMenu(menu, e);
        },
        [addToFavorites, copyToClipboard, currentPath, openTerminalAtPath, t]
    );

    const showBlockMenu = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const menu: ContextMenuItem[] = [
                {
                    label: isMagnified ? t("block.unMagnifyBlock") : t("block.magnifyBlock"),
                    click: () => model.nodeModel.toggleMagnify(),
                },
                {
                    type: "separator",
                },
                {
                    label: t("block.copyBlockId"),
                    click: () => copyToClipboard(model.blockId),
                },
                {
                    type: "separator",
                },
                {
                    label: t("block.closeBlock"),
                    click: () => uxCloseBlock(model.blockId),
                },
            ];
            ContextMenuModel.showContextMenu(menu, e);
        },
        [copyToClipboard, isMagnified, model.blockId, model.nodeModel, t]
    );

    const toggleHiddenFiles = useCallback(() => {
        const nextValue = !showHiddenFiles;
        setShowHiddenFiles(nextValue);
        fireAndForget(() => RpcApi.SetConfigCommand(TabRpcClient, { "preview:showhiddenfiles": nextValue }));
    }, [setShowHiddenFiles, showHiddenFiles]);

    const goBack = useCallback(() => fireAndForget(() => model.goHistoryBack()), [model]);
    const goForward = useCallback(() => fireAndForget(() => model.goHistoryForward()), [model]);
    const goUp = useCallback(() => fireAndForget(() => model.goParentDirectory({})), [model]);
    const refresh = useCallback(() => model.refreshCallback?.(), [model]);
    const copyCurrentPath = useCallback(() => copyToClipboard(currentPath), [copyToClipboard, currentPath]);

    const loadTreeChildren = useCallback(
        (path: string, opts?: { force?: boolean }) => {
            const normalized = normalizeExplorerPath(path);
            if (isBlank(normalized)) {
                return;
            }
            const existing = treeNodesRef.current[normalized];
            if (!opts?.force && (existing?.loading || existing?.children != null)) {
                return;
            }

            const nextSeq = (treeRequestSeqRef.current[normalized] ?? 0) + 1;
            treeRequestSeqRef.current[normalized] = nextSeq;

            setTreeNodes((prev) => ({
                ...prev,
                [normalized]: {
                    ...prev[normalized],
                    loading: true,
                    error: undefined,
                },
            }));

            fireAndForget(async () => {
                try {
                    const remotePath = await model.formatRemoteUri(normalized, globalStore.get);
                    const entries = await RpcApi.FileListCommand(
                        TabRpcClient,
                        {
                            path: remotePath,
                            opts: {
                                limit: 500,
                            },
                        },
                        { timeout: 2000 }
                    );
                    if (treeRequestSeqRef.current[normalized] !== nextSeq) {
                        return;
                    }
                    const children: ExplorerItem[] = (entries ?? [])
                        .filter((entry) => !!entry?.isdir)
                        .filter((entry) => entry.name !== "." && entry.name !== "..")
                        .filter((entry) => (showHiddenFiles ? true : !(entry?.name ?? "").startsWith(".")))
                        .map((entry) => ({
                            icon: "folder",
                            label: entry.name ?? getLeafLabel(entry.path),
                            path: entry.path,
                        }))
                        .sort((a, b) =>
                            a.label.localeCompare(b.label, undefined, {
                                numeric: true,
                                sensitivity: "base",
                            })
                        );
                    setTreeNodes((prev) => ({
                        ...prev,
                        [normalized]: {
                            children,
                            loading: false,
                            error: undefined,
                        },
                    }));
                } catch (e) {
                    if (treeRequestSeqRef.current[normalized] !== nextSeq) {
                        return;
                    }
                    setTreeNodes((prev) => ({
                        ...prev,
                        [normalized]: {
                            children: [],
                            loading: false,
                            error: `${e}`,
                        },
                    }));
                }
            });
        },
        [model, showHiddenFiles]
    );

    useEffect(() => {
        if (isBlank(normalizedCurrentPath)) {
            return;
        }
        const segments = getBreadcrumbSegments(normalizedCurrentPath);
        if (segments.length <= 1) {
            return;
        }
        const toExpand = segments
            .slice(0, -1)
            .map((seg) => normalizeExplorerPath(seg.path))
            .filter(Boolean);
        if (toExpand.length === 0) {
            return;
        }
        setExpandedTreePaths((prev) => {
            let changed = false;
            const next = new Set(prev);
            for (const p of toExpand) {
                if (!next.has(p)) {
                    next.add(p);
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
        for (const p of toExpand) {
            loadTreeChildren(p);
        }
    }, [loadTreeChildren, normalizedCurrentPath]);

    useEffect(() => {
        const expandedPaths = Array.from(expandedTreePaths.values());
        for (const path of expandedPaths) {
            const normalized = normalizeExplorerPath(path);
            if (isBlank(normalized)) {
                continue;
            }
            const nodeState = treeNodesRef.current[normalized];
            if (nodeState?.children == null && !nodeState?.loading && !nodeState?.error) {
                loadTreeChildren(normalized);
            }
        }
    }, [expandedTreePaths, loadTreeChildren]);

    const toggleTreeExpand = useCallback(
        (path: string) => {
            const normalized = normalizeExplorerPath(path);
            if (isBlank(normalized)) {
                return;
            }
            const wasExpanded = expandedTreePaths.has(normalized);
            setExpandedTreePaths((prev) => {
                const next = new Set(prev);
                if (next.has(normalized)) {
                    next.delete(normalized);
                } else {
                    next.add(normalized);
                }
                return next;
            });
            if (!wasExpanded) {
                loadTreeChildren(normalized);
            }
        },
        [expandedTreePaths, loadTreeChildren]
    );

    const showTreeItemContextMenu = useCallback(
        (e: React.MouseEvent, path: string, favoriteId?: string) => {
            e.preventDefault();
            e.stopPropagation();
            const normalized = normalizeExplorerPath(path);
            if (isBlank(normalized)) {
                return;
            }
            const menu: ContextMenuItem[] = [
                {
                    label: t("preview.copyFullPath"),
                    click: () => copyToClipboard(normalized),
                },
                {
                    label: t("favorites.add"),
                    click: () => addToFavorites(normalized),
                },
                {
                    label: t("preview.openTerminalHere"),
                    click: () => openTerminalAtPath(normalized),
                },
            ];
            if (favoriteId) {
                menu.push(
                    { type: "separator" },
                    {
                        label: t("favorites.remove"),
                        click: () => {
                            favoritesModel.removeFavorite(favoriteId);
                            window.dispatchEvent(new Event("favorites-updated"));
                        },
                    }
                );
            }
            ContextMenuModel.showContextMenu(menu, e);
        },
        [addToFavorites, copyToClipboard, favoritesModel, openTerminalAtPath, t]
    );

    const detailsPath = selectedPath || currentPath;
    useEffect(() => {
        if (!showDetails) {
            return;
        }
        if (isBlank(detailsPath)) {
            setDetailsInfo(null);
            setDetailsError(null);
            setDetailsLoading(false);
            return;
        }
        if (detailsPath === currentPath && currentFileInfo) {
            setDetailsInfo(currentFileInfo);
            setDetailsError(null);
            setDetailsLoading(false);
            return;
        }

        let cancelled = false;
        const timeout = setTimeout(() => {
            fireAndForget(async () => {
                setDetailsLoading(true);
                setDetailsError(null);
                try {
                    const remotePath = await model.formatRemoteUri(detailsPath, globalStore.get);
                    const finfo = await RpcApi.FileInfoCommand(TabRpcClient, { info: { path: remotePath } });
                    if (cancelled) {
                        return;
                    }
                    setDetailsInfo(finfo);
                } catch (e) {
                    if (cancelled) {
                        return;
                    }
                    setDetailsInfo(null);
                    setDetailsError(`${e}`);
                } finally {
                    if (!cancelled) {
                        setDetailsLoading(false);
                    }
                }
            });
        }, 120);

        return () => {
            cancelled = true;
            clearTimeout(timeout);
        };
    }, [currentFileInfo, currentPath, detailsPath, model, showDetails]);

    const startSidebarResize = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            e.preventDefault();
            e.stopPropagation();
            const startX = e.clientX;
            const startWidth = sidebarWidth;

            const onMove = (event: PointerEvent) => {
                const delta = event.clientX - startX;
                setSidebarWidth(clampNumber(startWidth + delta, 48, 520));
            };
            const onUp = () => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
                document.body.style.removeProperty("cursor");
                document.body.style.removeProperty("user-select");
            };
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
        },
        [sidebarWidth]
    );

    const startSearchResize = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            e.preventDefault();
            e.stopPropagation();
            const startX = e.clientX;
            const startWidth = searchWidth;

            const onMove = (event: PointerEvent) => {
                const delta = startX - event.clientX;
                setSearchWidth(clampNumber(startWidth + delta, 120, 520));
            };
            const onUp = () => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
                document.body.style.removeProperty("cursor");
                document.body.style.removeProperty("user-select");
            };
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
        },
        [searchWidth]
    );

    const renderNavTreeItems = (items: ExplorerNavItem[], depth: number): ReactNode => {
        return items.map((item) => {
            const keyPath = normalizeExplorerPath(item.path);
            const nodeState = treeNodes[keyPath];
            const isExpanded = expandedTreePaths.has(keyPath);
            const isActive = isSameExplorerPath(keyPath, normalizedCurrentPath);
            const isInPath = isExplorerPathAncestor(keyPath, normalizedCurrentPath);
            const isLoading = nodeState?.loading || (isExpanded && nodeState?.children == null && !nodeState?.error);
            const childItems = nodeState?.children ?? [];
            const indent = 8 + depth * 12;
            const iconClassName =
                item.icon === "star"
                    ? "fas fa-star text-yellow-500 w-4 text-center"
                    : clsx("fas", `fa-${item.icon}`, "text-zinc-400 w-4 text-center");

            return (
                <div key={item.favoriteId ? `fav:${item.favoriteId}` : keyPath}>
                    <div
                        className={clsx(
                            "flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer select-none",
                            isActive
                                ? "bg-hover text-primary"
                                : isInPath
                                  ? "text-primary/80 hover:bg-hover hover:text-primary"
                                  : "text-secondary hover:bg-hover hover:text-primary"
                        )}
                        onClick={() => navigate(item.path)}
                        onContextMenu={(e) => showTreeItemContextMenu(e, item.path, item.favoriteId)}
                        title={item.path}
                        style={{ paddingLeft: indent }}
                    >
                        <button
                            className={clsx(
                                "w-4 h-4 flex items-center justify-center rounded hover:bg-hoverbg text-zinc-500 hover:text-primary",
                                nodeState?.children && nodeState.children.length === 0 && !nodeState.loading && !nodeState.error && "opacity-30"
                            )}
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleTreeExpand(item.path);
                            }}
                            type="button"
                        >
                            {isLoading ? (
                                <i className="fas fa-spinner fa-spin text-[10px]" />
                            ) : (
                                <i className={clsx("fas text-[10px]", isExpanded ? "fa-chevron-down" : "fa-chevron-right")} />
                            )}
                        </button>
                        <i className={iconClassName} />
                        <span className="truncate">{item.label}</span>
                    </div>

                    {isExpanded && (
                        <div>
                            {nodeState?.error ? (
                                <div
                                    className="px-2 py-1 text-xs text-red-400 truncate"
                                    style={{ paddingLeft: indent + 12 }}
                                    title={nodeState.error}
                                >
                                    {nodeState.error}
                                </div>
                            ) : isLoading ? (
                                <div className="px-2 py-1 text-xs text-secondary" style={{ paddingLeft: indent + 12 }}>
                                    {t("common.loading")}
                                </div>
                            ) : childItems.length > 0 ? (
                                <div>{renderNavTreeItems(childItems as ExplorerNavItem[], depth + 1)}</div>
                            ) : (
                                <div className="px-2 py-1 text-xs text-secondary" style={{ paddingLeft: indent + 12 }}>
                                    -
                                </div>
                            )}
                        </div>
                    )}
                </div>
            );
        });
    };

    return (
        <div className="flex flex-row h-full overflow-hidden">
            {!sidebarHidden && (
                <>
                    <div
                        className="shrink-0 bg-zinc-950 border-r border-zinc-800 overflow-y-auto"
                        style={{ width: sidebarWidth }}
                    >
                        <button
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-secondary uppercase tracking-wider hover:bg-hoverbg"
                            onClick={() => setCollapsedSections((prev) => ({ ...prev, quickAccess: !prev.quickAccess }))}
                            type="button"
                        >
                            <i
                                className={clsx(
                                    "fas",
                                    collapsedSections.quickAccess ? "fa-chevron-right" : "fa-chevron-down",
                                    "text-[10px] text-zinc-400 w-3 text-center"
                                )}
                            />
                            <span className="truncate">{t("explorer.quickAccess")}</span>
                        </button>
                        {!collapsedSections.quickAccess && (
                            <div className="px-1">{renderNavTreeItems(quickAccessItems as ExplorerNavItem[], 0)}</div>
                        )}

                        {PLATFORM === PlatformWindows && (
                            <>
                                <button
                                    className="w-full flex items-center gap-2 px-3 pt-4 pb-2 text-xs font-semibold text-secondary uppercase tracking-wider hover:bg-hoverbg"
                                    onClick={() => setCollapsedSections((prev) => ({ ...prev, thisPC: !prev.thisPC }))}
                                    type="button"
                                >
                                    <i
                                        className={clsx(
                                            "fas",
                                            collapsedSections.thisPC ? "fa-chevron-right" : "fa-chevron-down",
                                            "text-[10px] text-zinc-400 w-3 text-center"
                                        )}
                                    />
                                    <span className="truncate">{t("explorer.thisPC")}</span>
                                </button>
                                {!collapsedSections.thisPC && (
                                    <div className="px-1 pb-3">
                                        {drivesLoading ? (
                                            <div className="px-2 py-1.5 text-sm text-secondary">{t("common.loading")}</div>
                                        ) : drives.length === 0 ? (
                                            <div className="px-2 py-1.5 text-sm text-secondary">-</div>
                                        ) : (
                                            renderNavTreeItems(drives as ExplorerNavItem[], 0)
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    <div
                        className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-zinc-700/40 active:bg-zinc-700/60"
                        onPointerDown={startSidebarResize}
                    />
                </>
            )}

            <div className="relative flex flex-col flex-1 overflow-hidden">
                {showCopiedToast && (
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
                        <div className="px-2 py-1 rounded bg-zinc-800/95 border border-zinc-700 text-xs text-primary shadow">
                            {t("common.copied")}
                        </div>
                    </div>
                )}
                <div className="flex items-center gap-2 px-2 py-1.5 bg-zinc-950 border-b border-zinc-800">
                    <div className="flex items-center gap-1 shrink-0">
                        <button
                            className={clsx(
                                "w-7 h-7 flex items-center justify-center rounded hover:bg-hoverbg text-secondary hover:text-primary",
                                sidebarHidden && "bg-hoverbg text-primary"
                            )}
                            onClick={() => setSidebarHidden((prev) => !prev)}
                            title={t("explorer.toggleSidebar")}
                            type="button"
                        >
                            <i className={clsx("fas", sidebarHidden ? "fa-angles-right" : "fa-angles-left", "text-sm")} />
                        </button>
                        <button
                            className="w-7 h-7 flex items-center justify-center rounded hover:bg-hoverbg text-secondary hover:text-primary"
                            onClick={goBack}
                            title={t("explorer.back")}
                            type="button"
                        >
                            <i className="fas fa-arrow-left text-sm" />
                        </button>
                        <button
                            className="w-7 h-7 flex items-center justify-center rounded hover:bg-hoverbg text-secondary hover:text-primary"
                            onClick={goForward}
                            title={t("explorer.forward")}
                            type="button"
                        >
                            <i className="fas fa-arrow-right text-sm" />
                        </button>
                        <button
                            className="w-7 h-7 flex items-center justify-center rounded hover:bg-hoverbg text-secondary hover:text-primary"
                            onClick={goUp}
                            title={t("explorer.up")}
                            type="button"
                        >
                            <i className="fas fa-arrow-up text-sm" />
                        </button>
                        <button
                            className="w-7 h-7 flex items-center justify-center rounded hover:bg-hoverbg text-secondary hover:text-primary"
                            onClick={refresh}
                            title={t("preview.refresh")}
                            type="button"
                        >
                            <i className="fas fa-arrows-rotate text-sm" />
                        </button>
                        <button
                            className="w-7 h-7 flex items-center justify-center rounded hover:bg-hoverbg text-secondary hover:text-primary"
                            onClick={copyCurrentPath}
                            title={t("preview.copyFullPath")}
                            type="button"
                        >
                            <i className="fas fa-copy text-sm" />
                        </button>
                        <button
                            className="w-7 h-7 flex items-center justify-center rounded hover:bg-hoverbg text-secondary hover:text-primary"
                            onClick={() => addToFavorites(currentPath)}
                            title={t("favorites.add")}
                            type="button"
                        >
                            <i className="fas fa-star text-sm text-yellow-500" />
                        </button>
                    </div>

                    <div className="flex-1 min-w-0" onContextMenu={handleAddressContextMenu}>
                        {addressMode === "edit" ? (
                            <input
                                ref={addressInputRef}
                                value={addressText}
                                onChange={(e) => setAddressText(e.target.value)}
                                onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === "Enter") {
                                        navigate(addressText);
                                    } else if (e.key === "Escape") {
                                        setAddressMode("crumbs");
                                        setAddressText(currentPath);
                                    }
                                }}
                                onBlur={() => {
                                    setAddressMode("crumbs");
                                    setAddressText(currentPath);
                                }}
                                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm text-primary outline-none"
                                placeholder={t("explorer.address")}
                            />
                        ) : (
                            <div
                                className={clsx(
                                    "w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm",
                                    "text-secondary cursor-text overflow-hidden whitespace-nowrap"
                                )}
                                onClick={() => {
                                    copyCurrentPath();
                                    setAddressText(currentPath);
                                    setAddressMode("edit");
                                }}
                                onDoubleClick={copyCurrentPath}
                                title={currentPath}
                            >
                                {breadcrumbSegments.length === 0 ? (
                                    <span className="text-zinc-400">~</span>
                                ) : (
                                    breadcrumbSegments.map((seg, idx) => (
                                        <Fragment key={seg.path}>
                                            <span
                                                className="hover:text-primary"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    navigate(seg.path);
                                                }}
                                            >
                                                {seg.label}
                                            </span>
                                            {idx < breadcrumbSegments.length - 1 && (
                                                <i className="fas fa-chevron-right text-[10px] text-zinc-500 mx-1" />
                                            )}
                                        </Fragment>
                                    ))
                                )}
                            </div>
                        )}
                    </div>

                    <div
                        className="w-1 shrink-0 cursor-col-resize bg-transparent hover:bg-zinc-700/40 active:bg-zinc-700/60"
                        onPointerDown={startSearchResize}
                    />

                    <div className="shrink-0" style={{ width: searchWidth }}>
                        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-700 rounded px-2 py-1">
                            <i className="fas fa-search text-zinc-400 text-xs" />
                            <input
                                value={searchText}
                                onChange={(e) => setSearchText(e.target.value.toLowerCase())}
                                onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === "Escape") {
                                        setSearchText("");
                                    }
                                }}
                                className="flex-1 min-w-0 bg-transparent outline-none text-sm text-primary"
                                placeholder={t("explorer.search")}
                            />
                            {!isBlank(searchText) && (
                                <button
                                    className="text-zinc-400 hover:text-primary"
                                    onClick={() => setSearchText("")}
                                    title={t("common.cancel")}
                                    type="button"
                                >
                                    <i className="fas fa-xmark text-xs" />
                                </button>
                            )}
                        </div>
                    </div>

                    <button
                        className={clsx(
                            "w-7 h-7 shrink-0 flex items-center justify-center rounded hover:bg-hoverbg text-secondary hover:text-primary",
                            showDetails && "bg-hoverbg text-primary"
                        )}
                        onClick={() => setShowDetails((prev) => !prev)}
                        title={t("explorer.details")}
                        type="button"
                    >
                        <i className="fas fa-circle-info text-sm" />
                    </button>

                    <button
                        className="w-7 h-7 shrink-0 flex items-center justify-center rounded hover:bg-hoverbg text-secondary hover:text-primary"
                        onClick={toggleHiddenFiles}
                        title={t("explorer.toggleHidden")}
                        type="button"
                    >
                        <i className={clsx("fas", showHiddenFiles ? "fa-eye" : "fa-eye-slash", "text-sm")} />
                    </button>

                    <button
                        className="w-7 h-7 shrink-0 flex items-center justify-center rounded hover:bg-hoverbg text-secondary hover:text-primary"
                        onClick={showBlockMenu}
                        title={t("common.moreOptions")}
                        type="button"
                    >
                        <i className="fa fa-ellipsis-vertical text-sm" />
                    </button>
                </div>

                <div className="flex flex-row flex-1 overflow-hidden">
                    <div className="flex-1 overflow-hidden">
                        <DirectoryPreview
                            model={model}
                            searchText={searchText}
                            setSearchText={setSearchText}
                            onSelectedPathChange={setSelectedPath}
                        />
                    </div>

                    {showDetails && (
                        <div className="w-72 shrink-0 bg-zinc-950 border-l border-zinc-800 overflow-y-auto p-3">
                            <div className="flex items-center justify-between mb-3">
                                <div className="text-xs font-semibold text-secondary uppercase tracking-wider">
                                    {t("explorer.details")}
                                </div>
                                <div className="flex items-center gap-1">
                                    <button
                                        className="w-7 h-7 flex items-center justify-center rounded hover:bg-hoverbg text-secondary hover:text-primary"
                                        onClick={() => copyToClipboard(detailsPath)}
                                        title={t("preview.copyFullPath")}
                                        type="button"
                                    >
                                        <i className="fas fa-copy text-sm" />
                                    </button>
                                    <button
                                        className="w-7 h-7 flex items-center justify-center rounded hover:bg-hoverbg text-secondary hover:text-primary"
                                        onClick={() => addToFavorites(detailsPath)}
                                        title={t("favorites.add")}
                                        type="button"
                                    >
                                        <i className="fas fa-star text-sm text-yellow-500" />
                                    </button>
                                </div>
                            </div>

                            {detailsLoading ? (
                                <div className="text-sm text-secondary">{t("common.loading")}</div>
                            ) : detailsError ? (
                                <div className="text-sm text-red-400 break-words">{detailsError}</div>
                            ) : detailsInfo ? (
                                <div className="flex flex-col gap-2 text-sm">
                                    <div className="text-primary font-medium break-words">
                                        {getLeafLabel(detailsInfo.path) || detailsInfo.path}
                                    </div>
                                    <div className="text-xs text-secondary break-words">{detailsInfo.path}</div>

                                    <div className="pt-2 border-t border-zinc-800 flex flex-col gap-1 text-xs text-secondary">
                                        <div className="flex justify-between gap-2">
                                            <span>{t("explorer.type")}</span>
                                            <span className="text-primary">
                                                {detailsInfo.isdir ? "directory" : detailsInfo.mimetype || "file"}
                                            </span>
                                        </div>
                                        <div className="flex justify-between gap-2">
                                            <span>{t("explorer.size")}</span>
                                            <span className="text-primary">{formatBytes(detailsInfo.size) || "-"}</span>
                                        </div>
                                        <div className="flex justify-between gap-2">
                                            <span>{t("explorer.modified")}</span>
                                            <span className="text-primary">
                                                {detailsInfo.modtime
                                                    ? new Date(detailsInfo.modtime).toLocaleString()
                                                    : "-"}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-sm text-secondary">-</div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

ExplorerDirectoryPreview.displayName = "ExplorerDirectoryPreview";

export { ExplorerDirectoryPreview };

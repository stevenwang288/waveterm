// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import {
    atoms,
    createBlock,
    getApi,
    getFocusedBlockId,
    globalStore,
    WOS,
} from "@/app/store/global";
import { FavoritesModel } from "@/app/store/favorites-model";
import { uxCloseBlock } from "@/app/store/keymodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { openCliLayoutInNewTab } from "@/util/clilayout";
import { PLATFORM, PlatformWindows } from "@/util/platformutil";
import { base64ToString, fireAndForget, isBlank, stringToBase64 } from "@/util/util";
import clsx from "clsx";
import { useAtom, useAtomValue } from "jotai";
import { Fragment, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SpecializedViewProps } from "./preview";
import { DirectoryPreview, type DirectoryViewMode } from "./preview-directory";

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

const AI_LAUNCH_COMMANDS: Array<{ label: string; command: string }> = [
    { label: "Codex", command: "codex" },
    { label: "Claude", command: "claude" },
    { label: "Gemini", command: "gemini" },
    { label: "Amp", command: "amp" },
    { label: "IFlow", command: "iflow" },
    { label: "OpenCode", command: "opencode" },
];

type CliLayoutPreset = {
    key: string;
    label: string;
    rows: number;
    cols: number;
};

type CliLayoutPresetState = {
    rows: number;
    cols: number;
    paths: string[];
    commands?: string[];
    connection?: string;
    updatedTs: number;
};

type CliLayoutConfigFile = {
    version: number;
    lastPresetKey?: string;
    presets: Record<string, CliLayoutPresetState>;
    savedLayouts?: Record<string, CliLayoutPresetState>;
};

const CLI_LAYOUT_PRESETS: CliLayoutPreset[] = [
    { key: "2", label: "布局：2 窗口（左右）", rows: 1, cols: 2 },
    { key: "3", label: "布局：3 窗口（左中右）", rows: 1, cols: 3 },
    { key: "4", label: "布局：4 窗口（田字）", rows: 2, cols: 2 },
    { key: "6", label: "布局：6 窗口（2×3）", rows: 2, cols: 3 },
    { key: "6-2col", label: "布局：6 窗口（3×2）", rows: 3, cols: 2 },
    { key: "8", label: "布局：8 窗口（2×4）", rows: 2, cols: 4 },
    { key: "8-2col", label: "布局：8 窗口（4×2）", rows: 4, cols: 2 },
    { key: "9", label: "布局：9 窗口（3×3）", rows: 3, cols: 3 },
];

const CLI_LAYOUT_SAVE_SLOTS: Array<{ key: string; label: string }> = [
    { key: "layout1", label: "布局方案 1" },
    { key: "layout2", label: "布局方案 2" },
    { key: "layout3", label: "布局方案 3" },
];

const CLI_LAYOUT_APPLY_EVENT = "waveterm:apply-cli-layout-preset";

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

function getExplorerParentPath(path: string): string {
    const normalized = normalizeExplorerPath(path);
    if (!normalized) {
        return "";
    }
    const segments = getBreadcrumbSegments(normalized);
    if (segments.length <= 1) {
        return normalized;
    }
    return normalizeExplorerPath(segments[segments.length - 2]?.path ?? normalized);
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
    const favoritesModel = useMemo(() => FavoritesModel.getInstance(), []);
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
    const [selectedPathIsDir, setSelectedPathIsDir] = useState<boolean | null>(null);
    const [addressMode, setAddressMode] = useState<"crumbs" | "edit">("crumbs");
    const [addressText, setAddressText] = useState("");
    const layoutModel = useMemo(() => getLayoutModelForStaticTab(), []);
    const focusedLayoutNode = useAtomValue(layoutModel.focusedNode);
    const addressInputRef = useRef<HTMLInputElement>(null);
    const [showCopiedToast, setShowCopiedToast] = useState(false);
    const cliLayoutConfigPath = useMemo(() => `${getApi().getConfigDir()}/cli-layout-presets.json`, []);
    const lastFocusedTermBlockIdRef = useRef<string>(null);
    const copiedToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const treeNodesRef = useRef<Record<string, TreeNodeState>>({});
    const treeRequestSeqRef = useRef<Record<string, number>>({});
    const loadedSidebarSectionsKeyRef = useRef<string | null>(null);
    const loadedTreeExpandedKeyRef = useRef<string | null>(null);
    const navItemRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const sidebarScrollRef = useRef<HTMLDivElement | null>(null);
    const autoLocateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
            return clampNumber(parsed, 120, 320);
        } catch {
            return 224;
        }
    });
    const viewModeStorageKey = "waveterm-directory-viewmode";
    const [viewMode, setViewMode] = useState<DirectoryViewMode>(() => {
        try {
            const stored = localStorage.getItem(viewModeStorageKey);
            if (
                stored === "details" ||
                stored === "list" ||
                stored === "smallIcons" ||
                stored === "mediumIcons" ||
                stored === "largeIcons"
            ) {
                return stored;
            }
        } catch {
            // ignore
        }
        return "details";
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
    const normalizedFocusPath = useMemo(() => {
        const normalizedSelectedPath = normalizeExplorerPath(selectedPath);
        if (!isBlank(normalizedSelectedPath)) {
            if (selectedPathIsDir === false) {
                const parentPath = getExplorerParentPath(normalizedSelectedPath);
                return normalizeExplorerPath(parentPath || currentPath);
            }
            return normalizedSelectedPath;
        }
        return normalizeExplorerPath(currentPath);
    }, [currentPath, selectedPath, selectedPathIsDir]);
    const isLocalExplorer = explorerStateScope === "local";

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

    const quickAccessPathMap = useMemo(() => {
        if (!isLocalExplorer) {
            return null;
        }
        const api = getApi();
        const resolvePath = (name: string, fallback: string) => {
            const path = api.getSystemPath(name);
            return isBlank(path) ? fallback : path;
        };
        return {
            home: resolvePath("home", "~"),
            desktop: resolvePath("desktop", "~/Desktop"),
        };
    }, [isLocalExplorer]);

    const quickAccessItems: ExplorerItem[] = useMemo(
        () => [
            {
                icon: "desktop",
                label: t("preview.bookmarks.desktop"),
                path: quickAccessPathMap?.desktop || "~/Desktop",
            },
        ],
        [quickAccessPathMap, t]
    );

    const breadcrumbSegments = useMemo(() => getBreadcrumbSegments(currentPath), [currentPath]);

    useEffect(() => {
        treeNodesRef.current = treeNodes;
    }, [treeNodes]);

    const setNavItemRef = useCallback((path: string, node: HTMLDivElement | null) => {
        if (node) {
            navItemRefs.current[path] = node;
            return;
        }
        delete navItemRefs.current[path];
    }, []);

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
        if (PLATFORM !== PlatformWindows || !isLocalExplorer) {
            setDrives([]);
            setDrivesLoading(false);
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
    }, [isLocalExplorer, model]);

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
            favoritesModel.addFavorite(normalized, undefined, undefined, connection);
            window.dispatchEvent(new Event("favorites-updated"));
        },
        [connection, favoritesModel]
    );

    const getBlockById = useCallback((blockId: string): Block | null => {
        if (isBlank(blockId)) {
            return null;
        }
        const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
        return globalStore.get(blockAtom);
    }, []);

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

        if (!isBlank(connection)) {
            for (const blockId of blockIds) {
                const blockData = getBlockById(blockId);
                if (blockData?.meta?.view !== "term") {
                    continue;
                }
                if (blockData?.meta?.connection === connection) {
                    return blockId;
                }
            }
        }

        for (const blockId of blockIds) {
            const blockData = getBlockById(blockId);
            if (blockData?.meta?.view === "term") {
                return blockId;
            }
        }
        return null;
    }, [connection, getBlockById]);

    const applyPathToTerminalBlock = useCallback((blockId: string, path: string) => {
        const normalizedPath = normalizeExplorerPath(path);
        if (isBlank(blockId) || isBlank(normalizedPath)) {
            return;
        }
        fireAndForget(async () => {
            await RpcApi.SetMetaCommand(TabRpcClient, {
                oref: WOS.makeORef("block", blockId),
                meta: { "cmd:cwd": normalizedPath },
            });
            await RpcApi.ControllerInputCommand(TabRpcClient, {
                blockid: blockId,
                inputdata64: stringToBase64(`cd "${normalizedPath.replace(/"/g, '\\"')}"\n`),
            });
        });
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

    const openTerminalAtPath = useCallback(
        (path: string, cliCommand?: string, preferExistingTerminal = false, allowCreateWhenNoTerminal = true) => {
            const normalized = normalizeExplorerPath(path);
            if (isBlank(normalized)) {
                return;
            }

            if (preferExistingTerminal && !isBlank(cliCommand)) {
                const targetTermBlockId = findTargetTerminalBlockId();
                if (!isBlank(targetTermBlockId)) {
                    const commandText = `${cliCommand}\n`;
                    fireAndForget(() =>
                        RpcApi.ControllerInputCommand(TabRpcClient, {
                            blockid: targetTermBlockId,
                            inputdata64: stringToBase64(commandText),
                        })
                    );
                    return;
                }
                if (!allowCreateWhenNoTerminal) {
                    return;
                }
            }

            const meta: Record<string, any> = {
                controller: "shell",
                view: "term",
                "cmd:cwd": normalized,
            };
            if (!isBlank(connection)) {
                meta.connection = connection;
            }
            if (!isBlank(cliCommand)) {
                meta["cmd:initscript"] = `${cliCommand}\n`;
            }
            fireAndForget(() => createBlock({ meta }));
        },
        [connection, findTargetTerminalBlockId]
    );

    const readCliLayoutConfig = useCallback(async (): Promise<CliLayoutConfigFile> => {
        const defaultConfig: CliLayoutConfigFile = {
            version: 1,
            presets: {},
            savedLayouts: {},
        };
        try {
            const fileData = await RpcApi.FileReadCommand(TabRpcClient, {
                info: { path: cliLayoutConfigPath },
            });
            const data64 = fileData?.data64 ?? "";
            if (isBlank(data64)) {
                return defaultConfig;
            }
            const rawText = base64ToString(data64);
            if (isBlank(rawText)) {
                return defaultConfig;
            }
            const parsed = JSON.parse(rawText);
            if (parsed == null || typeof parsed !== "object") {
                return defaultConfig;
            }

            const parsedPresets = (parsed as CliLayoutConfigFile).presets;

            const normalizedPresets: Record<string, CliLayoutPresetState> = {};
            for (const [key, value] of Object.entries(parsedPresets ?? {})) {
                if (value == null || typeof value !== "object") {
                    continue;
                }
                const rows = Number((value as CliLayoutPresetState).rows);
                const cols = Number((value as CliLayoutPresetState).cols);
                const paths = Array.isArray((value as CliLayoutPresetState).paths)
                    ? (value as CliLayoutPresetState).paths.map((path) => normalizeExplorerPath(path ?? "")).filter(Boolean)
                    : [];
                const commands = Array.isArray((value as CliLayoutPresetState).commands)
                    ? (value as CliLayoutPresetState).commands
                          .map((cmd) => (typeof cmd === "string" ? cmd.trim() : ""))
                          .filter((cmd) => !isBlank(cmd))
                    : [];
                if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows <= 0 || cols <= 0) {
                    continue;
                }
                normalizedPresets[key] = {
                    rows,
                    cols,
                    paths,
                    commands,
                    connection: (value as CliLayoutPresetState).connection,
                    updatedTs: Number((value as CliLayoutPresetState).updatedTs) || Date.now(),
                };
            }

            const normalizedSavedLayouts: Record<string, CliLayoutPresetState> = {};
            const parsedSavedLayouts = (parsed as CliLayoutConfigFile).savedLayouts;
            for (const [key, value] of Object.entries(parsedSavedLayouts ?? {})) {
                if (value == null || typeof value !== "object") {
                    continue;
                }
                const rows = Number((value as CliLayoutPresetState).rows);
                const cols = Number((value as CliLayoutPresetState).cols);
                const paths = Array.isArray((value as CliLayoutPresetState).paths)
                    ? (value as CliLayoutPresetState).paths.map((path) => normalizeExplorerPath(path ?? "")).filter(Boolean)
                    : [];
                const commands = Array.isArray((value as CliLayoutPresetState).commands)
                    ? (value as CliLayoutPresetState).commands
                          .map((cmd) => (typeof cmd === "string" ? cmd.trim() : ""))
                          .filter((cmd) => !isBlank(cmd))
                    : [];
                if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows <= 0 || cols <= 0) {
                    continue;
                }
                normalizedSavedLayouts[key] = {
                    rows,
                    cols,
                    paths,
                    commands,
                    connection: (value as CliLayoutPresetState).connection,
                    updatedTs: Number((value as CliLayoutPresetState).updatedTs) || Date.now(),
                };
            }

            return {
                version: 1,
                lastPresetKey:
                    typeof (parsed as CliLayoutConfigFile).lastPresetKey === "string"
                        ? (parsed as CliLayoutConfigFile).lastPresetKey
                        : undefined,
                presets: normalizedPresets,
                savedLayouts: normalizedSavedLayouts,
            };
        } catch {
            return defaultConfig;
        }
    }, [cliLayoutConfigPath]);

    const writeCliLayoutConfig = useCallback(
        async (config: CliLayoutConfigFile) => {
            try {
                await RpcApi.FileWriteCommand(TabRpcClient, {
                    info: { path: cliLayoutConfigPath },
                    data64: stringToBase64(JSON.stringify(config, null, 2)),
                });
            } catch (e) {
                console.error("Failed to write CLI layout config:", e);
            }
        },
        [cliLayoutConfigPath]
    );

    const captureCurrentLayoutState = useCallback((): CliLayoutPresetState => {
        const leafOrder = globalStore.get(layoutModel.leafOrder) ?? [];
        const blockIds = leafOrder.map((leaf) => leaf.blockid).filter(Boolean);

        const paths: string[] = [];
        const commands: string[] = [];
        const uniqueRows = new Set<number>();
        const uniqueCols = new Set<number>();

        for (const blockId of blockIds) {
            const blockData = getBlockById(blockId);
            const cmdCwd = normalizeExplorerPath((blockData?.meta?.["cmd:cwd"] as string) ?? "");
            paths.push(cmdCwd || currentPath || "");
            const autoCmd = typeof blockData?.meta?.["term:autoCmd"] === "string" ? blockData.meta["term:autoCmd"] : "";
            commands.push(autoCmd.trim());

            const layoutNode = layoutModel.getNodeByBlockId(blockId);
            const addl = layoutNode ? layoutModel.getNodeAdditionalProperties(layoutNode) : null;
            if (addl?.treeKey) {
                const parts = String(addl.treeKey).split(".").map((segment) => Number(segment));
                if (parts.length >= 2) {
                    const row = parts[0];
                    const col = parts[1];
                    if (Number.isFinite(row)) {
                        uniqueRows.add(row);
                    }
                    if (Number.isFinite(col)) {
                        uniqueCols.add(col);
                    }
                }
            }
        }

        const inferredRows = uniqueRows.size > 0 ? uniqueRows.size : Math.max(1, Math.round(Math.sqrt(blockIds.length || 1)));
        const inferredCols = uniqueCols.size > 0 ? uniqueCols.size : Math.max(1, Math.ceil((blockIds.length || 1) / inferredRows));

        return {
            rows: inferredRows,
            cols: inferredCols,
            paths,
            commands,
            connection: connection ?? undefined,
            updatedTs: Date.now(),
        };
    }, [connection, currentPath, getBlockById, layoutModel]);

    const saveCurrentLayoutToSlot = useCallback(
        (slotKey: string) => {
            fireAndForget(async () => {
                const config = await readCliLayoutConfig();
                const currentLayoutState = captureCurrentLayoutState();
                config.savedLayouts = config.savedLayouts ?? {};
                config.savedLayouts[slotKey] = currentLayoutState;
                await writeCliLayoutConfig(config);
            });
        },
        [captureCurrentLayoutState, readCliLayoutConfig, writeCliLayoutConfig]
    );

    const applySavedLayoutSlot = useCallback(
        (slotKey: string, fallbackPath: string) => {
            fireAndForget(async () => {
                const config = await readCliLayoutConfig();
                const savedLayouts = config.savedLayouts ?? {};
                const saved = savedLayouts[slotKey];
                if (saved == null || saved.rows <= 0 || saved.cols <= 0) {
                    return;
                }

                const matchingPreset = CLI_LAYOUT_PRESETS.find((preset) => preset.rows === saved.rows && preset.cols === saved.cols);
                if (!matchingPreset) {
                    return;
                }

                const normalizedPath = normalizeExplorerPath(fallbackPath);
                const totalSlots = matchingPreset.rows * matchingPreset.cols;
                const savedPaths = saved.paths ?? [];
                const savedCommands = saved.commands ?? [];
                const resolvedPaths = Array.from({ length: totalSlots }, (_, index) => {
                    const path = normalizeExplorerPath(savedPaths[index] ?? "");
                    return path || normalizedPath;
                });
                const resolvedCommands = Array.from({ length: totalSlots }, (_, index) => {
                    const cmd = savedCommands[index];
                    return typeof cmd === "string" ? cmd.trim() : "";
                });

                config.presets[matchingPreset.key] = {
                    rows: matchingPreset.rows,
                    cols: matchingPreset.cols,
                    paths: resolvedPaths,
                    commands: resolvedCommands,
                    connection: saved.connection,
                    updatedTs: Date.now(),
                };
                await writeCliLayoutConfig(config);
                applyCliLayoutPreset(matchingPreset, normalizedPath);
            });
        },
        [applyCliLayoutPreset, readCliLayoutConfig, writeCliLayoutConfig]
    );

    const applyCliLayoutPreset = useCallback(
        (preset: CliLayoutPreset, path: string) => {
            const normalizedPath = normalizeExplorerPath(path);
            if (isBlank(normalizedPath)) {
                return;
            }

            fireAndForget(async () => {
                const presetLabelKey = `clilayout.presets.${preset.key}`;
                const translatedPresetLabel = t(presetLabelKey);
                const tabName = translatedPresetLabel === presetLabelKey ? preset.label : translatedPresetLabel;
                const totalSlots = preset.rows * preset.cols;
                const config = await readCliLayoutConfig();
                const savedPreset = config.presets[preset.key];

                const restoredPaths =
                    savedPreset != null && savedPreset.rows === preset.rows && savedPreset.cols === preset.cols
                        ? savedPreset.paths
                        : [];
                const restoredCommands =
                    savedPreset != null && savedPreset.rows === preset.rows && savedPreset.cols === preset.cols
                        ? savedPreset.commands ?? []
                        : [];
                const resolvedPaths = Array.from({ length: totalSlots }, (_, index) => {
                    const restoredPath = normalizeExplorerPath(restoredPaths[index] ?? "");
                    return isBlank(restoredPath) ? normalizedPath : restoredPath;
                });
                const resolvedCommands = Array.from({ length: totalSlots }, (_, index) => {
                    const command = restoredCommands[index];
                    return typeof command === "string" ? command.trim() : "";
                });

                config.lastPresetKey = preset.key;
                config.presets[preset.key] = {
                    rows: preset.rows,
                    cols: preset.cols,
                    paths: resolvedPaths,
                    commands: resolvedCommands,
                    connection: connection ?? undefined,
                    updatedTs: Date.now(),
                };
                await writeCliLayoutConfig(config);

                await openCliLayoutInNewTab(
                    {
                        rows: preset.rows,
                        cols: preset.cols,
                        paths: resolvedPaths,
                        commands: resolvedCommands,
                        connection: isBlank(connection) ? undefined : connection,
                        updatedTs: Date.now(),
                    },
                    tabName,
                    preset.key
                );
            });
        },
        [connection, readCliLayoutConfig, t, writeCliLayoutConfig]
    );

    useEffect(() => {
        const onApplyLayoutFromWidgets = (event: Event) => {
            const customEvent = event as CustomEvent<{ presetKey?: string; targetBlockId?: string }>;
            const presetKey = customEvent.detail?.presetKey;
            const targetBlockId = customEvent.detail?.targetBlockId;
            if (!isBlank(targetBlockId) && targetBlockId !== model.blockId) {
                return;
            }
            const preset = CLI_LAYOUT_PRESETS.find((item) => item.key === presetKey);
            if (!preset) {
                return;
            }
            const targetPath = normalizeExplorerPath(selectedPath || currentPath);
            if (isBlank(targetPath)) {
                return;
            }
            applyCliLayoutPreset(preset, targetPath);
        };

        window.addEventListener(CLI_LAYOUT_APPLY_EVENT, onApplyLayoutFromWidgets as EventListener);
        return () => {
            window.removeEventListener(CLI_LAYOUT_APPLY_EVENT, onApplyLayoutFromWidgets as EventListener);
        };
    }, [applyCliLayoutPreset, currentPath, model.blockId, selectedPath]);

    const formatPathForClipboard = useCallback(
        (path: string) => {
            const normalized = normalizeExplorerPath(path);
            if (isBlank(normalized)) {
                return normalized;
            }
            if (!isLocalExplorer) {
                return normalized;
            }

            let resolvedPath = normalized;
            const homePath = normalizeExplorerPath(quickAccessPathMap?.home ?? "");
            if (!isBlank(homePath) && (resolvedPath === "~" || resolvedPath.startsWith("~/") || resolvedPath.startsWith("~\\"))) {
                const suffix = resolvedPath.slice(1).replace(/^[\\/]+/, "");
                const base = homePath.replace(/[\\/]+$/, "");
                resolvedPath = isBlank(suffix) ? homePath : `${base}/${suffix}`;
            }

            if (isProbablyWindowsPath(resolvedPath)) {
                return resolvedPath.replace(/\//g, "\\");
            }
            return resolvedPath;
        },
        [isLocalExplorer, quickAccessPathMap]
    );

    const buildAiLaunchMenuItems = useCallback(
        (path: string): ContextMenuItem[] => {
            const normalized = normalizeExplorerPath(path);
            if (isBlank(normalized)) {
                return [];
            }
            const commandItems: ContextMenuItem[] = AI_LAUNCH_COMMANDS.map((item) => ({
                label: t("preview.openAiHere", { ai: item.label }),
                click: () => openTerminalAtPath(normalized, item.command, true, false),
            }));

            const layoutItems: ContextMenuItem[] = CLI_LAYOUT_PRESETS.map((preset) => {
                const labelKey = `clilayout.presets.${preset.key}`;
                const translated = t(labelKey);
                const label = translated === labelKey ? preset.label : translated;
                return {
                    label,
                    click: () => applyCliLayoutPreset(preset, normalized),
                };
            });

            return [...commandItems, { type: "separator" }, ...layoutItems];
        },
        [applyCliLayoutPreset, openTerminalAtPath, t]
    );

    const buildAutoCommandMenuItems = useCallback(
        (path: string): ContextMenuItem[] => {
            const normalized = normalizeExplorerPath(path);
            if (isBlank(normalized)) {
                return [];
            }
            return AI_LAUNCH_COMMANDS.map((item) => ({
                label: `${item.label}`,
                click: () => openTerminalAtPath(normalized, item.command, true, false),
            }));
        },
        [openTerminalAtPath]
    );

    const buildLayoutMenuItems = useCallback(
        (path: string): ContextMenuItem[] => {
            const normalized = normalizeExplorerPath(path);
            if (isBlank(normalized)) {
                return [];
            }

            const presetItems: ContextMenuItem[] = CLI_LAYOUT_PRESETS.map((preset) => {
                const labelKey = `clilayout.presets.${preset.key}`;
                const translated = t(labelKey);
                const label = translated === labelKey ? preset.label : translated;
                return {
                    label,
                    click: () => applyCliLayoutPreset(preset, normalized),
                };
            });

            const saveItems: ContextMenuItem[] = CLI_LAYOUT_SAVE_SLOTS.map((slot) => {
                const slotKey = `clilayout.slots.${slot.key}`;
                const translatedSlot = t(slotKey);
                const slotLabel = translatedSlot === slotKey ? slot.label : translatedSlot;
                return {
                    label: t("clilayout.saveToSlot", { slot: slotLabel }),
                    click: () => saveCurrentLayoutToSlot(slot.key),
                };
            });

            const loadItems: ContextMenuItem[] = CLI_LAYOUT_SAVE_SLOTS.map((slot) => {
                const slotKey = `clilayout.slots.${slot.key}`;
                const translatedSlot = t(slotKey);
                const slotLabel = translatedSlot === slotKey ? slot.label : translatedSlot;
                return {
                    label: t("clilayout.loadSlot", { slot: slotLabel }),
                    click: () => applySavedLayoutSlot(slot.key, normalized),
                };
            });

            return [
                ...presetItems,
                { type: "separator" },
                ...saveItems,
                { type: "separator" },
                ...loadItems,
            ];
        },
        [applyCliLayoutPreset, applySavedLayoutSlot, saveCurrentLayoutToSlot]
    );

    const showAiLaunchMenu = useCallback(
        (e: React.MouseEvent, path: string) => {
            e.preventDefault();
            e.stopPropagation();
            const menuItems = buildAiLaunchMenuItems(path);
            if (menuItems.length === 0) {
                return;
            }
            ContextMenuModel.showContextMenu(menuItems, e);
        },
        [buildAiLaunchMenuItems]
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
                    click: () => copyToClipboard(formatPathForClipboard(currentPath)),
                },
                {
                    label: t("favorites.add"),
                    click: () => addToFavorites(currentPath),
                },
                {
                    label: t("preview.openTerminalHere"),
                    click: () => openTerminalAtPath(currentPath),
                },
                {
                    type: "separator",
                },
                {
                    label: t("favorites.autoCommand"),
                    submenu: buildAutoCommandMenuItems(currentPath),
                },
                {
                    label: t("preview.openWithAi"),
                    submenu: buildAiLaunchMenuItems(currentPath),
                },
                {
                    label: t("clilayout.menu"),
                    submenu: buildLayoutMenuItems(currentPath),
                },
            ];
            ContextMenuModel.showContextMenu(menu, e);
        },
        [
            addToFavorites,
            buildAiLaunchMenuItems,
            buildAutoCommandMenuItems,
            buildLayoutMenuItems,
            copyToClipboard,
            currentPath,
            formatPathForClipboard,
            openTerminalAtPath,
            t,
        ]
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
    const copyCurrentPath = useCallback(
        () => copyToClipboard(formatPathForClipboard(currentPath)),
        [copyToClipboard, currentPath, formatPathForClipboard]
    );

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
        if (isBlank(normalizedFocusPath)) {
            return;
        }
        const segments = getBreadcrumbSegments(normalizedFocusPath);
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
    }, [loadTreeChildren, normalizedFocusPath]);

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

    useEffect(() => {
        if (sidebarHidden || isBlank(normalizedFocusPath)) {
            return;
        }
        const shouldOpenThisPc = PLATFORM === PlatformWindows && /^[A-Za-z]:[\\/]/.test(normalizedFocusPath);
        setCollapsedSections((prev) => {
            const next = { ...prev };
            let changed = false;
            if (next.quickAccess) {
                next.quickAccess = false;
                changed = true;
            }
            if (shouldOpenThisPc && next.thisPC) {
                next.thisPC = false;
                changed = true;
            }
            return changed ? next : prev;
        });
    }, [normalizedFocusPath, sidebarHidden]);

    const scrollNavItemIntoView = useCallback((node: HTMLDivElement) => {
        const scrollContainer = sidebarScrollRef.current;
        if (!scrollContainer) {
            node.scrollIntoView({ block: "center", inline: "nearest" });
            return;
        }

        const containerRect = scrollContainer.getBoundingClientRect();
        const nodeRect = node.getBoundingClientRect();
        if (nodeRect.top >= containerRect.top && nodeRect.bottom <= containerRect.bottom) {
            return;
        }

        const currentScrollTop = scrollContainer.scrollTop;
        const nodeOffsetTop = node.offsetTop;
        const targetScrollTop = Math.max(0, nodeOffsetTop - scrollContainer.clientHeight / 2 + node.clientHeight / 2);

        if (Math.abs(targetScrollTop - currentScrollTop) > 1) {
            scrollContainer.scrollTo({ top: targetScrollTop, behavior: "auto" });
        }
    }, []);

    useLayoutEffect(() => {
        if (sidebarHidden || isBlank(normalizedFocusPath)) {
            return;
        }

        let cancelled = false;
        let attempts = 0;
        const maxAttempts = 60;

        const locateNode = (): HTMLDivElement | null => {
            let node = navItemRefs.current[normalizedFocusPath] ?? null;
            if (node) {
                return node;
            }
            const pathSegments = getBreadcrumbSegments(normalizedFocusPath)
                .map((segment) => normalizeExplorerPath(segment.path))
                .filter(Boolean);
            for (let i = pathSegments.length - 1; i >= 0; i--) {
                const segmentPath = pathSegments[i];
                const segmentNode = navItemRefs.current[segmentPath];
                if (segmentNode) {
                    return segmentNode;
                }
            }
            return null;
        };

        const locateAndScroll = () => {
            if (cancelled) {
                return;
            }

            const node = locateNode();
            if (node) {
                scrollNavItemIntoView(node);
                return;
            }

            if (attempts >= maxAttempts) {
                return;
            }

            attempts += 1;
            autoLocateTimerRef.current = setTimeout(locateAndScroll, 100);
        };

        const rafId = window.requestAnimationFrame(locateAndScroll);
        return () => {
            cancelled = true;
            window.cancelAnimationFrame(rafId);
            if (autoLocateTimerRef.current) {
                clearTimeout(autoLocateTimerRef.current);
                autoLocateTimerRef.current = null;
            }
        };
    }, [normalizedFocusPath, scrollNavItemIntoView, sidebarHidden]);

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
                    click: () => copyToClipboard(formatPathForClipboard(normalized)),
                },
                {
                    label: t("favorites.add"),
                    click: () => addToFavorites(normalized),
                },
                {
                    label: t("preview.openTerminalHere"),
                    click: () => openTerminalAtPath(normalized),
                },
                {
                    label: t("favorites.applyToCurrentTerminal"),
                    click: () => {
                        const targetTermBlockId = findTargetTerminalBlockId();
                        if (isBlank(targetTermBlockId)) {
                            return;
                        }
                        applyPathToTerminalBlock(targetTermBlockId, normalized);
                    },
                },
                {
                    type: "separator",
                },
                {
                    label: t("favorites.autoCommand"),
                    submenu: buildAutoCommandMenuItems(normalized),
                },
                {
                    label: t("preview.openWithAi"),
                    submenu: buildAiLaunchMenuItems(normalized),
                },
                {
                    label: t("clilayout.menu"),
                    submenu: buildLayoutMenuItems(normalized),
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
        [
            addToFavorites,
            buildAiLaunchMenuItems,
            buildAutoCommandMenuItems,
            buildLayoutMenuItems,
            copyToClipboard,
            favoritesModel,
            formatPathForClipboard,
            findTargetTerminalBlockId,
            applyPathToTerminalBlock,
            openTerminalAtPath,
            t,
        ]
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
                setSearchWidth(clampNumber(startWidth + delta, 120, 320));
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
            const isActive = isSameExplorerPath(keyPath, normalizedFocusPath);
            const isInPath = isExplorerPathAncestor(keyPath, normalizedFocusPath);
            const isLoading = nodeState?.loading || (isExpanded && nodeState?.children == null && !nodeState?.error);
            const childItems = nodeState?.children ?? [];
            const indent = 8 + depth * 12;
            const iconClassName = clsx(
                "fas",
                `fa-${item.icon}`,
                "w-4 text-center",
                item.icon === "star"
                    ? "text-yellow-500"
                    : item.icon === "folder" && isActive
                      ? "text-blue-300"
                      : item.icon === "folder" && isInPath
                        ? "text-blue-400"
                        : isActive
                          ? "text-blue-200"
                          : isInPath
                            ? "text-blue-300/90"
                            : "text-zinc-400"
            );

            return (
                <div key={item.favoriteId ? `fav:${item.favoriteId}` : keyPath}>
                    <div
                        ref={(node) => setNavItemRef(keyPath, node)}
                        className={clsx(
                            "flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer select-none",
                            isActive
                                ? "bg-blue-600/60 text-blue-50 ring-1 ring-blue-300/80"
                                : item.icon === "folder" && isInPath
                                  ? "bg-blue-700/35 text-blue-100 hover:bg-blue-700/45"
                                : isInPath
                                  ? "text-blue-300/90 hover:bg-hover hover:text-blue-200"
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

    const quickViewModes: Array<{ mode: DirectoryViewMode; label: string; title: string }> = [
        { mode: "details", label: "D", title: t("explorer.view.details") },
        { mode: "list", label: "L", title: t("explorer.view.list") },
        { mode: "smallIcons", label: "S", title: t("explorer.view.smallIcons") },
        { mode: "mediumIcons", label: "M", title: t("explorer.view.mediumIcons") },
        { mode: "largeIcons", label: "LG", title: t("explorer.view.largeIcons") },
    ];

    return (
        <div className="flex flex-row h-full overflow-hidden">
            {!sidebarHidden && (
                <>
                    <div
                        ref={sidebarScrollRef}
                        className="shrink-0 pt-11 bg-zinc-950 border-r border-zinc-800 overflow-y-auto"
                        style={{ width: sidebarWidth }}
                    >
                        <div className="px-2 pt-2 pb-1">
                            <button
                                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-semibold text-secondary hover:bg-hoverbg hover:text-primary"
                                onClick={(e) => showAiLaunchMenu(e, selectedPath || currentPath)}
                                title={t("preview.openWithAi")}
                                type="button"
                            >
                                <i className="fas fa-robot text-blue-300 w-4 text-center" />
                                <span className="truncate">{t("preview.openWithAi")}</span>
                            </button>

                        </div>
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

            <div className="relative flex flex-col flex-1 overflow-y-hidden overflow-x-visible">
                {showCopiedToast && (
                    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
                        <div className="px-2 py-1 rounded bg-zinc-800/95 border border-zinc-700 text-xs text-primary shadow">
                            {t("common.copied")}
                        </div>
                    </div>
                )}
                <div
                    className="relative z-20 flex items-center gap-2 px-2 py-1.5 bg-zinc-950 border-b border-zinc-800"
                    style={sidebarHidden ? undefined : { marginLeft: -(sidebarWidth + 4) }}
                >
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
                        <button
                            className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-500/20 text-red-300 hover:text-red-200"
                            onClick={() => uxCloseBlock(model.blockId)}
                            title={t("common.close")}
                            type="button"
                        >
                            <i className="fas fa-xmark text-sm" />
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

                    <div className="min-w-[120px] shrink" style={{ width: searchWidth }}>
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

                    <div className="shrink-0 flex items-center gap-1 bg-zinc-900 border border-zinc-700 rounded p-0.5">
                        {quickViewModes.map((item) => {
                            const active = viewMode === item.mode;
                            return (
                                <button
                                    key={item.mode}
                                    type="button"
                                    className={clsx(
                                        "px-2 py-1 rounded text-[11px]",
                                        active
                                            ? "bg-blue-600/70 text-blue-50"
                                            : "text-secondary hover:bg-hoverbg hover:text-primary"
                                    )}
                                    title={item.title}
                                    onClick={() => setViewMode(item.mode)}
                                >
                                    {item.label}
                                </button>
                            );
                        })}
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
                            viewMode={viewMode}
                            setViewMode={setViewMode}
                            showQuickViewControls={false}
                            onSelectedPathChange={(path, isDir) => {
                                setSelectedPath(path);
                                setSelectedPathIsDir(isDir);
                            }}
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

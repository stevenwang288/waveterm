// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    atoms,
    getApi,
    getFocusedBlockId,
    globalStore,
    WOS,
} from "@/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getLayoutModelForStaticTab } from "@/layout/index";
import { openCliLayoutInNewTab } from "@/util/clilayout";
import { base64ToString, fireAndForget, isBlank, stringToBase64 } from "@/util/util";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type CliLayoutPreset = {
    key: string;
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
    name?: string;
};

type CliLayoutConfigFile = {
    version: number;
    lastPresetKey?: string;
    presets: Record<string, CliLayoutPresetState>;
    savedLayouts?: Record<string, CliLayoutPresetState>;
};

type SavedLayoutEntry = {
    key: string;
    state: CliLayoutPresetState;
};

const CLI_LAYOUT_PRESETS: CliLayoutPreset[] = [
    { key: "2", rows: 1, cols: 2 },
    { key: "3", rows: 1, cols: 3 },
    { key: "4", rows: 2, cols: 2 },
    { key: "6", rows: 2, cols: 3 },
    { key: "6-2col", rows: 3, cols: 2 },
    { key: "8", rows: 2, cols: 4 },
    { key: "8-2col", rows: 4, cols: 2 },
    { key: "9", rows: 3, cols: 3 },
];

function normalizePath(path: string): string {
    if (isBlank(path)) {
        return "";
    }
    const trimmed = path.trim();
    if (trimmed === "~" || trimmed === "/" || trimmed === "\\") {
        return trimmed;
    }
    const driveRoot = trimmed.match(/^([A-Za-z]:)[\\/]*$/);
    if (driveRoot) {
        return `${driveRoot[1]}\\`;
    }
    return trimmed.replace(/[\\/]+$/, "");
}

function fmtTime(ts: number): string {
    const d = new Date(ts || Date.now());
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getMonth() + 1}-${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const LayoutsPanel = memo(() => {
    const { t } = useTranslation();
    const layoutModel = useMemo(() => getLayoutModelForStaticTab(), []);
    const cliLayoutConfigPath = useMemo(() => `${getApi().getConfigDir()}/cli-layout-presets.json`, []);
    const [savedLayouts, setSavedLayouts] = useState<SavedLayoutEntry[]>([]);
    const [presetStates, setPresetStates] = useState<Record<string, CliLayoutPresetState>>({});
    const [lastPresetKey, setLastPresetKey] = useState<string>("");

    const getBlockById = useCallback((blockId: string): Block | null => {
        if (isBlank(blockId)) {
            return null;
        }
        const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
        return globalStore.get(blockAtom);
    }, []);

    const getFallbackFromFocus = useCallback(() => {
        const focusedBlockId = getFocusedBlockId();
        const focusedBlock = getBlockById(focusedBlockId);
        const path = typeof focusedBlock?.meta?.["cmd:cwd"] === "string" ? normalizePath(focusedBlock.meta["cmd:cwd"]) : "";
        const connection = typeof focusedBlock?.meta?.connection === "string" ? focusedBlock.meta.connection : "";
        return { path, connection };
    }, [getBlockById]);

    const readConfig = useCallback(async (): Promise<CliLayoutConfigFile> => {
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
            const parsed = JSON.parse(rawText) as CliLayoutConfigFile;
            if (parsed == null || typeof parsed !== "object") {
                return defaultConfig;
            }

            const normalizeState = (state: CliLayoutPresetState): CliLayoutPresetState | null => {
                const rows = Number(state?.rows);
                const cols = Number(state?.cols);
                if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows <= 0 || cols <= 0) {
                    return null;
                }
                const paths = Array.isArray(state?.paths) ? state.paths.map((p) => normalizePath(p ?? "")) : [];
                const commands = Array.isArray(state?.commands)
                    ? state.commands.map((cmd) => (typeof cmd === "string" ? cmd.trim() : ""))
                    : [];
                return {
                    rows,
                    cols,
                    paths,
                    commands,
                    connection: state?.connection,
                    updatedTs: Number(state?.updatedTs) || Date.now(),
                    name: typeof state?.name === "string" ? state.name : undefined,
                };
            };

            const normalizedPresets: Record<string, CliLayoutPresetState> = {};
            for (const [key, state] of Object.entries(parsed.presets ?? {})) {
                const normalized = normalizeState(state);
                if (normalized != null) {
                    normalizedPresets[key] = normalized;
                }
            }

            const normalizedSavedLayouts: Record<string, CliLayoutPresetState> = {};
            for (const [key, state] of Object.entries(parsed.savedLayouts ?? {})) {
                const normalized = normalizeState(state);
                if (normalized != null) {
                    normalizedSavedLayouts[key] = normalized;
                }
            }

            return {
                version: 1,
                lastPresetKey: typeof parsed.lastPresetKey === "string" ? parsed.lastPresetKey : undefined,
                presets: normalizedPresets,
                savedLayouts: normalizedSavedLayouts,
            };
        } catch {
            return defaultConfig;
        }
    }, [cliLayoutConfigPath]);

    const writeConfig = useCallback(
        async (config: CliLayoutConfigFile) => {
            await RpcApi.FileWriteCommand(TabRpcClient, {
                info: { path: cliLayoutConfigPath },
                data64: stringToBase64(JSON.stringify(config, null, 2)),
            });
        },
        [cliLayoutConfigPath]
    );

    const refreshConfig = useCallback(() => {
        fireAndForget(async () => {
            const config = await readConfig();
            setLastPresetKey(config.lastPresetKey ?? "");
            setPresetStates(config.presets ?? {});
            const saved = Object.entries(config.savedLayouts ?? {})
                .map(([key, state]) => ({ key, state }))
                .sort((a, b) => (b.state.updatedTs ?? 0) - (a.state.updatedTs ?? 0));
            setSavedLayouts(saved);
        });
    }, [readConfig]);

    useEffect(() => {
        refreshConfig();
    }, [refreshConfig]);

    useEffect(() => {
        const handler = () => refreshConfig();
        window.addEventListener("cli-layout-presets-updated", handler);
        return () => window.removeEventListener("cli-layout-presets-updated", handler);
    }, [refreshConfig]);

    const captureCurrentLayoutState = useCallback((): CliLayoutPresetState | null => {
        const leafOrder = globalStore.get(layoutModel.leafOrder) ?? [];
        if (leafOrder.length === 0) {
            return null;
        }

        const paths: string[] = [];
        const commands: string[] = [];
        const uniqueRows = new Set<number>();
        const uniqueCols = new Set<number>();
        let connection = "";

        for (const leaf of leafOrder) {
            const blockData = getBlockById(leaf.blockid);
            const path = typeof blockData?.meta?.["cmd:cwd"] === "string" ? normalizePath(blockData.meta["cmd:cwd"]) : "";
            const autoCmd = typeof blockData?.meta?.["term:autoCmd"] === "string" ? String(blockData.meta["term:autoCmd"]).trim() : "";
            paths.push(path);
            commands.push(autoCmd);

            if (isBlank(connection) && typeof blockData?.meta?.connection === "string") {
                connection = blockData.meta.connection;
            }

            const layoutNode = layoutModel.getNodeByBlockId(leaf.blockid);
            const addl = layoutNode ? layoutModel.getNodeAdditionalProperties(layoutNode) : null;
            if (!isBlank(addl?.treeKey)) {
                const parts = String(addl.treeKey).split(".").map((seg) => Number(seg));
                if (parts.length >= 2) {
                    if (Number.isFinite(parts[0])) {
                        uniqueRows.add(parts[0]);
                    }
                    if (Number.isFinite(parts[1])) {
                        uniqueCols.add(parts[1]);
                    }
                }
            }
        }

        const inferredRows = uniqueRows.size > 0 ? uniqueRows.size : Math.max(1, Math.round(Math.sqrt(leafOrder.length)));
        const inferredCols = uniqueCols.size > 0 ? uniqueCols.size : Math.max(1, Math.ceil(leafOrder.length / inferredRows));

        return {
            rows: inferredRows,
            cols: inferredCols,
            paths,
            commands,
            connection: isBlank(connection) ? undefined : connection,
            updatedTs: Date.now(),
        };
    }, [getBlockById, layoutModel]);

    const openLayoutStateInNewTab = useCallback(
        async (state: CliLayoutPresetState, tabName: string, presetKey?: string) => {
            const rows = state.rows;
            const cols = state.cols;
            if (rows <= 0 || cols <= 0) {
                return;
            }

            const totalSlots = rows * cols;
            const focusInfo = getFallbackFromFocus();
            const fallbackPath = focusInfo.path;
            const fallbackConn = focusInfo.connection;

            const resolvedPaths = Array.from({ length: totalSlots }, (_, index) => {
                const v = normalizePath(state.paths?.[index] ?? "");
                return isBlank(v) ? fallbackPath : v;
            });
            const resolvedCommands = Array.from({ length: totalSlots }, (_, index) => {
                const cmd = state.commands?.[index];
                return typeof cmd === "string" ? cmd.trim() : "";
            });
            const effectiveConnection = !isBlank(state.connection) ? state.connection : fallbackConn;

            if (presetKey != null) {
                const config = await readConfig();
                config.lastPresetKey = presetKey;
                config.presets[presetKey] = {
                    rows,
                    cols,
                    paths: resolvedPaths,
                    commands: resolvedCommands,
                    connection: effectiveConnection,
                    updatedTs: Date.now(),
                };
                await writeConfig(config);
                refreshConfig();
            }

            await openCliLayoutInNewTab(
                {
                    rows,
                    cols,
                    paths: resolvedPaths,
                    commands: resolvedCommands,
                    connection: effectiveConnection,
                    updatedTs: Date.now(),
                },
                tabName,
                presetKey
            );
        },
        [getFallbackFromFocus, readConfig, refreshConfig, writeConfig]
    );

    const applyPreset = useCallback(
        (preset: CliLayoutPreset) => {
            fireAndForget(async () => {
                const presetLabel = t(`clilayout.presets.${preset.key}`);
                const focusInfo = getFallbackFromFocus();
                const totalSlots = preset.rows * preset.cols;
                const savedState = presetStates[preset.key];
                const canReuseSaved =
                    savedState != null && savedState.rows === preset.rows && savedState.cols === preset.cols;
                const paths = canReuseSaved ? savedState.paths : Array.from({ length: totalSlots }, () => focusInfo.path);
                const commands = canReuseSaved
                    ? savedState.commands ?? []
                    : Array.from({ length: totalSlots }, () => "");

                await openLayoutStateInNewTab(
                    {
                        rows: preset.rows,
                        cols: preset.cols,
                        paths,
                        commands,
                        connection: canReuseSaved ? savedState.connection ?? focusInfo.connection : focusInfo.connection,
                        updatedTs: Date.now(),
                    },
                    presetLabel,
                    preset.key
                );
            });
        },
        [getFallbackFromFocus, openLayoutStateInNewTab, presetStates, t]
    );

    const saveCurrentLayout = useCallback(() => {
        fireAndForget(async () => {
            const snapshot = captureCurrentLayoutState();
            if (snapshot == null) {
                return;
            }
            const datetime = new Date().toLocaleString();
            const defaultName = t("clilayout.defaultSavedName", { datetime });
            const nameInput = window.prompt(t("clilayout.promptSaveName"), defaultName);
            if (nameInput == null) {
                return;
            }
            const finalName = isBlank(nameInput) ? defaultName : nameInput.trim();
            const key = `layout-${Date.now()}`;
            const config = await readConfig();
            config.savedLayouts = config.savedLayouts ?? {};
            config.savedLayouts[key] = {
                ...snapshot,
                name: finalName,
                updatedTs: Date.now(),
            };
            await writeConfig(config);
            refreshConfig();
        });
    }, [captureCurrentLayoutState, readConfig, refreshConfig, t, writeConfig]);

    const applySavedLayout = useCallback(
        (entry: SavedLayoutEntry) => {
            fireAndForget(async () => {
                const title = isBlank(entry.state.name)
                    ? t("clilayout.layoutTitle", { rows: entry.state.rows, cols: entry.state.cols })
                    : entry.state.name;
                await openLayoutStateInNewTab(entry.state, title);
            });
        },
        [openLayoutStateInNewTab, t]
    );

    const deleteSavedLayout = useCallback(
        (layoutKey: string) => {
            fireAndForget(async () => {
                const config = await readConfig();
                if (config.savedLayouts == null || config.savedLayouts[layoutKey] == null) {
                    return;
                }
                delete config.savedLayouts[layoutKey];
                await writeConfig(config);
                refreshConfig();
            });
        },
        [readConfig, refreshConfig, writeConfig]
    );

    return (
        <div className="flex flex-col h-full bg-zinc-950 border-r border-zinc-800 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 flex-shrink-0">
                <div className="flex items-center gap-2">
                    <i className="fas fa-table-cells text-cyan-400" />
                    <span className="text-sm font-semibold">{t("clilayout.menu")}</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                    <button className="text-secondary hover:text-primary" onClick={saveCurrentLayout}>
                        {t("clilayout.saveCurrent")}
                    </button>
                    <button className="text-secondary hover:text-primary" onClick={refreshConfig}>
                        {t("clilayout.refresh")}
                    </button>
                </div>
            </div>

            <div className="px-3 pt-2 pb-1 text-xs text-secondary/80 uppercase tracking-wide">{t("clilayout.quickPresets")}</div>
            <div className="px-2 pb-2">
                {CLI_LAYOUT_PRESETS.map((preset) => {
                    const presetLabel = t(`clilayout.presets.${preset.key}`);
                    const savedState = presetStates[preset.key];
                    const canReuseSaved =
                        savedState != null && savedState.rows === preset.rows && savedState.cols === preset.cols;
                    const savedPaths = canReuseSaved ? savedState.paths.filter((p) => !isBlank(p)) : [];
                    const pathPreview = savedPaths.slice(0, 2).join(" | ");
                    const pathSuffix = savedPaths.length > 2 ? " …" : "";
                    const hasAutoCmd = canReuseSaved ? (savedState.commands ?? []).some((cmd) => !isBlank(cmd)) : false;
                    const summaryParts: string[] = [];
                    if (canReuseSaved && !isBlank(pathPreview)) {
                        summaryParts.push(`${pathPreview}${pathSuffix}`);
                    }
                    if (canReuseSaved) {
                        summaryParts.push(fmtTime(savedState.updatedTs));
                    }
                    if (hasAutoCmd) {
                        summaryParts.push(t("clilayout.includesCommand"));
                    }
                    const summary = summaryParts.join(" · ");

                    return (
                        <div
                            key={preset.key}
                            className="flex items-center px-2 py-1.5 text-sm hover:bg-hover rounded cursor-pointer"
                            onClick={() => applyPreset(preset)}
                            title={
                                canReuseSaved
                                    ? t("clilayout.restoreRecentPresetTitle", { preset: presetLabel })
                                    : t("clilayout.createNewPresetTitle", { preset: presetLabel })
                            }
                        >
                            <i className="fa fa-table-cells mr-2 text-secondary" />
                            <div className="flex-1 overflow-hidden">
                                <div className="flex items-center">
                                    <span className="truncate">{presetLabel}</span>
                                    {lastPresetKey === preset.key && (
                                        <span className="ml-auto text-[10px] text-cyan-300">{t("clilayout.recent")}</span>
                                    )}
                                </div>
                                {canReuseSaved && (
                                    <div className="text-[10px] text-secondary/80 truncate">{summary}</div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="px-3 pt-2 pb-1 text-xs text-secondary/80 uppercase tracking-wide">{t("clilayout.savedConfigs")}</div>
            <div className="flex-1 overflow-y-auto px-2 pb-2">
                {savedLayouts.length === 0 ? (
                    <div className="text-xs text-secondary px-2 py-2">{t("clilayout.noSavedLayouts")}</div>
                ) : (
                    savedLayouts.map((entry) => {
                        const title = isBlank(entry.state.name)
                            ? t("clilayout.layoutTitle", { rows: entry.state.rows, cols: entry.state.cols })
                            : entry.state.name;
                        return (
                            <div
                                key={entry.key}
                                className="flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-hover rounded cursor-pointer"
                                onClick={() => applySavedLayout(entry)}
                                title={`${entry.state.rows}×${entry.state.cols} · ${fmtTime(entry.state.updatedTs)}`}
                            >
                                <i className="fa fa-clock-rotate-left text-secondary" />
                                <div className="flex-1 overflow-hidden">
                                    <div className="truncate">{title}</div>
                                    <div className="text-[10px] text-secondary/80 truncate">
                                        {entry.state.rows}×{entry.state.cols} · {fmtTime(entry.state.updatedTs)}
                                    </div>
                                </div>
                                <button
                                    className="text-zinc-500 hover:text-red-400"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        deleteSavedLayout(entry.key);
                                    }}
                                >
                                    <i className="fa fa-trash" />
                                </button>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
});

LayoutsPanel.displayName = "LayoutsPanel";

export { LayoutsPanel };

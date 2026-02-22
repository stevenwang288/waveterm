// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import { ConnectionButton } from "@/app/block/connectionbutton";
import { modalsModel } from "@/app/store/modalmodel";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { FocusManager } from "@/app/store/focusManager";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { shouldIncludeWidgetForWorkspace } from "@/app/workspace/widgetfilter";
import { GitPanel } from "@/app/workspace/git-panel";
import { atoms, createBlock, getBlockComponentModel, globalStore, useBlockAtom, WOS, isDev } from "@/store/global";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { fireAndForget, isBlank, makeIconClass, stringToBase64 } from "@/util/util";
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
import { atom, useAtom, useAtomValue, type PrimitiveAtom } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";

function sortByDisplayOrder(wmap: { [key: string]: WidgetConfigType }): WidgetConfigType[] {
    if (wmap == null) {
        return [];
    }
    const wlist = Object.values(wmap);
    wlist.sort((a, b) => {
        return (a["display:order"] ?? 0) - (b["display:order"] ?? 0);
    });
    return wlist;
}

function isExplorerWidget(widget: WidgetConfigType): boolean {
    const meta = widget?.blockdef?.meta as Record<string, any> | undefined;
    return meta?.view === "preview" && !!meta?.["preview:explorer"];
}

const AI_LAUNCH_COMMANDS: Array<{ label: string; command: string }> = [
    { label: "Codex", command: "codex" },
    { label: "Claude", command: "claude" },
    { label: "Gemini", command: "gemini" },
    { label: "Amp", command: "amp" },
    { label: "IFlow", command: "iflow" },
    { label: "OpenCode", command: "opencode" },
    { label: "ClawX", command: "clawx" },
];
const CLAWX_LOCAL_URL = "http://127.0.0.1:5173";
const CLAWX_LOCALHOST_URL = "http://localhost:5173";
const CLAWX_ICON = "rocket";

async function handleWidgetSelect(widget: WidgetConfigType) {
    const blockDef = widget.blockdef;
    createBlock(blockDef, widget.magnified);
}

const Widget = memo(({ widget, mode }: { widget: WidgetConfigType; mode: "normal" | "compact" | "supercompact" }) => {
    const [isTruncated, setIsTruncated] = useState(false);
    const labelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (mode === "normal" && labelRef.current) {
            const element = labelRef.current;
            setIsTruncated(element.scrollWidth > element.clientWidth);
        }
    }, [mode, widget.label]);

    const shouldDisableTooltip = mode !== "normal" ? false : !isTruncated;

    return (
        <Tooltip
            content={widget.description || widget.label}
            placement="right"
            disable={shouldDisableTooltip}
            divClassName={clsx(
                "flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer",
                mode === "supercompact" ? "text-sm" : "text-lg",
                widget["display:hidden"] && "hidden"
            )}
            divOnClick={() => handleWidgetSelect(widget)}
        >
            <div style={{ color: widget.color }}>
                <i className={makeIconClass(widget.icon, true, { defaultIcon: "browser" })}></i>
            </div>
            {mode === "normal" && !isBlank(widget.label) ? (
                <div
                    ref={labelRef}
                    className="text-xxs mt-0.5 w-full px-0.5 text-center whitespace-nowrap overflow-hidden text-ellipsis"
                >
                    {widget.label}
                </div>
            ) : null}
        </Tooltip>
    );
});

const ExplorerConnectionButton = memo(({ mode }: { mode: "normal" | "compact" | "supercompact" }) => {
    const focusedBlockId = useAtomValue(FocusManager.getInstance().blockFocusAtom);
    if (!focusedBlockId) {
        return null;
    }
    return <ExplorerConnectionButtonInner blockId={focusedBlockId} mode={mode} />;
});

ExplorerConnectionButton.displayName = "ExplorerConnectionButton";

const ExplorerConnectionButtonInner = memo(
    ({ blockId, mode }: { blockId: string; mode: "normal" | "compact" | "supercompact" }) => {
        const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
        const isExplorerMode = blockData?.meta?.view === "preview" && !!blockData?.meta?.["preview:explorer"];
        const connection = blockData?.meta?.connection ?? "";

        const changeConnModalAtom = useBlockAtom(blockId, "changeConn", () => atom(false)) as PrimitiveAtom<boolean>;
        const [, setConnModalOpen] = useAtom(changeConnModalAtom);

        const bcm = getBlockComponentModel(blockId);
        const connBtnRef = (bcm?.viewModel as any)?.connBtnRef as RefObject<HTMLDivElement> | undefined;

        if (!isExplorerMode || !connBtnRef) {
            return null;
        }

        return (
            <div
                className={clsx(
                    "flex flex-col justify-center items-center w-full py-1.5 pr-0.5",
                    "text-secondary overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer",
                    mode === "supercompact" ? "text-sm" : "text-lg"
                )}
                onClick={() => setConnModalOpen(true)}
            >
                <ConnectionButton
                    ref={connBtnRef}
                    connection={connection}
                    changeConnModalAtom={changeConnModalAtom}
                    compact
                />
            </div>
        );
    }
);

ExplorerConnectionButtonInner.displayName = "ExplorerConnectionButtonInner";

function calculateGridSize(appCount: number): number {
    if (appCount <= 4) return 2;
    if (appCount <= 9) return 3;
    if (appCount <= 16) return 4;
    if (appCount <= 25) return 5;
    return 6;
}

const AppsFloatingWindow = memo(
    ({
        isOpen,
        onClose,
        referenceElement,
    }: {
        isOpen: boolean;
        onClose: () => void;
        referenceElement: HTMLElement;
    }) => {
        const { t } = useTranslation();
        const [apps, setApps] = useState<AppInfo[]>([]);
        const [loading, setLoading] = useState(true);

        const { refs, floatingStyles, context } = useFloating({
            open: isOpen,
            onOpenChange: onClose,
            placement: "right-start",
            middleware: [offset(-2), shift({ padding: 12 })],
            whileElementsMounted: autoUpdate,
            elements: {
                reference: referenceElement,
            },
        });

        const dismiss = useDismiss(context);
        const { getFloatingProps } = useInteractions([dismiss]);

        useEffect(() => {
            if (!isOpen) return;

            const fetchApps = async () => {
                setLoading(true);
                try {
                    const allApps = await RpcApi.ListAllAppsCommand(TabRpcClient);
                    const localApps = allApps
                        .filter((app) => !app.appid.startsWith("draft/"))
                        .sort((a, b) => {
                            const aName = a.appid.replace(/^local\//, "");
                            const bName = b.appid.replace(/^local\//, "");
                            return aName.localeCompare(bName);
                        });
                    setApps(localApps);
                } catch (error) {
                    console.error("Failed to fetch apps:", error);
                    setApps([]);
                } finally {
                    setLoading(false);
                }
            };

            fetchApps();
        }, [isOpen]);

        if (!isOpen) return null;

        const gridSize = calculateGridSize(apps.length);

        return (
            <FloatingPortal>
                <div
                    ref={refs.setFloating}
                    style={floatingStyles}
                    {...getFloatingProps()}
                    className="bg-modalbg border border-border rounded-lg shadow-xl p-4 z-50"
                >
                    {loading ? (
                        <div className="flex items-center justify-center p-8">
                            <i className="fa fa-solid fa-spinner fa-spin text-2xl text-muted"></i>
                        </div>
                    ) : apps.length === 0 ? (
                        <div className="text-muted text-sm p-4 text-center">{t("workspace.noLocalAppsFound")}</div>
                    ) : (
                        <div
                            className="grid gap-3"
                            style={{
                                gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
                                maxWidth: `${gridSize * 80}px`,
                            }}
                        >
                            {apps.map((app) => {
                                const appMeta = app.manifest?.appmeta;
                                const displayName = app.appid.replace(/^local\//, "");
                                const icon = appMeta?.icon || "cube";
                                const iconColor = appMeta?.iconcolor || "white";

                                return (
                                    <div
                                        key={app.appid}
                                        className="flex flex-col items-center justify-center p-2 rounded hover:bg-hoverbg cursor-pointer transition-colors"
                                        onClick={() => {
                                            const blockDef: BlockDef = {
                                                meta: {
                                                    view: "tsunami",
                                                    controller: "tsunami",
                                                    "tsunami:appid": app.appid,
                                                },
                                            };
                                            createBlock(blockDef);
                                            onClose();
                                        }}
                                    >
                                        <div style={{ color: iconColor }} className="text-3xl mb-1">
                                            <i className={makeIconClass(icon, false)}></i>
                                        </div>
                                        <div className="text-xxs text-center text-secondary break-words w-full px-1">
                                            {displayName}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </FloatingPortal>
        );
    }
);

const GitFloatingWindow = memo(
    ({
        isOpen,
        onClose,
        referenceElement,
    }: {
        isOpen: boolean;
        onClose: () => void;
        referenceElement: HTMLElement;
    }) => {
        const { refs, floatingStyles, context } = useFloating({
            open: isOpen,
            onOpenChange: onClose,
            placement: "right-start",
            middleware: [offset(-2), shift({ padding: 12 })],
            whileElementsMounted: autoUpdate,
            elements: {
                reference: referenceElement,
            },
        });

        const dismiss = useDismiss(context);
        const { getFloatingProps } = useInteractions([dismiss]);

        if (!isOpen) return null;

        return (
            <FloatingPortal>
                <div
                    ref={refs.setFloating}
                    style={floatingStyles}
                    {...getFloatingProps()}
                    className="bg-modalbg rounded-lg shadow-xl z-50 overflow-hidden"
                >
                    <div className="w-[460px] min-w-[360px] max-w-[700px] h-[680px] max-h-[78vh] min-h-[420px]">
                        <GitPanel />
                    </div>
                </div>
            </FloatingPortal>
        );
    }
);

const SettingsFloatingWindow = memo(
    ({
        isOpen,
        onClose,
        referenceElement,
    }: {
        isOpen: boolean;
        onClose: () => void;
        referenceElement: HTMLElement;
    }) => {
        const { t } = useTranslation();
        const { refs, floatingStyles, context } = useFloating({
            open: isOpen,
            onOpenChange: onClose,
            placement: "right-start",
            middleware: [offset(-2), shift({ padding: 12 })],
            whileElementsMounted: autoUpdate,
            elements: {
                reference: referenceElement,
            },
        });

        const dismiss = useDismiss(context);
        const { getFloatingProps } = useInteractions([dismiss]);

        if (!isOpen) return null;

        const menuItems = [
            {
                icon: "gear",
                label: t("workspace.menu.settings"),
                onClick: () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "waveconfig",
                        },
                    };
                    createBlock(blockDef, false, true);
                    onClose();
                },
            },
            {
                icon: "palette",
                label: t("workspace.menu.appearance"),
                onClick: () => {
                    modalsModel.pushModal("AboutModal");
                    onClose();
                },
            },
            {
                icon: "lightbulb",
                label: t("workspace.menu.tips"),
                onClick: () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "tips",
                        },
                    };
                    createBlock(blockDef, true, true);
                    onClose();
                },
            },
            {
                icon: "lock",
                label: t("workspace.menu.secrets"),
                onClick: () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "waveconfig",
                            file: "secrets",
                        },
                    };
                    createBlock(blockDef, false, true);
                    onClose();
                },
            },
            {
                icon: "circle-question",
                label: t("workspace.menu.help"),
                onClick: () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "help",
                        },
                    };
                    createBlock(blockDef);
                    onClose();
                },
            },
        ];

        return (
            <FloatingPortal>
                <div
                    ref={refs.setFloating}
                    style={floatingStyles}
                    {...getFloatingProps()}
                    className="bg-modalbg border border-border rounded-lg shadow-xl p-2 z-50"
                >
                    {menuItems.map((item, idx) => (
                        <div
                            key={idx}
                            className="flex items-center gap-3 px-3 py-2 rounded hover:bg-hoverbg cursor-pointer transition-colors text-secondary hover:text-white"
                            onClick={item.onClick}
                        >
                            <div className="text-lg w-5 flex justify-center">
                                <i className={makeIconClass(item.icon, false)}></i>
                            </div>
                            <div className="text-sm whitespace-nowrap">{item.label}</div>
                        </div>
                    ))}
                </div>
            </FloatingPortal>
        );
    }
);

GitFloatingWindow.displayName = "GitFloatingWindow";
SettingsFloatingWindow.displayName = "SettingsFloatingWindow";

const Widgets = memo(() => {
    const { t } = useTranslation();
    const fallbackFullConfigAtom = useMemo(() => atom<FullConfigType>(null), []);
    const fallbackHasCustomAIPresetsAtom = useMemo(() => atom(false), []);
    const fallbackWorkspaceAtom = useMemo(() => atom<Workspace | null>(null), []);
    const fullConfig = useAtomValue(atoms?.fullConfigAtom ?? fallbackFullConfigAtom);
    const workspace = useAtomValue(atoms?.workspace ?? fallbackWorkspaceAtom);
    const hasCustomAIPresets = useAtomValue(atoms?.hasCustomAIPresetsAtom ?? fallbackHasCustomAIPresetsAtom);
    const [mode, setMode] = useState<"normal" | "compact" | "supercompact">("normal");
    const containerRef = useRef<HTMLDivElement>(null);
    const measurementRef = useRef<HTMLDivElement>(null);

    const featureWaveAppBuilder = fullConfig?.settings?.["feature:waveappbuilder"] ?? false;
    const widgetsMap = fullConfig?.widgets ?? {};
    const filteredWidgets = useMemo(() => {
        return Object.fromEntries(
            Object.entries(widgetsMap).filter(([key, widget]) => {
                if (!hasCustomAIPresets && key === "defwidget@ai") {
                    return false;
                }
                if (isExplorerWidget(widget)) {
                    return false;
                }
                return shouldIncludeWidgetForWorkspace(widget, workspace?.oid);
            })
        );
    }, [hasCustomAIPresets, widgetsMap, workspace?.oid]);
    const widgets = sortByDisplayOrder(filteredWidgets);

    const [isAppsOpen, setIsAppsOpen] = useState(false);
    const appsButtonRef = useRef<HTMLDivElement>(null);
    const focusedBlockId = useAtomValue(FocusManager.getInstance().blockFocusAtom);
    const [focusedBlockData] = WOS.useWaveObjectValue<Block>(focusedBlockId ? WOS.makeORef("block", focusedBlockId) : null);

    const launchAiCommand = useCallback(
        (command: string) => {
            const isFocusedTerm = focusedBlockData?.meta?.view === "term";
            const targetBlockId = isFocusedTerm ? focusedBlockId : null;
            if (!isBlank(targetBlockId) && !isBlank(command)) {
                fireAndForget(async () => {
                    await RpcApi.SetMetaCommand(TabRpcClient, {
                        oref: WOS.makeORef("block", targetBlockId),
                        meta: { "term:autoCmd": command } as any,
                    });
                    await RpcApi.ControllerInputCommand(TabRpcClient, {
                        blockid: targetBlockId,
                        inputdata64: stringToBase64(`${command}\n`),
                    });
                });
                return;
            }

            const meta: Record<string, any> = {
                controller: "shell",
                view: "term",
            };
            const cwd = focusedBlockData?.meta?.["cmd:cwd"];
            const connection = focusedBlockData?.meta?.connection;
            if (!isBlank(cwd)) {
                meta["cmd:cwd"] = cwd;
            }
            if (!isBlank(connection)) {
                meta.connection = connection;
            }
            if (!isBlank(command)) {
                meta["term:autoCmd"] = command;
                meta["cmd:initscript"] = `${command}\n`;
            }
            fireAndForget(async () => {
                await createBlock({ meta }, false, true);
            });
        },
        [focusedBlockData, focusedBlockId]
    );

    const showAiLauncherMenu = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const menu: ContextMenuItem[] = AI_LAUNCH_COMMANDS.map((item) => ({
                label: t("preview.openAiHere", { ai: item.label }),
                click: () => launchAiCommand(item.command),
            }));
            ContextMenuModel.showContextMenu(menu, e);
        },
        [launchAiCommand, t]
    );

    const openGitBlock = useCallback(() => {
        WorkspaceLayoutModel.getInstance().toggleSidePanelView("git");
    }, []);

    const normalizePathForScope = useCallback((pathValue: string): string => {
        const rawPath = typeof pathValue === "string" ? pathValue.trim() : "";
        if (!rawPath) {
            return "";
        }
        let normalizedPath = rawPath;
        if (normalizedPath.length > 1) {
            normalizedPath = normalizedPath.replace(/[\\/]+$/, "");
        }
        if (/^[A-Za-z]:$/.test(normalizedPath)) {
            normalizedPath = `${normalizedPath}\\`;
        }
        normalizedPath = normalizedPath.replace(/\\/g, "/");
        const isUncPath = normalizedPath.startsWith("//");
        if (isUncPath) {
            normalizedPath = `//${normalizedPath.slice(2).replace(/\/{2,}/g, "/")}`;
        } else {
            normalizedPath = normalizedPath.replace(/\/{2,}/g, "/");
        }
        if (/^[A-Za-z]:\//.test(normalizedPath)) {
            normalizedPath = `${normalizedPath[0].toLowerCase()}${normalizedPath.slice(1)}`;
        }
        return normalizedPath;
    }, []);

    const getScopeFromTermBlock = useCallback(
        (blockData: Block | null | undefined): string => {
            if (blockData?.meta?.view !== "term") {
                return "";
            }
            const normalizedPath = normalizePathForScope(String(blockData?.meta?.["cmd:cwd"] ?? ""));
            if (!normalizedPath) {
                return "";
            }
            const connectionName = String(blockData?.meta?.connection ?? "local").trim() || "local";
            return `${connectionName}::${normalizedPath}`;
        },
        [normalizePathForScope]
    );

    const resolveClawXPathScope = useCallback((): string => {
        const focusedScope = getScopeFromTermBlock(focusedBlockData);
        if (focusedScope) {
            return focusedScope;
        }
        const tabId = globalStore.get(atoms.staticTabId);
        if (isBlank(tabId)) {
            return "__tab__";
        }
        const tabAtom = WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId));
        const tabData = globalStore.get(tabAtom);
        const blockIds: string[] = tabData?.blockids ?? [];
        for (const blockId of blockIds) {
            const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
            const blockData = globalStore.get(blockAtom);
            const scopeValue = getScopeFromTermBlock(blockData);
            if (scopeValue) {
                return scopeValue;
            }
        }
        return "__tab__";
    }, [focusedBlockData, getScopeFromTermBlock]);

    const appendClawXScopeQuery = useCallback((url: string, scopeValue: string): string => {
        if (isBlank(url)) {
            return url;
        }
        try {
            const parsedUrl = new URL(url);
            parsedUrl.searchParams.set("wave_scope", scopeValue);
            parsedUrl.searchParams.set("wave_source", "waveterm");
            return parsedUrl.toString();
        } catch {
            return url;
        }
    }, []);

    const openClawXBlock = useCallback((url?: string) => {
        const scopeValue = resolveClawXPathScope();
        const meta: Record<string, any> = {
            view: "clawx",
            "clawx:pathscope": scopeValue,
        };
        if (!isBlank(url)) {
            meta.url = appendClawXScopeQuery(url, scopeValue);
        }
        fireAndForget(async () => {
            await createBlock({ meta });
        });
    }, [appendClawXScopeQuery, resolveClawXPathScope]);

    const showClawXLauncherMenu = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const menu: ContextMenuItem[] = [
                {
                    label: t("workspace.openClawxDefault"),
                    click: () => openClawXBlock(),
                },
                {
                    label: t("workspace.openClawxLocal"),
                    click: () => openClawXBlock(CLAWX_LOCAL_URL),
                },
                {
                    label: t("workspace.openClawxLocalhost"),
                    click: () => openClawXBlock(CLAWX_LOCALHOST_URL),
                },
            ];
            ContextMenuModel.showContextMenu(menu, e);
        },
        [openClawXBlock, t]
    );

    const openSettingsPanel = useCallback(() => {
        const blockDef: BlockDef = {
            meta: {
                view: "waveconfig",
            },
        };
        fireAndForget(async () => {
            await createBlock(blockDef, false, true);
        });
    }, []);

    const checkModeNeeded = useCallback(() => {
        if (!containerRef.current || !measurementRef.current) return;

        const containerHeight = containerRef.current.clientHeight;
        const normalHeight = measurementRef.current.scrollHeight;
        const gracePeriod = 10;

        let newMode: "normal" | "compact" | "supercompact" = "normal";

        if (normalHeight > containerHeight - gracePeriod) {
            newMode = "compact";

            // Calculate total widget count for supercompact check
            const utilityWidgets = (isDev() || featureWaveAppBuilder) ? 6 : 5;
            const totalWidgets = (widgets?.length || 0) + utilityWidgets;
            const minHeightPerWidget = 32;
            const requiredHeight = totalWidgets * minHeightPerWidget;

            if (requiredHeight > containerHeight) {
                newMode = "supercompact";
            }
        }

        if (newMode !== mode) {
            setMode(newMode);
        }
    }, [featureWaveAppBuilder, mode, widgets]);

    useEffect(() => {
        const resizeObserver = new ResizeObserver(() => {
            checkModeNeeded();
        });

        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        return () => {
            resizeObserver.disconnect();
        };
    }, [checkModeNeeded]);

    useEffect(() => {
        checkModeNeeded();
    }, [widgets, focusedBlockId, checkModeNeeded]);

    const handleWidgetsBarContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        const menu: ContextMenuItem[] = [
            {
                label: t("workspace.menu.editWidgetsJson"),
                click: () => {
                    fireAndForget(async () => {
                        const blockDef: BlockDef = {
                            meta: {
                                view: "waveconfig",
                                file: "widgets.json",
                            },
                        };
                        await createBlock(blockDef, false, true);
                    });
                },
            },
        ];
        ContextMenuModel.showContextMenu(menu, e);
    };

    return (
        <>
            <div
                ref={containerRef}
                className="flex flex-col w-12 overflow-hidden py-1 -ml-1 select-none"
                onContextMenu={handleWidgetsBarContextMenu}
            >
                {mode === "supercompact" ? (
                    <>
                        <div className="grid grid-cols-2 gap-0 w-full">
                            {widgets?.map((data, idx) => (
                                <Widget key={`widget-${idx}`} widget={data} mode={mode} />
                            ))}
                        </div>
                        <div className="flex-grow" />
                        <div className="grid grid-cols-2 gap-0 w-full">
                            <ExplorerConnectionButton mode={mode} />
                            {isDev() || featureWaveAppBuilder ? (
                                <div
                                    ref={appsButtonRef}
                                    className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-sm overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                                    onClick={() => {
                                        setIsAppsOpen((prev) => !prev);
                                    }}
                                >
                                    <Tooltip
                                        content={t("workspace.localWaveAppsTooltip")}
                                        placement="right"
                                        disable={isAppsOpen}
                                    >
                                        <div>
                                            <i className={makeIconClass("cube", true)}></i>
                                        </div>
                                    </Tooltip>
                                </div>
                            ) : null}
                            <div
                                className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-sm overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                                onClick={() => {
                                    openGitBlock();
                                    setIsAppsOpen(false);
                                }}
                            >
                                <Tooltip content={t("workspace.git")} placement="right" disable={false}>
                                    <div>
                                        <i className={makeIconClass("code-branch", true)}></i>
                                    </div>
                                </Tooltip>
                            </div>
                            <div
                                className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-sm overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                                onClick={() => {
                                    openClawXBlock(CLAWX_LOCAL_URL);
                                    setIsAppsOpen(false);
                                }}
                                onContextMenu={showClawXLauncherMenu}
                            >
                                <Tooltip content={t("workspace.clawxTooltip")} placement="right" disable={false}>
                                    <div>
                                        <i className={makeIconClass(CLAWX_ICON, true)}></i>
                                    </div>
                                </Tooltip>
                            </div>
                            <div
                                className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-sm overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                                onClick={showAiLauncherMenu}
                            >
                                <Tooltip content={t("preview.openWithAi")} placement="right" disable={false}>
                                    <div>
                                        <i className={makeIconClass("robot", true)}></i>
                                    </div>
                                </Tooltip>
                            </div>
                            <div
                                className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-sm overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                                onClick={() => {
                                    openSettingsPanel();
                                    setIsAppsOpen(false);
                                }}
                            >
                                <Tooltip
                                    content={t("workspace.settingsHelpTooltip")}
                                    placement="right"
                                    disable={false}
                                >
                                    <div>
                                        <i className={makeIconClass("gear", true)}></i>
                                    </div>
                                </Tooltip>
                            </div>
                        </div>
                    </>
                ) : (
                    <>
                        {widgets?.map((data, idx) => (
                            <Widget key={`widget-${idx}`} widget={data} mode={mode} />
                        ))}
                        <div className="flex-grow" />
                        <ExplorerConnectionButton mode={mode} />
                        {isDev() || featureWaveAppBuilder ? (
                            <div
                                ref={appsButtonRef}
                                className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-lg overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                                onClick={() => {
                                    setIsAppsOpen((prev) => !prev);
                                }}
                            >
                                <Tooltip content={t("workspace.localWaveAppsTooltip")} placement="right" disable={isAppsOpen}>
                                    <div className="flex flex-col items-center w-full">
                                        <div>
                                            <i className={makeIconClass("cube", true)}></i>
                                        </div>
                                        {mode === "normal" && (
                                            <div className="text-xxs mt-0.5 w-full px-0.5 text-center whitespace-nowrap overflow-hidden text-ellipsis">
                                                {t("workspace.apps")}
                                            </div>
                                        )}
                                    </div>
                                </Tooltip>
                            </div>
                        ) : null}
                        <div
                            className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-lg overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                            onClick={() => {
                                openGitBlock();
                                setIsAppsOpen(false);
                            }}
                        >
                            <Tooltip content={t("workspace.git")} placement="right" disable={false}>
                                <div className="flex flex-col items-center w-full">
                                    <div>
                                        <i className={makeIconClass("code-branch", true)}></i>
                                    </div>
                                    {mode === "normal" && (
                                        <div className="text-xxs mt-0.5 w-full px-0.5 text-center whitespace-nowrap overflow-hidden text-ellipsis">
                                            {t("workspace.git")}
                                        </div>
                                    )}
                                </div>
                            </Tooltip>
                        </div>
                        <div
                            className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-lg overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                            onClick={() => {
                                openClawXBlock(CLAWX_LOCAL_URL);
                                setIsAppsOpen(false);
                            }}
                            onContextMenu={showClawXLauncherMenu}
                        >
                            <Tooltip content={t("workspace.clawxTooltip")} placement="right" disable={false}>
                                <div className="flex flex-col items-center w-full">
                                    <div>
                                        <i className={makeIconClass(CLAWX_ICON, true)}></i>
                                    </div>
                                    {mode === "normal" && (
                                        <div className="text-xxs mt-0.5 w-full px-0.5 text-center whitespace-nowrap overflow-hidden text-ellipsis">
                                            {t("workspace.clawx")}
                                        </div>
                                    )}
                                </div>
                            </Tooltip>
                        </div>
                        <div
                            className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-lg overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                            onClick={showAiLauncherMenu}
                        >
                            <Tooltip content={t("preview.openWithAi")} placement="right" disable={false}>
                                <div className="flex flex-col items-center w-full">
                                    <div>
                                        <i className={makeIconClass("robot", true)}></i>
                                    </div>
                                    {mode === "normal" && (
                                        <div className="text-xxs mt-0.5 w-full px-0.5 text-center whitespace-nowrap overflow-hidden text-ellipsis">
                                            {t("workspace.ai")}
                                        </div>
                                    )}
                                </div>
                            </Tooltip>
                        </div>
                        <div
                            className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-lg overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                            onClick={() => {
                                openSettingsPanel();
                                setIsAppsOpen(false);
                            }}
                        >
                            <Tooltip content={t("workspace.settingsHelpTooltip")} placement="right" disable={false}>
                                <div>
                                    <i className={makeIconClass("gear", true)}></i>
                                </div>
                            </Tooltip>
                        </div>
                    </>
                )}
                {isDev() ? (
                    <div
                        className="flex justify-center items-center w-full py-1 text-accent text-[30px]"
                        title={t("workspace.runningDevBuild")}
                    >
                        <i className="fa fa-brands fa-dev fa-fw" />
                    </div>
                ) : null}
            </div>
            {(isDev() || featureWaveAppBuilder) && appsButtonRef.current && (
                <AppsFloatingWindow
                    isOpen={isAppsOpen}
                    onClose={() => setIsAppsOpen(false)}
                    referenceElement={appsButtonRef.current}
                />
            )}

            <div
                ref={measurementRef}
                className="flex flex-col w-12 py-1 -ml-1 select-none absolute -z-10 opacity-0 pointer-events-none"
            >
                {widgets?.map((data, idx) => (
                    <Widget key={`measurement-widget-${idx}`} widget={data} mode="normal" />
                ))}
                <div className="flex-grow" />
                <ExplorerConnectionButton mode="normal" />
                <div className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-lg">
                    <div>
                        <i className={makeIconClass("code-branch", true)}></i>
                    </div>
                    <div className="text-xxs mt-0.5 w-full px-0.5 text-center">{t("workspace.git")}</div>
                </div>
                <div className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-lg">
                    <div>
                        <i className={makeIconClass("robot", true)}></i>
                    </div>
                    <div className="text-xxs mt-0.5 w-full px-0.5 text-center">{t("workspace.ai")}</div>
                </div>
                <div className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-lg">
                    <div>
                        <i className={makeIconClass(CLAWX_ICON, true)}></i>
                    </div>
                    <div className="text-xxs mt-0.5 w-full px-0.5 text-center">{t("workspace.clawx")}</div>
                </div>
                <div className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-lg">
                    <div>
                        <i className={makeIconClass("gear", true)}></i>
                    </div>
                    <div className="text-xxs mt-0.5 w-full px-0.5 text-center">{t("workspace.menu.settings")}</div>
                </div>
                {isDev() ? (
                    <div className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-lg">
                        <div>
                            <i className={makeIconClass("cube", true)}></i>
                        </div>
                        <div className="text-xxs mt-0.5 w-full px-0.5 text-center">{t("workspace.apps")}</div>
                    </div>
                ) : null}
                {isDev() ? (
                    <div
                        className="flex justify-center items-center w-full py-1 text-accent text-[30px]"
                        title={t("workspace.runningDevBuild")}
                    >
                        <i className="fa fa-brands fa-dev fa-fw" />
                    </div>
                ) : null}
            </div>
        </>
    );
});

export { Widgets };

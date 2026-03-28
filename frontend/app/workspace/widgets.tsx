// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    resolveCodexResumeTargetBlock,
    runCodexResumeSequence,
    waitForCodexResumeToBecomeInteractive,
    type CodexResumeShellState,
} from "@/app/block/codex-resume";
import { ConnectionButton } from "@/app/block/connectionbutton";
import { Tooltip } from "@/app/element/tooltip";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { FocusManager } from "@/app/store/focusManager";
import {
    atoms,
    createBlock,
    getBlockComponentModel,
    globalStore,
    isDev,
    pushFlashError,
    recordTEvent,
    useBlockAtom,
    WOS,
} from "@/app/store/global";
import { modalsModel } from "@/app/store/modalmodel";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { shouldIncludeWidgetForWorkspace } from "@/app/workspace/widgetfilter";
import { getUtilityWidgetCount, getWidgetBarMode, type WidgetBarMode } from "@/app/workspace/widgets-layout";
import { fireAndForget, isBlank, makeIconClass, stringToBase64 } from "@/util/util";
import {
    autoUpdate,
    FloatingPortal,
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

async function handleWidgetSelect(widget: WidgetConfigType) {
    const blockDef = widget.blockdef;
    createBlock(blockDef, widget.magnified);
}

const Widget = memo(({ widget, mode }: { widget: WidgetConfigType; mode: WidgetBarMode }) => {
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

const ExplorerConnectionButton = memo(({ mode }: { mode: WidgetBarMode }) => {
    const focusedBlockId = useAtomValue(FocusManager.getInstance().blockFocusAtom);
    if (!focusedBlockId) {
        return null;
    }
    return <ExplorerConnectionButtonInner blockId={focusedBlockId} mode={mode} />;
});

ExplorerConnectionButton.displayName = "ExplorerConnectionButton";

const ExplorerConnectionButtonInner = memo(({ blockId, mode }: { blockId: string; mode: WidgetBarMode }) => {
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
});

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

SettingsFloatingWindow.displayName = "SettingsFloatingWindow";

const Widgets = memo(() => {
    const { t } = useTranslation();
    const fallbackFullConfigAtom = useMemo(() => atom<FullConfigType>(null), []);
    const fallbackHasCustomAIPresetsAtom = useMemo(() => atom(false), []);
    const fallbackWorkspaceAtom = useMemo(() => atom<Workspace | null>(null), []);
    const fallbackStaticTabIdAtom = useMemo(() => atom(""), []);
    const fullConfig = useAtomValue(atoms?.fullConfigAtom ?? fallbackFullConfigAtom);
    const workspace = useAtomValue(atoms?.workspace ?? fallbackWorkspaceAtom);
    const hasCustomAIPresets = useAtomValue(atoms?.hasCustomAIPresetsAtom ?? fallbackHasCustomAIPresetsAtom);
    const [mode, setMode] = useState<WidgetBarMode>("normal");
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
    const activeTabId = useAtomValue(atoms?.staticTabId ?? fallbackStaticTabIdAtom);
    const [activeTabData] = WOS.useWaveObjectValue<Tab>(activeTabId ? WOS.makeORef("tab", activeTabId) : null);
    const focusedBlockId = useAtomValue(FocusManager.getInstance().blockFocusAtom);
    const [focusedBlockData] = WOS.useWaveObjectValue<Block>(
        focusedBlockId ? WOS.makeORef("block", focusedBlockId) : null
    );
    const showAppsButton = isDev() || featureWaveAppBuilder;
    const showExplorerConnectionButton =
        focusedBlockData?.meta?.view === "preview" && !!focusedBlockData?.meta?.["preview:explorer"];
    const showDevBadge = isDev();
    const getBlockData = useCallback((blockId: string): Block | undefined => {
        if (isBlank(blockId)) {
            return undefined;
        }
        const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
        return globalStore.get(blockAtom);
    }, []);
    const getShellState = useCallback((blockId: string): CodexResumeShellState => {
        if (isBlank(blockId)) {
            return null;
        }
        const shellStateAtom = useBlockAtom(blockId, "term:shellstate", () => atom<CodexResumeShellState>(null));
        return globalStore.get(shellStateAtom);
    }, []);
    const getOutputTs = useCallback((blockId: string): number => {
        if (isBlank(blockId)) {
            return 0;
        }
        const outputTsAtom = useBlockAtom(blockId, "term:lastoutputts", () => atom<number>(0));
        const outputTs = Number(globalStore.get(outputTsAtom));
        return Number.isFinite(outputTs) && outputTs > 0 ? outputTs : 0;
    }, []);
    const getBlockCodexResumeLines = useCallback(async (blockId: string): Promise<string[]> => {
        try {
            const result = await RpcApi.TermGetScrollbackLinesCommand(
                TabRpcClient,
                { linestart: 0, lineend: 160, lastcommand: false },
                { route: `feblock:${blockId}` }
            );
            return result?.lines ?? [];
        } catch {
            return [];
        }
    }, []);
    const waitForBlockCodexResumeToBecomeInteractive = useCallback(
        async (blockId: string, baselineOutputTs: number) => {
            await waitForCodexResumeToBecomeInteractive({
                getSnapshot: async () => ({
                    shellState: getShellState(blockId),
                    outputTs: getOutputTs(blockId),
                    baselineOutputTs,
                    lines: await getBlockCodexResumeLines(blockId),
                }),
            });
        },
        [getBlockCodexResumeLines, getOutputTs, getShellState]
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

    const handleResumeCodexForCurrentTab = useCallback(() => {
        const tabBlockIds = activeTabData?.blockids ?? [];
        const { eligibleBlockIds, targetBlockId } = resolveCodexResumeTargetBlock(
            tabBlockIds,
            focusedBlockId,
            getBlockData,
            getShellState
        );
        if (targetBlockId == null) {
            pushFlashError({
                id: "",
                icon: "triangle-exclamation",
                title: "Codex resume unavailable",
                message: "当前页没有可恢复的本地终端。",
                expiration: Date.now() + 7000,
            });
            return;
        }
        fireAndForget(async () => {
            try {
                const baselineOutputTs = getOutputTs(targetBlockId);
                await runCodexResumeSequence(
                    (input) =>
                        RpcApi.ControllerInputCommand(TabRpcClient, {
                            blockid: targetBlockId,
                            inputdata64: stringToBase64(input),
                        }),
                    {
                        waitUntilReadyForFollowup: () =>
                            waitForBlockCodexResumeToBecomeInteractive(targetBlockId, baselineOutputTs),
                    }
                );
                recordTEvent("action:codexresume");
                if (eligibleBlockIds.length > 1) {
                    pushFlashError({
                        id: "",
                        icon: "circle-info",
                        title: "Codex resume narrowed",
                        message: `当前页有 ${eligibleBlockIds.length} 个可恢复终端。为避免同时拉起多套 Codex，本次只恢复 1 个；如需恢复其他终端，请先聚焦对应块再点一次。`,
                        expiration: Date.now() + 7000,
                    });
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                pushFlashError({
                    id: "",
                    icon: "triangle-exclamation",
                    title: "Codex resume failed",
                    message,
                    expiration: Date.now() + 7000,
                });
            }
        });
    }, [
        activeTabData?.blockids,
        focusedBlockId,
        getBlockData,
        getOutputTs,
        getShellState,
        waitForBlockCodexResumeToBecomeInteractive,
    ]);

    const checkModeNeeded = useCallback(() => {
        if (!containerRef.current || !measurementRef.current) return;

        const containerHeight = containerRef.current.clientHeight;
        const normalHeight = measurementRef.current.scrollHeight;
        const utilityWidgets = getUtilityWidgetCount({
            showAppsButton,
            showDevIndicator: showDevBadge,
            showExplorerConnection: showExplorerConnectionButton,
        });
        const newMode = getWidgetBarMode({
            containerHeight,
            normalHeight,
            widgetCount: widgets?.length || 0,
            utilityWidgetCount: utilityWidgets,
        });

        if (newMode !== mode) {
            setMode(newMode);
        }
    }, [mode, showAppsButton, showDevBadge, showExplorerConnectionButton, widgets]);

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
                className={clsx(
                    "flex flex-col w-12 overflow-x-hidden py-1 -ml-1 select-none",
                    mode === "supercompact" ? "overflow-y-auto" : "overflow-hidden"
                )}
                onContextMenu={handleWidgetsBarContextMenu}
            >
                {mode === "supercompact" ? (
                    <>
                        <div className="flex flex-col w-full">
                            {widgets?.map((data, idx) => (
                                <Widget key={`widget-${idx}`} widget={data} mode={mode} />
                            ))}
                        </div>
                        <div className="flex-grow" />
                        <div className="flex flex-col w-full">
                            <ExplorerConnectionButton mode={mode} />
                            {showAppsButton ? (
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
                                onClick={handleResumeCodexForCurrentTab}
                            >
                                <Tooltip
                                    content="恢复当前焦点终端（或当前页首个可恢复终端）的最近 Codex 会话"
                                    placement="right"
                                    disable={false}
                                >
                                    <div>
                                        <i className={makeIconClass("clock-rotate-left", true)}></i>
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
                                <Tooltip content={t("workspace.settingsHelpTooltip")} placement="right" disable={false}>
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
                        {showAppsButton ? (
                            <div
                                ref={appsButtonRef}
                                className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-secondary text-lg overflow-hidden rounded-sm hover:bg-hoverbg hover:text-white cursor-pointer"
                                onClick={() => {
                                    setIsAppsOpen((prev) => !prev);
                                }}
                            >
                                <Tooltip
                                    content={t("workspace.localWaveAppsTooltip")}
                                    placement="right"
                                    disable={isAppsOpen}
                                >
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
                            onClick={handleResumeCodexForCurrentTab}
                        >
                            <Tooltip
                                content="恢复当前焦点终端（或当前页首个可恢复终端）的最近 Codex 会话"
                                placement="right"
                                disable={false}
                            >
                                <div className="flex flex-col items-center w-full">
                                    <div>
                                        <i className={makeIconClass("clock-rotate-left", true)}></i>
                                    </div>
                                    {mode === "normal" && (
                                        <div className="text-xxs mt-0.5 w-full px-0.5 text-center whitespace-nowrap overflow-hidden text-ellipsis">
                                            Resume
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
                {showDevBadge ? (
                    <div
                        className="flex justify-center items-center w-full py-1 text-accent text-[30px]"
                        title={t("workspace.runningDevBuild")}
                    >
                        <i className="fa fa-brands fa-dev fa-fw" />
                    </div>
                ) : null}
            </div>
            {showAppsButton && appsButtonRef.current && (
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
                {showAppsButton ? (
                    <div className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-lg">
                        <div>
                            <i className={makeIconClass("cube", true)}></i>
                        </div>
                        <div className="text-xxs mt-0.5 w-full px-0.5 text-center">{t("workspace.apps")}</div>
                    </div>
                ) : null}
                <div className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-lg">
                    <div>
                        <i className={makeIconClass("clock-rotate-left", true)}></i>
                    </div>
                    <div className="text-xxs mt-0.5 w-full px-0.5 text-center">Resume</div>
                </div>
                <div className="flex flex-col justify-center items-center w-full py-1.5 pr-0.5 text-lg">
                    <div>
                        <i className={makeIconClass("gear", true)}></i>
                    </div>
                    <div className="text-xxs mt-0.5 w-full px-0.5 text-center">{t("workspace.menu.settings")}</div>
                </div>
                {showDevBadge ? (
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

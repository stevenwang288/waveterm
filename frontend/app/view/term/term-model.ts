// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveAIModel } from "@/app/aipanel/waveai-model";
import { BlockNodeModel } from "@/app/block/blocktypes";
import i18next from "@/app/i18n";
import { appHandleKeyDown } from "@/app/store/keymodel";
import { modalsModel } from "@/app/store/modalmodel";
import type { TabModel } from "@/app/store/tab-model";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { FavoriteItem, FavoritesModel } from "@/app/store/favorites-model";
import { makeFeBlockRouteId } from "@/app/store/wshrouter";
import { DefaultRouter, TabRpcClient } from "@/app/store/wshrpcutil";
import { TerminalView } from "@/app/view/term/term";
import { TermWshClient } from "@/app/view/term/term-wsh";
import { VDomModel } from "@/app/view/vdom/vdom-model";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { openCliLayoutInNewTab } from "@/util/clilayout";
import {
    atoms,
    createBlock,
    createBlockSplitHorizontally,
    createBlockSplitVertically,
    getAllBlockComponentModels,
    getApi,
    getBlockComponentModel,
    getBlockMetaKeyAtom,
    getBlockTermDurableAtom,
    getConnStatusAtom,
    getOverrideConfigAtom,
    getSettingsKeyAtom,
    globalStore,
    readAtom,
    recordTEvent,
    useBlockAtom,
    WOS,
} from "@/store/global";
import * as services from "@/store/services";
import * as keyutil from "@/util/keyutil";
import { isMacOS, isWindows } from "@/util/platformutil";
import { base64ToString, boundNumber, fireAndForget, isBlank, stringToBase64 } from "@/util/util";
import * as jotai from "jotai";
import * as React from "react";
import { getBlockingCommand } from "./shellblocking";
import { computeTheme, DefaultTermTheme } from "./termutil";
import { TermWrap } from "./termwrap";

const AI_LAUNCH_COMMANDS: Array<{ label: string; command: string }> = [
    { label: "Codex", command: "codex" },
    { label: "Claude", command: "claude" },
    { label: "Gemini", command: "gemini" },
    { label: "Amp", command: "amp" },
    { label: "IFlow", command: "iflow" },
    { label: "OpenCode", command: "opencode" },
    { label: "ClawX", command: "clawx" },
];

const BUILTIN_TERM_THEME_DISPLAY_NAME_TO_I18N_KEY: Record<string, string> = {
    "Default Dark": "term.themeNames.defaultDark",
    "One Dark Pro": "term.themeNames.oneDarkPro",
    Dracula: "term.themeNames.dracula",
    Monokai: "term.themeNames.monokai",
    Campbell: "term.themeNames.campbell",
    "Warm Yellow": "term.themeNames.warmYellow",
    "Rose Pine": "term.themeNames.rosePine",
};

function translateBuiltinTermThemeDisplayName(displayName: string): string {
    const key = BUILTIN_TERM_THEME_DISPLAY_NAME_TO_I18N_KEY[displayName];
    if (!key) {
        return displayName;
    }
    const translated = i18next.t(key);
    return translated === key ? displayName : translated;
}

function getTermThemeMenuLabel(themeName: string, theme: Record<string, any> | undefined): string {
    const displayName = theme?.["display:name"] ?? themeName;
    return translateBuiltinTermThemeDisplayName(displayName);
}

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
    name?: string;
};

type CliLayoutConfigFile = {
    version: number;
    lastPresetKey?: string;
    presets: Record<string, CliLayoutPresetState>;
    savedLayouts?: Record<string, CliLayoutPresetState>;
};

const CLI_LAYOUT_PRESETS: CliLayoutPreset[] = [
    { key: "2", label: "两分屏", rows: 1, cols: 2 },
    { key: "3", label: "三分屏", rows: 1, cols: 3 },
    { key: "4", label: "四分屏", rows: 2, cols: 2 },
    { key: "6", label: "六分屏", rows: 2, cols: 3 },
    { key: "6-2col", label: "六分屏（2列）", rows: 3, cols: 2 },
    { key: "8", label: "八分屏", rows: 2, cols: 4 },
    { key: "8-2col", label: "八分屏（2列）", rows: 4, cols: 2 },
    { key: "9", label: "九分屏", rows: 3, cols: 3 },
];
const INPUT_RESTART_COOLDOWN_MS = 1200;

function getCliLayoutPresetLabel(preset: CliLayoutPreset): string {
    const key = `clilayout.presets.${preset.key}`;
    const translated = i18next.t(key);
    return translated === key ? preset.label : translated;
}

function isCategoryPath(path: string): boolean {
    return path.endsWith("/__category__") || path.endsWith("\\__category__");
}

function normalizeConnectionName(connection?: string): string {
    const cleaned = connection?.trim();
    return cleaned ? cleaned : "";
}

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

export class TermViewModel implements ViewModel {
    viewType: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    connected: boolean;
    termRef: React.RefObject<TermWrap> = { current: null };
    blockAtom: jotai.Atom<Block>;
    termMode: jotai.Atom<string>;
    blockId: string;
    viewIcon: jotai.Atom<IconButtonDecl>;
    viewName: jotai.Atom<string>;
    viewText: jotai.Atom<HeaderElem[]>;
    blockBg: jotai.Atom<MetaType>;
    manageConnection: jotai.Atom<boolean>;
    filterOutNowsh?: jotai.Atom<boolean>;
    connStatus: jotai.Atom<ConnStatus>;
    useTermHeader: jotai.Atom<boolean>;
    termWshClient: TermWshClient;
    vdomBlockId: jotai.Atom<string>;
    vdomToolbarBlockId: jotai.Atom<string>;
    vdomToolbarTarget: jotai.PrimitiveAtom<VDomTargetToolbar>;
    fontSizeAtom: jotai.Atom<number>;
    termThemeNameAtom: jotai.Atom<string>;
    termTransparencyAtom: jotai.Atom<number>;
    termBPMAtom: jotai.Atom<boolean>;
    noPadding: jotai.PrimitiveAtom<boolean>;
    endIconButtons: jotai.Atom<IconButtonDecl[]>;
    shellProcFullStatus: jotai.PrimitiveAtom<BlockControllerRuntimeStatus>;
    shellProcStatus: jotai.Atom<string>;
    shellProcStatusUnsubFn: () => void;
    blockJobStatusAtom: jotai.PrimitiveAtom<BlockJobStatusData>;
    blockJobStatusVersionTs: number;
    blockJobStatusUnsubFn: () => void;
    termBPMUnsubFn: () => void;
    isCmdController: jotai.Atom<boolean>;
    isRestarting: jotai.PrimitiveAtom<boolean>;
    termDurableStatus: jotai.Atom<BlockJobStatusData | null>;
    searchAtoms?: SearchAtoms;
    pendingInputQueue: string[] = [];
    isFlushingPendingInput: boolean = false;
    lastInputRestartTs: number = 0;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.viewType = "term";
        this.blockId = blockId;
        this.tabModel = tabModel;
        this.termWshClient = new TermWshClient(blockId, this);
        DefaultRouter.registerRoute(makeFeBlockRouteId(blockId), this.termWshClient);
        this.nodeModel = nodeModel;
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.vdomBlockId = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            return blockData?.meta?.["term:vdomblockid"];
        });
        this.vdomToolbarBlockId = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            return blockData?.meta?.["term:vdomtoolbarblockid"];
        });
        this.vdomToolbarTarget = jotai.atom<VDomTargetToolbar>(null) as jotai.PrimitiveAtom<VDomTargetToolbar>;
        this.termMode = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            return blockData?.meta?.["term:mode"] ?? "term";
        });
        this.isRestarting = jotai.atom(false);
        this.viewIcon = jotai.atom((get) => {
            const termMode = get(this.termMode);
            if (termMode == "vdom") {
                return { elemtype: "iconbutton", icon: "bolt" };
            }
            return { elemtype: "iconbutton", icon: "terminal" };
        });
        this.viewName = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            const termMode = get(this.termMode);
            if (termMode == "vdom") {
                return i18next.t("term.waveApp");
            }
            if (blockData?.meta?.controller == "cmd") {
                return "";
            }
            return "";
        });
        this.viewText = jotai.atom((get) => {
            const termMode = get(this.termMode);
            if (termMode == "vdom") {
                return [
                    {
                        elemtype: "iconbutton",
                        icon: "square-terminal",
                        title: i18next.t("term.switchBackToTerminal"),
                        click: () => {
                            this.setTermMode("term");
                        },
                    },
                ];
            }
            const vdomBlockId = get(this.vdomBlockId);
            const rtn: HeaderElem[] = [];
            if (vdomBlockId) {
                rtn.push({
                    elemtype: "iconbutton",
                    icon: "bolt",
                    title: i18next.t("term.switchToWaveApp"),
                    click: () => {
                        this.setTermMode("vdom");
                    },
                });
            }
            const isCmd = get(this.isCmdController);
            if (isCmd) {
                const blockMeta = get(this.blockAtom)?.meta;
                let cmdText = blockMeta?.["cmd"];
                let cmdArgs = blockMeta?.["cmd:args"];
                if (cmdArgs != null && Array.isArray(cmdArgs) && cmdArgs.length > 0) {
                    cmdText += " " + cmdArgs.join(" ");
                }
                rtn.push({
                    elemtype: "text",
                    text: cmdText,
                    noGrow: true,
                });
                const isRestarting = get(this.isRestarting);
                if (isRestarting) {
                    rtn.push({
                        elemtype: "iconbutton",
                        icon: "refresh",
                        iconColor: "var(--success-color)",
                        iconSpin: true,
                        title: i18next.t("term.restartingCommand"),
                        noAction: true,
                    });
                } else {
                    const fullShellProcStatus = get(this.shellProcFullStatus);
                    if (fullShellProcStatus?.shellprocstatus == "done") {
                        if (fullShellProcStatus?.shellprocexitcode == 0) {
                            rtn.push({
                                elemtype: "iconbutton",
                                icon: "check",
                                iconColor: "var(--success-color)",
                                title: i18next.t("term.commandExitedSuccessfully"),
                                noAction: true,
                            });
                        } else {
                            rtn.push({
                                elemtype: "iconbutton",
                                icon: "xmark-large",
                                iconColor: "var(--error-color)",
                                title: i18next.t("term.exitCode", {
                                    code: fullShellProcStatus?.shellprocexitcode,
                                }),
                                noAction: true,
                            });
                        }
                    }
                }
            }

            const isMI = get(this.tabModel.isTermMultiInput);
            if (isMI && this.isBasicTerm(get)) {
                rtn.push({
                    elemtype: "textbutton",
                    text: i18next.t("term.multiInputOn"),
                    className: "yellow !py-[2px] !px-[10px] text-[11px] font-[500]",
                    title: i18next.t("term.multiInputTitle"),
                    onClick: () => {
                        globalStore.set(this.tabModel.isTermMultiInput, false);
                    },
                });
            }
            return rtn;
        });
        this.manageConnection = jotai.atom((get) => {
            const termMode = get(this.termMode);
            if (termMode == "vdom") {
                return false;
            }
            const isCmd = get(this.isCmdController);
            if (isCmd) {
                return false;
            }
            return true;
        });
        this.useTermHeader = jotai.atom((get) => {
            const termMode = get(this.termMode);
            if (termMode == "vdom") {
                return false;
            }
            const isCmd = get(this.isCmdController);
            if (isCmd) {
                return false;
            }
            return true;
        });
        this.filterOutNowsh = jotai.atom(false);
        this.termBPMAtom = getOverrideConfigAtom(blockId, "term:allowbracketedpaste");
        this.termThemeNameAtom = useBlockAtom(blockId, "termthemeatom", () => {
            return jotai.atom<string>((get) => {
                return get(getOverrideConfigAtom(this.blockId, "term:theme")) ?? DefaultTermTheme;
            });
        });
        this.termTransparencyAtom = useBlockAtom(blockId, "termtransparencyatom", () => {
            return jotai.atom<number>((get) => {
                let value = get(getOverrideConfigAtom(this.blockId, "term:transparency")) ?? 0;
                return boundNumber(value, 0, 1);
            });
        });
        this.blockBg = jotai.atom((get) => {
            const fullConfig = get(atoms.fullConfigAtom);
            const themeName = get(this.termThemeNameAtom);
            const termTransparency = get(this.termTransparencyAtom);
            const [_, bgcolor] = computeTheme(fullConfig, themeName, termTransparency);
            if (bgcolor != null) {
                return { bg: bgcolor };
            }
            return null;
        });
        this.connStatus = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            const connName = blockData?.meta?.connection;
            const connAtom = getConnStatusAtom(connName);
            return get(connAtom);
        });
        this.fontSizeAtom = useBlockAtom(blockId, "fontsizeatom", () => {
            return jotai.atom<number>((get) => {
                const blockData = get(this.blockAtom);
                const fsSettingsAtom = getSettingsKeyAtom("term:fontsize");
                const settingsFontSize = get(fsSettingsAtom);
                const connName = blockData?.meta?.connection;
                const fullConfig = get(atoms.fullConfigAtom);
                const connFontSize = fullConfig?.connections?.[connName]?.["term:fontsize"];
                const rtnFontSize = blockData?.meta?.["term:fontsize"] ?? connFontSize ?? settingsFontSize ?? 12;
                if (typeof rtnFontSize != "number" || isNaN(rtnFontSize) || rtnFontSize < 4 || rtnFontSize > 64) {
                    return 12;
                }
                return rtnFontSize;
            });
        });
        this.noPadding = jotai.atom(true);
        this.endIconButtons = jotai.atom((get) => {
            const blockData = get(this.blockAtom);
            const shellProcStatus = get(this.shellProcStatus);
            const connStatus = get(this.connStatus);
            const isCmd = get(this.isCmdController);
            const rtn: IconButtonDecl[] = [];

            const isAIPanelOpen = get(WorkspaceLayoutModel.getInstance().panelVisibleAtom);
            if (isAIPanelOpen) {
                const shellIntegrationButton = this.getShellIntegrationIconButton(get);
                if (shellIntegrationButton) {
                    rtn.push(shellIntegrationButton);
                }
            }

            if (blockData?.meta?.["controller"] != "cmd" && shellProcStatus != "done") {
                return rtn;
            }
            if (connStatus?.status != "connected") {
                return rtn;
            }
            let iconName: string = null;
            let title: string = null;
            const noun = isCmd ? i18next.t("term.controllerNoun.command") : i18next.t("term.controllerNoun.shell");
            if (shellProcStatus == "init") {
                iconName = "play";
                title = i18next.t("term.controller.clickToStart", { noun });
            } else if (shellProcStatus == "running") {
                iconName = "refresh";
                title = i18next.t("term.controller.runningClickToRestart", { noun });
            } else if (shellProcStatus == "done") {
                iconName = "refresh";
                title = i18next.t("term.controller.exitedClickToRestart", { noun });
            }
            if (iconName != null) {
                const buttonDecl: IconButtonDecl = {
                    elemtype: "iconbutton",
                    icon: iconName,
                    click: this.forceRestartController.bind(this),
                    title: title,
                };
                rtn.push(buttonDecl);
            }
            return rtn;
        });
        this.isCmdController = jotai.atom((get) => {
            const controllerMetaAtom = getBlockMetaKeyAtom(this.blockId, "controller");
            return get(controllerMetaAtom) == "cmd";
        });
        this.shellProcFullStatus = jotai.atom(null) as jotai.PrimitiveAtom<BlockControllerRuntimeStatus>;
        const initialShellProcStatus = services.BlockService.GetControllerStatus(blockId);
        initialShellProcStatus.then((rts) => {
            this.updateShellProcStatus(rts);
        });
        this.shellProcStatusUnsubFn = waveEventSubscribeSingle({
            eventType: "controllerstatus",
            scope: WOS.makeORef("block", blockId),
            handler: (event) => {
                this.updateShellProcStatus(event.data);
            },
        });
        this.shellProcStatus = jotai.atom((get) => {
            const fullStatus = get(this.shellProcFullStatus);
            return fullStatus?.shellprocstatus ?? "init";
        });
        this.termDurableStatus = jotai.atom((get) => {
            const isDurable = get(getBlockTermDurableAtom(this.blockId));
            if (!isDurable) {
                return null;
            }
            const blockJobStatus = get(this.blockJobStatusAtom);
            if (blockJobStatus?.jobid == null || blockJobStatus?.status == null) {
                return null;
            }
            return blockJobStatus;
        });
        this.blockJobStatusAtom = jotai.atom(null) as jotai.PrimitiveAtom<BlockJobStatusData>;
        this.blockJobStatusVersionTs = 0;
        const initialBlockJobStatus = RpcApi.BlockJobStatusCommand(TabRpcClient, blockId);
        initialBlockJobStatus
            .then((status) => {
                this.handleBlockJobStatusUpdate(status);
            })
            .catch((error) => {
                console.log("error getting initial block job status", error);
            });
        this.blockJobStatusUnsubFn = waveEventSubscribeSingle({
            eventType: "block:jobstatus",
            scope: `block:${blockId}`,
            handler: (event) => {
                this.handleBlockJobStatusUpdate(event.data);
            },
        });
        this.termBPMUnsubFn = globalStore.sub(this.termBPMAtom, () => {
            if (this.termRef.current?.terminal) {
                const allowBPM = globalStore.get(this.termBPMAtom) ?? true;
                this.termRef.current.terminal.options.ignoreBracketedPasteMode = !allowBPM;
            }
        });
    }

    getShellIntegrationIconButton(get: jotai.Getter): IconButtonDecl | null {
        if (!this.termRef.current?.shellIntegrationStatusAtom) {
            return null;
        }
        const shellIntegrationStatus = get(this.termRef.current.shellIntegrationStatusAtom);
        if (shellIntegrationStatus == null) {
            return {
                elemtype: "iconbutton",
                icon: "sparkles",
                className: "text-muted",
                title: i18next.t("term.shellIntegration.noIntegration"),
                noAction: true,
            };
        }
        if (shellIntegrationStatus === "ready") {
            return {
                elemtype: "iconbutton",
                icon: "sparkles",
                className: "text-accent",
                title: i18next.t("term.shellIntegration.ready"),
                noAction: true,
            };
        }
        if (shellIntegrationStatus === "running-command") {
            let title = i18next.t("term.shellIntegration.busy");

            if (this.termRef.current) {
                const inAltBuffer = this.termRef.current.terminal?.buffer?.active?.type === "alternate";
                const lastCommand = get(this.termRef.current.lastCommandAtom);
                const blockingCmd = getBlockingCommand(lastCommand, inAltBuffer);
                if (blockingCmd) {
                    title = i18next.t("term.shellIntegration.disabledInProgram", { program: blockingCmd });
                }
            }

            return {
                elemtype: "iconbutton",
                icon: "sparkles",
                className: "text-warning",
                title: title,
                noAction: true,
            };
        }
        return null;
    }

    get viewComponent(): ViewComponent {
        return TerminalView as ViewComponent;
    }

    isBasicTerm(getFn: jotai.Getter): boolean {
        const termMode = getFn(this.termMode);
        if (termMode == "vdom") {
            return false;
        }
        const blockData = getFn(this.blockAtom);
        if (blockData?.meta?.controller == "cmd") {
            return false;
        }
        return true;
    }

    multiInputHandler(data: string) {
        const tvms = getAllBasicTermModels();
        for (const tvm of tvms) {
            if (tvm != this) {
                tvm.sendDataToController(data);
            }
        }
    }

    sendDataToController(data: string) {
        if (isBlank(data)) {
            return;
        }
        const shellProcStatus = globalStore.get(this.shellProcStatus);
        if (shellProcStatus !== "running") {
            this.pendingInputQueue.push(data);
            this.requestControllerRestartForInput();
            return;
        }
        fireAndForget(async () => {
            try {
                const b64data = stringToBase64(data);
                await RpcApi.ControllerInputCommand(TabRpcClient, { blockid: this.blockId, inputdata64: b64data });
            } catch (e) {
                console.log("controller input failed, queueing for retry", this.blockId, e);
                this.pendingInputQueue.push(data);
                this.requestControllerRestartForInput();
            }
        });
    }

    private requestControllerRestartForInput() {
        if (globalStore.get(this.isRestarting)) {
            return;
        }
        const now = Date.now();
        if (now - this.lastInputRestartTs < INPUT_RESTART_COOLDOWN_MS) {
            return;
        }
        this.lastInputRestartTs = now;
        this.forceRestartController();
    }

    private async flushPendingInputQueue() {
        if (this.isFlushingPendingInput || this.pendingInputQueue.length === 0) {
            return;
        }
        if (globalStore.get(this.shellProcStatus) !== "running") {
            return;
        }
        this.isFlushingPendingInput = true;
        try {
            while (this.pendingInputQueue.length > 0) {
                if (globalStore.get(this.shellProcStatus) !== "running") {
                    return;
                }
                const payload = this.pendingInputQueue.join("");
                this.pendingInputQueue = [];
                try {
                    await RpcApi.ControllerInputCommand(TabRpcClient, {
                        blockid: this.blockId,
                        inputdata64: stringToBase64(payload),
                    });
                } catch (e) {
                    console.log("flush pending input failed, will retry", this.blockId, e);
                    this.pendingInputQueue.unshift(payload);
                    this.requestControllerRestartForInput();
                    return;
                }
            }
        } finally {
            this.isFlushingPendingInput = false;
        }
    }

    setTermMode(mode: "term" | "vdom") {
        if (mode == "term") {
            mode = null;
        }
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("block", this.blockId),
            meta: { "term:mode": mode },
        });
    }

    triggerRestartAtom() {
        globalStore.set(this.isRestarting, true);
        setTimeout(() => {
            globalStore.set(this.isRestarting, false);
        }, 300);
    }

    handleBlockJobStatusUpdate(status: BlockJobStatusData) {
        if (status?.versionts == null) {
            return;
        }
        if (status.versionts <= this.blockJobStatusVersionTs) {
            return;
        }
        this.blockJobStatusVersionTs = status.versionts;
        globalStore.set(this.blockJobStatusAtom, status);
    }

    updateShellProcStatus(fullStatus: BlockControllerRuntimeStatus) {
        if (fullStatus == null) {
            return;
        }
        const curStatus = globalStore.get(this.shellProcFullStatus);
        if (curStatus == null || curStatus.version < fullStatus.version) {
            globalStore.set(this.shellProcFullStatus, fullStatus);
            if (fullStatus.shellprocstatus === "running" && this.pendingInputQueue.length > 0) {
                fireAndForget(() => this.flushPendingInputQueue());
            }
        }
    }

    getVDomModel(): VDomModel {
        const vdomBlockId = globalStore.get(this.vdomBlockId);
        if (!vdomBlockId) {
            return null;
        }
        const bcm = getBlockComponentModel(vdomBlockId);
        if (!bcm) {
            return null;
        }
        return bcm.viewModel as VDomModel;
    }

    getVDomToolbarModel(): VDomModel {
        const vdomToolbarBlockId = globalStore.get(this.vdomToolbarBlockId);
        if (!vdomToolbarBlockId) {
            return null;
        }
        const bcm = getBlockComponentModel(vdomToolbarBlockId);
        if (!bcm) {
            return null;
        }
        return bcm.viewModel as VDomModel;
    }

    dispose() {
        DefaultRouter.unregisterRoute(makeFeBlockRouteId(this.blockId));
        this.shellProcStatusUnsubFn?.();
        this.blockJobStatusUnsubFn?.();
        this.termBPMUnsubFn?.();
    }

    giveFocus(): boolean {
        if (this.searchAtoms && globalStore.get(this.searchAtoms.isOpen)) {
            console.log("search is open, not giving focus");
            return true;
        }
        let termMode = globalStore.get(this.termMode);
        if (termMode == "term") {
            if (this.termRef?.current?.terminal) {
                this.termRef.current.terminal.focus();
                return true;
            }
        }
        return false;
    }

    keyDownHandler(waveEvent: WaveKeyboardEvent): boolean {
        if (keyutil.checkKeyPressed(waveEvent, "Ctrl:r")) {
            const shellIntegrationStatus = readAtom(this.termRef?.current?.shellIntegrationStatusAtom);
            if (shellIntegrationStatus === "ready") {
                recordTEvent("action:term", { "action:type": "term:ctrlr" });
            }
            // just for telemetry, we allow this keybinding through, back to the terminal
            return false;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Cmd:Escape")) {
            const blockAtom = WOS.getWaveObjectAtom<Block>(`block:${this.blockId}`);
            const blockData = globalStore.get(blockAtom);
            const newTermMode = blockData?.meta?.["term:mode"] == "vdom" ? null : "vdom";
            const vdomBlockId = globalStore.get(this.vdomBlockId);
            if (newTermMode == "vdom" && !vdomBlockId) {
                return;
            }
            this.setTermMode(newTermMode);
            return true;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Shift:End")) {
            if (this.termRef?.current?.terminal) {
                this.termRef.current.terminal.scrollToBottom();
            }
            return true;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Shift:Home")) {
            if (this.termRef?.current?.terminal) {
                this.termRef.current.terminal.scrollToLine(0);
            }
            return true;
        }
        if (isMacOS() && keyutil.checkKeyPressed(waveEvent, "Cmd:End")) {
            if (this.termRef?.current?.terminal) {
                this.termRef.current.terminal.scrollToBottom();
            }
            return true;
        }
        if (isMacOS() && keyutil.checkKeyPressed(waveEvent, "Cmd:Home")) {
            if (this.termRef?.current?.terminal) {
                this.termRef.current.terminal.scrollToLine(0);
            }
            return true;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Shift:PageDown")) {
            if (this.termRef?.current?.terminal) {
                this.termRef.current.terminal.scrollPages(1);
            }
            return true;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Shift:PageUp")) {
            if (this.termRef?.current?.terminal) {
                this.termRef.current.terminal.scrollPages(-1);
            }
            return true;
        }
        const blockData = globalStore.get(this.blockAtom);
        if (blockData.meta?.["term:mode"] == "vdom") {
            const vdomModel = this.getVDomModel();
            return vdomModel?.keyDownHandler(waveEvent);
        }
        return false;
    }

    shouldHandleCtrlVPaste(): boolean {
        // macOS never uses Ctrl-V for paste (uses Cmd-V)
        if (isMacOS()) {
            return false;
        }

        // Get the app:ctrlvpaste setting
        const ctrlVPasteAtom = getSettingsKeyAtom("app:ctrlvpaste");
        const ctrlVPasteSetting = globalStore.get(ctrlVPasteAtom);

        // If setting is explicitly set, use it
        if (ctrlVPasteSetting != null) {
            return ctrlVPasteSetting;
        }

        // Default behavior: Windows=true, Linux/other=false
        return isWindows();
    }

    handleTerminalKeydown(event: KeyboardEvent): boolean {
        const waveEvent = keyutil.adaptFromReactOrNativeKeyEvent(event);
        if (waveEvent.type != "keydown") {
            return true;
        }

        // Handle Escape key during IME composition
        if (keyutil.checkKeyPressed(waveEvent, "Escape")) {
            if (this.termRef.current?.isComposing) {
                // Reset composition state when Escape is pressed during composition
                this.termRef.current.resetCompositionState();
            }
        }

        if (this.keyDownHandler(waveEvent)) {
            event.preventDefault();
            event.stopPropagation();
            return false;
        }

        if (isMacOS()) {
            if (keyutil.checkKeyPressed(waveEvent, "Cmd:ArrowLeft")) {
                this.sendDataToController("\x01"); // Ctrl-A (beginning of line)
                event.preventDefault();
                event.stopPropagation();
                return false;
            }
            if (keyutil.checkKeyPressed(waveEvent, "Cmd:ArrowRight")) {
                this.sendDataToController("\x05"); // Ctrl-E (end of line)
                event.preventDefault();
                event.stopPropagation();
                return false;
            }
        }

        // Arrow keys: scroll viewport by line when reading output.
        // - Always allow normal arrow behavior in alternate buffer apps (vim/less/tmux).
        // - Keep normal prompt/history behavior when we're at the bottom.
        // - When scrolled up, use ArrowUp/ArrowDown to scroll by 1 line (avoids breaking interactive TUIs).
        if (
            waveEvent.key &&
            (waveEvent.key === "ArrowUp" || waveEvent.key === "ArrowDown") &&
            !waveEvent.shift &&
            !waveEvent.control &&
            !waveEvent.alt &&
            !waveEvent.meta &&
            !waveEvent.cmd
        ) {
            const termWrap = this.termRef.current;
            const terminal = termWrap?.terminal;
            const buffer = terminal?.buffer?.active;
            if (terminal && buffer && buffer.type !== "alternate") {
                const isAtBottom = buffer.baseY === buffer.viewportY;
                const shouldScroll = !isAtBottom;
                if (shouldScroll) {
                    terminal.scrollLines(waveEvent.key === "ArrowUp" ? -1 : 1);
                    event.preventDefault();
                    event.stopPropagation();
                    return false;
                }
            }
        }
        if (keyutil.checkKeyPressed(waveEvent, "Shift:Enter")) {
            const shiftEnterNewlineAtom = getOverrideConfigAtom(this.blockId, "term:shiftenternewline");
            const shiftEnterNewlineEnabled = globalStore.get(shiftEnterNewlineAtom) ?? true;
            if (shiftEnterNewlineEnabled) {
                this.sendDataToController("\n");
                event.preventDefault();
                event.stopPropagation();
                return false;
            }
        }

        // Check for Ctrl-V paste (platform-dependent)
        if (this.shouldHandleCtrlVPaste() && keyutil.checkKeyPressed(waveEvent, "Ctrl:v")) {
            event.preventDefault();
            event.stopPropagation();
            getApi().nativePaste();
            return false;
        }

        if (keyutil.checkKeyPressed(waveEvent, "Ctrl:Shift:v")) {
            event.preventDefault();
            event.stopPropagation();
            getApi().nativePaste();
            // this.termRef.current?.pasteHandler();
            return false;
        } else if (keyutil.checkKeyPressed(waveEvent, "Ctrl:Shift:c")) {
            event.preventDefault();
            event.stopPropagation();
            const sel = this.termRef.current?.terminal.getSelection();
            if (!sel) {
                return false;
            }
            navigator.clipboard.writeText(sel);
            return false;
        } else if (keyutil.checkKeyPressed(waveEvent, "Cmd:k")) {
            event.preventDefault();
            event.stopPropagation();
            this.termRef.current?.terminal?.clear();
            return false;
        }
        const shellProcStatus = globalStore.get(this.shellProcStatus);
        if ((shellProcStatus == "done" || shellProcStatus == "init") && keyutil.checkKeyPressed(waveEvent, "Enter")) {
            this.sendDataToController("\n");
            event.preventDefault();
            event.stopPropagation();
            return false;
        }
        const appHandled = appHandleKeyDown(waveEvent);
        if (appHandled) {
            event.preventDefault();
            event.stopPropagation();
            return false;
        }
        return true;
    }

    setTerminalTheme(themeName: string) {
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("block", this.blockId),
            meta: { "term:theme": themeName },
        });
    }

    forceRestartController() {
        if (globalStore.get(this.isRestarting)) {
            return;
        }
        this.triggerRestartAtom();
        const termsize = {
            rows: this.termRef.current?.terminal?.rows,
            cols: this.termRef.current?.terminal?.cols,
        };
        const prtn = RpcApi.ControllerResyncCommand(TabRpcClient, {
            tabid: globalStore.get(atoms.staticTabId),
            blockid: this.blockId,
            forcerestart: true,
            rtopts: { termsize: termsize },
        });
        prtn.catch((e) => console.log("error controller resync (force restart)", e));
    }

    async restartSessionInStandardMode() {
        await RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("block", this.blockId),
            meta: { "term:durable": false },
        });
        await RpcApi.ControllerDestroyCommand(TabRpcClient, this.blockId);
        const termsize = {
            rows: this.termRef.current?.terminal?.rows,
            cols: this.termRef.current?.terminal?.cols,
        };
        await RpcApi.ControllerResyncCommand(TabRpcClient, {
            tabid: globalStore.get(atoms.staticTabId),
            blockid: this.blockId,
            forcerestart: true,
            rtopts: { termsize: termsize },
        });
    }

    private async readCliLayoutConfig(cliLayoutConfigPath: string): Promise<CliLayoutConfigFile> {
        const defaultConfig: CliLayoutConfigFile = { version: 1, presets: {}, savedLayouts: {} };
        try {
            const fileData = await RpcApi.FileReadCommand(TabRpcClient, { info: { path: cliLayoutConfigPath } });
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
            return {
                version: 1,
                lastPresetKey: typeof parsed.lastPresetKey === "string" ? parsed.lastPresetKey : undefined,
                presets: typeof parsed.presets === "object" && parsed.presets != null ? parsed.presets : {},
                savedLayouts: typeof parsed.savedLayouts === "object" && parsed.savedLayouts != null ? parsed.savedLayouts : {},
            };
        } catch {
            return defaultConfig;
        }
    }

    private async writeCliLayoutConfig(cliLayoutConfigPath: string, config: CliLayoutConfigFile): Promise<void> {
        await RpcApi.FileWriteCommand(TabRpcClient, {
            info: { path: cliLayoutConfigPath },
            data64: stringToBase64(JSON.stringify(config, null, 2)),
        });
    }

    private async addCurrentPathToLayoutPreset(preset: CliLayoutPreset, openAfterAdd: boolean): Promise<void> {
        if (!preset) {
            return;
        }

        const blockData = globalStore.get(this.blockAtom);
        const currentPath = normalizePath(String(blockData?.meta?.["cmd:cwd"] ?? "~")) || "~";
        const currentConn = normalizeConnectionName(blockData?.meta?.connection);
        const cliLayoutConfigPath = `${getApi().getConfigDir()}/cli-layout-presets.json`;

        const config = await this.readCliLayoutConfig(cliLayoutConfigPath);
        const existingState = config.presets?.[preset.key];
        const totalSlots = Math.max(1, preset.rows * preset.cols);

        const paths = Array.from({ length: totalSlots }, (_, index) => {
            return normalizePath(existingState?.paths?.[index] ?? "");
        });
        const commands = Array.from({ length: totalSlots }, (_, index) => {
            const cmd = existingState?.commands?.[index];
            return typeof cmd === "string" ? cmd.trim() : "";
        });

        const emptyIndex = paths.findIndex((p) => isBlank(p));
        if (emptyIndex >= 0) {
            paths[emptyIndex] = currentPath;
        } else {
            paths.shift();
            paths.push(currentPath);
        }

        const preservedConn =
            existingState != null && !isBlank(existingState.connection) ? existingState.connection : currentConn;
        const nextConnection = isBlank(preservedConn) ? undefined : preservedConn;

        const nextState: CliLayoutPresetState = {
            rows: preset.rows,
            cols: preset.cols,
            paths,
            commands,
            connection: nextConnection,
            updatedTs: Date.now(),
            name: typeof existingState?.name === "string" ? existingState.name : undefined,
        };

        config.version = 1;
        config.lastPresetKey = preset.key;
        config.presets = config.presets ?? {};
        config.presets[preset.key] = nextState;

        await this.writeCliLayoutConfig(cliLayoutConfigPath, config);
        window.dispatchEvent(new Event("cli-layout-presets-updated"));

        if (openAfterAdd) {
            const openPaths = nextState.paths.map((p) => (isBlank(p) ? currentPath : normalizePath(p) || currentPath));
            const openCommands = nextState.commands?.map((cmd) => (typeof cmd === "string" ? cmd.trim() : "")) ?? [];
            await openCliLayoutInNewTab(
                {
                    rows: preset.rows,
                    cols: preset.cols,
                    paths: openPaths,
                    commands: openCommands,
                    connection: nextState.connection,
                    updatedTs: Date.now(),
                },
                getCliLayoutPresetLabel(preset),
                preset.key
            );
        }
    }

    private buildFavoritesOpenMenuItems(items: FavoriteItem[], currentConnection?: string): ContextMenuItem[] {
        if (!items?.length) {
            return [
                {
                    label: i18next.t("favorites.empty"),
                    enabled: false,
                },
            ];
        }

        const normalizedCurrentConn = normalizeConnectionName(currentConnection);
        const blockId = this.blockId;
        const favoritesModel = FavoritesModel.getInstance();

        const runInThisTerminal = (fav: FavoriteItem, cliCommand?: string) => {
            if (isCategoryPath(fav.path)) {
                return;
            }
            const normalizedPath = fav.path?.trim() ?? "";
            if (isBlank(normalizedPath)) {
                return;
            }

            const escapedPath = normalizedPath.replace(/"/g, '\\"');
            const command = typeof cliCommand === "string" ? cliCommand.trim() : "";
            const inputScript = isBlank(command)
                ? `cd "${escapedPath}"\n`
                : `cd "${escapedPath}"\n${command}\n`;

            const favConn = normalizeConnectionName(fav.connection);

            if (favConn !== normalizedCurrentConn) {
                const meta: Record<string, any> = {
                    controller: "shell",
                    view: "term",
                    "cmd:cwd": normalizedPath,
                };
                if (!isBlank(favConn)) {
                    meta.connection = favConn;
                }
                if (!isBlank(command)) {
                    meta["term:autoCmd"] = command;
                    meta["cmd:initscript"] = `${command}\n`;
                }
                if (!isBlank(command)) {
                    favoritesModel.updateFavoriteAutoCmd(fav.id, command);
                    window.dispatchEvent(new Event("favorites-updated"));
                }
                createBlock({ meta });
                return;
            }

            fireAndForget(async () => {
                const meta: Record<string, any> = {
                    "cmd:cwd": normalizedPath,
                };
                if (!isBlank(command)) {
                    meta["term:autoCmd"] = command;
                }
                await RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                    meta,
                });
                this.sendDataToController(inputScript);
                if (!isBlank(command)) {
                    favoritesModel.updateFavoriteAutoCmd(fav.id, command);
                    window.dispatchEvent(new Event("favorites-updated"));
                }
            });
        };

        const buildCommandMenuItems = (fav: FavoriteItem): ContextMenuItem[] => {
            const defaultCmd = typeof fav.autoCmd === "string" ? fav.autoCmd.trim() : "";
            const defaultMarker = i18next.t("favorites.defaultMarker");
            const menuItems: ContextMenuItem[] = [
                ...(isBlank(defaultCmd)
                    ? []
                    : [
                          {
                              label: i18next.t("favorites.openDefault"),
                              sublabel: defaultCmd,
                              click: () => runInThisTerminal(fav, defaultCmd),
                          },
                          {
                              label: i18next.t("favorites.clearDefaultCommand"),
                              click: () => {
                                  favoritesModel.updateFavoriteAutoCmd(fav.id, undefined);
                                  window.dispatchEvent(new Event("favorites-updated"));
                              },
                          },
                          { type: "separator" as const },
                      ]),
                {
                    label: i18next.t("favorites.cdHere"),
                    click: () => runInThisTerminal(fav),
                },
                { type: "separator" },
                ...AI_LAUNCH_COMMANDS.map((item) => ({
                    label: !isBlank(defaultCmd) && item.command === defaultCmd ? `${item.label}${defaultMarker}` : item.label,
                    click: () => runInThisTerminal(fav, item.command),
                })),
            ];
            return menuItems;
        };

        const buildPathMenuItems = (favItems: FavoriteItem[]): ContextMenuItem[] => {
            return favItems.map((fav) => {
                const hasChildren = (fav.children?.length ?? 0) > 0;
                const isCategory = isCategoryPath(fav.path);
                const favConn = normalizeConnectionName(fav.connection);
                const sublabelParts: string[] = [];
                if (!isBlank(favConn)) {
                    sublabelParts.push(favConn);
                }
                if (!isBlank(fav.path) && !isCategory) {
                    sublabelParts.push(fav.path);
                }
                const sublabel = sublabelParts.length ? sublabelParts.join(" · ") : undefined;

                if (hasChildren || isCategory) {
                    const submenu = buildPathMenuItems(fav.children ?? []);
                    return {
                        label: fav.label || fav.path,
                        sublabel,
                        enabled: submenu.length > 0,
                        submenu,
                    };
                }

                return {
                    label: fav.label || fav.path,
                    sublabel,
                    submenu: buildCommandMenuItems(fav),
                };
            });
        };

        return buildPathMenuItems(items);
    }

    getContextMenuItems(): ContextMenuItem[] {
        const menu: ContextMenuItem[] = [];
        const hasSelection = this.termRef.current?.terminal?.hasSelection();
        const selection = hasSelection ? this.termRef.current?.terminal.getSelection() : null;

        if (hasSelection) {
            menu.push({
                label: i18next.t("ctx.copy"),
                click: () => {
                    if (selection) {
                        navigator.clipboard.writeText(selection);
                    }
                },
            });
            menu.push({ type: "separator" });
            menu.push({
                label: i18next.t("term.sendToWaveAI"),
                click: () => {
                    if (selection) {
                        const aiModel = WaveAIModel.getInstance();
                        aiModel.appendText(selection, true, { scrollToBottom: true });
                        const layoutModel = WorkspaceLayoutModel.getInstance();
                        if (!layoutModel.getAIPanelVisible()) {
                            layoutModel.setAIPanelVisible(true);
                        }
                        aiModel.focusInput();
                    }
                },
            });
            menu.push({
                label: i18next.t("term.translateSelection"),
                click: () => {
                    if (!selection) {
                        return;
                    }
                    modalsModel.pushModal("CodexTranslateModal", { text: selection });
                },
            });

            let selectionURL: URL = null;
            if (selection) {
                try {
                    const trimmedSelection = selection.trim();
                    const url = new URL(trimmedSelection);
                    if (url.protocol.startsWith("http")) {
                        selectionURL = url;
                    }
                } catch (e) {
                    // not a valid URL
                }
            }

            if (selectionURL) {
                menu.push({ type: "separator" });
                menu.push({
                    label: i18next.t("term.openUrl", { host: selectionURL.hostname }),
                    click: () => {
                        createBlock({
                            meta: {
                                view: "web",
                                url: selectionURL.toString(),
                            },
                        });
                    },
                });
                menu.push({
                    label: i18next.t("term.openUrlExternal"),
                    click: () => {
                        getApi().openExternal(selectionURL.toString());
                    },
                });
            }
            menu.push({ type: "separator" });
        }

        const favoritesModel = FavoritesModel.getInstance();
        const blockData = globalStore.get(this.blockAtom);
        const currentPath = blockData?.meta?.["cmd:cwd"] || "~";
        const connection = blockData?.meta?.connection;

        menu.push({
            label: i18next.t("favorites.add"),
            click: () => {
                const currentAutoCmd =
                    typeof blockData?.meta?.["term:autoCmd"] === "string" ? String(blockData.meta["term:autoCmd"]).trim() : "";
                favoritesModel.addFavorite(
                    currentPath,
                    undefined,
                    undefined,
                    connection,
                    isBlank(currentAutoCmd) ? undefined : currentAutoCmd
                );
                window.dispatchEvent(new Event("favorites-updated"));
            },
        });

        menu.push({
            label: i18next.t("favorites.title"),
            submenu: this.buildFavoritesOpenMenuItems(favoritesModel.getItems(), connection),
        });

        menu.push({
            label: i18next.t("block.addToLayout"),
            submenu: CLI_LAYOUT_PRESETS.map((preset) => ({
                label: getCliLayoutPresetLabel(preset),
                submenu: [
                    {
                        label: i18next.t("clilayout.addOnly"),
                        click: () => fireAndForget(() => this.addCurrentPathToLayoutPreset(preset, false)),
                    },
                    {
                        label: i18next.t("clilayout.addAndOpen"),
                        click: () => fireAndForget(() => this.addCurrentPathToLayoutPreset(preset, true)),
                    },
                ],
            })),
        });

        const openAiSubmenu: ContextMenuItem[] = AI_LAUNCH_COMMANDS.map((item) => ({
            label: i18next.t("preview.openAiHere", { ai: item.label }),
            click: () => {
                const meta: Record<string, any> = {
                    controller: "shell",
                    view: "term",
                    "cmd:cwd": currentPath,
                    "cmd:initscript": `${item.command}\n`,
                };
                if (connection) {
                    meta.connection = connection;
                }
                createBlock({ meta });
            },
        }));

        menu.push({
            label: i18next.t("preview.openWithAi"),
            submenu: openAiSubmenu,
        });

        menu.push({ type: "separator" });

        menu.push({
            label: i18next.t("ctx.paste"),
            click: () => {
                getApi().nativePaste();
            },
        });

        menu.push({ type: "separator" });

        const magnified = globalStore.get(this.nodeModel.isMagnified);
        menu.push({
            label: magnified ? i18next.t("block.unMagnifyBlock") : i18next.t("block.magnifyBlock"),
            click: () => {
                this.nodeModel.toggleMagnify();
            },
        });
        menu.push({
            label: i18next.t("term.reflowHistory"),
            click: () => {
                fireAndForget(() => this.termRef.current?.reflowHistoryToCurrentWidth("context-menu"));
            },
        });

        menu.push({ type: "separator" });

        const settingsItems = this.getSettingsMenuItems();
        menu.push(...settingsItems);

        return menu;
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const fullConfig = globalStore.get(atoms.fullConfigAtom);
        const termThemes = fullConfig?.termthemes ?? {};
        const termThemeKeys = Object.keys(termThemes);
        const curThemeName = globalStore.get(getBlockMetaKeyAtom(this.blockId, "term:theme"));
        const defaultFontSize = globalStore.get(getSettingsKeyAtom("term:fontsize")) ?? 12;
        const defaultAllowBracketedPaste = globalStore.get(getSettingsKeyAtom("term:allowbracketedpaste")) ?? true;
        const transparencyMeta = globalStore.get(getBlockMetaKeyAtom(this.blockId, "term:transparency"));
        const blockData = globalStore.get(this.blockAtom);
        const overrideFontSize = blockData?.meta?.["term:fontsize"];

        termThemeKeys.sort((a, b) => {
            return (termThemes[a]["display:order"] ?? 0) - (termThemes[b]["display:order"] ?? 0);
        });
        const defaultTermBlockDef: BlockDef = {
            meta: {
                view: "term",
                controller: "shell",
            },
        };

        const shellIntegrationStatus = globalStore.get(this.termRef?.current?.shellIntegrationStatusAtom);
        const cwd = blockData?.meta?.["cmd:cwd"];
        console.log("term-model: newBlockInheritCwd check", { shellIntegrationStatus, cwd, blockId: this.blockId });
        const canInheritCwd = cwd != null; // Temporarily relaxed for debugging/fix
        const canShowFileBrowser = canInheritCwd;

        const fullMenu: ContextMenuItem[] = [];
        fullMenu.push({
            label: i18next.t("term.splitHorizontally"),
            click: () => {
                const blockData = globalStore.get(this.blockAtom);
                const blockDef: BlockDef = {
                    meta: blockData?.meta || defaultTermBlockDef.meta,
                };
                createBlockSplitHorizontally(blockDef, this.blockId, "after");
            },
        });
        fullMenu.push({
            label: i18next.t("term.splitVertically"),
            click: () => {
                const blockData = globalStore.get(this.blockAtom);
                const blockDef: BlockDef = {
                    meta: blockData?.meta || defaultTermBlockDef.meta,
                };
                createBlockSplitVertically(blockDef, this.blockId, "after");
            },
        });
        fullMenu.push({
            label: i18next.t("term.newBlockInheritCwd"),
            enabled: canInheritCwd,
            click: () => {
                const blockData = globalStore.get(this.blockAtom);
                const connection = blockData?.meta?.connection;
                const cwd = blockData?.meta?.["cmd:cwd"];
                const meta: Record<string, any> = {
                    ...defaultTermBlockDef.meta,
                    "cmd:cwd": cwd,
                };
                if (connection) {
                    meta.connection = connection;
                }
                createBlock({ meta });
            },
        });
        fullMenu.push({ type: "separator" });

        if (canShowFileBrowser) {
            fullMenu.push({
                label: i18next.t("term.fileBrowser"),
                click: () => {
                    const blockData = globalStore.get(this.blockAtom);
                    const connection = blockData?.meta?.connection;
                    const cwd = blockData?.meta?.["cmd:cwd"];
                    const meta: Record<string, any> = {
                        view: "preview",
                        file: cwd,
                    };
                    if (connection) {
                        meta.connection = connection;
                    }
                    const blockDef: BlockDef = { meta };
                    createBlock(blockDef);
                },
            });
            fullMenu.push({ type: "separator" });
        }

        fullMenu.push({
            label: "Save Session As...",
            click: () => {
                if (this.termRef.current) {
                    const content = this.termRef.current.getScrollbackContent();
                    if (content) {
                        fireAndForget(async () => {
                            try {
                                const success = await getApi().saveTextFile("session.log", content);
                                if (!success) {
                                    console.log("Save scrollback cancelled by user");
                                }
                            } catch (error) {
                                console.error("Failed to save scrollback:", error);
                                const errorMessage = error?.message || "An unknown error occurred";
                                modalsModel.pushModal("MessageModal", {
                                    children: `Failed to save session scrollback: ${errorMessage}`,
                                });
                            }
                        });
                    } else {
                        modalsModel.pushModal("MessageModal", {
                            children: "No scrollback content to save.",
                        });
                    }
                }
            },
        });
        fullMenu.push({ type: "separator" });

        const submenu: ContextMenuItem[] = termThemeKeys.map((themeName) => {
            const theme = termThemes[themeName];
            return {
                label: getTermThemeMenuLabel(themeName, theme),
                type: "checkbox",
                checked: curThemeName == themeName,
                click: () => this.setTerminalTheme(themeName),
            };
        });
        submenu.unshift({
            label: i18next.t("common.default"),
            type: "checkbox",
            checked: curThemeName == null,
            click: () => this.setTerminalTheme(null),
        });
        const transparencySubMenu: ContextMenuItem[] = [];
        transparencySubMenu.push({
            label: i18next.t("common.default"),
            type: "checkbox",
            checked: transparencyMeta == null,
            click: () => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", this.blockId),
                    meta: { "term:transparency": null },
                });
            },
        });
        transparencySubMenu.push({
            label: i18next.t("term.transparentBackground"),
            type: "checkbox",
            checked: transparencyMeta == 0.5,
            click: () => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", this.blockId),
                    meta: { "term:transparency": 0.5 },
                });
            },
        });
        transparencySubMenu.push({
            label: i18next.t("term.noTransparency"),
            type: "checkbox",
            checked: transparencyMeta == 0,
            click: () => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", this.blockId),
                    meta: { "term:transparency": 0 },
                });
            },
        });

        const fontSizeSubMenu: ContextMenuItem[] = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map(
            (fontSize: number) => {
                return {
                    label: fontSize.toString() + "px",
                    type: "checkbox",
                    checked: overrideFontSize == fontSize,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "term:fontsize": fontSize },
                        });
                    },
                };
            }
        );
        fontSizeSubMenu.unshift({
            label: i18next.t("common.defaultWithValue", { value: `${defaultFontSize}px` }),
            type: "checkbox",
            checked: overrideFontSize == null,
            click: () => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", this.blockId),
                    meta: { "term:fontsize": null },
                });
            },
        });
        fullMenu.push({
            label: i18next.t("term.themes"),
            submenu: submenu,
        });
        fullMenu.push({
            label: i18next.t("term.fontSize"),
            submenu: fontSizeSubMenu,
        });
        fullMenu.push({
            label: i18next.t("term.transparency"),
            submenu: transparencySubMenu,
        });
        fullMenu.push({ type: "separator" });
        const advancedSubmenu: ContextMenuItem[] = [];

        const defaultBellNotify = globalStore.get(getSettingsKeyAtom("term:bellnotify")) ?? true;
        const bellNotify = blockData?.meta?.["term:bellnotify"];
        advancedSubmenu.push({
            label: i18next.t("term.bellNotify"),
            submenu: [
                {
                    label: i18next.t("common.defaultWithValue", {
                        value: defaultBellNotify ? i18next.t("common.on") : i18next.t("common.off"),
                    }),
                    type: "checkbox",
                    checked: bellNotify == null,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "term:bellnotify": null },
                        });
                    },
                },
                {
                    label: i18next.t("common.on"),
                    type: "checkbox",
                    checked: bellNotify === true,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "term:bellnotify": true },
                        });
                    },
                },
                {
                    label: i18next.t("common.off"),
                    type: "checkbox",
                    checked: bellNotify === false,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "term:bellnotify": false },
                        });
                    },
                },
            ],
        });

        const allowBracketedPaste = blockData?.meta?.["term:allowbracketedpaste"];
        advancedSubmenu.push({
            label: i18next.t("term.allowBracketedPasteMode"),
            submenu: [
                {
                    label: i18next.t("common.defaultWithValue", {
                        value: defaultAllowBracketedPaste ? i18next.t("common.on") : i18next.t("common.off"),
                    }),
                    type: "checkbox",
                    checked: allowBracketedPaste == null,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "term:allowbracketedpaste": null },
                        });
                    },
                },
                {
                    label: i18next.t("common.on"),
                    type: "checkbox",
                    checked: allowBracketedPaste === true,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "term:allowbracketedpaste": true },
                        });
                    },
                },
                {
                    label: i18next.t("common.off"),
                    type: "checkbox",
                    checked: allowBracketedPaste === false,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "term:allowbracketedpaste": false },
                        });
                    },
                },
            ],
        });
        advancedSubmenu.push({
            label: i18next.t("term.forceRestartController"),
            click: this.forceRestartController.bind(this),
        });
        const isClearOnStart = blockData?.meta?.["cmd:clearonstart"];
        advancedSubmenu.push({
            label: i18next.t("term.clearOutputOnRestart"),
            submenu: [
                {
                    label: i18next.t("common.on"),
                    type: "checkbox",
                    checked: isClearOnStart,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "cmd:clearonstart": true },
                        });
                    },
                },
                {
                    label: i18next.t("common.off"),
                    type: "checkbox",
                    checked: !isClearOnStart,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "cmd:clearonstart": false },
                        });
                    },
                },
            ],
        });
        const runOnStart = blockData?.meta?.["cmd:runonstart"];
        advancedSubmenu.push({
            label: i18next.t("term.runOnStartup"),
            submenu: [
                {
                    label: i18next.t("common.on"),
                    type: "checkbox",
                    checked: runOnStart,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "cmd:runonstart": true },
                        });
                    },
                },
                {
                    label: i18next.t("common.off"),
                    type: "checkbox",
                    checked: !runOnStart,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "cmd:runonstart": false },
                        });
                    },
                },
            ],
        });
        const debugConn = blockData?.meta?.["term:conndebug"];
        advancedSubmenu.push({
            label: i18next.t("term.debugConnection"),
            submenu: [
                {
                    label: i18next.t("common.off"),
                    type: "checkbox",
                    checked: !debugConn,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "term:conndebug": null },
                        });
                    },
                },
                {
                    label: i18next.t("term.debugConnectionInfo"),
                    type: "checkbox",
                    checked: debugConn == "info",
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "term:conndebug": "info" },
                        });
                    },
                },
                {
                    label: i18next.t("term.debugConnectionVerbose"),
                    type: "checkbox",
                    checked: debugConn == "debug",
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "term:conndebug": "debug" },
                        });
                    },
                },
            ],
        });

        const isDurable = globalStore.get(getBlockTermDurableAtom(this.blockId));
        if (isDurable) {
            advancedSubmenu.push({
                label: i18next.t("term.sessionDurability"),
                submenu: [
                    {
                        label: i18next.t("term.restartSessionStandardMode"),
                        click: () => this.restartSessionInStandardMode(),
                    },
                ],
            });
        }

        fullMenu.push({
            label: i18next.t("term.advanced"),
            submenu: advancedSubmenu,
        });
        if (blockData?.meta?.["term:vdomtoolbarblockid"]) {
            fullMenu.push({ type: "separator" });
            fullMenu.push({
                label: i18next.t("term.closeToolbar"),
                click: () => {
                    RpcApi.DeleteSubBlockCommand(TabRpcClient, { blockid: blockData.meta["term:vdomtoolbarblockid"] });
                },
            });
        }
        return fullMenu;
    }
}

export function getAllBasicTermModels(): TermViewModel[] {
    const termModels: TermViewModel[] = [];
    const bcms = getAllBlockComponentModels();
    for (const bcm of bcms) {
        if (bcm?.viewModel?.viewType == "term") {
            const tvm = bcm.viewModel as TermViewModel;
            if (tvm.isBasicTerm((atom) => globalStore.get(atom))) {
                termModels.push(tvm);
            }
        }
    }
    return termModels;
}

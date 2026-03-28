// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { speechRuntime } from "@/app/aipanel/speechruntime";
import { resolveSpeechSettings, type ResolvedSpeechSettings } from "@/app/aipanel/speechsettings";
import {
    waveAICurrentModeAtom,
    waveAIErrorAtom,
    waveAILatestAssistantMessageTextAtom,
    waveAIStreamingAtom,
} from "@/app/aipanel/waveai-shared";
import {
    blockViewToIcon,
    blockViewToName,
    getViewIconElem,
    OptMagnifyButton,
    renderHeaderElements,
} from "@/app/block/blockutil";
import { ConnectionButton } from "@/app/block/connectionbutton";
import {
    canRunCodexResume,
    runCodexResumeSequence,
    shouldShowCodexResumeButton,
    waitForCodexResumeToBecomeInteractive,
} from "@/app/block/codex-resume";
import {
    getTerminalFormalReplyRefreshDelayMs,
    getTerminalSpeechAutoPlayBaselineTs,
    getTerminalSpeechCompletionAnchor,
    loadLatestTerminalFormalReplyPayload,
    loadLatestWorkbenchFormalReplyPayload,
    playTerminalFormalReplyPayload,
    shouldAutoPlayTerminalFormalReply,
    type TerminalSpeechCompletionAnchor,
    type TerminalFormalReplyPayload,
    type TerminalFormalReplySourceMode,
} from "@/app/block/terminal-speech";
import { ContextMenuModel } from "@/app/store/contextmenu";
import {
    atoms,
    getConnStatusAtom,
    getOverrideConfigAtom,
    getSettingsKeyAtom,
    pushFlashError,
    recordTEvent,
    useBlockAtom,
    WOS,
} from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { uxCloseBlock } from "@/app/store/keymodel";
import { getFileSubject } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import {
    launchAgentCommandInCurrentTerminalBlock,
} from "@/app/view/workbench/workbench-agent-layout";
import { getTraditionalView, toggleWorkbenchMode } from "@/app/view/workbench/workbench-mode";
import { IconButton } from "@/element/iconbutton";
import { getTerminalDisplayCwd, resolveTerminalActionCwd } from "@/util/launchcwd";
import { NodeModel } from "@/layout/index";
import * as util from "@/util/util";
import { cn } from "@/util/util";
import * as jotai from "jotai";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { BlockFrameProps } from "./blocktypes";

function getDurableIconProps(
    jobStatus: BlockJobStatusData,
    connStatus: ConnStatus,
    t: (key: string, options?: any) => string
) {
    let color = "text-muted";
    let titleText = t("block.durableSession.base");
    const status = jobStatus?.status;
    if (status === "connected") {
        color = "text-green-500";
        titleText = t("block.durableSession.attached");
    } else if (status === "disconnected") {
        color = "text-sky-300";
        titleText = t("block.durableSession.detached");
    } else if (status === "init") {
        color = "text-sky-300";
        titleText = t("block.durableSession.starting");
    } else if (status === "done") {
        color = "text-muted";
        const doneReason = jobStatus?.donereason;
        if (doneReason === "terminated") {
            titleText = t("block.durableSession.endedExited");
        } else if (doneReason === "gone") {
            titleText = t("block.durableSession.endedEnvLost");
        } else if (doneReason === "startuperror") {
            titleText = t("block.durableSession.endedFailedStart");
        } else {
            titleText = t("block.durableSession.ended");
        }
    } else if (status == null) {
        if (!connStatus?.connected) {
            color = "text-muted";
            titleText = t("block.durableSession.awaitingConnection");
        } else {
            color = "text-muted";
            titleText = t("block.durableSession.noSession");
        }
    }
    return { color, titleText };
}

export function buildBlockFrameContextMenuItems(
    blockId: string,
    viewModel: ViewModel,
    nodeModel: NodeModel,
    t: (key: string, options?: any) => string
): ContextMenuItem[] {
    const magnified = globalStore.get(nodeModel.isMagnified);
    const menu: ContextMenuItem[] = [
        {
            label: magnified ? t("block.unMagnifyBlock") : t("block.magnifyBlock"),
            click: () => {
                nodeModel.toggleMagnify();
            },
        },
        { type: "separator" },
        {
            label: t("block.copyBlockId"),
            click: () => {
                navigator.clipboard.writeText(blockId);
            },
        },
    ];
    const extraItems = viewModel?.getSettingsMenuItems?.();
    if (extraItems && extraItems.length > 0) menu.push({ type: "separator" }, ...extraItems);
    menu.push(
        { type: "separator" },
        {
            label: t("block.closeBlock"),
            click: () => uxCloseBlock(blockId),
        }
    );
    return menu;
}

function handleHeaderContextMenu(
    e: React.MouseEvent<HTMLDivElement>,
    blockId: string,
    viewModel: ViewModel,
    nodeModel: NodeModel,
    t: (key: string, options?: any) => string
) {
    e.preventDefault();
    e.stopPropagation();
    ContextMenuModel.showContextMenu(buildBlockFrameContextMenuItems(blockId, viewModel, nodeModel, t), e);
}

type HeaderTextElemsProps = {
    headerTextUnion: string | HeaderElem[];
    preview: boolean;
    error?: Error;
    onDoubleClick?: React.MouseEventHandler<HTMLDivElement>;
};

const HeaderTextElems = React.memo(({ headerTextUnion, preview, error, onDoubleClick }: HeaderTextElemsProps) => {
    const { t } = useTranslation();
    const headerTextElems: React.ReactElement[] = [];
    if (typeof headerTextUnion === "string") {
        if (!util.isBlank(headerTextUnion)) {
            headerTextElems.push(
                <div key="text" className="block-frame-text ellipsis">
                    &lrm;{headerTextUnion}
                </div>
            );
        }
    } else if (Array.isArray(headerTextUnion)) {
        headerTextElems.push(...renderHeaderElements(headerTextUnion, preview));
    }
    if (error != null) {
        const copyHeaderErr = () => {
            navigator.clipboard.writeText(error.message + "\n" + error.stack);
        };
        headerTextElems.push(
            <div className="iconbutton disabled" key="controller-status" onClick={copyHeaderErr}>
                <i
                    className="fa-sharp fa-solid fa-triangle-exclamation"
                    title={t("block.errorRenderingHeader", { message: error.message })}
                />
            </div>
        );
    }

    if (headerTextElems.length === 0) {
        return null;
    }

    return (
        <div className="block-frame-textelems-wrapper" onDoubleClick={onDoubleClick}>
            {headerTextElems}
        </div>
    );
});
HeaderTextElems.displayName = "HeaderTextElems";

type HeaderEndIconsProps = {
    viewModel: ViewModel;
    nodeModel: NodeModel;
    blockId: string;
    currentView: string;
    isTerminalBlock: boolean;
    shellState: "ready" | "running-command" | null;
    lastOutputTs: number;
    lastCommandDoneTs: number;
    liveDisplayCwd?: string;
};

const MODE_TOGGLE_ICON = "gauge-high";

function CodexBrandMark() {
    return (
        <svg viewBox="0 0 158.7128 157.296" aria-hidden="true" focusable="false">
            <path
                fill="currentColor"
                d="M60.8734,57.2556v-14.9432c0-1.2586.4722-2.2029,1.5728-2.8314l30.0443-17.3023c4.0899-2.3593,8.9662-3.4599,13.9988-3.4599,18.8759,0,30.8307,14.6289,30.8307,30.2006,0,1.1007,0,2.3593-.158,3.6178l-31.1446-18.2467c-1.8872-1.1006-3.7754-1.1006-5.6629,0l-39.4812,22.9651ZM131.0276,115.4561v-35.7074c0-2.2028-.9446-3.7756-2.8318-4.8763l-39.481-22.9651,12.8982-7.3934c1.1007-.6285,2.0453-.6285,3.1458,0l30.0441,17.3024c8.6523,5.0341,14.4708,15.7296,14.4708,26.1107,0,11.9539-7.0769,22.965-18.2461,27.527v.0021ZM51.593,83.9964l-12.8982-7.5497c-1.1007-.6285-1.5728-1.5728-1.5728-2.8314v-34.6048c0-16.8303,12.8982-29.5722,30.3585-29.5722,6.607,0,12.7403,2.2029,17.9324,6.1349l-30.987,17.9324c-1.8871,1.1007-2.8314,2.6735-2.8314,4.8764v45.6159l-.0014-.0015ZM79.3562,100.0403l-18.4829-10.3811v-22.0209l18.4829-10.3811,18.4812,10.3811v22.0209l-18.4812,10.3811ZM91.2319,147.8591c-6.607,0-12.7403-2.2031-17.9324-6.1344l30.9866-17.9333c1.8872-1.1005,2.8318-2.6728,2.8318-4.8759v-45.616l13.0564,7.5498c1.1005.6285,1.5723,1.5728,1.5723,2.8314v34.6051c0,16.8297-13.0564,29.5723-30.5147,29.5723v.001ZM53.9522,112.7822l-30.0443-17.3024c-8.652-5.0343-14.471-15.7296-14.471-26.1107,0-12.1119,7.2356-22.9652,18.403-27.5272v35.8634c0,2.2028.9443,3.7756,2.8314,4.8763l39.3248,22.8068-12.8982,7.3938c-1.1007.6287-2.045.6287-3.1456,0ZM52.2229,138.5791c-17.7745,0-30.8306-13.3713-30.8306-29.8871,0-1.2585.1578-2.5169.3143-3.7754l30.987,17.9323c1.8871,1.1005,3.7757,1.1005,5.6628,0l39.4811-22.807v14.9435c0,1.2585-.4721,2.2021-1.5728,2.8308l-30.0443,17.3025c-4.0898,2.359-8.9662,3.4605-13.9989,3.4605h.0014ZM91.2319,157.296c19.0327,0,34.9188-13.5272,38.5383-31.4594,17.6164-4.562,28.9425-21.0779,28.9425-37.908,0-11.0112-4.719-21.7066-13.2133-29.4143.7867-3.3035,1.2595-6.607,1.2595-9.909,0-22.4929-18.2471-39.3247-39.3251-39.3247-4.2461,0-8.3363.6285-12.4262,2.045-7.0792-6.9213-16.8318-11.3254-27.5271-11.3254-19.0331,0-34.9191,13.5268-38.5384,31.4591C11.3255,36.0212,0,52.5373,0,69.3675c0,11.0112,4.7184,21.7065,13.2125,29.4142-.7865,3.3035-1.2586,6.6067-1.2586,9.9092,0,22.4923,18.2466,39.3241,39.3248,39.3241,4.2462,0,8.3362-.6277,12.426-2.0441,7.0776,6.921,16.8302,11.3251,27.5271,11.3251Z"
            />
        </svg>
    );
}

function ClaudeBrandMark() {
    return (
        <svg viewBox="0 0 1200 1200" aria-hidden="true" focusable="false">
            <path
                fill="currentColor"
                d="M 233.959793 800.214905 L 468.644287 668.536987 L 472.590637 657.100647 L 468.644287 650.738403 L 457.208069 650.738403 L 417.986633 648.322144 L 283.892639 644.69812 L 167.597321 639.865845 L 54.926208 633.825623 L 26.577238 627.785339 L 3.3e-05 592.751709 L 2.73832 575.27533 L 26.577238 559.248352 L 60.724873 562.228149 L 136.187973 567.382629 L 249.422867 575.194763 L 331.570496 580.026978 L 453.261841 592.671082 L 472.590637 592.671082 L 475.328857 584.859009 L 468.724915 580.026978 L 463.570557 575.194763 L 346.389313 495.785217 L 219.543671 411.865906 L 153.100723 363.543762 L 117.181267 339.060425 L 99.060455 316.107361 L 91.248367 266.01355 L 123.865784 230.093994 L 167.677887 233.073853 L 178.872513 236.053772 L 223.248367 270.201477 L 318.040283 343.570496 L 441.825592 434.738342 L 459.946411 449.798706 L 467.194672 444.64447 L 468.080597 441.020203 L 459.946411 427.409485 L 392.617493 305.718323 L 320.778564 181.932983 L 288.80542 130.630859 L 280.348999 99.865845 C 277.369171 87.221436 275.194641 76.590698 275.194641 63.624268 L 312.322174 13.20813 L 332.8591 6.604126 L 382.389313 13.20813 L 403.248352 31.328979 L 434.013519 101.71814 L 483.865753 212.537048 L 561.181274 363.221497 L 583.812134 407.919434 L 595.892639 449.315491 L 600.40271 461.959839 L 608.214783 461.959839 L 608.214783 454.711609 L 614.577271 369.825623 L 626.335632 265.61084 L 637.771851 131.516846 L 641.718201 93.745117 L 660.402832 48.483276 L 697.530334 24.000122 L 726.52356 37.852417 L 750.362549 72 L 747.060486 94.067139 L 732.886047 186.201416 L 705.100708 330.52356 L 686.979919 427.167847 L 697.530334 427.167847 L 709.61084 415.087341 L 758.496704 350.174561 L 840.644348 247.490051 L 876.885925 206.738342 L 919.167847 161.71814 L 946.308838 140.29541 L 997.61084 140.29541 L 1035.38269 196.429626 L 1018.469849 254.416199 L 965.637634 321.422852 L 921.825562 378.201538 L 859.006714 462.765259 L 819.785278 530.41626 L 823.409424 535.812073 L 832.75177 534.92627 L 974.657776 504.724915 L 1051.328979 490.872559 L 1142.818848 475.167786 L 1184.214844 494.496582 L 1188.724854 514.147644 L 1172.456421 554.335693 L 1074.604126 578.496765 L 959.838989 601.449829 L 788.939636 641.879272 L 786.845764 643.409485 L 789.261841 646.389343 L 866.255127 653.637634 L 899.194702 655.409424 L 979.812134 655.409424 L 1129.932861 666.604187 L 1169.154419 692.537109 L 1192.671265 724.268677 L 1188.724854 748.429688 L 1128.322144 779.194641 L 1046.818848 759.865845 L 856.590759 714.604126 L 791.355774 698.335754 L 782.335693 698.335754 L 782.335693 703.731567 L 836.69812 756.885986 L 936.322205 846.845581 L 1061.073975 962.81897 L 1067.436279 991.490112 L 1051.409424 1014.120911 L 1034.496704 1011.704712 L 924.885986 929.234924 L 882.604126 892.107544 L 786.845764 811.48999 L 780.483276 811.48999 L 780.483276 819.946289 L 802.550415 852.241699 L 919.087341 1027.409424 L 925.127625 1081.127686 L 916.671204 1098.604126 L 886.469849 1109.154419 L 853.288696 1103.114136 L 785.073914 1007.355835 L 714.684631 899.516785 L 657.906067 802.872498 L 650.979858 806.81897 L 617.476624 1167.704834 L 601.771851 1186.147705 L 565.530212 1200 L 535.328857 1177.046997 L 519.302124 1139.919556 L 535.328857 1066.550537 L 554.657776 970.792053 L 570.362488 894.68457 L 584.536926 800.134277 L 592.993347 768.724976 L 592.429626 766.630859 L 585.503479 767.516968 L 514.22821 865.369263 L 405.825531 1011.865906 L 320.053711 1103.677979 L 299.516815 1111.812256 L 263.919525 1093.369263 L 267.221497 1060.429688 L 287.114136 1031.114136 L 405.825531 880.107361 L 477.422913 786.52356 L 523.651062 732.483276 L 523.328918 724.671265 L 520.590698 724.671265 L 205.288605 929.395935 L 149.154434 936.644409 L 124.993355 914.01355 L 127.973183 876.885986 L 139.409409 864.80542 L 234.201385 799.570435 L 233.879227 799.8927 Z"
            />
        </svg>
    );
}

function AgentHeaderButtonIcon({ kind }: { kind: "codex" | "claude" }) {
    return <span className={cn("agent-brand-mark", kind)}>{kind === "codex" ? <CodexBrandMark /> : <ClaudeBrandMark />}</span>;
}

function isModeToggleButton(elem: HeaderElem | IconButtonDecl | null | undefined): elem is IconButtonDecl {
    return elem?.elemtype === "iconbutton" && elem.icon === MODE_TOGGLE_ICON;
}

export function getModeToggleButtonTitle(
    currentView: string,
    meta?: MetaType | null,
    currentTitle?: string
): string {
    if (currentView === "workbench") {
        const traditionalView = getTraditionalView(meta);
        const traditionalViewName = blockViewToName(traditionalView);
        return traditionalView === "term" ? "返回终端" : `返回${traditionalViewName}`;
    }
    if (currentView === "term") {
        return "进入工作台";
    }
    if (currentView) {
        return "进入工作台";
    }
    return currentTitle ?? "";
}

export function createWorkbenchModeToggleButton(
    currentView: string,
    blockId: string,
    meta?: MetaType | null
): IconButtonDecl | null {
    const title = getModeToggleButtonTitle(currentView, meta);
    if (!title) {
        return null;
    }
    return {
        elemtype: "iconbutton",
        icon: MODE_TOGGLE_ICON,
        iconColor: "var(--accent-color)",
        className: cn("toggle", currentView === "workbench" && "active"),
        title,
        click: () => void toggleWorkbenchMode(blockId),
    };
}

export function resolveTerminalSpeechAutoPlay(rawValue: unknown): boolean {
    return typeof rawValue === "boolean" ? rawValue : true;
}

export function resolveTerminalSpeechAutoPlayVisualState(
    rawValue: unknown,
    optimisticValue: boolean | null | undefined
): boolean {
    return typeof optimisticValue === "boolean" ? optimisticValue : resolveTerminalSpeechAutoPlay(rawValue);
}

export function shouldSeedTerminalSpeechAutoPlayConfig(options: {
    isTerminalBlock: boolean;
    speechAutoPlayRaw: unknown;
    hasSeeded: boolean;
}): boolean {
    return options.isTerminalBlock && !options.hasSeeded && typeof options.speechAutoPlayRaw !== "boolean";
}

type TerminalSpeechChainLabelInput = Pick<
    ResolvedSpeechSettings,
    "endpoint" | "localEngine" | "model" | "transport" | "voice" | "voiceAssistant"
>;

export function getTerminalSpeechChainLabel(settings: TerminalSpeechChainLabelInput): string {
    const endpoint = settings.endpoint?.trim() ?? "";
    const voice = (settings.voiceAssistant || settings.voice || "").trim();
    const engineLabel =
        endpoint.startsWith("wave://edge-tts/") || settings.localEngine === "edge"
            ? "Edge 内置语音"
            : settings.transport === "api"
              ? "语音接口"
              : "浏览器语音";
    return [engineLabel, settings.model?.trim(), voice].filter(Boolean).join(" / ");
}

export function getTerminalSpeechAutoPlayTitle(_autoPlay: boolean): string {
    return "自动播报";
}

export function getTerminalSpeechManualButtonTitle(speechActive: boolean): string {
    return speechActive ? "停止当前播报" : "播放最近正式回复";
}

export function shouldShowSharedHeaderSpeechButton(isTerminalBlock: boolean): boolean {
    return isTerminalBlock;
}

export function isTerminalLikeBlockView(currentView: string): boolean {
    return currentView === "term" || currentView === "workbench";
}

export function shouldUseTerminalFormalReplySource(currentView: string): boolean {
    return isTerminalLikeBlockView(currentView);
}

export function shouldRefreshTerminalFormalReplyFromScrollback(currentView: string): boolean {
    return currentView === "term";
}

export function shouldRefreshWorkbenchFormalReplyFromFile(currentView: string): boolean {
    return currentView === "workbench";
}

function getSharedHeaderFormalReplySourceMode(currentView: string): TerminalFormalReplySourceMode {
    return currentView === "workbench" ? "workbench" : "terminal";
}

function isAbsoluteTerminalHeaderPath(value: string): boolean {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) {
        return false;
    }
    return /^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("\\\\");
}

export function resolveTerminalHeaderPathLabel(
    liveDisplayCwd: string | null | undefined,
    meta?: MetaType | null
): string {
    const livePath = String(liveDisplayCwd ?? "").trim();
    const persistedPath = String(getTerminalDisplayCwd(meta) ?? "").trim();
    if (util.isBlank(livePath)) {
        return persistedPath;
    }
    if (util.isBlank(persistedPath)) {
        return livePath;
    }
    if (persistedPath.length > livePath.length && persistedPath.endsWith(livePath)) {
        return persistedPath;
    }
    if (isAbsoluteTerminalHeaderPath(persistedPath) && !isAbsoluteTerminalHeaderPath(livePath)) {
        return persistedPath;
    }
    return livePath;
}

export function shouldReplaceTerminalSpeechPayload(
    currentPayload: TerminalFormalReplyPayload | null | undefined,
    nextPayload: TerminalFormalReplyPayload
): boolean {
    if (!currentPayload) {
        return true;
    }
    if (currentPayload.id === nextPayload.id) {
        return false;
    }
    const currentText = String(currentPayload.text ?? "").trim();
    const nextText = String(nextPayload.text ?? "").trim();
    const currentOutputTs = Number(currentPayload.outputTs) || 0;
    const nextOutputTs = Number(nextPayload.outputTs) || 0;
    const duplicatePayloadWindowMs = 2000;
    const isRapidDuplicatePayload =
        currentText.length > 0 &&
        currentText === nextText &&
        currentOutputTs > 0 &&
        nextOutputTs >= currentOutputTs &&
        nextOutputTs - currentOutputTs <= duplicatePayloadWindowMs;
    if (isRapidDuplicatePayload) {
        return false;
    }
    return true;
}

const HeaderEndIcons = React.memo(
    ({
        viewModel,
        nodeModel,
        blockId,
        currentView,
        isTerminalBlock,
        shellState,
        lastOutputTs,
        lastCommandDoneTs,
        liveDisplayCwd,
    }: HeaderEndIconsProps) => {
        const { t } = useTranslation();
        const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
        const endIconButtons = util.useAtomValueSafe(viewModel?.endIconButtons);
        const modeToggleButton = React.useMemo(
            () => createWorkbenchModeToggleButton(currentView, blockId, blockData?.meta),
            [blockData?.meta, blockId, currentView]
        );
        const filteredEndIconButtons = React.useMemo(() => {
            if (!Array.isArray(endIconButtons)) {
                return [];
            }
            return endIconButtons.filter((button) => !isModeToggleButton(button));
        }, [endIconButtons]);
        const usesTerminalFormalReplySource = shouldUseTerminalFormalReplySource(currentView);
        const usesTerminalFormalReplyRefreshSource = shouldRefreshTerminalFormalReplyFromScrollback(currentView);
        const usesWorkbenchFormalReplyFileSource = shouldRefreshWorkbenchFormalReplyFromFile(currentView);
        const formalReplySourceMode = React.useMemo(
            () => getSharedHeaderFormalReplySourceMode(currentView),
            [currentView]
        );
        const currentMode = jotai.useAtomValue(waveAICurrentModeAtom);
        const aiModeConfigs = jotai.useAtomValue(atoms.waveaiModeConfigAtom);
        const currentModeConfig = aiModeConfigs?.[currentMode];
        const latestAssistantText = jotai.useAtomValue(waveAILatestAssistantMessageTextAtom);
        const isAIStreaming = jotai.useAtomValue(waveAIStreamingAtom);
        const speechEnabled = jotai.useAtomValue(getSettingsKeyAtom("speech:enabled"));
        const speechProvider = jotai.useAtomValue(getSettingsKeyAtom("speech:provider"));
        const speechEndpoint = jotai.useAtomValue(getSettingsKeyAtom("speech:endpoint"));
        const speechModel = jotai.useAtomValue(getSettingsKeyAtom("speech:model"));
        const speechVoice = jotai.useAtomValue(getSettingsKeyAtom("speech:voice"));
        const speechVoiceAssistant = jotai.useAtomValue(getSettingsKeyAtom("speech:voiceassistant"));
        const speechVoiceUser = jotai.useAtomValue(getSettingsKeyAtom("speech:voiceuser"));
        const speechVoiceSystem = jotai.useAtomValue(getSettingsKeyAtom("speech:voicesystem"));
        const speechFilterUrls = jotai.useAtomValue(getSettingsKeyAtom("speech:filterurls"));
        const speechFilterPaths = jotai.useAtomValue(getSettingsKeyAtom("speech:filterpaths"));
        const speechFilterCode = jotai.useAtomValue(getSettingsKeyAtom("speech:filtercode"));
        const speechAutoPlayRaw = jotai.useAtomValue(getSettingsKeyAtom("speech:autoplay"));
        const [speechAutoPlayOptimistic, setSpeechAutoPlayOptimistic] = React.useState<boolean | null>(null);
        const speechAutoPlay = resolveTerminalSpeechAutoPlayVisualState(speechAutoPlayRaw, speechAutoPlayOptimistic);
        const speechAutoPlayBaselineTsAtom = React.useMemo(() => {
        return useBlockAtom(blockId, "speech:autoplay-baseline-ts", () => {
            return jotai.atom(0) as jotai.PrimitiveAtom<number>;
        }) as jotai.PrimitiveAtom<number>;
    }, [blockId]);
        const [speechAutoPlayBaselineTs, setSpeechAutoPlayBaselineTs] = jotai.useAtom(speechAutoPlayBaselineTsAtom);
        const speechFormalReplyPayloadAtom = React.useMemo(() => {
            return useBlockAtom(blockId, "speech:formal-reply-payload", () => {
                return jotai.atom(null) as jotai.PrimitiveAtom<TerminalFormalReplyPayload | null>;
            }) as jotai.PrimitiveAtom<TerminalFormalReplyPayload | null>;
        }, [blockId]);
        const [speechFormalReplyPayload, setSpeechFormalReplyPayload] = jotai.useAtom(speechFormalReplyPayloadAtom);
        const speechAttentionActiveAtom = React.useMemo(() => {
            return useBlockAtom(blockId, "speech:attention-active", () => {
                return jotai.atom(false) as jotai.PrimitiveAtom<boolean>;
            }) as jotai.PrimitiveAtom<boolean>;
        }, [blockId]);
        const [, setSpeechAttentionActive] = jotai.useAtom(speechAttentionActiveAtom);
        const speechLastSpokenPayloadIdAtom = React.useMemo(() => {
            return useBlockAtom(blockId, "speech:last-spoken-payload-id", () => {
                return jotai.atom("") as jotai.PrimitiveAtom<string>;
            }) as jotai.PrimitiveAtom<string>;
        }, [blockId]);
    const [speechLastSpokenPayloadId, setSpeechLastSpokenPayloadId] = jotai.useAtom(speechLastSpokenPayloadIdAtom);
    const speechManualButton = jotai.useAtomValue(getSettingsKeyAtom("speech:manualbutton"));
    const speechRate = jotai.useAtomValue(getSettingsKeyAtom("speech:rate"));
    const speechLocalEngine = jotai.useAtomValue(getSettingsKeyAtom("speech:localengine"));
    const speechLocalModel = jotai.useAtomValue(getSettingsKeyAtom("speech:localmodel"));
    const speechLocalModelPath = jotai.useAtomValue(getSettingsKeyAtom("speech:localmodelpath"));
    const showCodexResumeButton = shouldShowCodexResumeButton(
        currentView,
        blockData?.meta?.connection,
        blockData?.meta?.["workbench:returnview"]
    );
    const codexResumeAvailable = canRunCodexResume(shellState);
    const speechSettings = React.useMemo(
        () =>
            resolveSpeechSettings(
                {
                    "speech:enabled": speechEnabled,
                    "speech:provider": speechProvider,
                    "speech:endpoint": speechEndpoint,
                    "speech:model": speechModel,
                    "speech:voice": speechVoice,
                    "speech:voiceassistant": speechVoiceAssistant,
                    "speech:voiceuser": speechVoiceUser,
                    "speech:voicesystem": speechVoiceSystem,
                    "speech:filterurls": speechFilterUrls,
                    "speech:filterpaths": speechFilterPaths,
                    "speech:filtercode": speechFilterCode,
                    "speech:autoplay": speechAutoPlay,
                    "speech:manualbutton": speechManualButton,
                    "speech:rate": speechRate,
                    "speech:localengine": speechLocalEngine,
                    "speech:localmodel": speechLocalModel,
                    "speech:localmodelpath": speechLocalModelPath,
                },
                currentModeConfig
            ),
        [
            currentModeConfig,
            speechEnabled,
            speechProvider,
            speechEndpoint,
            speechModel,
            speechVoice,
            speechVoiceAssistant,
            speechVoiceUser,
            speechVoiceSystem,
            speechFilterUrls,
            speechFilterPaths,
            speechFilterCode,
            speechAutoPlay,
            speechManualButton,
            speechRate,
            speechLocalEngine,
            speechLocalModel,
            speechLocalModelPath,
        ]
    );
    const [speechActive, setSpeechActive] = React.useState(false);
    React.useEffect(() => {
        return speechRuntime.subscribe(setSpeechActive, blockId);
    }, [blockId]);
    const reportSpeechError = React.useCallback((message: string) => {
        pushFlashError({
            id: "",
            icon: "triangle-exclamation",
            title: "朗读失败",
            message,
            expiration: Date.now() + 7000,
        } as any);
    }, []);
    const magnified = jotai.useAtomValue(nodeModel.isMagnified);
    const ephemeral = jotai.useAtomValue(nodeModel.isEphemeral);
    const numLeafs = jotai.useAtomValue(nodeModel.numLeafs);
    const magnifyDisabled = numLeafs <= 1;
    const getBlockCodexResumeLines = React.useCallback(async () => {
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
    }, [blockId]);
    const waitForBlockCodexResumeToBecomeInteractive = React.useCallback(async (baselineOutputTs: number) => {
        await waitForCodexResumeToBecomeInteractive({
            getSnapshot: async () => ({
                shellState: shellStateRef.current,
                outputTs: lastOutputTsRef.current,
                baselineOutputTs,
                lines: await getBlockCodexResumeLines(),
            }),
        });
    }, [getBlockCodexResumeLines]);
    const runHeaderAction = React.useCallback((title: string, action: () => Promise<void>) => {
        util.fireAndForget(async () => {
            try {
                await action();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                pushFlashError({
                    id: "",
                    icon: "triangle-exclamation",
                    title,
                    message,
                    expiration: Date.now() + 7000,
                });
            }
        });
    }, []);
    const launchCodexInCurrentTerminal = React.useCallback(() => {
        runHeaderAction("Codex 启动失败", async () => {
            if (currentView !== "term") {
                return;
            }
            await launchAgentCommandInCurrentTerminalBlock(blockId, "codex");
        });
    }, [blockId, currentView, runHeaderAction]);
    const launchClaudeInCurrentTerminal = React.useCallback(() => {
        runHeaderAction("Claude 启动失败", async () => {
            if (currentView !== "term") {
                return;
            }
            await launchAgentCommandInCurrentTerminalBlock(blockId, "cloud");
        });
    }, [blockId, currentView, runHeaderAction]);

    const endIconsElem: React.ReactElement[] = [];
    const payloadBuildTimerRef = React.useRef<number | null>(null);
    const payloadBuildRunIdRef = React.useRef(0);
    const autoPlayPendingPayloadIdRef = React.useRef("");
    const lastPayloadRefreshKeyRef = React.useRef("");
    const speechSettingsRef = React.useRef(speechSettings);
    const speechActiveRef = React.useRef(speechActive);
    const speechFormalReplyPayloadRef = React.useRef<TerminalFormalReplyPayload | null>(speechFormalReplyPayload);
    const speechLastSpokenPayloadIdRef = React.useRef(speechLastSpokenPayloadId);
    const speechAutoPlayBaselineTsRef = React.useRef(speechAutoPlayBaselineTs);
    const speechAutoPlayConfigSeededRef = React.useRef(typeof speechAutoPlayRaw === "boolean");
    const isTerminalBlockRef = React.useRef(isTerminalBlock);
    const lastOutputTsRef = React.useRef(Number(lastOutputTs) || 0);
    const lastCommandDoneTsRef = React.useRef(Number(lastCommandDoneTs) || 0);
    const shellStateRef = React.useRef(shellState);
    React.useEffect(() => {
        speechSettingsRef.current = speechSettings;
    }, [speechSettings]);
    React.useEffect(() => {
        speechActiveRef.current = speechActive;
    }, [speechActive]);
    React.useEffect(() => {
        speechFormalReplyPayloadRef.current = speechFormalReplyPayload;
    }, [speechFormalReplyPayload]);
    React.useEffect(() => {
        speechLastSpokenPayloadIdRef.current = speechLastSpokenPayloadId;
    }, [speechLastSpokenPayloadId]);
    React.useEffect(() => {
        speechAutoPlayBaselineTsRef.current = Number(speechAutoPlayBaselineTs) || 0;
    }, [speechAutoPlayBaselineTs]);
    React.useEffect(() => {
        if (speechAutoPlayOptimistic == null || typeof speechAutoPlayRaw !== "boolean") {
            return;
        }
        if (speechAutoPlayOptimistic === speechAutoPlayRaw) {
            setSpeechAutoPlayOptimistic(null);
        }
    }, [speechAutoPlayOptimistic, speechAutoPlayRaw]);
    React.useEffect(() => {
        if (typeof speechAutoPlayRaw === "boolean") {
            speechAutoPlayConfigSeededRef.current = true;
            return;
        }
        if (
            !shouldSeedTerminalSpeechAutoPlayConfig({
                isTerminalBlock,
                speechAutoPlayRaw,
                hasSeeded: speechAutoPlayConfigSeededRef.current,
            })
        ) {
            return;
        }
        speechAutoPlayConfigSeededRef.current = true;
        void RpcApi.SetConfigCommand(TabRpcClient, { "speech:autoplay": true });
    }, [isTerminalBlock, speechAutoPlayRaw]);
    React.useEffect(() => {
        isTerminalBlockRef.current = isTerminalBlock;
    }, [isTerminalBlock]);
    React.useEffect(() => {
        const ts = Number(lastOutputTs);
        lastOutputTsRef.current = Number.isFinite(ts) && ts > 0 ? ts : 0;
    }, [lastOutputTs]);
    React.useEffect(() => {
        const ts = Number(lastCommandDoneTs);
        lastCommandDoneTsRef.current = Number.isFinite(ts) && ts > 0 ? ts : 0;
    }, [lastCommandDoneTs]);
    React.useEffect(() => {
        shellStateRef.current = shellState;
    }, [shellState]);

    const isIgnorableSpeechError = React.useCallback((message: string) => {
        const trimmed = (message ?? "").trim();
        if (!trimmed) {
            return true;
        }
        if (trimmed.includes("没有检测到可播报的 AI 正式回复")) {
            return true;
        }
        const lowered = trimmed.toLowerCase();
        return (
            lowered.includes("no text content") ||
            lowered.includes("interrupted") ||
            lowered.includes("abort") ||
            lowered.includes("aborted") ||
            lowered.includes("cancelled") ||
            lowered.includes("canceled")
        );
    }, []);
    const clearPayloadBuildTimer = React.useCallback(() => {
        if (payloadBuildTimerRef.current != null) {
            window.clearTimeout(payloadBuildTimerRef.current);
            payloadBuildTimerRef.current = null;
        }
    }, []);
    const cancelAutoSpeech = React.useCallback((stopPlayback: boolean) => {
        clearPayloadBuildTimer();
        payloadBuildRunIdRef.current += 1;
        autoPlayPendingPayloadIdRef.current = "";
        if (stopPlayback) {
            speechRuntime.stop(blockId);
        }
    }, [blockId, clearPayloadBuildTimer]);

    if (modeToggleButton != null) {
        endIconsElem.push(<IconButton key="workbench-mode-toggle" decl={modeToggleButton} />);
    }
    if (filteredEndIconButtons.length > 0) {
        endIconsElem.push(...filteredEndIconButtons.map((button, idx) => <IconButton key={idx} decl={button} />));
    }
    if (currentView === "term") {
        const codexLaunchDecl: IconButtonDecl = {
            elemtype: "iconbutton",
            icon: <AgentHeaderButtonIcon kind="codex" />,
            title: "在当前终端启动 Codex",
            click: () => launchCodexInCurrentTerminal(),
        };
        endIconsElem.push(
            <IconButton key="codex-agent-launch" decl={codexLaunchDecl} className="block-frame-agent-launch" />
        );
        const claudeLaunchDecl: IconButtonDecl = {
            elemtype: "iconbutton",
            icon: <AgentHeaderButtonIcon kind="claude" />,
            title: "在当前终端启动 Claude",
            click: () => launchClaudeInCurrentTerminal(),
        };
        endIconsElem.push(
            <IconButton key="claude-agent-launch" decl={claudeLaunchDecl} className="block-frame-agent-launch" />
        );
    }
    const speechChainLabel = getTerminalSpeechChainLabel(speechSettings);
    const speechHint = speechChainLabel ? `（${speechChainLabel}）` : "";
    const speechDisabledTitle = "语音播报已关闭";
    const stopSpeechTitle = getTerminalSpeechManualButtonTitle(true);
    const readOutputTitle = getTerminalSpeechManualButtonTitle(false);
    const readReplyTitle = "朗读最新回复";
    const noTextContentTitle = "当前没有可朗读的回复";
    const waitForFinalTitle = "仍在生成中，请等回复完成后再播报。";
    const speakTerminalPayload = React.useCallback(
        async (payload: TerminalFormalReplyPayload): Promise<boolean> => {
            const started = await playTerminalFormalReplyPayload({
                payload,
                speechSettings: speechSettingsRef.current,
                ownerId: blockId,
                onError: (errorMessage) => {
                    if (isIgnorableSpeechError(errorMessage)) {
                        return;
                    }
                    globalStore.set(waveAIErrorAtom, errorMessage);
                    reportSpeechError(errorMessage);
                },
            });
            if (started) {
                speechLastSpokenPayloadIdRef.current = payload.id;
                setSpeechLastSpokenPayloadId(payload.id);
            }
            return started;
        },
        [blockId, isIgnorableSpeechError, reportSpeechError, setSpeechLastSpokenPayloadId]
    );
    const resolveTerminalFormalReplyPayload = React.useCallback(
        async (options?: {
            freshnessTs?: number;
            payloadTs?: number;
            strictFreshness?: boolean;
        }): Promise<TerminalFormalReplyPayload | null> => {
            const normalizedFreshnessTs = Number(options?.freshnessTs);
            const normalizedPayloadTs = Number(options?.payloadTs);
            const hasFreshnessTs = Number.isFinite(normalizedFreshnessTs) && normalizedFreshnessTs > 0;
            const hasPayloadTs = Number.isFinite(normalizedPayloadTs) && normalizedPayloadTs > 0;
            const strictFreshness = options?.strictFreshness ?? true;
            const minLastUpdatedTs = strictFreshness && hasFreshnessTs ? Math.floor(normalizedFreshnessTs) : 0;
            const payload = await loadLatestTerminalFormalReplyPayload({
                blockId,
                preferLastCommand: shellStateRef.current !== null,
                minLastUpdatedTs,
                requirePromptAfterCodexReply: true,
                outputTs: hasPayloadTs
                    ? Math.floor(normalizedPayloadTs)
                    : hasFreshnessTs
                      ? Math.floor(normalizedFreshnessTs)
                      : Date.now(),
                onError: (errorMessage) => {
                    if (isIgnorableSpeechError(errorMessage)) {
                        return;
                    }
                    globalStore.set(waveAIErrorAtom, errorMessage);
                },
            });
            if (payload) {
                const currentPayload = speechFormalReplyPayloadRef.current;
                const shouldReplacePayload = shouldReplaceTerminalSpeechPayload(currentPayload, payload);
                if (!shouldReplacePayload) {
                    return currentPayload ?? payload;
                }
                if (shouldReplacePayload) {
                    speechFormalReplyPayloadRef.current = payload;
                    setSpeechFormalReplyPayload(payload);
                }
                return payload;
            }
            return null;
        },
        [blockId, isIgnorableSpeechError, setSpeechFormalReplyPayload]
    );
    const resolveWorkbenchFormalReplyPayload = React.useCallback(
        async (options?: { requireLatestEntryAssistant?: boolean }): Promise<TerminalFormalReplyPayload | null> => {
            const payload = await loadLatestWorkbenchFormalReplyPayload({
                blockId,
                requireLatestEntryAssistant: options?.requireLatestEntryAssistant ?? false,
                onError: (errorMessage) => {
                    if (isIgnorableSpeechError(errorMessage)) {
                        return;
                    }
                    globalStore.set(waveAIErrorAtom, errorMessage);
                },
            });
            if (!payload) {
                return null;
            }
            const currentPayload = speechFormalReplyPayloadRef.current;
            const shouldReplacePayload = shouldReplaceTerminalSpeechPayload(currentPayload, payload);
            if (!shouldReplacePayload) {
                return currentPayload ?? payload;
            }
            speechFormalReplyPayloadRef.current = payload;
            setSpeechFormalReplyPayload(payload);
            return payload;
        },
        [blockId, isIgnorableSpeechError, setSpeechFormalReplyPayload]
    );
    const scheduleTerminalPayloadRefresh = React.useCallback(
        (anchor: TerminalSpeechCompletionAnchor, attempt = 0) => {
            const delayMs = getTerminalFormalReplyRefreshDelayMs(attempt);
            if (delayMs == null) {
                return;
            }
            clearPayloadBuildTimer();
            const runId = ++payloadBuildRunIdRef.current;
            payloadBuildTimerRef.current = window.setTimeout(() => {
                payloadBuildTimerRef.current = null;
                void (async () => {
                    if (runId !== payloadBuildRunIdRef.current) {
                        return;
                    }
                    if (!isTerminalBlockRef.current) {
                        return;
                    }
                    const currentAnchor = getTerminalSpeechCompletionAnchor({
                        shellState: shellStateRef.current,
                        lastCommandDoneTs: lastCommandDoneTsRef.current,
                        lastOutputTs: lastOutputTsRef.current,
                    });
                    if (!currentAnchor) {
                        return;
                    }
                    if (anchor.source === "command-done") {
                        if (currentAnchor.source !== "command-done" || currentAnchor.freshnessTs !== anchor.freshnessTs) {
                            return;
                        }
                    }
                    const payload = await resolveTerminalFormalReplyPayload({
                        freshnessTs: anchor.freshnessTs,
                        payloadTs: anchor.payloadTs,
                        strictFreshness: true,
                    });
                    if (payload) {
                        return;
                    }
                    if (anchor.source !== "command-done") {
                        return;
                    }
                    if (shellStateRef.current !== "ready") {
                        return;
                    }
                    if ((Number(lastCommandDoneTsRef.current) || 0) !== anchor.freshnessTs) {
                        return;
                    }
                    scheduleTerminalPayloadRefresh(anchor, attempt + 1);
                })();
            }, delayMs);
        },
        [clearPayloadBuildTimer, resolveTerminalFormalReplyPayload]
    );
    const speechDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: speechActive ? "stop" : "volume-high",
        title:
            (!speechSettings.enabled
                ? speechDisabledTitle
                : speechActive
                  ? stopSpeechTitle
                  : isTerminalBlock
                    ? readOutputTitle
                    : !latestAssistantText?.trim()
                    ? noTextContentTitle
                    : readReplyTitle
            ).trim() + (speechHint ? ` ${speechHint}` : ""),
        click: () => {
            if (speechActive) {
                speechRuntime.stop(blockId);
                return;
            }
            if (!speechSettings.enabled) {
                globalStore.set(waveAIErrorAtom, speechDisabledTitle);
                reportSpeechError("语音播报已关闭，请到“设置 -> 语音播报”打开总开关。");
                return;
            }
            if (!isTerminalBlock) {
                if (isAIStreaming) {
                    globalStore.set(waveAIErrorAtom, waitForFinalTitle);
                    reportSpeechError("还在生成回复，等它结束再点播报。");
                    return;
                }
                void speechRuntime.play(latestAssistantText ?? "", speechSettings, "assistant", (errorMessage) => {
                    if (isIgnorableSpeechError(errorMessage)) {
                        return;
                    }
                    globalStore.set(waveAIErrorAtom, errorMessage);
                    reportSpeechError(errorMessage);
                }, { ownerId: blockId });
                return;
            }
            cancelAutoSpeech(false);
            const currentOutputTs = Number(lastOutputTsRef.current);
            void (async () => {
                let payload = speechFormalReplyPayloadRef.current;
                if (currentView === "term") {
                    const currentAnchor = getTerminalSpeechCompletionAnchor({
                        shellState: shellStateRef.current,
                        lastCommandDoneTs: lastCommandDoneTsRef.current,
                        lastOutputTs: currentOutputTs,
                    });
                    payload = await resolveTerminalFormalReplyPayload({
                        freshnessTs: currentAnchor?.freshnessTs ?? currentOutputTs,
                        payloadTs: currentAnchor?.payloadTs ?? currentOutputTs,
                        strictFreshness: true,
                    });
                    const canRelaxFreshness = shellStateRef.current !== "running-command";
                    if (!payload && canRelaxFreshness) {
                        payload = await resolveTerminalFormalReplyPayload({
                            payloadTs: currentAnchor?.payloadTs ?? currentOutputTs,
                            strictFreshness: false,
                        });
                    }
                } else if (!payload || !payload.text.trim()) {
                    payload = await resolveWorkbenchFormalReplyPayload();
                }
                if (!payload) {
                    const message = "没有检测到可播报的 AI 正式回复。";
                    globalStore.set(waveAIErrorAtom, message);
                    reportSpeechError(message);
                    return;
                }
                await speakTerminalPayload(payload);
            })();
        },
        disabled: false,
    };
    React.useEffect(() => {
        if (!usesTerminalFormalReplyRefreshSource) {
            return;
        }
        const anchor = getTerminalSpeechCompletionAnchor({
            shellState,
            lastCommandDoneTs,
            lastOutputTs,
        });
        if (!anchor) {
            return;
        }
        const refreshKey = `${anchor.source}:${anchor.freshnessTs}:${anchor.payloadTs}`;
        if (lastPayloadRefreshKeyRef.current === refreshKey) {
            return;
        }
        lastPayloadRefreshKeyRef.current = refreshKey;
        scheduleTerminalPayloadRefresh(anchor);
    }, [lastCommandDoneTs, lastOutputTs, scheduleTerminalPayloadRefresh, shellState, usesTerminalFormalReplyRefreshSource]);
    React.useEffect(() => {
        if (!usesWorkbenchFormalReplyFileSource) {
            return;
        }
        const fileSubject = getFileSubject(blockId, "aidata");
        const subscription = fileSubject.subscribe(() => {
            void resolveWorkbenchFormalReplyPayload({ requireLatestEntryAssistant: true });
        });
        return () => {
            subscription.unsubscribe();
            fileSubject.release();
        };
    }, [blockId, resolveWorkbenchFormalReplyPayload, usesWorkbenchFormalReplyFileSource]);

    const prevAutoPlayRef = React.useRef(speechSettings.autoPlay);
    const autoPlayBaselineInitializedRef = React.useRef(false);
    const sessionStartTsRef = React.useRef(Date.now());
    const autoPlayStartupSuppressedRef = React.useRef(false);
    React.useEffect(() => {
        // Establish a per-session baseline so we never auto-play historical scrollback
        // restored during startup. This must not persist across app restarts.
        if (!usesTerminalFormalReplySource || !speechSettings.enabled || !speechSettings.autoPlay) {
            autoPlayBaselineInitializedRef.current = false;
            autoPlayStartupSuppressedRef.current = false;
            return;
        }
        if (autoPlayBaselineInitializedRef.current) {
            return;
        }
        autoPlayBaselineInitializedRef.current = true;
        const baselineTs = getTerminalSpeechAutoPlayBaselineTs(
            {
                shellState: shellStateRef.current,
                lastCommandDoneTs: lastCommandDoneTsRef.current,
                lastOutputTs: lastOutputTsRef.current,
            },
            Date.now()
        );
        speechAutoPlayBaselineTsRef.current = baselineTs;
        setSpeechAutoPlayBaselineTs(baselineTs);
    }, [setSpeechAutoPlayBaselineTs, speechSettings.autoPlay, speechSettings.enabled, usesTerminalFormalReplySource]);
    React.useEffect(() => {
        // Suppress auto-play for any formal reply payload restored from a previous session.
        // A new reply generated after startup should still auto-play normally.
        if (!usesTerminalFormalReplySource || !speechSettings.enabled || !speechSettings.autoPlay) {
            autoPlayStartupSuppressedRef.current = false;
            return;
        }
        if (autoPlayStartupSuppressedRef.current) {
            return;
        }
        const payload = speechFormalReplyPayload;
        if (!payload?.id || !payload.text.trim()) {
            return;
        }
        const payloadTs = Number(payload.outputTs) || 0;
        const baselineTs = Number(speechAutoPlayBaselineTsRef.current) || 0;
        const sessionStartTs = Number(sessionStartTsRef.current) || 0;
        const looksLikeEpochMs = payloadTs >= 1000 * 1000 * 1000 * 1000;
        const isRestoredFromHistory = looksLikeEpochMs && sessionStartTs > 0 && payloadTs < sessionStartTs;

        if (isRestoredFromHistory) {
            autoPlayStartupSuppressedRef.current = true;
            speechLastSpokenPayloadIdRef.current = payload.id;
            setSpeechLastSpokenPayloadId(payload.id);
            const nextBaselineTs = Math.max(baselineTs, payloadTs, sessionStartTs);
            if (nextBaselineTs > 0 && nextBaselineTs !== baselineTs) {
                speechAutoPlayBaselineTsRef.current = nextBaselineTs;
                setSpeechAutoPlayBaselineTs(nextBaselineTs);
            }
            return;
        }

        // First payload arrived during this session; do not suppress it (autoplay effect will handle).
        autoPlayStartupSuppressedRef.current = true;
    }, [
        setSpeechAutoPlayBaselineTs,
        setSpeechLastSpokenPayloadId,
        speechFormalReplyPayload,
        speechSettings.autoPlay,
        speechSettings.enabled,
        usesTerminalFormalReplySource,
    ]);
    React.useEffect(() => {
        const prevAutoPlay = prevAutoPlayRef.current;
        prevAutoPlayRef.current = speechSettings.autoPlay;
        if (!usesTerminalFormalReplySource || !speechSettings.enabled || !speechSettings.autoPlay) {
            const shouldStopActivePlayback =
                usesTerminalFormalReplySource &&
                prevAutoPlay &&
                (!speechSettings.autoPlay || !speechSettings.enabled);
            cancelAutoSpeech(shouldStopActivePlayback);
            if (usesTerminalFormalReplySource && !speechSettings.enabled) {
                speechAutoPlayBaselineTsRef.current = 0;
                setSpeechAutoPlayBaselineTs(0);
            }
            return;
        }
        const payload = speechFormalReplyPayload;
        if (!payload || !payload.text.trim()) {
            return;
        }
        if (
            !shouldAutoPlayTerminalFormalReply({
                payload,
                sourceMode: formalReplySourceMode,
                shellState: shellStateRef.current,
                sessionStartTs: sessionStartTsRef.current,
                lastCommandDoneTs: lastCommandDoneTsRef.current,
                lastOutputTs: lastOutputTsRef.current,
                baselineTs: speechAutoPlayBaselineTsRef.current,
                lastSpokenPayloadId: speechLastSpokenPayloadIdRef.current,
                pendingPayloadId: autoPlayPendingPayloadIdRef.current,
                speechActive: speechActiveRef.current,
            })
        ) {
            return;
        }
        autoPlayPendingPayloadIdRef.current = payload.id;
        void (async () => {
            try {
                setSpeechAttentionActive(true);
                await speakTerminalPayload(payload);
            } finally {
                if (autoPlayPendingPayloadIdRef.current === payload.id) {
                    autoPlayPendingPayloadIdRef.current = "";
                }
            }
        })();
    }, [
        cancelAutoSpeech,
        speakTerminalPayload,
        speechFormalReplyPayload,
        speechSettings.autoPlay,
        speechSettings.enabled,
        formalReplySourceMode,
        setSpeechAttentionActive,
        usesTerminalFormalReplySource,
    ]);

    React.useEffect(() => {
        return () => {
            cancelAutoSpeech(false);
        };
    }, [cancelAutoSpeech]);

    if (isTerminalBlock) {
        const autoPlayDecl: IconButtonDecl = {
            elemtype: "iconbutton",
            icon: "arrows-rotate",
            className: speechAutoPlay ? "toggle active" : "toggle",
            iconColor: speechAutoPlay ? "var(--success-color)" : "var(--secondary-text-color)",
            title: getTerminalSpeechAutoPlayTitle(speechAutoPlay),
            click: () => {
                const nextAutoPlay = !speechAutoPlay;
                speechAutoPlayConfigSeededRef.current = true;
                setSpeechAutoPlayOptimistic(nextAutoPlay);
                void Promise.resolve(RpcApi.SetConfigCommand(TabRpcClient, { "speech:autoplay": nextAutoPlay })).catch(
                    (error) => {
                        setSpeechAutoPlayOptimistic(null);
                        const message = error instanceof Error ? error.message : String(error);
                        reportSpeechError(`自动播报切换失败：${message}`);
                    }
                );
            },
            disabled: false,
        };
        endIconsElem.push(<IconButton key="speech-autoplay" decl={autoPlayDecl} className="block-frame-speech-autoplay" />);
    }

    const showSpeechButton = shouldShowSharedHeaderSpeechButton(isTerminalBlock);
    if (showSpeechButton) {
        endIconsElem.push(<IconButton key="speech" decl={speechDecl} className="block-frame-speech" />);
    }
    if (showCodexResumeButton) {
        const codexResumeDecl: IconButtonDecl = {
            elemtype: "iconbutton",
            icon: "clock-rotate-left",
            iconColor: codexResumeAvailable ? "var(--accent-color)" : "var(--secondary-text-color)",
            title: codexResumeAvailable
                ? "恢复最近的 Codex 会话"
                : "请等待当前终端命令结束后，再恢复 Codex 会话",
            click: () => {
                if (!codexResumeAvailable) {
                    return;
                }
                util.fireAndForget(async () => {
                    try {
                        const baselineOutputTs = Number(lastOutputTsRef.current) || 0;
                        await runCodexResumeSequence((input) =>
                            RpcApi.ControllerInputCommand(TabRpcClient, {
                                blockid: blockId,
                                inputdata64: util.stringToBase64(input),
                            })
                        , { waitUntilReadyForFollowup: () => waitForBlockCodexResumeToBecomeInteractive(baselineOutputTs) });
                        recordTEvent("action:codexresume", { "block:view": "term" });
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        pushFlashError({
                            id: "",
                            icon: "triangle-exclamation",
                            title: "恢复 Codex 会话失败",
                            message,
                            expiration: Date.now() + 7000,
                        });
                    }
                });
            },
            disabled: !codexResumeAvailable,
        };
        endIconsElem.push(<IconButton key="codex-resume" decl={codexResumeDecl} className="block-frame-codex-resume" />);
    }
    const settingsDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "cog",
        title: "打开设置",
        click: (e) => handleHeaderContextMenu(e, blockId, viewModel, nodeModel, t),
    };
    endIconsElem.push(<IconButton key="settings" decl={settingsDecl} className="block-frame-settings" />);
    if (ephemeral) {
        const addToLayoutDecl: IconButtonDecl = {
            elemtype: "iconbutton",
            icon: "circle-plus",
            title: "加入布局",
            click: () => {
                nodeModel.addEphemeralNodeToLayout();
            },
        };
        endIconsElem.push(<IconButton key="add-to-layout" decl={addToLayoutDecl} />);
    } else {
        endIconsElem.push(
            <OptMagnifyButton
                key="unmagnify"
                magnified={magnified}
                toggleMagnify={nodeModel.toggleMagnify}
                disabled={magnifyDisabled}
            />
        );
    }

    const closeDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "xmark-large",
        title: "关闭",
        click: () => uxCloseBlock(nodeModel.blockId),
    };
    endIconsElem.push(<IconButton key="close" decl={closeDecl} className="block-frame-default-close" />);

    return <div className="block-frame-end-icons">{endIconsElem}</div>;
    }
);
HeaderEndIcons.displayName = "HeaderEndIcons";

const BlockFrame_Header = ({
    nodeModel,
    viewModel,
    preview,
    connBtnRef,
    changeConnModalAtom,
    error,
}: BlockFrameProps & { changeConnModalAtom: jotai.PrimitiveAtom<boolean>; error?: Error }) => {
    const { t } = useTranslation();
    const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", nodeModel.blockId));
    let viewName = util.useAtomValueSafe(viewModel?.viewName) ?? blockViewToName(blockData?.meta?.view);
    let viewIconUnion = util.useAtomValueSafe(viewModel?.viewIcon) ?? blockViewToIcon(blockData?.meta?.view);
    const preIconButton = util.useAtomValueSafe(viewModel?.preIconButton);
    const useTermHeader = util.useAtomValueSafe(viewModel?.useTermHeader);
    const termDurableStatus = util.useAtomValueSafe(viewModel?.termDurableStatus);
    const hideViewName = util.useAtomValueSafe(viewModel?.hideViewName);
    const magnified = jotai.useAtomValue(nodeModel.isMagnified);
    const prevMagifiedState = React.useRef(magnified);
    const manageConnection = util.useAtomValueSafe(viewModel?.manageConnection);
    const dragHandleRef = preview ? null : nodeModel.dragHandleRef;
    const currentView = String(blockData?.meta?.view ?? "").trim();
    const isBrowserChromeHeader = blockData?.meta?.["web:headerstyle"] === "browser-chrome";
    const isTerminalBlock = isTerminalLikeBlockView(currentView);
    const unreadAtom = React.useMemo(() => {
        return useBlockAtom(nodeModel.blockId, "term:unread", () => jotai.atom(false) as jotai.PrimitiveAtom<boolean>);
    }, [nodeModel.blockId]);
    const hasUnread = jotai.useAtomValue(unreadAtom as jotai.PrimitiveAtom<boolean>);
    const numLeafs = jotai.useAtomValue(nodeModel.numLeafs);
    const magnifyDisabled = numLeafs <= 1;
    viewName = blockData?.meta?.["frame:title"] ?? viewName;
    viewIconUnion = blockData?.meta?.["frame:icon"] ?? viewIconUnion;
    const connName = blockData?.meta?.connection;
    const connStatus = jotai.useAtomValue(getConnStatusAtom(connName));
    const rawHeaderTextUnion = util.useAtomValueSafe(viewModel?.viewText);
    const headerTextUnion = blockData?.meta?.["frame:text"] ?? rawHeaderTextUnion;
    const shellStateAtom = React.useMemo(() => {
        if (!isTerminalBlock) {
            return null;
        }
        return useBlockAtom(nodeModel.blockId, "term:shellstate", () => {
            return jotai.atom(null) as jotai.PrimitiveAtom<"ready" | "running-command" | null>;
        }) as jotai.PrimitiveAtom<"ready" | "running-command" | null>;
    }, [isTerminalBlock, nodeModel.blockId]);
    const shellState = util.useAtomValueSafe(shellStateAtom as any) as "ready" | "running-command" | null;
    const lastOutputTsAtom = React.useMemo(() => {
        if (!isTerminalBlock) {
            return null;
        }
        return useBlockAtom(nodeModel.blockId, "term:lastoutputts", () => {
            return jotai.atom(0) as jotai.PrimitiveAtom<number>;
        }) as jotai.PrimitiveAtom<number>;
    }, [isTerminalBlock, nodeModel.blockId]);
    const lastOutputTs = util.useAtomValueSafe(lastOutputTsAtom as any) as number;
    const displayCwdAtom = React.useMemo(() => {
        if (!isTerminalBlock) {
            return null;
        }
        return useBlockAtom(nodeModel.blockId, "term:displaycwd", () => {
            return jotai.atom("") as jotai.PrimitiveAtom<string>;
        }) as jotai.PrimitiveAtom<string>;
    }, [isTerminalBlock, nodeModel.blockId]);
    const liveDisplayCwd = util.useAtomValueSafe(displayCwdAtom as any) as string;
    const lastCommandDoneTsAtom = React.useMemo(() => {
        if (!isTerminalBlock) {
            return null;
        }
        return useBlockAtom(nodeModel.blockId, "term:lastcommanddonets", () => {
            return jotai.atom(0) as jotai.PrimitiveAtom<number>;
        }) as jotai.PrimitiveAtom<number>;
    }, [isTerminalBlock, nodeModel.blockId]);
    const lastCommandDoneTs = util.useAtomValueSafe(lastCommandDoneTsAtom as any) as number;
    const altBufAtom = React.useMemo(() => {
        if (!isTerminalBlock) {
            return null;
        }
        return useBlockAtom(nodeModel.blockId, "term:altbuf", () => {
            return jotai.atom(false) as jotai.PrimitiveAtom<boolean>;
        }) as jotai.PrimitiveAtom<boolean>;
    }, [isTerminalBlock, nodeModel.blockId]);
    const isAltBuf = util.useAtomValueSafe(altBufAtom as any) as boolean;

    const activityWindowMsAtom = React.useMemo(() => {
        if (!isTerminalBlock) {
            return null;
        }
        return getOverrideConfigAtom(nodeModel.blockId, "term:activitywindowms");
    }, [isTerminalBlock, nodeModel.blockId]);
    const activityWindowMsRaw = util.useAtomValueSafe(activityWindowMsAtom as any) as number;
    const activityWindowMs = React.useMemo(() => {
        const defaultMs = 60000;
        const raw = Number(activityWindowMsRaw);
        if (!Number.isFinite(raw) || raw < 0) {
            return defaultMs;
        }
        return Math.min(Math.floor(raw), 10 * 60 * 1000);
    }, [activityWindowMsRaw]);
    const documentHasFocus = util.useAtomValueSafe(atoms.documentHasFocus) ?? true;
    const [activityTick, setActivityTick] = React.useState(0);
    React.useEffect(() => {
        if (!isTerminalBlock) {
            return;
        }
        if (shellState != null) {
            return;
        }
        if (isAltBuf) {
            return;
        }
        if (!documentHasFocus) {
            return;
        }
        // No shell integration. Only update when the "recent output" window expires
        // (and avoid running per-block 1s intervals, especially in background windows).
        const ts = Number(lastOutputTs) || 0;
        if (ts <= 0) {
            return;
        }
        const now = Date.now();
        const msUntilStopped = ts + activityWindowMs - now;
        if (msUntilStopped <= 0) {
            return;
        }
        const timeoutMs = Math.min(msUntilStopped + 50, 10 * 60 * 1000);
        const timeoutId = window.setTimeout(() => setActivityTick((v) => v + 1), timeoutMs);
        return () => window.clearTimeout(timeoutId);
    }, [activityWindowMs, documentHasFocus, isAltBuf, isTerminalBlock, lastOutputTs, shellState]);
    const termLifeClass = React.useMemo(() => {
        if (!isTerminalBlock) {
            return null;
        }
        if (shellState === "running-command") {
            return "term-running";
        }
        if (shellState === "ready") {
            return "term-stopped";
        }
        if (isAltBuf) {
            return "term-running";
        }
        // No shell integration. Fall back to recent output activity (best effort).
        const ts = Number(lastOutputTs) || 0;
        if (ts <= 0) {
            return "term-stopped";
        }
        return Date.now() - ts < activityWindowMs ? "term-running" : "term-stopped";
    }, [activityTick, activityWindowMs, documentHasFocus, isAltBuf, isTerminalBlock, lastOutputTs, shellState]);
    const terminalPathLabel = React.useMemo(() => {
        if (!isTerminalBlock) {
            return undefined;
        }
        const pathLabel = resolveTerminalHeaderPathLabel(liveDisplayCwd, blockData?.meta);
        return util.isBlank(pathLabel) ? undefined : pathLabel;
    }, [blockData?.meta, isTerminalBlock, liveDisplayCwd, lastOutputTs]);
    const terminalCwd = React.useMemo(() => {
        if (!isTerminalBlock) {
            return undefined;
        }
        const cwd = resolveTerminalActionCwd(blockData?.meta, liveDisplayCwd);
        return util.isBlank(cwd) ? undefined : cwd;
    }, [blockData?.meta, isTerminalBlock, liveDisplayCwd]);

    const codexAuthReady = util.useAtomValueSafe(atoms.codexAuthReadyAtom) ?? false;

    React.useEffect(() => {
        if (magnified && !preview && !prevMagifiedState.current) {
            RpcApi.ActivityCommand(TabRpcClient, { nummagnify: 1 });
            recordTEvent("action:magnify", { "block:view": viewName });
        }
        prevMagifiedState.current = magnified;
    }, [magnified]);

    const viewIconElem = getViewIconElem(viewIconUnion, blockData);

    const { color: durableIconColor, titleText: durableTitle } = getDurableIconProps(termDurableStatus, connStatus, t);

    const handleHeaderTextDoubleClick = React.useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            if (preview || magnifyDisabled) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            nodeModel.toggleMagnify();
        },
        [magnifyDisabled, nodeModel, preview]
    );

    const handleHeaderBlankDoubleClick = React.useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            if (!isTerminalBlock || preview || magnifyDisabled) {
                return;
            }
            // Only handle true blank-area double clicks (flex gaps); avoid interfering with buttons/labels.
            if (e.target !== e.currentTarget) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            nodeModel.toggleMagnify();
        },
        [isTerminalBlock, magnifyDisabled, nodeModel, preview]
    );

    const handleTerminalLabelDoubleClick = React.useCallback(() => {
        if (preview || magnifyDisabled) {
            return;
        }
        nodeModel.toggleMagnify();
    }, [magnifyDisabled, nodeModel, preview]);
    return (
        <div
            className={cn(
                "block-frame-default-header",
                isBrowserChromeHeader && "browser-chrome-header",
                useTermHeader && "!pl-[2px]",
                termLifeClass,
                isTerminalBlock && termLifeClass === "term-stopped" && codexAuthReady && "term-ai-ready",
                isTerminalBlock && hasUnread && "term-unread"
            )}
            data-role="block-header"
            ref={dragHandleRef}
            onContextMenu={(e) => handleHeaderContextMenu(e, nodeModel.blockId, viewModel, nodeModel, t)}
            onDoubleClick={handleHeaderBlankDoubleClick}
        >
            {!useTermHeader && (
                <>
                    {preIconButton && <IconButton decl={preIconButton} className="block-frame-preicon-button" />}
                    <div className={cn("block-frame-default-header-iconview", isBrowserChromeHeader && "browser-chrome-iconview")}>
                        {viewIconElem}
                        {viewName && !hideViewName && (
                            <div className={cn("block-frame-view-type", isBrowserChromeHeader && "browser-chrome-title")}>
                                {viewName}
                            </div>
                        )}
                    </div>
                </>
            )}
            {manageConnection && (
                <ConnectionButton
                    ref={connBtnRef}
                    key="connbutton"
                    connection={blockData?.meta?.connection}
                    changeConnModalAtom={changeConnModalAtom}
                    isTerminalBlock={isTerminalBlock}
                    terminalLabel={terminalPathLabel}
                    terminalCwd={terminalCwd}
                    unread={isTerminalBlock && hasUnread}
                    onTerminalLabelDoubleClick={isTerminalBlock ? handleTerminalLabelDoubleClick : undefined}
                />
            )}
            {useTermHeader && termDurableStatus != null && (
                <div className="iconbutton disabled text-[13px] ml-[-4px]" key="durable-status">
                    <i className={`fa-sharp fa-solid fa-shield ${durableIconColor}`} title={durableTitle} />
                </div>
            )}
            <HeaderTextElems
                headerTextUnion={headerTextUnion}
                preview={preview}
                error={error}
                onDoubleClick={isTerminalBlock ? handleHeaderTextDoubleClick : undefined}
            />
            <HeaderEndIcons
                viewModel={viewModel}
                nodeModel={nodeModel}
                blockId={nodeModel.blockId}
                currentView={currentView}
                isTerminalBlock={isTerminalBlock}
                shellState={shellState}
                lastOutputTs={lastOutputTs}
                lastCommandDoneTs={lastCommandDoneTs}
                liveDisplayCwd={liveDisplayCwd}
            />
        </div>
    );
};

export { BlockFrame_Header };

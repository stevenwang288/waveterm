// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { speechRuntime } from "@/app/aipanel/speechruntime";
import { resolveSpeechSettings } from "@/app/aipanel/speechsettings";
import { WaveAIModel } from "@/app/aipanel/waveai-model";
import {
    blockViewToIcon,
    blockViewToName,
    getViewIconElem,
    OptMagnifyButton,
    renderHeaderElements,
} from "@/app/block/blockutil";
import { ConnectionButton } from "@/app/block/connectionbutton";
import {
    loadLatestTerminalFormalReplyPayload,
    playTerminalFormalReplyPayload,
    type TerminalFormalReplyPayload,
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
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { IconButton } from "@/element/iconbutton";
import { NodeModel } from "@/layout/index";
import * as util from "@/util/util";
import { cn } from "@/util/util";
import * as jotai from "jotai";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { BlockFrameProps } from "./blocktypes";

function getPathDisplayLabel(path: string): string {
    if (!path) {
        return "";
    }
    const trimmed = path.trim();
    if (!trimmed) {
        return "";
    }
    if (trimmed === "~" || trimmed === "/" || trimmed === "\\") {
        return trimmed;
    }
    const normalized = trimmed.replace(/[\\/]+$/, "");
    if (!normalized) {
        return trimmed;
    }
    if (/^[A-Za-z]:$/.test(normalized)) {
        return `${normalized}\\`;
    }
    return normalized;
}

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

function handleHeaderContextMenu(
    e: React.MouseEvent<HTMLDivElement>,
    blockId: string,
    viewModel: ViewModel,
    nodeModel: NodeModel,
    t: (key: string, options?: any) => string
) {
    e.preventDefault();
    e.stopPropagation();
    const magnified = globalStore.get(nodeModel.isMagnified);
    let menu: ContextMenuItem[] = [
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
    ContextMenuModel.showContextMenu(menu, e);
}

type HeaderTextElemsProps = {
    viewModel: ViewModel;
    blockData: Block;
    preview: boolean;
    error?: Error;
    onDoubleClick?: React.MouseEventHandler<HTMLDivElement>;
};

const HeaderTextElems = React.memo(({ viewModel, blockData, preview, error, onDoubleClick }: HeaderTextElemsProps) => {
    const { t } = useTranslation();
    let headerTextUnion = util.useAtomValueSafe(viewModel?.viewText);
    headerTextUnion = blockData?.meta?.["frame:text"] ?? headerTextUnion;

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
    isTerminalBlock: boolean;
    shellState: "ready" | "running-command" | null;
    lastOutputTs: number;
    lastCommandDoneTs: number;
};

const HeaderEndIcons = React.memo(
    ({ viewModel, nodeModel, blockId, isTerminalBlock, shellState, lastOutputTs, lastCommandDoneTs }: HeaderEndIconsProps) => {
    const { t } = useTranslation();
    const endIconButtons = util.useAtomValueSafe(viewModel?.endIconButtons);
    const aiModel = React.useMemo(() => WaveAIModel.getInstance(), []);
    const currentMode = jotai.useAtomValue(aiModel.currentAIMode);
    const aiModeConfigs = jotai.useAtomValue(aiModel.aiModeConfigs);
    const currentModeConfig = aiModeConfigs?.[currentMode];
    const latestAssistantText = jotai.useAtomValue(aiModel.latestAssistantMessageText);
    const isAIStreaming = jotai.useAtomValue(aiModel.isAIStreaming);
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
    const speechAutoPlayAtom = React.useMemo(() => {
        return useBlockAtom(blockId, "speech:autoplay-local", () => {
            // Default terminal speech mode: auto on. Users can switch to manual if they prefer.
            return jotai.atom(true) as jotai.PrimitiveAtom<boolean>;
        }) as jotai.PrimitiveAtom<boolean>;
    }, [blockId]);
    const [speechAutoPlay, setSpeechAutoPlay] = jotai.useAtom(speechAutoPlayAtom);
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

    const endIconsElem: React.ReactElement[] = [];
    const payloadBuildTimerRef = React.useRef<number | null>(null);
    const payloadBuildRunIdRef = React.useRef(0);
    const autoPlayPendingPayloadIdRef = React.useRef("");
    const lastCommandDoneRefreshTsRef = React.useRef(0);
    const speechSettingsRef = React.useRef(speechSettings);
    const speechActiveRef = React.useRef(speechActive);
    const speechFormalReplyPayloadRef = React.useRef<TerminalFormalReplyPayload | null>(speechFormalReplyPayload);
    const speechLastSpokenPayloadIdRef = React.useRef(speechLastSpokenPayloadId);
    const speechAutoPlayBaselineTsRef = React.useRef(speechAutoPlayBaselineTs);
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

    if (endIconButtons && endIconButtons.length > 0) {
        endIconsElem.push(...endIconButtons.map((button, idx) => <IconButton key={idx} decl={button} />));
    }
    const speechEngineLabel =
        speechSettings.transport === "browser"
            ? "系统语音"
            : speechSettings.provider === "local"
              ? speechSettings.localEngine === "edge"
                  ? "Edge"
                  : speechSettings.localEngine === "melo"
                    ? "Melo"
                    : "API"
              : "API";
    const speechHintParts = [
        speechEngineLabel,
        speechSettings.transport === "api" ? speechSettings.model : "",
        speechSettings.voiceAssistant || speechSettings.voice,
    ].filter(Boolean);
    const speechHint = speechHintParts.length > 0 ? `（${speechHintParts.join(" / ")}）` : "";
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
                    aiModel.setError(errorMessage);
                    reportSpeechError(errorMessage);
                },
            });
            if (started) {
                speechLastSpokenPayloadIdRef.current = payload.id;
                setSpeechLastSpokenPayloadId(payload.id);
            }
            return started;
        },
        [aiModel, blockId, isIgnorableSpeechError, reportSpeechError, setSpeechLastSpokenPayloadId]
    );
    const resolveTerminalFormalReplyPayload = React.useCallback(
        async (outputTs: number, options?: { strictFreshness?: boolean }): Promise<TerminalFormalReplyPayload | null> => {
            const normalizedOutputTs = Number(outputTs);
            const hasOutputTs = Number.isFinite(normalizedOutputTs) && normalizedOutputTs > 0;
            const strictFreshness = options?.strictFreshness ?? true;
            const minLastUpdatedTs = strictFreshness && hasOutputTs ? normalizedOutputTs : 0;
            const payload = await loadLatestTerminalFormalReplyPayload({
                blockId,
                preferLastCommand: shellStateRef.current !== null,
                minLastUpdatedTs,
                requirePromptAfterCodexReply: true,
                outputTs: hasOutputTs ? normalizedOutputTs : Date.now(),
                onError: (errorMessage) => {
                    if (isIgnorableSpeechError(errorMessage)) {
                        return;
                    }
                    aiModel.setError(errorMessage);
                },
            });
            if (payload) {
                const currentPayload = speechFormalReplyPayloadRef.current;
                if (currentPayload?.text === payload.text) {
                    return currentPayload;
                }
                if (currentPayload?.id !== payload.id) {
                    speechFormalReplyPayloadRef.current = payload;
                    setSpeechFormalReplyPayload(payload);
                }
                return payload;
            }
            const currentPayload = speechFormalReplyPayloadRef.current;
            if (!hasOutputTs) {
                return currentPayload?.text?.trim() ? currentPayload : null;
            }
            if (currentPayload && currentPayload.outputTs >= normalizedOutputTs) {
                return currentPayload;
            }
            return null;
        },
        [aiModel, blockId, isIgnorableSpeechError, setSpeechFormalReplyPayload]
    );
    const scheduleTerminalPayloadRefresh = React.useCallback(
        (delayMs: number, outputTs: number) => {
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
                    const targetOutputTs = Number(outputTs);
                    if (!Number.isFinite(targetOutputTs) || targetOutputTs <= 0) {
                        return;
                    }
                    // Output changed again; skip stale payload refresh.
                    if (lastOutputTsRef.current > targetOutputTs) {
                        return;
                    }
                    await resolveTerminalFormalReplyPayload(targetOutputTs);
                })();
            }, Math.max(0, Math.floor(delayMs)));
        },
        [clearPayloadBuildTimer, resolveTerminalFormalReplyPayload]
    );
    const speechDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: speechActive ? "stop" : "volume-high",
        title:
            (!speechSettings.enabled
                ? t("aipanel.feedback.speechDisabled", { defaultValue: "Speech is disabled in settings" })
                : speechActive
                  ? t("aipanel.feedback.stopSpeech")
                  : isTerminalBlock
                    ? t("aipanel.feedback.readLocal", { defaultValue: "Read output aloud" })
                    : !latestAssistantText?.trim()
                    ? t("aipanel.noTextContent")
                    : t("aipanel.feedback.readLocal", { defaultValue: "Read reply aloud" })
            ).trim() + (speechHint ? ` ${speechHint}` : ""),
        click: () => {
            if (speechActive) {
                speechRuntime.stop(blockId);
                return;
            }
            if (!speechSettings.enabled) {
                aiModel.setError(
                    t("aipanel.feedback.speechDisabled", { defaultValue: "Speech is disabled in settings" })
                );
                reportSpeechError("语音播报已关闭。去 设置 -> 语音播报 打开“总开关”。");
                return;
            }
            if (!isTerminalBlock) {
                if (isAIStreaming) {
                    aiModel.setError(
                        t("aipanel.feedback.waitForFinal", {
                            defaultValue: "Still generating. Wait for the reply to finish before speaking.",
                        })
                    );
                    reportSpeechError("还在生成回复，等它结束再点朗读。");
                    return;
                }
                void speechRuntime.play(latestAssistantText ?? "", speechSettings, "assistant", (errorMessage) => {
                    if (isIgnorableSpeechError(errorMessage)) {
                        return;
                    }
                    aiModel.setError(errorMessage);
                    reportSpeechError(errorMessage);
                }, { ownerId: blockId });
                return;
            }
            cancelAutoSpeech(false);
            const currentOutputTs = Number(lastOutputTsRef.current);
            void (async () => {
                let payload = await resolveTerminalFormalReplyPayload(currentOutputTs, {
                    strictFreshness: true,
                });
                const canRelaxFreshness = shellStateRef.current !== "running-command";
                if (!payload && canRelaxFreshness) {
                    payload = await resolveTerminalFormalReplyPayload(currentOutputTs, {
                        strictFreshness: false,
                    });
                }
                if (!payload && canRelaxFreshness) {
                    const cachedPayload = speechFormalReplyPayloadRef.current;
                    if (cachedPayload?.text?.trim()) {
                        payload = cachedPayload;
                    }
                }
                if (!payload) {
                    const message = "没有检测到可播报的 AI 正式回复。";
                    aiModel.setError(message);
                    reportSpeechError(message);
                    return;
                }
                await speakTerminalPayload(payload);
            })();
        },
        disabled: false,
    };
    React.useEffect(() => {
        if (!isTerminalBlock) {
            return;
        }
        if (shellState !== null) {
            return;
        }
        const ts = Number(lastOutputTs);
        if (!Number.isFinite(ts) || ts <= 0) {
            return;
        }
        const delayMs = shellState === "running-command" ? 700 : 420;
        scheduleTerminalPayloadRefresh(delayMs, ts);
    }, [isTerminalBlock, lastOutputTs, scheduleTerminalPayloadRefresh, shellState]);
    React.useEffect(() => {
        if (!isTerminalBlock) {
            return;
        }
        if (shellState === null) {
            return;
        }
        const doneTs = Number(lastCommandDoneTs);
        if (!Number.isFinite(doneTs) || doneTs <= 0) {
            return;
        }
        if (lastCommandDoneRefreshTsRef.current === doneTs) {
            return;
        }
        lastCommandDoneRefreshTsRef.current = doneTs;
        const outputTs = Number(lastOutputTsRef.current);
        const targetOutputTs =
            Number.isFinite(outputTs) && outputTs > 0 ? Math.max(doneTs, outputTs) : doneTs;
        scheduleTerminalPayloadRefresh(180, targetOutputTs);
    }, [isTerminalBlock, lastCommandDoneTs, scheduleTerminalPayloadRefresh, shellState]);

    const prevAutoPlayRef = React.useRef(speechSettings.autoPlay);
    React.useEffect(() => {
        // If auto-play is already enabled (for example after a hot reload), establish a baseline so we
        // only speak replies that happen after this point (never historical scrollback).
        if (!isTerminalBlock || !speechSettings.enabled || !speechSettings.autoPlay) {
            return;
        }
        const existingBaseline = Number(speechAutoPlayBaselineTsRef.current) || 0;
        if (existingBaseline > 0) {
            return;
        }
        const currentOutputTs = Number(lastOutputTsRef.current);
        const commandDoneTs = Number(lastCommandDoneTsRef.current);
        const outputTs = Number.isFinite(currentOutputTs) && currentOutputTs > 0 ? currentOutputTs : 0;
        const doneTs = Number.isFinite(commandDoneTs) && commandDoneTs > 0 ? commandDoneTs : 0;
        const baselineTs = doneTs > 0 ? Math.max(doneTs, outputTs) : outputTs;
        if (baselineTs <= 0) {
            return;
        }
        speechAutoPlayBaselineTsRef.current = baselineTs;
        setSpeechAutoPlayBaselineTs(baselineTs);
    }, [isTerminalBlock, setSpeechAutoPlayBaselineTs, speechSettings.autoPlay, speechSettings.enabled]);
    React.useEffect(() => {
        const prevAutoPlay = prevAutoPlayRef.current;
        prevAutoPlayRef.current = speechSettings.autoPlay;
        if (!isTerminalBlock || !speechSettings.enabled || !speechSettings.autoPlay) {
            const shouldStopActivePlayback =
                isTerminalBlock &&
                prevAutoPlay &&
                (!speechSettings.autoPlay || !speechSettings.enabled);
            cancelAutoSpeech(shouldStopActivePlayback);
            return;
        }
        const payload = speechFormalReplyPayload;
        if (!payload || !payload.text.trim()) {
            return;
        }
        const baselineTs = Number(speechAutoPlayBaselineTsRef.current) || 0;
        if (baselineTs > 0 && payload.outputTs <= baselineTs) {
            return;
        }
        if (payload.id === speechLastSpokenPayloadIdRef.current) {
            return;
        }
        if (speechActiveRef.current) {
            return;
        }
        if (autoPlayPendingPayloadIdRef.current === payload.id) {
            return;
        }
        autoPlayPendingPayloadIdRef.current = payload.id;
        void (async () => {
            try {
                await speakTerminalPayload(payload);
            } finally {
                if (autoPlayPendingPayloadIdRef.current === payload.id) {
                    autoPlayPendingPayloadIdRef.current = "";
                }
            }
        })();
    }, [
        cancelAutoSpeech,
        isTerminalBlock,
        speakTerminalPayload,
        speechFormalReplyPayload,
        speechSettings.autoPlay,
        speechSettings.enabled,
    ]);

    React.useEffect(() => {
        return () => {
            cancelAutoSpeech(false);
        };
    }, [cancelAutoSpeech]);

    const speechModeDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: (
            <span className="speech-mode-chip">
                <span className="speech-mode-dot" />
                {speechSettings.autoPlay ? "自动" : "手动"}
            </span>
        ),
        title: speechSettings.autoPlay ? "自动播报：开（点击切到手动）" : "自动播报：关（点击切到自动）",
        click: () => {
            const nextAutoPlay = !speechSettings.autoPlay;
            if (!nextAutoPlay) {
                cancelAutoSpeech(true);
                speechAutoPlayBaselineTsRef.current = 0;
                setSpeechAutoPlayBaselineTs(0);
            } else {
                const currentOutputTs = Number(lastOutputTsRef.current);
                const commandDoneTs = Number(lastCommandDoneTsRef.current);
                const outputTs = Number.isFinite(currentOutputTs) && currentOutputTs > 0 ? currentOutputTs : 0;
                const doneTs = Number.isFinite(commandDoneTs) && commandDoneTs > 0 ? commandDoneTs : 0;
                const baselineTs = doneTs > 0 ? Math.max(doneTs, outputTs) : outputTs;
                speechAutoPlayBaselineTsRef.current = baselineTs;
                setSpeechAutoPlayBaselineTs(baselineTs);
                if (baselineTs > 0) {
                    scheduleTerminalPayloadRefresh(120, baselineTs);
                }
            }
            setSpeechAutoPlay(nextAutoPlay);
        },
        disabled: !speechSettings.enabled || !isTerminalBlock,
    };

    const showSpeechButton = isTerminalBlock ? true : speechSettings.showManualButton;
    if (isTerminalBlock) {
        endIconsElem.push(
            <IconButton
                key="speech-mode"
                decl={speechModeDecl}
                className={cn("block-frame-speech-mode", speechSettings.autoPlay ? "is-auto-on" : "is-auto-off")}
            />
        );
    }
    if (showSpeechButton) {
        endIconsElem.push(<IconButton key="speech" decl={speechDecl} className="block-frame-speech" />);
    }
    const settingsDecl: IconButtonDecl = {
        elemtype: "iconbutton",
        icon: "cog",
        title: t("block.settings"),
        click: (e) => handleHeaderContextMenu(e, blockId, viewModel, nodeModel, t),
    };
    endIconsElem.push(<IconButton key="settings" decl={settingsDecl} className="block-frame-settings" />);
    if (ephemeral) {
        const addToLayoutDecl: IconButtonDecl = {
            elemtype: "iconbutton",
            icon: "circle-plus",
            title: t("block.addToLayout"),
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
        title: t("common.close"),
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
    const isTerminalBlock = blockData?.meta?.view === "term";
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
        const cwd = typeof blockData?.meta?.["cmd:cwd"] === "string" ? String(blockData.meta["cmd:cwd"]) : "";
        const pathLabel = getPathDisplayLabel(cwd);
        return util.isBlank(pathLabel) ? undefined : pathLabel;
    }, [blockData?.meta, isTerminalBlock]);

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
                    <div className="block-frame-default-header-iconview">
                        {viewIconElem}
                        {viewName && !hideViewName && <div className="block-frame-view-type">{viewName}</div>}
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
                viewModel={viewModel}
                blockData={blockData}
                preview={preview}
                error={error}
                onDoubleClick={isTerminalBlock ? handleHeaderTextDoubleClick : undefined}
            />
            <HeaderEndIcons
                viewModel={viewModel}
                nodeModel={nodeModel}
                blockId={nodeModel.blockId}
                isTerminalBlock={isTerminalBlock}
                shellState={shellState}
                lastOutputTs={lastOutputTs}
                lastCommandDoneTs={lastCommandDoneTs}
            />
        </div>
    );
};

export { BlockFrame_Header };

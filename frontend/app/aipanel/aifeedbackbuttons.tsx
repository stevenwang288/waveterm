// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { cn, makeIconClass } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    canUseLocalSpeechSynthesis,
    requestOpenAICompatibleSpeechAudio,
    resolveOpenAICompatibleSpeechEndpoint,
    speakLocally,
    stopLocalSpeechSynthesis,
} from "./aispeech";
import { WaveAIModel } from "./waveai-model";

interface AIFeedbackButtonsProps {
    messageText: string;
}

export const AIFeedbackButtons = memo(({ messageText }: AIFeedbackButtonsProps) => {
    const model = WaveAIModel.getInstance();
    const { t } = useTranslation();
    const currentMode = useAtomValue(model.currentAIMode);
    const aiModeConfigs = useAtomValue(model.aiModeConfigs);
    const currentModeConfig = aiModeConfigs?.[currentMode];
    const apiToken = (currentModeConfig?.["ai:apitoken"] ?? "").trim();
    const apiSpeechEndpoint = useMemo(
        () => resolveOpenAICompatibleSpeechEndpoint(currentModeConfig?.["ai:endpoint"], apiToken),
        [currentModeConfig, apiToken]
    );
    const canUseApiSpeech = !!apiSpeechEndpoint;
    const canUseLocalSpeech = canUseLocalSpeechSynthesis();

    const [thumbsUpClicked, setThumbsUpClicked] = useState(false);
    const [thumbsDownClicked, setThumbsDownClicked] = useState(false);
    const [copied, setCopied] = useState(false);
    const [localSpeaking, setLocalSpeaking] = useState(false);
    const [apiSpeaking, setApiSpeaking] = useState(false);

    const apiAudioRef = useRef<HTMLAudioElement | null>(null);
    const apiAudioUrlRef = useRef<string | null>(null);
    const apiAbortRef = useRef<AbortController | null>(null);

    const handleThumbsUp = () => {
        setThumbsUpClicked(!thumbsUpClicked);
        if (thumbsDownClicked) {
            setThumbsDownClicked(false);
        }
        if (!thumbsUpClicked) {
            model.handleAIFeedback("good");
        }
    };

    const handleThumbsDown = () => {
        setThumbsDownClicked(!thumbsDownClicked);
        if (thumbsUpClicked) {
            setThumbsUpClicked(false);
        }
        if (!thumbsDownClicked) {
            model.handleAIFeedback("bad");
        }
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(messageText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const cleanupApiAudioResources = () => {
        if (apiAudioRef.current) {
            apiAudioRef.current.pause();
            apiAudioRef.current.src = "";
            apiAudioRef.current = null;
        }
        if (apiAudioUrlRef.current) {
            URL.revokeObjectURL(apiAudioUrlRef.current);
            apiAudioUrlRef.current = null;
        }
    };

    const stopApiSpeech = (updateState = true) => {
        if (apiAbortRef.current) {
            apiAbortRef.current.abort();
            apiAbortRef.current = null;
        }
        cleanupApiAudioResources();
        if (updateState) {
            setApiSpeaking(false);
        }
    };

    useEffect(() => {
        return () => {
            stopLocalSpeechSynthesis();
            stopApiSpeech(false);
        };
    }, []);

    const handleLocalSpeech = () => {
        if (!messageText?.trim()) {
            return;
        }
        if (localSpeaking) {
            stopLocalSpeechSynthesis();
            setLocalSpeaking(false);
            return;
        }
        if (!canUseLocalSpeech) {
            model.setError(t("aipanel.feedback.localSpeechUnavailable"));
            return;
        }

        stopApiSpeech();
        setLocalSpeaking(true);
        const started = speakLocally(messageText, {
            onDone: () => setLocalSpeaking(false),
            onError: (errorMessage) => {
                model.setError(errorMessage);
            },
        });
        if (!started) {
            setLocalSpeaking(false);
        }
    };

    const handleApiSpeech = async () => {
        if (!messageText?.trim()) {
            return;
        }
        if (apiSpeaking) {
            stopApiSpeech();
            return;
        }
        if (!canUseApiSpeech || !apiSpeechEndpoint) {
            model.setError(t("aipanel.feedback.apiSpeechUnavailable"));
            return;
        }

        stopLocalSpeechSynthesis();
        setLocalSpeaking(false);
        stopApiSpeech();

        const abortController = new AbortController();
        apiAbortRef.current = abortController;
        setApiSpeaking(true);

        try {
            const speechBlob = await requestOpenAICompatibleSpeechAudio(
                messageText,
                {
                    endpoint: apiSpeechEndpoint,
                    model: currentModeConfig?.["ai:model"],
                    token: apiToken,
                },
                abortController.signal
            );
            if (abortController.signal.aborted) {
                setApiSpeaking(false);
                return;
            }
            const speechUrl = URL.createObjectURL(speechBlob);
            apiAudioUrlRef.current = speechUrl;
            const speechAudio = new Audio(speechUrl);
            apiAudioRef.current = speechAudio;
            speechAudio.onended = () => {
                cleanupApiAudioResources();
                setApiSpeaking(false);
            };
            speechAudio.onerror = () => {
                cleanupApiAudioResources();
                setApiSpeaking(false);
                model.setError(t("aipanel.feedback.apiSpeechPlaybackFailed"));
            };
            await speechAudio.play();
        } catch (error) {
            if (!abortController.signal.aborted) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                model.setError(errorMessage || t("aipanel.feedback.apiSpeechPlaybackFailed"));
            }
            cleanupApiAudioResources();
            setApiSpeaking(false);
        } finally {
            if (apiAbortRef.current === abortController) {
                apiAbortRef.current = null;
            }
        }
    };

    const localSpeechTitle = localSpeaking ? t("aipanel.feedback.stopSpeech") : t("aipanel.feedback.readLocal");
    const apiSpeechTitle = !canUseApiSpeech
        ? t("aipanel.feedback.apiSpeechUnavailable")
        : apiSpeaking
          ? t("aipanel.feedback.stopSpeech")
          : t("aipanel.feedback.readApi");

    return (
        <div className="flex items-center gap-0.5 mt-2">
            <button
                onClick={handleThumbsUp}
                className={cn(
                    "p-1.5 rounded cursor-pointer transition-colors",
                    thumbsUpClicked
                        ? "text-accent"
                        : "text-secondary hover:bg-zinc-700 hover:text-primary"
                )}
                title={t("aipanel.feedback.good")}
            >
                <i className={makeIconClass(thumbsUpClicked ? "solid@thumbs-up" : "regular@thumbs-up", false)} />
            </button>
            <button
                onClick={handleThumbsDown}
                className={cn(
                    "p-1.5 rounded cursor-pointer transition-colors",
                    thumbsDownClicked
                        ? "text-accent"
                        : "text-secondary hover:bg-zinc-700 hover:text-primary"
                )}
                title={t("aipanel.feedback.bad")}
            >
                <i className={makeIconClass(thumbsDownClicked ? "solid@thumbs-down" : "regular@thumbs-down", false)} />
            </button>
            {messageText?.trim() && (
                <button
                    onClick={handleCopy}
                    className={cn(
                        "p-1.5 rounded cursor-pointer transition-colors",
                        copied
                            ? "text-success"
                            : "text-secondary hover:bg-zinc-700 hover:text-primary"
                    )}
                    title={t("aipanel.feedback.copyMessage")}
                >
                    <i className={makeIconClass(copied ? "solid@check" : "regular@copy", false)} />
                </button>
            )}
            {messageText?.trim() && (
                <button
                    onClick={handleLocalSpeech}
                    className={cn(
                        "p-1.5 rounded cursor-pointer transition-colors",
                        localSpeaking
                            ? "text-accent"
                            : "text-secondary hover:bg-zinc-700 hover:text-primary",
                        !canUseLocalSpeech && "opacity-50 cursor-not-allowed"
                    )}
                    title={localSpeechTitle}
                    disabled={!canUseLocalSpeech}
                >
                    <i className={makeIconClass(localSpeaking ? "solid@stop" : "solid@volume-high", false)} />
                </button>
            )}
            {messageText?.trim() && (
                <button
                    onClick={() => {
                        void handleApiSpeech();
                    }}
                    className={cn(
                        "p-1.5 rounded cursor-pointer transition-colors",
                        apiSpeaking ? "text-accent" : "text-secondary hover:bg-zinc-700 hover:text-primary",
                        !canUseApiSpeech && "opacity-50 cursor-not-allowed"
                    )}
                    title={apiSpeechTitle}
                    disabled={!canUseApiSpeech}
                >
                    <i className={makeIconClass(apiSpeaking ? "solid@stop" : "solid@cloud", false)} />
                </button>
            )}
        </div>
    );
});

AIFeedbackButtons.displayName = "AIFeedbackButtons";

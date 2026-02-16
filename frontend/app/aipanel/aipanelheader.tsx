// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { handleWaveAIContextMenu } from "@/app/aipanel/aipanel-contextmenu";
import { getSettingsKeyAtom } from "@/app/store/global";
import { cn, makeIconClass } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveSpeechSettings } from "./speechsettings";
import { speechRuntime } from "./speechruntime";
import { WaveAIModel } from "./waveai-model";

export const AIPanelHeader = memo(() => {
    const model = WaveAIModel.getInstance();
    const widgetAccess = useAtomValue(model.widgetAccessAtom);
    const isAIStreaming = useAtomValue(model.isAIStreaming);
    const currentMode = useAtomValue(model.currentAIMode);
    const aiModeConfigs = useAtomValue(model.aiModeConfigs);
    const currentModeConfig = aiModeConfigs?.[currentMode];
    const latestAssistantText = useAtomValue(model.latestAssistantMessageText);
    const speechEnabled = useAtomValue(getSettingsKeyAtom("speech:enabled"));
    const speechProvider = useAtomValue(getSettingsKeyAtom("speech:provider"));
    const speechEndpoint = useAtomValue(getSettingsKeyAtom("speech:endpoint"));
    const speechModel = useAtomValue(getSettingsKeyAtom("speech:model"));
    const speechVoice = useAtomValue(getSettingsKeyAtom("speech:voice"));
    const speechVoiceAssistant = useAtomValue(getSettingsKeyAtom("speech:voiceassistant"));
    const speechVoiceUser = useAtomValue(getSettingsKeyAtom("speech:voiceuser"));
    const speechVoiceSystem = useAtomValue(getSettingsKeyAtom("speech:voicesystem"));
    const speechFilterUrls = useAtomValue(getSettingsKeyAtom("speech:filterurls"));
    const speechFilterPaths = useAtomValue(getSettingsKeyAtom("speech:filterpaths"));
    const speechFilterCode = useAtomValue(getSettingsKeyAtom("speech:filtercode"));
    const speechAutoPlay = useAtomValue(getSettingsKeyAtom("speech:autoplay"));
    const speechManualButton = useAtomValue(getSettingsKeyAtom("speech:manualbutton"));
    const speechLocalEngine = useAtomValue(getSettingsKeyAtom("speech:localengine"));
    const speechLocalModel = useAtomValue(getSettingsKeyAtom("speech:localmodel"));
    const speechLocalModelPath = useAtomValue(getSettingsKeyAtom("speech:localmodelpath"));
    const inBuilder = model.inBuilder;
    const { t } = useTranslation();
    const [speechActive, setSpeechActive] = useState(false);

    const speechSettings = useMemo(
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
            speechLocalEngine,
            speechLocalModel,
            speechLocalModelPath,
        ]
    );
    const hasReadableText = !!latestAssistantText?.trim();

    useEffect(() => {
        return speechRuntime.subscribe(setSpeechActive);
    }, []);

    const handleKebabClick = (e: React.MouseEvent) => {
        handleWaveAIContextMenu(e, false);
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        handleWaveAIContextMenu(e, false);
    };

    const handleSpeechClick = async () => {
        if (speechActive) {
            speechRuntime.stop();
            return;
        }
        if (isAIStreaming) {
            model.setError(
                t("aipanel.feedback.waitForFinal", {
                    defaultValue: "Still generating. Wait for the reply to finish before speaking.",
                })
            );
            return;
        }
        await speechRuntime.play(latestAssistantText ?? "", speechSettings, "assistant", (errorMessage) => {
            model.setError(errorMessage);
        });
    };

    const speechTitle = !speechSettings.enabled
        ? t("aipanel.feedback.speechDisabled", { defaultValue: "Speech is disabled in settings" })
        : !hasReadableText
          ? t("aipanel.noTextContent")
          : speechActive
            ? t("aipanel.feedback.stopSpeech")
            : t("aipanel.feedback.readLocal", { defaultValue: "Read reply aloud" });

    return (
        <div
            className="py-2 pl-3 pr-1 @xs:p-2 @xs:pl-4 border-b border-gray-600 flex items-center justify-between min-w-0"
            onContextMenu={handleContextMenu}
        >
            <h2 className="text-white text-sm @xs:text-lg font-semibold flex items-center gap-2 flex-shrink-0 whitespace-nowrap">
                <i className="fa fa-sparkles text-accent"></i>
                {t("aipanel.header")}
            </h2>

            <div className="flex items-center flex-shrink-0 whitespace-nowrap">
                {speechSettings.showManualButton && (
                    <button
                        onClick={() => {
                            void handleSpeechClick();
                        }}
                        className={cn(
                            "text-gray-400 hover:text-white cursor-pointer transition-colors p-1 rounded flex-shrink-0 mr-1 focus:outline-none"
                        )}
                        title={speechTitle}
                    >
                        <i
                            className={makeIconClass(
                                speechActive ? "solid@stop" : speechSettings.transport === "api" ? "solid@cloud" : "solid@volume-high",
                                false
                            )}
                        />
                    </button>
                )}
                {!inBuilder && (
                    <div className="flex items-center text-sm whitespace-nowrap">
                        <span className="text-gray-300 @xs:hidden mr-1 text-[12px]">{t("aipanel.context")}</span>
                        <span className="text-gray-300 hidden @xs:inline mr-2 text-[12px]">{t("aipanel.widgetContext")}</span>
                        <button
                            onClick={() => {
                                model.setWidgetAccess(!widgetAccess);
                                setTimeout(() => {
                                    model.focusInput();
                                }, 0);
                            }}
                            className={`relative inline-flex h-6 w-14 items-center rounded-full transition-colors cursor-pointer ${
                                widgetAccess ? "bg-accent-600" : "bg-zinc-600"
                            }`}
                            title={`Widget Access ${widgetAccess ? t("aipanel.widgetContextOn") : t("aipanel.widgetContextOff")}`}
                        >
                            <span
                                className={`absolute inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                    widgetAccess ? "translate-x-8" : "translate-x-1"
                                }`}
                            />
                            <span
                                className={`relative z-10 text-xs text-white transition-all ${
                                    widgetAccess ? "ml-2.5 mr-6 text-left" : "ml-6 mr-1 text-right"
                                }`}
                            >
                                {widgetAccess ? t("aipanel.widgetContextOn") : t("aipanel.widgetContextOff")}
                            </span>
                        </button>
                    </div>
                )}

                <button
                    onClick={handleKebabClick}
                    className="text-gray-400 hover:text-white cursor-pointer transition-colors p-1 rounded flex-shrink-0 ml-2 focus:outline-none"
                    title={t("aipanel.moreOptions")}
                >
                    <i className="fa fa-ellipsis-vertical"></i>
                </button>
            </div>
        </div>
    );
});

AIPanelHeader.displayName = "AIPanelHeader";

// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { waveAIHasSelection } from "@/app/aipanel/waveai-focus-utils";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { createBlock, getSettingsKeyAtom, isDev } from "@/app/store/global";
import { globalStore } from "@/app/store/jotaiStore";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WaveAIModel } from "./waveai-model";
import i18next from "@/app/i18n";
import { resolveSpeechSettings } from "./speechsettings";

export async function handleWaveAIContextMenu(e: React.MouseEvent, showCopy: boolean): Promise<void> {
    e.preventDefault();
    e.stopPropagation();

    const model = WaveAIModel.getInstance();
    const menu: ContextMenuItem[] = [];

    if (showCopy) {
        const hasSelection = waveAIHasSelection();
        if (hasSelection) {
            menu.push({
                role: "copy",
            });
            menu.push({ type: "separator" });
        }
    }

    menu.push({
        label: i18next.t("aipanel.newChat"),
        click: () => {
            model.clearChat();
        },
    });

    menu.push({ type: "separator" });

    const rtInfo = await RpcApi.GetRTInfoCommand(TabRpcClient, {
        oref: model.orefContext,
    });

    const defaultTokens = model.inBuilder ? 24576 : 4096;
    const currentMaxTokens = rtInfo?.["waveai:maxoutputtokens"] ?? defaultTokens;

    const maxTokensSubmenu: ContextMenuItem[] = [];

    if (model.inBuilder) {
        maxTokensSubmenu.push(
            {
                label: i18next.t("aipanel.maxTokensOption", { tokens: "24k" }),
                type: "checkbox",
                checked: currentMaxTokens === 24576,
                click: () => {
                    RpcApi.SetRTInfoCommand(TabRpcClient, {
                        oref: model.orefContext,
                        data: { "waveai:maxoutputtokens": 24576 },
                    });
                },
            },
            {
                label: i18next.t("aipanel.maxTokensOptionPro", { tokens: "64k" }),
                type: "checkbox",
                checked: currentMaxTokens === 65536,
                click: () => {
                    RpcApi.SetRTInfoCommand(TabRpcClient, {
                        oref: model.orefContext,
                        data: { "waveai:maxoutputtokens": 65536 },
                    });
                },
            }
        );
    } else {
        if (isDev()) {
            maxTokensSubmenu.push({
                label: i18next.t("aipanel.maxTokensOptionDevTesting", { tokens: "1k" }),
                type: "checkbox",
                checked: currentMaxTokens === 1024,
                click: () => {
                    RpcApi.SetRTInfoCommand(TabRpcClient, {
                        oref: model.orefContext,
                        data: { "waveai:maxoutputtokens": 1024 },
                    });
                },
            });
        }
        maxTokensSubmenu.push(
            {
                label: i18next.t("aipanel.maxTokensOption", { tokens: "4k" }),
                type: "checkbox",
                checked: currentMaxTokens === 4096,
                click: () => {
                    RpcApi.SetRTInfoCommand(TabRpcClient, {
                        oref: model.orefContext,
                        data: { "waveai:maxoutputtokens": 4096 },
                    });
                },
            },
            {
                label: i18next.t("aipanel.maxTokensOptionPro", { tokens: "16k" }),
                type: "checkbox",
                checked: currentMaxTokens === 16384,
                click: () => {
                    RpcApi.SetRTInfoCommand(TabRpcClient, {
                        oref: model.orefContext,
                        data: { "waveai:maxoutputtokens": 16384 },
                    });
                },
            },
            {
                label: i18next.t("aipanel.maxTokensOptionPro", { tokens: "64k" }),
                type: "checkbox",
                checked: currentMaxTokens === 65536,
                click: () => {
                    RpcApi.SetRTInfoCommand(TabRpcClient, {
                        oref: model.orefContext,
                        data: { "waveai:maxoutputtokens": 65536 },
                    });
                },
            }
        );
    }

    menu.push({
        label: i18next.t("aipanel.maxTokens"),
        submenu: maxTokensSubmenu,
    });

    const speechEnabled = globalStore.get(getSettingsKeyAtom("speech:enabled")) ?? true;
    const speechProvider = globalStore.get(getSettingsKeyAtom("speech:provider")) ?? "local";
    const speechEndpoint = globalStore.get(getSettingsKeyAtom("speech:endpoint")) ?? "";
    const speechModel = globalStore.get(getSettingsKeyAtom("speech:model")) ?? "";
    const speechVoice = globalStore.get(getSettingsKeyAtom("speech:voice")) ?? "";
    const speechVoiceAssistant = globalStore.get(getSettingsKeyAtom("speech:voiceassistant")) ?? "";
    const speechVoiceUser = globalStore.get(getSettingsKeyAtom("speech:voiceuser")) ?? "";
    const speechVoiceSystem = globalStore.get(getSettingsKeyAtom("speech:voicesystem")) ?? "";
    const speechFilterUrls = globalStore.get(getSettingsKeyAtom("speech:filterurls")) ?? true;
    const speechFilterPaths = globalStore.get(getSettingsKeyAtom("speech:filterpaths")) ?? true;
    const speechFilterCode = globalStore.get(getSettingsKeyAtom("speech:filtercode")) ?? true;
    const speechAutoPlay = globalStore.get(getSettingsKeyAtom("speech:autoplay")) ?? false;
    const speechManualButton = globalStore.get(getSettingsKeyAtom("speech:manualbutton")) ?? true;
    const speechLocalEngine = globalStore.get(getSettingsKeyAtom("speech:localengine")) ?? "browser";
    const speechLocalModel = globalStore.get(getSettingsKeyAtom("speech:localmodel")) ?? "";
    const speechLocalModelPath = globalStore.get(getSettingsKeyAtom("speech:localmodelpath")) ?? "";
    const currentMode = globalStore.get(model.currentAIMode);
    const aiModeConfigs = globalStore.get(model.aiModeConfigs);
    const currentModeConfig = aiModeConfigs?.[currentMode];
    const resolvedSpeech = resolveSpeechSettings(
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
    );
    const speechMenu: ContextMenuItem[] = [
        {
            label: i18next.t("aipanel.speech.enable", { defaultValue: "Enable Speech" }),
            type: "checkbox",
            checked: speechEnabled,
            click: () => {
                RpcApi.SetConfigCommand(TabRpcClient, { "speech:enabled": !speechEnabled });
            },
        },
        {
            type: "separator",
        },
        {
            label: i18next.t("aipanel.speech.providerLocal", { defaultValue: "Use Local Voice" }),
            type: "checkbox",
            checked: resolvedSpeech.provider === "local",
            click: () => {
                RpcApi.SetConfigCommand(TabRpcClient, { "speech:provider": "local" });
            },
        },
        {
            label: i18next.t("aipanel.speech.providerApi", { defaultValue: "Use API Voice" }),
            type: "checkbox",
            checked: resolvedSpeech.provider === "api",
            click: () => {
                RpcApi.SetConfigCommand(TabRpcClient, { "speech:provider": "api" });
            },
        },
        {
            type: "separator",
        },
        {
            label: i18next.t("aipanel.speech.autoPlay", { defaultValue: "Auto-play new replies" }),
            type: "checkbox",
            checked: speechAutoPlay,
            click: () => {
                RpcApi.SetConfigCommand(TabRpcClient, { "speech:autoplay": !speechAutoPlay });
            },
        },
        {
            label: i18next.t("aipanel.speech.manualButton", { defaultValue: "Show manual play button" }),
            type: "checkbox",
            checked: speechManualButton,
            click: () => {
                RpcApi.SetConfigCommand(TabRpcClient, { "speech:manualbutton": !speechManualButton });
            },
        },
        {
            type: "separator",
        },
        {
            label: i18next.t("aipanel.speech.localBrowser", { defaultValue: "Local engine: Browser" }),
            type: "checkbox",
            checked: speechLocalEngine === "browser",
            click: () => {
                RpcApi.SetConfigCommand(TabRpcClient, {
                    "speech:localengine": "browser",
                    "speech:model": "browser-speechsynthesis",
                    "speech:provider": "local",
                });
            },
        },
        {
            label: i18next.t("aipanel.speech.localEdge", { defaultValue: "Local engine: Edge TTS" }),
            type: "checkbox",
            checked: speechLocalEngine === "edge",
            click: () => {
                RpcApi.SetConfigCommand(TabRpcClient, {
                    "speech:localengine": "edge",
                    "speech:model": "edge-tts",
                    "speech:provider": "local",
                });
            },
        },
        {
            label: i18next.t("aipanel.speech.localMelo", { defaultValue: "Local engine: MeloTTS" }),
            type: "checkbox",
            checked: speechLocalEngine === "melo",
            click: () => {
                RpcApi.SetConfigCommand(TabRpcClient, {
                    "speech:localengine": "melo",
                    "speech:model": speechLocalModel || "MeloTTS-Chinese",
                    "speech:provider": "local",
                });
            },
        },
        {
            type: "separator",
        },
        {
            label: i18next.t("aipanel.speech.filterUrls", { defaultValue: "Skip URLs while speaking" }),
            type: "checkbox",
            checked: speechFilterUrls,
            click: () => {
                RpcApi.SetConfigCommand(TabRpcClient, { "speech:filterurls": !speechFilterUrls });
            },
        },
        {
            label: i18next.t("aipanel.speech.filterPaths", { defaultValue: "Skip file paths while speaking" }),
            type: "checkbox",
            checked: speechFilterPaths,
            click: () => {
                RpcApi.SetConfigCommand(TabRpcClient, { "speech:filterpaths": !speechFilterPaths });
            },
        },
        {
            label: i18next.t("aipanel.speech.filterCode", { defaultValue: "Skip code blocks while speaking" }),
            type: "checkbox",
            checked: speechFilterCode,
            click: () => {
                RpcApi.SetConfigCommand(TabRpcClient, { "speech:filtercode": !speechFilterCode });
            },
        },
        {
            type: "separator",
        },
        {
            label: i18next.t("aipanel.speech.openSettings", { defaultValue: "Open Settings (speech:*)" }),
            click: () => {
                createBlock(
                    {
                        meta: {
                            view: "waveconfig",
                            file: "speech",
                        },
                    },
                    false,
                    true
                );
            },
        },
    ];

    menu.push({
        label: i18next.t("aipanel.speech.menu", { defaultValue: "Speech" }),
        submenu: speechMenu,
    });

    menu.push({ type: "separator" });

    menu.push({
        label: i18next.t("aipanel.configureModes"),
        click: () => {
            RpcApi.RecordTEventCommand(
                TabRpcClient,
                {
                    event: "action:other",
                    props: {
                        "action:type": "waveai:configuremodes:contextmenu",
                    },
                },
                { noresponse: true }
            );
            model.openWaveAIConfig();
        },
    });

    if (model.canCloseWaveAIPanel()) {
        menu.push({ type: "separator" });

        menu.push({
            label: i18next.t("aipanel.hideWaveAI"),
            click: () => {
                model.closeWaveAIPanel();
            },
        });
    }

    ContextMenuModel.showContextMenu(menu, e);
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    DefaultOpenAICompatibleSpeechModel,
    DefaultOpenAICompatibleSpeechVoice,
    resolveOpenAICompatibleSpeechEndpoint,
    SpeechFilterOptions,
} from "./aispeech";

export type SpeechProvider = "local" | "api";
export type SpeechTransport = "browser" | "api";
export type SpeechLocalEngine = "browser" | "edge" | "melo";
export type SpeechRole = "assistant" | "user" | "system";

export type ResolvedSpeechSettings = {
    enabled: boolean;
    provider: SpeechProvider;
    localEngine: SpeechLocalEngine;
    transport: SpeechTransport;
    autoPlay: boolean;
    showManualButton: boolean;
    endpoint: string | null;
    model: string;
    token: string;
    voice: string;
    voiceAssistant: string;
    voiceUser: string;
    voiceSystem: string;
    localModel: string;
    localModelPath: string;
    filterOptions: SpeechFilterOptions;
};

function normalizeProvider(rawValue: unknown): SpeechProvider {
    if (rawValue === "api") {
        return "api";
    }
    return "local";
}

function normalizeLocalEngine(rawValue: unknown): SpeechLocalEngine {
    if (rawValue === "edge" || rawValue === "melo") {
        return rawValue;
    }
    return "browser";
}

function normalizeBool(rawValue: unknown, defaultValue: boolean): boolean {
    if (typeof rawValue === "boolean") {
        return rawValue;
    }
    return defaultValue;
}

function normalizeString(rawValue: unknown, defaultValue = ""): string {
    if (typeof rawValue !== "string") {
        return defaultValue;
    }
    return rawValue.trim();
}

export function resolveSpeechSettings(
    globalSettings: SettingsType | null | undefined,
    currentModeConfig: MetaType | null | undefined
): ResolvedSpeechSettings {
    const enabled = normalizeBool(globalSettings?.["speech:enabled"], true);
    const provider = normalizeProvider(globalSettings?.["speech:provider"]);
    const localEngine = normalizeLocalEngine(globalSettings?.["speech:localengine"]);
    const transport: SpeechTransport = provider === "api" || localEngine !== "browser" ? "api" : "browser";
    const token = normalizeString(currentModeConfig?.["ai:apitoken"]);
    const configuredEndpoint = normalizeString(globalSettings?.["speech:endpoint"]);
    const localEndpointFallback =
        provider === "local"
            ? localEngine === "edge"
                ? "http://127.0.0.1:5050/v1/audio/speech"
                : localEngine === "melo"
                  ? "http://127.0.0.1:5051/v1/audio/speech"
                  : ""
            : "";
    const fallbackEndpoint = normalizeString(currentModeConfig?.["ai:endpoint"]);
    const endpoint = resolveOpenAICompatibleSpeechEndpoint(
        configuredEndpoint || (transport === "api" ? localEndpointFallback || fallbackEndpoint : fallbackEndpoint),
        token
    );
    const configuredModel =
        normalizeString(globalSettings?.["speech:model"], normalizeString(currentModeConfig?.["ai:model"]))
        || DefaultOpenAICompatibleSpeechModel;
    const model = provider === "local" && localEngine === "edge" ? "edge-tts" : configuredModel;
    const voice = normalizeString(globalSettings?.["speech:voice"], DefaultOpenAICompatibleSpeechVoice)
        || DefaultOpenAICompatibleSpeechVoice;
    const voiceAssistant =
        normalizeString(globalSettings?.["speech:voiceassistant"], voice) || DefaultOpenAICompatibleSpeechVoice;
    const voiceUser = normalizeString(globalSettings?.["speech:voiceuser"], voiceAssistant) || voiceAssistant;
    const voiceSystem = normalizeString(globalSettings?.["speech:voicesystem"], voiceAssistant) || voiceAssistant;
    return {
        enabled,
        provider,
        localEngine,
        transport,
        autoPlay: normalizeBool(globalSettings?.["speech:autoplay"], false),
        showManualButton: normalizeBool(globalSettings?.["speech:manualbutton"], true),
        endpoint,
        model,
        token,
        voice,
        voiceAssistant,
        voiceUser,
        voiceSystem,
        localModel: normalizeString(globalSettings?.["speech:localmodel"]),
        localModelPath: normalizeString(globalSettings?.["speech:localmodelpath"]),
        filterOptions: {
            filterUrls: normalizeBool(globalSettings?.["speech:filterurls"], true),
            filterPaths: normalizeBool(globalSettings?.["speech:filterpaths"], true),
            filterCode: normalizeBool(globalSettings?.["speech:filtercode"], true),
        },
    };
}

export function getSpeechVoiceForRole(settings: ResolvedSpeechSettings, role: SpeechRole): string {
    if (role === "user") {
        return settings.voiceUser || settings.voiceAssistant || settings.voice;
    }
    if (role === "system") {
        return settings.voiceSystem || settings.voiceAssistant || settings.voice;
    }
    return settings.voiceAssistant || settings.voice;
}

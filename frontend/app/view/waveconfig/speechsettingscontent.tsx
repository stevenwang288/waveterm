// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { speechRuntime } from "@/app/aipanel/speechruntime";
import { resolveSpeechSettings } from "@/app/aipanel/speechsettings";
import { WaveAIModel } from "@/app/aipanel/waveai-model";
import { Toggle } from "@/app/element/toggle";
import { getSettingsKeyAtom } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useState } from "react";

interface SpeechSettingsContentProps {
    model: WaveConfigViewModel;
}

const EdgeVoiceOptions = [
    "zh-CN-XiaoxiaoNeural",
    "zh-CN-YunxiNeural",
    "zh-CN-XiaoyiNeural",
    "zh-CN-YunjianNeural",
    "zh-CN-liaoning-XiaobeiNeural",
    "zh-CN-shaanxi-XiaoniNeural",
];

function FieldLabel({ title, desc }: { title: string; desc?: string }) {
    return (
        <div className="mb-1">
            <div className="text-sm font-medium text-primary">{title}</div>
            {desc && <div className="text-xs text-muted-foreground mt-0.5 leading-5">{desc}</div>}
        </div>
    );
}

function Card({
    title,
    desc,
    className,
    children,
}: {
    title: string;
    desc?: string;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <div className={`rounded-lg border border-border bg-black/10 p-1.5 ${className ?? ""}`.trim()}>
            <FieldLabel title={title} desc={desc} />
            {children}
        </div>
    );
}

function normalizeOptions(values: (string | null | undefined)[]): string[] {
    const unique = new Set<string>();
    for (const value of values) {
        const normalized = value?.trim();
        if (!normalized) {
            continue;
        }
        unique.add(normalized);
    }
    return Array.from(unique);
}

async function setConfig(values: SettingsType): Promise<void> {
    await RpcApi.SetConfigCommand(TabRpcClient, values);
}

export const SpeechSettingsContent = memo(({ model: _model }: SpeechSettingsContentProps) => {
    const aiModel = useMemo(() => WaveAIModel.getInstance(), []);
    const currentMode = useAtomValue(aiModel.currentAIMode);
    const aiModeConfigs = useAtomValue(aiModel.aiModeConfigs);
    const currentModeConfig = aiModeConfigs?.[currentMode];

    const speechEnabledRaw = useAtomValue(getSettingsKeyAtom("speech:enabled"));
    const speechAutoPlayRaw = useAtomValue(getSettingsKeyAtom("speech:autoplay"));
    const speechManualButtonRaw = useAtomValue(getSettingsKeyAtom("speech:manualbutton"));
    const speechProviderRaw = useAtomValue(getSettingsKeyAtom("speech:provider")) ?? "local";
    const speechProvider = "local";
    const speechRate = useAtomValue(getSettingsKeyAtom("speech:rate")) ?? 1;
    const speechLocalEngineRaw = useAtomValue(getSettingsKeyAtom("speech:localengine")) ?? "edge";
    const speechLocalEngine = speechLocalEngineRaw;
    const speechLocalModel = useAtomValue(getSettingsKeyAtom("speech:localmodel")) ?? "";
    const speechLocalModelPath = useAtomValue(getSettingsKeyAtom("speech:localmodelpath")) ?? "";
    const speechModel = useAtomValue(getSettingsKeyAtom("speech:model")) ?? "edge-tts";
    const speechVoice = useAtomValue(getSettingsKeyAtom("speech:voice")) ?? "";
    const speechVoiceAssistant = useAtomValue(getSettingsKeyAtom("speech:voiceassistant")) ?? "zh-CN-XiaoxiaoNeural";
    const speechVoiceUser = useAtomValue(getSettingsKeyAtom("speech:voiceuser")) ?? speechVoiceAssistant;
    const speechVoiceSystem = useAtomValue(getSettingsKeyAtom("speech:voicesystem")) ?? speechVoiceAssistant;
    const speechFilterUrls = useAtomValue(getSettingsKeyAtom("speech:filterurls")) ?? true;
    const speechFilterPaths = useAtomValue(getSettingsKeyAtom("speech:filterpaths")) ?? true;
    const speechFilterCode = useAtomValue(getSettingsKeyAtom("speech:filtercode")) ?? true;
    const speechRateValue = useMemo(() => Math.max(0.5, Math.min(2, speechRate)), [speechRate]);

    const speechEnabled = typeof speechEnabledRaw === "boolean" ? speechEnabledRaw : false;
    const speechAutoPlay = typeof speechAutoPlayRaw === "boolean" ? speechAutoPlayRaw : false;
    const speechManualButton = typeof speechManualButtonRaw === "boolean" ? speechManualButtonRaw : true;

    const speechEndpoint = useAtomValue(getSettingsKeyAtom("speech:endpoint")) ?? "";

    useEffect(() => {
        const update: SettingsType = {};
        let changed = false;
        if (speechProviderRaw !== "local") {
            update["speech:provider"] = "local";
            changed = true;
        }
        if (speechLocalEngineRaw !== "edge") {
            update["speech:localengine"] = "edge";
            changed = true;
        }
        if ((speechModel ?? "").trim() !== "edge-tts") {
            update["speech:model"] = "edge-tts";
            changed = true;
        }
        if ((speechEndpoint ?? "").trim() !== "") {
            update["speech:endpoint"] = "";
            changed = true;
        }
        if (changed) {
            void setConfig(update);
        }
    }, [speechEndpoint, speechLocalEngineRaw, speechModel, speechProviderRaw]);

    useEffect(() => {
        const update: SettingsType = {};
        let changed = false;
        if (speechLocalEngineRaw === "browser") {
            update["speech:localengine"] = "edge";
            update["speech:model"] = "edge-tts";
            changed = true;
        }
        if (speechLocalEngineRaw === "melo") {
            update["speech:localengine"] = "edge";
            update["speech:model"] = "edge-tts";
            changed = true;
        }
        if ((speechLocalModel ?? "").trim() !== "") {
            update["speech:localmodel"] = "";
            changed = true;
        }
        if ((speechLocalModelPath ?? "").trim() !== "") {
            update["speech:localmodelpath"] = "";
            changed = true;
        }
        if (changed) {
            void setConfig(update);
        }
    }, [speechLocalEngineRaw, speechLocalModel, speechLocalModelPath]);

    const [speechActive, setSpeechActive] = useState(false);
    useEffect(() => {
        return speechRuntime.subscribe(setSpeechActive, "speech-settings-preview");
    }, []);

    const modelOptions = useMemo(() => {
        return ["edge-tts"];
    }, []);

    const voiceOptions = useMemo(() => {
        if (speechLocalEngine === "edge") {
            return EdgeVoiceOptions;
        }
        return EdgeVoiceOptions;
    }, [speechLocalEngine]);

    const assistantVoiceValue = voiceOptions.includes(speechVoiceAssistant) ? speechVoiceAssistant : voiceOptions[0];
    const userVoiceValue = voiceOptions.includes(speechVoiceUser) ? speechVoiceUser : assistantVoiceValue;
    const systemVoiceValue = voiceOptions.includes(speechVoiceSystem) ? speechVoiceSystem : assistantVoiceValue;

    useEffect(() => {
        if (modelOptions.length === 0) {
            return;
        }
        if (!modelOptions.includes(speechModel)) {
            void setConfig({ "speech:model": modelOptions[0] });
        }
    }, [modelOptions, speechModel]);

    useEffect(() => {
        if (voiceOptions.length === 0) {
            return;
        }
        const fallbackVoice = voiceOptions[0];
        const update: SettingsType = {};
        let changed = false;
        if (!voiceOptions.includes(speechVoiceAssistant)) {
            update["speech:voiceassistant"] = fallbackVoice;
            update["speech:voice"] = fallbackVoice;
            changed = true;
        }
        if (!voiceOptions.includes(speechVoiceUser)) {
            update["speech:voiceuser"] = fallbackVoice;
            changed = true;
        }
        if (!voiceOptions.includes(speechVoiceSystem)) {
            update["speech:voicesystem"] = fallbackVoice;
            changed = true;
        }
        if (changed) {
            void setConfig(update);
        }
    }, [speechVoiceAssistant, speechVoiceSystem, speechVoiceUser, voiceOptions]);

    const resolvedSettings = useMemo(
        () =>
            resolveSpeechSettings(
                {
                    "speech:enabled": speechEnabled,
                    "speech:provider": speechProvider,
                    "speech:localengine": speechLocalEngine,
                    "speech:model": "edge-tts",
                    "speech:voice": speechVoice?.trim() ? speechVoice : assistantVoiceValue,
                    "speech:voiceassistant": assistantVoiceValue,
                    "speech:voiceuser": userVoiceValue,
                    "speech:voicesystem": systemVoiceValue,
                    "speech:rate": speechRateValue,
                    "speech:localmodel": speechLocalModel,
                    "speech:localmodelpath": speechLocalModelPath,
                    "speech:filterurls": speechFilterUrls,
                    "speech:filterpaths": speechFilterPaths,
                    "speech:filtercode": speechFilterCode,
                    "speech:autoplay": speechAutoPlay,
                    "speech:manualbutton": speechManualButton,
                },
                currentModeConfig
            ),
        [
            assistantVoiceValue,
            currentModeConfig,
            speechAutoPlay,
            speechEnabled,
            speechFilterCode,
            speechFilterPaths,
            speechFilterUrls,
            speechLocalEngine,
            speechLocalModel,
            speechLocalModelPath,
            speechManualButton,
            speechRateValue,
            speechProvider,
            speechVoice,
            systemVoiceValue,
            userVoiceValue,
        ]
    );

    const [testText, setTestText] = useState("一二三四。这是一段语音播报测试。");
    const [testError, setTestError] = useState("");
    const [endpointDiag, setEndpointDiag] = useState("");

    const runTest = async () => {
        setTestError("");
        if (speechActive) {
            speechRuntime.stop("speech-settings-preview");
            await new Promise((resolve) => window.setTimeout(resolve, 80));
        }
        let runtimeError = "";
        const started = await speechRuntime.play(
            testText,
            resolvedSettings,
            "assistant",
            (errorMessage) => {
                runtimeError = errorMessage;
                setTestError(errorMessage);
            },
            { ownerId: "speech-settings-preview" }
        );
        if (!started && !runtimeError) {
            setTestError("未能启动语音测试，请检查终端小喇叭是否可用。");
        }
    };

    useEffect(() => {
        setEndpointDiag("");
    }, [speechLocalEngine, speechProvider]);

    const runEndpointDiagnose = async () => {
        setEndpointDiag("");
        const endpoint = resolvedSettings.endpoint ?? "unknown";
        const voice = resolvedSettings.voiceAssistant || resolvedSettings.voice || "unknown";
        const model = resolvedSettings.model || "unknown";

        let about: AboutModalDetails | null = null;
        try {
            const api = (window as any)?.api;
            if (typeof api?.getAboutModalDetails === "function") {
                about = api.getAboutModalDetails() as AboutModalDetails;
            }
        } catch {
            about = null;
        }

        const waveLine = about?.version ? `WAVE: ${about.version} (${about.buildTime || 0})` : "";
        const uiLine = about?.uiCommit
            ? `UI: ${about.uiCommit}${about.uiDirty ? " (dirty)" : ""} (${about.uiBuildIso || ""})`
            : "";
        const profileLine = about?.profile ? `Profile: ${about.profile}` : "";
        const extra = [waveLine, uiLine, profileLine].filter(Boolean).join("\n");

        setEndpointDiag(
            `当前使用内置 Edge TTS（无需端口）。\nendpoint: ${endpoint}\nmodel: ${model}\nvoice: ${voice}${extra ? `\n\n${extra}` : ""}`
        );
    };

    const setSpeechRate = (nextRate: number) => {
        const clamped = Math.max(0.5, Math.min(2, nextRate));
        void setConfig({ "speech:rate": Number(clamped.toFixed(2)) });
    };

    return (
        <div className="h-full overflow-hidden px-2 py-2">
            <div className="mx-auto max-w-[700px]">
                <div className="space-y-1.5">
                    <Card title="总开关与播放方式" desc="建议先打开总开关，然后用“发声测试”验证链路。">
                        <div className="grid grid-cols-1 gap-1.5">
                            <Toggle checked={speechEnabled} onChange={(val) => void setConfig({ "speech:enabled": !!val })} label="启用语音播报（总开关）" />
                            <Toggle
                                checked={speechAutoPlay}
                                onChange={(val) => void setConfig({ "speech:autoplay": !!val })}
                                label="自动朗读 Wave AI 新回复（全局）"
                            />
                            <Toggle
                                checked={speechManualButton}
                                onChange={(val) => void setConfig({ "speech:manualbutton": !!val })}
                                label="显示 Wave AI 的手动朗读按钮"
                            />
                        </div>
                    </Card>

                    <Card title="播报速度">
                        <div className="rounded border border-border/70 px-2 py-1.5">
                            <div className="text-xs text-muted-foreground mb-1">0.5x - 2.0x，手动和自动都生效。</div>
                            <div className="flex items-center gap-2">
                                <input
                                    type="range"
                                    min={0.5}
                                    max={2}
                                    step={0.05}
                                    value={speechRateValue}
                                    onChange={(e) => setSpeechRate(Number(e.target.value))}
                                    className="w-[200px] max-w-full"
                                />
                                <input
                                    type="number"
                                    min={0.5}
                                    max={2}
                                    step={0.05}
                                    value={speechRateValue.toFixed(2)}
                                    onChange={(e) => {
                                        const next = Number(e.target.value);
                                        if (!Number.isNaN(next)) {
                                            setSpeechRate(next);
                                        }
                                    }}
                                    className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm"
                                />
                            </div>
                        </div>
                    </Card>

                    <Card title="语音来源与模型" desc="仅支持内置 Edge TTS（不会自动降级到 Windows 兜底 TTS）。">
                        <div className="space-y-1.5">
                            <select
                                className="w-[240px] max-w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5"
                                value="edge"
                                disabled
                            >
                                <option value="edge">Edge TTS（内置）</option>
                            </select>
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded cursor-pointer"
                                    onClick={() => void runEndpointDiagnose()}
                                    title="显示当前实际使用的内置 Edge TTS 参数（endpoint/model/voice）"
                                >
                                    诊断
                                </button>
                                {endpointDiag && (
                                    <div className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
                                        {endpointDiag}
                                    </div>
                                )}
                            </div>
                        </div>
                    </Card>

                    <Card title="Assistant 音色与过滤" desc="终端小喇叭只使用 Assistant 音色。">
                        <div className="space-y-1.5">
                            <select
                                className="w-[260px] max-w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5"
                                value={assistantVoiceValue}
                                onChange={(e) =>
                                    void setConfig({
                                        "speech:voiceassistant": e.target.value,
                                        "speech:voice": e.target.value,
                                    })
                                }
                            >
                                {voiceOptions.map((voice) => (
                                    <option key={voice} value={voice}>
                                        {voice}
                                    </option>
                                ))}
                            </select>
                            <div className="grid grid-cols-1 gap-1.5">
                                <Toggle checked={speechFilterUrls} onChange={(val) => void setConfig({ "speech:filterurls": val })} label="过滤 URL" />
                                <Toggle checked={speechFilterPaths} onChange={(val) => void setConfig({ "speech:filterpaths": val })} label="过滤文件路径" />
                                <Toggle checked={speechFilterCode} onChange={(val) => void setConfig({ "speech:filtercode": val })} label="过滤代码块" />
                            </div>
                        </div>
                    </Card>

                    <Card title="发声测试（Assistant）" desc="用于确认当前语音链路正常。">
                        <div className="flex flex-wrap items-center gap-2">
                            <input
                                className="w-[420px] max-w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5"
                                value={testText}
                                onChange={(e) => setTestText(e.target.value)}
                            />
                            <button
                                className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded cursor-pointer"
                                onClick={() => void runTest()}
                                title={speechActive ? "停止播报" : "播放测试"}
                            >
                                {speechActive ? "停止" : "播放测试"}
                            </button>
                        </div>
                        {testError && <div className="text-xs text-yellow-400 mt-1">{testError}</div>}
                    </Card>

                </div>
            </div>
        </div>
    );
});

SpeechSettingsContent.displayName = "SpeechSettingsContent";

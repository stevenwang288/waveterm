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

const OpenAICompatibleModelOptions = [
    "gpt-4o-mini-tts",
    "gpt-4o-tts",
];
const OpenAIVoiceOptions = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"];
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

    const speechProvider = useAtomValue(getSettingsKeyAtom("speech:provider")) ?? "local";
    const speechRate = useAtomValue(getSettingsKeyAtom("speech:rate")) ?? 1;
    const speechLocalEngineRaw = useAtomValue(getSettingsKeyAtom("speech:localengine")) ?? "edge";
    const speechLocalEngine = speechLocalEngineRaw === "edge" ? "edge" : "edge";
    const speechLocalModel = useAtomValue(getSettingsKeyAtom("speech:localmodel")) ?? "";
    const speechLocalModelPath = useAtomValue(getSettingsKeyAtom("speech:localmodelpath")) ?? "";
    const speechEndpoint = useAtomValue(getSettingsKeyAtom("speech:endpoint")) ?? "";
    const speechModel =
        useAtomValue(getSettingsKeyAtom("speech:model")) ??
        (speechProvider === "local" ? "edge-tts" : "gpt-4o-mini-tts");
    const speechVoice = useAtomValue(getSettingsKeyAtom("speech:voice")) ?? "";
    const speechVoiceAssistant = useAtomValue(getSettingsKeyAtom("speech:voiceassistant")) ?? "zh-CN-XiaoxiaoNeural";
    const speechVoiceUser = useAtomValue(getSettingsKeyAtom("speech:voiceuser")) ?? speechVoiceAssistant;
    const speechVoiceSystem = useAtomValue(getSettingsKeyAtom("speech:voicesystem")) ?? speechVoiceAssistant;
    const speechFilterUrls = useAtomValue(getSettingsKeyAtom("speech:filterurls")) ?? true;
    const speechFilterPaths = useAtomValue(getSettingsKeyAtom("speech:filterpaths")) ?? true;
    const speechFilterCode = useAtomValue(getSettingsKeyAtom("speech:filtercode")) ?? true;
    const speechRateValue = useMemo(() => Math.max(0.5, Math.min(2, speechRate)), [speechRate]);

    const [endpointDraft, setEndpointDraft] = useState(speechEndpoint);
    const [modelDraft, setModelDraft] = useState(speechModel);
    const [browserVoiceOptions, setBrowserVoiceOptions] = useState<string[]>([]);

    useEffect(() => setEndpointDraft(speechEndpoint), [speechEndpoint]);
    useEffect(() => setModelDraft(speechModel), [speechModel]);

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
    const [showAdvanced, setShowAdvanced] = useState(false);
    useEffect(() => {
        return speechRuntime.subscribe(setSpeechActive, "speech-settings-preview");
    }, []);

    useEffect(() => {
        if (typeof window === "undefined" || typeof window.speechSynthesis === "undefined") {
            return;
        }
        const refreshVoices = () => {
            const voices = window.speechSynthesis.getVoices().map((voice) => voice.name);
            setBrowserVoiceOptions(normalizeOptions(voices));
        };
        refreshVoices();
        window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
        return () => {
            window.speechSynthesis.removeEventListener("voiceschanged", refreshVoices);
        };
    }, []);

    const modelOptions = useMemo(() => {
        if (speechProvider !== "local") {
            return normalizeOptions([...OpenAICompatibleModelOptions, speechModel]);
        }
        return ["edge-tts"];
    }, [speechModel, speechProvider]);

    const voiceOptions = useMemo(() => {
        if (speechProvider !== "local") {
            return OpenAIVoiceOptions;
        }
        if (speechLocalEngine === "edge") {
            return EdgeVoiceOptions;
        }
        if (browserVoiceOptions.length > 0) {
            return normalizeOptions(["system-default", ...browserVoiceOptions]);
        }
        return ["system-default"];
    }, [browserVoiceOptions, speechLocalEngine, speechProvider]);

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
                    "speech:provider": speechProvider,
                    "speech:localengine": speechLocalEngine,
                    "speech:endpoint": endpointDraft,
                    "speech:model": modelDraft,
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
                },
                currentModeConfig
            ),
        [
            assistantVoiceValue,
            currentModeConfig,
            endpointDraft,
            modelDraft,
            speechFilterCode,
            speechFilterPaths,
            speechFilterUrls,
            speechLocalEngine,
            speechLocalModel,
            speechLocalModelPath,
            speechRateValue,
            speechProvider,
            speechVoice,
            systemVoiceValue,
            userVoiceValue,
        ]
    );

    const [testText, setTestText] = useState("一二三四。这是一段语音播报测试。");
    const [testError, setTestError] = useState("");

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

    const showApiSection = speechProvider === "api";
    const showLocalEndpointSection = speechProvider === "local" && speechLocalEngine !== "browser";

    const setSpeechRate = (nextRate: number) => {
        const clamped = Math.max(0.5, Math.min(2, nextRate));
        void setConfig({ "speech:rate": Number(clamped.toFixed(2)) });
    };

    return (
        <div className="h-full overflow-hidden px-2 py-2">
            <div className="mx-auto max-w-[700px]">
                <div className="space-y-1.5">
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

                    <Card title="语音来源与模型" desc="默认推荐本地 Edge TTS。">
                        <div className="space-y-1.5">
                            <div className="flex gap-4 flex-wrap">
                                <label className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        checked={speechProvider === "local"}
                                        onChange={() => void setConfig({ "speech:provider": "local" })}
                                    />
                                    <span>本地</span>
                                </label>
                                <label className="flex items-center gap-2">
                                    <input
                                        type="radio"
                                        checked={speechProvider === "api"}
                                        onChange={() => void setConfig({ "speech:provider": "api" })}
                                    />
                                    <span>OpenAI 兼容 API</span>
                                </label>
                            </div>

                            {speechProvider === "local" && (
                                <select
                                    className="w-[240px] max-w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5"
                                    value={speechLocalEngine}
                                    onChange={(e) => {
                                        const localEngine = e.target.value;
                                        const update: SettingsType = { "speech:localengine": localEngine, "speech:model": "edge-tts" };
                                        void setConfig(update);
                                    }}
                                >
                                    <option value="edge">Edge TTS（本地服务）</option>
                                </select>
                            )}

                            {showApiSection && (
                                <div className="space-y-1.5">
                                    <input
                                        list="speech-model-options"
                                        className="w-[260px] max-w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5"
                                        value={modelDraft}
                                        onChange={(e) => setModelDraft(e.target.value)}
                                        onBlur={() => void setConfig({ "speech:model": modelDraft.trim() })}
                                        placeholder="例如：gpt-4o-mini-tts"
                                    />
                                    <datalist id="speech-model-options">
                                        {modelOptions.map((opt) => (
                                            <option key={opt} value={opt} />
                                        ))}
                                    </datalist>
                                </div>
                            )}
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

                    <div className="flex items-center justify-between px-1">
                        <span className="text-xs text-muted-foreground">高级选项</span>
                        <Toggle checked={showAdvanced} onChange={(val) => setShowAdvanced(!!val)} label="显示高级项" />
                    </div>

                    {showAdvanced && showApiSection && (
                        <Card title="API Endpoint" desc="支持 /v1、/responses、/chat/completions，会自动归一化到 /audio/speech。">
                            <input
                                className="w-[420px] max-w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5"
                                value={endpointDraft}
                                onChange={(e) => setEndpointDraft(e.target.value)}
                                onBlur={() => void setConfig({ "speech:endpoint": endpointDraft.trim() })}
                                placeholder="https://api.openai.com/v1/audio/speech"
                            />
                        </Card>
                    )}

                    {showAdvanced && showLocalEndpointSection && (
                        <Card title="本地服务 Endpoint" desc="留空时自动使用默认端口（Edge=5050）。">
                            <div className="flex flex-wrap items-center gap-2">
                                <input
                                    className="w-[380px] max-w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5"
                                    value={endpointDraft}
                                    onChange={(e) => setEndpointDraft(e.target.value)}
                                    onBlur={() => void setConfig({ "speech:endpoint": endpointDraft.trim() })}
                                    placeholder="http://127.0.0.1:5050/v1/audio/speech"
                                />
                                <button
                                    className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded cursor-pointer"
                                    onClick={() => {
                                        setEndpointDraft("");
                                        void setConfig({ "speech:endpoint": "" });
                                    }}
                                >
                                    默认
                                </button>
                            </div>
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
});

SpeechSettingsContent.displayName = "SpeechSettingsContent";

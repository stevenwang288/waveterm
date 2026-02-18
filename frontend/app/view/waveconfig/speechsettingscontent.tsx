// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Toggle } from "@/app/element/toggle";
import { getSpeechVoiceForRole, resolveSpeechSettings, type SpeechRole } from "@/app/aipanel/speechsettings";
import { speechRuntime } from "@/app/aipanel/speechruntime";
import { WaveAIModel } from "@/app/aipanel/waveai-model";
import { getApi, getSettingsKeyAtom } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useState } from "react";

interface SpeechSettingsContentProps {
    model: WaveConfigViewModel;
}

const OpenAICompatibleModelOptions = ["gpt-4o-mini-tts", "gpt-4o-tts"];
const OpenAIVoiceOptions = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"];
const EdgeVoiceOptions = [
    "zh-CN-XiaoxiaoNeural",
    "zh-CN-YunxiNeural",
    "zh-CN-XiaoyiNeural",
    "zh-CN-YunjianNeural",
    "zh-CN-liaoning-XiaobeiNeural",
    "zh-CN-shaanxi-XiaoniNeural",
];
const MeloVoiceOptions = ["zh", "zh_female", "zh_male", "speaker_0", "speaker_1", "speaker_2"];

function FieldLabel({ title, desc }: { title: string; desc?: string }) {
    return (
        <div className="mb-1">
            <div className="text-sm font-medium text-primary">{title}</div>
            {desc && <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>}
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
    const speechEnabled = useAtomValue(getSettingsKeyAtom("speech:enabled")) ?? true;
    const speechProvider = useAtomValue(getSettingsKeyAtom("speech:provider")) ?? "local";
    const speechAutoPlay = useAtomValue(getSettingsKeyAtom("speech:autoplay")) ?? false;
    const speechManualButton = useAtomValue(getSettingsKeyAtom("speech:manualbutton")) ?? true;
    const speechLocalEngine = useAtomValue(getSettingsKeyAtom("speech:localengine")) ?? "browser";
    const speechLocalModel = useAtomValue(getSettingsKeyAtom("speech:localmodel")) ?? "MeloTTS-Chinese";
    const speechLocalModelPath = useAtomValue(getSettingsKeyAtom("speech:localmodelpath")) ?? "E:\\models\\huggingface";
    const speechEndpoint = useAtomValue(getSettingsKeyAtom("speech:endpoint")) ?? "";
    const speechModel =
        useAtomValue(getSettingsKeyAtom("speech:model"))
        ?? (speechProvider === "local"
            ? speechLocalEngine === "edge"
                ? "edge-tts"
                : speechLocalEngine === "melo"
                  ? speechLocalModel
                  : "browser-speechsynthesis"
            : "gpt-4o-mini-tts");
    const speechVoice = useAtomValue(getSettingsKeyAtom("speech:voice")) ?? "";
    const speechVoiceAssistant = useAtomValue(getSettingsKeyAtom("speech:voiceassistant")) ?? "zh-CN-XiaoxiaoNeural";
    const speechVoiceUser = useAtomValue(getSettingsKeyAtom("speech:voiceuser")) ?? speechVoiceAssistant;
    const speechVoiceSystem = useAtomValue(getSettingsKeyAtom("speech:voicesystem")) ?? speechVoiceAssistant;
    const speechFilterUrls = useAtomValue(getSettingsKeyAtom("speech:filterurls")) ?? true;
    const speechFilterPaths = useAtomValue(getSettingsKeyAtom("speech:filterpaths")) ?? true;
    const speechFilterCode = useAtomValue(getSettingsKeyAtom("speech:filtercode")) ?? true;

    const [endpointDraft, setEndpointDraft] = useState(speechEndpoint);
    const [localModelDraft, setLocalModelDraft] = useState(speechLocalModel);
    const [localModelPathDraft, setLocalModelPathDraft] = useState(speechLocalModelPath);
    const [scanLoading, setScanLoading] = useState(false);
    const [scanError, setScanError] = useState("");
    const [localModelOptions, setLocalModelOptions] = useState<string[]>([]);
    const [browserVoiceOptions, setBrowserVoiceOptions] = useState<string[]>([]);

    useEffect(() => setEndpointDraft(speechEndpoint), [speechEndpoint]);
    useEffect(() => setLocalModelDraft(speechLocalModel), [speechLocalModel]);
    useEffect(() => setLocalModelPathDraft(speechLocalModelPath), [speechLocalModelPath]);

    const [speechActive, setSpeechActive] = useState(false);
    useEffect(() => {
        return speechRuntime.subscribe(setSpeechActive);
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

    const localEngineOptions = useMemo(
        () => [
            { label: "浏览器本地语音", value: "browser" },
            { label: "Edge TTS（本地服务）", value: "edge" },
            { label: "MeloTTS（本地模型）", value: "melo" },
        ],
        []
    );

    const modelOptions = useMemo(() => {
        if (speechProvider !== "local") {
            return normalizeOptions([...OpenAICompatibleModelOptions, speechModel]);
        }
        if (speechLocalEngine === "edge") {
            return ["edge-tts"];
        }
        if (speechLocalEngine === "melo") {
            return normalizeOptions([speechLocalModel, "MeloTTS-Chinese"]);
        }
        return ["browser-speechsynthesis"];
    }, [speechLocalEngine, speechLocalModel, speechModel, speechProvider]);

    const baseVoiceOptions = useMemo(() => {
        if (speechProvider !== "local") {
            return OpenAIVoiceOptions;
        }
        if (speechLocalEngine === "edge") {
            return EdgeVoiceOptions;
        }
        if (speechLocalEngine === "melo") {
            return MeloVoiceOptions;
        }
        if (browserVoiceOptions.length > 0) {
            return ["system-default", ...browserVoiceOptions];
        }
        return ["system-default"];
    }, [browserVoiceOptions, speechLocalEngine, speechProvider]);

    const voiceOptions = useMemo(() => normalizeOptions(baseVoiceOptions), [baseVoiceOptions]);
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

    const scanLocalModels = async () => {
        const scanPath = localModelPathDraft.trim();
        if (!scanPath) {
            setScanError("请先填写本地模型目录。");
            return;
        }
        setScanLoading(true);
        setScanError("");
        try {
            const list = await RpcApi.FileListCommand(TabRpcClient, {
                path: scanPath,
                opts: { limit: 500, all: false },
            });
            const folders = (list ?? []).filter((item) => item?.isdir).map((item) => item.name).filter(Boolean);
            setLocalModelOptions(folders);
            if (folders.length === 0) {
                setScanError("未扫描到模型目录。");
            }
        } catch (error) {
            setScanError(error instanceof Error ? error.message : String(error));
        } finally {
            setScanLoading(false);
        }
    };

    const resolvedSettings = useMemo(
        () =>
            resolveSpeechSettings(
                {
                    "speech:enabled": speechEnabled,
                    "speech:provider": speechProvider,
                    "speech:localengine": speechLocalEngine,
                    "speech:endpoint": endpointDraft,
                    "speech:model": speechModel,
                    // Keep legacy "speech:voice" aligned to the assistant voice for API calls.
                    "speech:voice": speechVoice?.trim() ? speechVoice : assistantVoiceValue,
                    "speech:voiceassistant": assistantVoiceValue,
                    "speech:voiceuser": userVoiceValue,
                    "speech:voicesystem": systemVoiceValue,
                    "speech:autoplay": speechAutoPlay,
                    "speech:manualbutton": speechManualButton,
                    "speech:localmodel": localModelDraft,
                    "speech:localmodelpath": localModelPathDraft,
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
            localModelDraft,
            localModelPathDraft,
            speechAutoPlay,
            speechEnabled,
            speechFilterCode,
            speechFilterPaths,
            speechFilterUrls,
            speechLocalEngine,
            speechManualButton,
            speechModel,
            speechProvider,
            speechVoice,
            systemVoiceValue,
            userVoiceValue,
        ]
    );

    const [testRole, setTestRole] = useState<SpeechRole>("assistant");
    const [testText, setTestText] = useState("一二三四。这是一段语音播报测试。");
    const [testError, setTestError] = useState("");

    const testVoice = useMemo(() => getSpeechVoiceForRole(resolvedSettings, testRole), [resolvedSettings, testRole]);

    const runTest = async () => {
        setTestError("");
        if (speechActive) {
            speechRuntime.stop();
            return;
        }
        await speechRuntime.play(testText, resolvedSettings, testRole, (errorMessage) => {
            setTestError(errorMessage);
        });
    };

    const showApiSection = speechProvider === "api";
    const showLocalEngineSection = speechProvider === "local";
    const showLocalEndpointSection = speechProvider === "local" && speechLocalEngine !== "browser";
    const showLocalModelSection = speechProvider === "local" && speechLocalEngine === "melo";

    return (
        <div className="h-full overflow-y-auto px-5 py-4">
            <div className="text-lg font-semibold mb-4">语音播报</div>

            <div className="rounded-lg border border-border p-4 mb-4">
                <FieldLabel title="测试朗读" desc="先用这里验证能发声，再去每个面板右上角（齿轮左侧）按钮朗读 AI 回复。" />
                <div className="grid grid-cols-1 gap-3">
                    <textarea
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2"
                        value={testText}
                        onChange={(e) => setTestText(e.target.value)}
                        rows={3}
                    />
                    <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">角色</span>
                            <select
                                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2"
                                value={testRole}
                                onChange={(e) => setTestRole(e.target.value as SpeechRole)}
                            >
                                <option value="assistant">Assistant</option>
                                <option value="user">User</option>
                                <option value="system">System</option>
                            </select>
                        </div>
                        <button
                            className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded cursor-pointer"
                            onClick={() => {
                                void runTest();
                            }}
                            title={speechActive ? "停止播报" : "播放测试"}
                        >
                            {speechActive ? "停止" : "播放测试"}
                        </button>
                        <div className="text-xs text-muted-foreground">
                            当前：{resolvedSettings.transport === "browser" ? "浏览器语音" : "API"} / voice:{" "}
                            {testVoice || "system-default"}
                            {resolvedSettings.transport === "api" && (
                                <>
                                    {" "}
                                    / model: {resolvedSettings.model || "-"}
                                    {" "}
                                    / endpoint: {resolvedSettings.endpoint || "(未配置)"}
                                </>
                            )}
                        </div>
                    </div>
                    {testError && <div className="text-xs text-yellow-400">{testError}</div>}
                </div>
            </div>

            <div className="rounded-lg border border-border p-4 mb-4">
                <FieldLabel title="总开关" desc="关闭后自动和手动播报都会停用。" />
                <Toggle checked={speechEnabled} onChange={(val) => void setConfig({ "speech:enabled": val })} />
            </div>

            <div className="rounded-lg border border-border p-4 mb-4">
                <FieldLabel title="播报模式" desc="自动：新回复到达就播报；手动：用面板右上角（齿轮左边）按钮播报当前轮。" />
                <div className="flex flex-col gap-3">
                    <Toggle
                        checked={speechAutoPlay}
                        onChange={(val) => void setConfig({ "speech:autoplay": val })}
                        label="AI 回复结束后自动朗读"
                    />
                    <Toggle
                        checked={speechManualButton}
                        onChange={(val) => void setConfig({ "speech:manualbutton": val })}
                        label="显示右上角朗读按钮（齿轮左侧）"
                    />
                </div>
            </div>

            <div className="rounded-lg border border-border p-4 mb-4">
                <FieldLabel title="语音来源" />
                <div className="flex gap-4 mb-3">
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

                {showLocalEngineSection && (
                    <>
                        <FieldLabel title="本地引擎" desc="浏览器：系统自带；Edge/Melo：需要你本机先启动对应的本地服务（没启动会自动用系统语音，所以声音可能不一样）。" />
                        <select
                            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 mb-3"
                            value={speechLocalEngine}
                            onChange={(e) => {
                                const localEngine = e.target.value;
                                const update: SettingsType = { "speech:localengine": localEngine };
                                if (localEngine === "edge") {
                                    update["speech:model"] = "edge-tts";
                                } else if (localEngine === "melo") {
                                    update["speech:model"] = localModelDraft.trim() || "MeloTTS-Chinese";
                                } else {
                                    update["speech:model"] = "browser-speechsynthesis";
                                }
                                void setConfig(update);
                            }}
                        >
                            {localEngineOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </>
                )}
            </div>

            {showApiSection && (
                <div className="rounded-lg border border-border p-4 mb-4">
                    <FieldLabel title="API 设置" desc="使用 OpenAI 兼容接口（token 来自当前 AI mode 的配置）。" />
                    <div className="grid grid-cols-1 gap-3">
                        <div>
                            <FieldLabel title="Endpoint" desc="可以填 /v1、/responses、/chat/completions，WAVE 会自动改成 /v1/audio/speech。" />
                            <input
                                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2"
                                value={endpointDraft}
                                onChange={(e) => setEndpointDraft(e.target.value)}
                                onBlur={() => void setConfig({ "speech:endpoint": endpointDraft.trim() })}
                                placeholder="https://api.openai.com/v1/audio/speech"
                            />
                        </div>
                        <div>
                            <FieldLabel title="模型（下拉选择）" />
                            <select
                                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2"
                                value={speechModel}
                                onChange={(e) => void setConfig({ "speech:model": e.target.value })}
                            >
                                {modelOptions.map((opt) => (
                                    <option key={opt} value={opt}>
                                        {opt}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            )}

            {showLocalEndpointSection && (
                <div className="rounded-lg border border-border p-4 mb-4">
                    <FieldLabel title="本地服务 Endpoint" desc="留空会使用默认端口：Edge=5050，Melo=5051。" />
                    <div className="grid grid-cols-1 gap-3">
                        <div className="flex gap-2">
                            <input
                                className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2"
                                value={endpointDraft}
                                onChange={(e) => setEndpointDraft(e.target.value)}
                                onBlur={() => void setConfig({ "speech:endpoint": endpointDraft.trim() })}
                                placeholder={
                                    speechLocalEngine === "melo"
                                        ? "http://127.0.0.1:5051/v1/audio/speech"
                                        : "http://127.0.0.1:5050/v1/audio/speech"
                                }
                            />
                            <button
                                className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded cursor-pointer"
                                onClick={() => {
                                    setEndpointDraft("");
                                    void setConfig({ "speech:endpoint": "" });
                                }}
                                title="清空后走默认端口"
                            >
                                默认
                            </button>
                        </div>
                        <div className="text-xs text-muted-foreground">
                            如果你之前在 API 模式里填过云端 Endpoint，这里建议点一次“默认”。
                        </div>
                    </div>
                </div>
            )}

            {showLocalModelSection && (
                <div className="rounded-lg border border-border p-4 mb-4">
                    <FieldLabel title="本地模型（Melo）" desc="用于本地下载的 HF 模型目录与名称。" />
                    <FieldLabel title="本地模型目录" desc="例如 E:\\models\\huggingface" />
                    <div className="flex gap-2 mb-3">
                        <input
                            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2"
                            value={localModelPathDraft}
                            onChange={(e) => setLocalModelPathDraft(e.target.value)}
                            onBlur={() => void setConfig({ "speech:localmodelpath": localModelPathDraft.trim() })}
                        />
                        <button
                            className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded cursor-pointer"
                            onClick={() => {
                                const path = localModelPathDraft.trim();
                                if (path) {
                                    getApi().openNativePath(path);
                                }
                            }}
                        >
                            打开
                        </button>
                        <button
                            className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded cursor-pointer"
                            onClick={() => void scanLocalModels()}
                        >
                            {scanLoading ? "扫描中..." : "扫描模型"}
                        </button>
                    </div>
                    {scanError && <div className="text-xs text-yellow-400 mb-2">{scanError}</div>}

                    <FieldLabel title="本地模型名称" desc="可手填，也可从扫描结果选择。" />
                    <div className="flex gap-2 mb-2">
                        <input
                            className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2"
                            value={localModelDraft}
                            onChange={(e) => setLocalModelDraft(e.target.value)}
                            onBlur={() => {
                                const localModel = localModelDraft.trim();
                                const update: SettingsType = { "speech:localmodel": localModel };
                                if (speechLocalEngine === "melo" && localModel) {
                                    update["speech:model"] = localModel;
                                }
                                void setConfig(update);
                            }}
                            placeholder="例如：MeloTTS-Chinese"
                        />
                        {localModelOptions.length > 0 && (
                            <select
                                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2"
                                value=""
                                onChange={(e) => {
                                    const localModel = e.target.value;
                                    if (!localModel) {
                                        return;
                                    }
                                    setLocalModelDraft(localModel);
                                    const update: SettingsType = { "speech:localmodel": localModel };
                                    if (speechLocalEngine === "melo") {
                                        update["speech:model"] = localModel;
                                    }
                                    void setConfig(update);
                                }}
                            >
                                <option value="">从扫描结果选择</option>
                                {localModelOptions.map((name) => (
                                    <option key={name} value={name}>
                                        {name}
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>
                </div>
            )}

            <div className="rounded-lg border border-border p-4 mb-4">
                <FieldLabel title="角色人物（下拉选择）" desc="人物列表会随模型/引擎变化。" />
                <div className="grid grid-cols-1 gap-3">
                    <div>
                        <FieldLabel title="助手人物（Assistant）" />
                        <select
                            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2"
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
                    </div>
                    <div>
                        <FieldLabel title="用户人物（User）" />
                        <select className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2" value={userVoiceValue} onChange={(e) => void setConfig({ "speech:voiceuser": e.target.value })}>
                            {voiceOptions.map((voice) => (
                                <option key={voice} value={voice}>
                                    {voice}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <FieldLabel title="系统人物（System）" />
                        <select className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2" value={systemVoiceValue} onChange={(e) => void setConfig({ "speech:voicesystem": e.target.value })}>
                            {voiceOptions.map((voice) => (
                                <option key={voice} value={voice}>
                                    {voice}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            <div className="rounded-lg border border-border p-4 mb-4">
                <FieldLabel title="播报过滤" desc="避免把链接、路径、代码原样念出来。" />
                <div className="flex flex-col gap-2">
                    <Toggle checked={speechFilterUrls} onChange={(val) => void setConfig({ "speech:filterurls": val })} label="过滤 URL" />
                    <Toggle checked={speechFilterPaths} onChange={(val) => void setConfig({ "speech:filterpaths": val })} label="过滤文件路径" />
                    <Toggle checked={speechFilterCode} onChange={(val) => void setConfig({ "speech:filtercode": val })} label="过滤代码块" />
                </div>
            </div>
        </div>
    );
});

SpeechSettingsContent.displayName = "SpeechSettingsContent";

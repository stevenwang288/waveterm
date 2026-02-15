// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Toggle } from "@/app/element/toggle";
import { getApi, getSettingsKeyAtom } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useState } from "react";

interface SpeechSettingsContentProps {
    model: WaveConfigViewModel;
}

function FieldLabel({ title, desc }: { title: string; desc?: string }) {
    return (
        <div className="mb-1">
            <div className="text-sm font-medium text-primary">{title}</div>
            {desc && <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>}
        </div>
    );
}

async function setConfig(values: SettingsType): Promise<void> {
    await RpcApi.SetConfigCommand(TabRpcClient, values);
}

export const SpeechSettingsContent = memo(({ model }: SpeechSettingsContentProps) => {
    const speechEnabled = useAtomValue(getSettingsKeyAtom("speech:enabled")) ?? true;
    const speechProvider = useAtomValue(getSettingsKeyAtom("speech:provider")) ?? "local";
    const speechAutoPlay = useAtomValue(getSettingsKeyAtom("speech:autoplay")) ?? false;
    const speechManualButton = useAtomValue(getSettingsKeyAtom("speech:manualbutton")) ?? true;
    const speechLocalEngine = useAtomValue(getSettingsKeyAtom("speech:localengine")) ?? "browser";
    const speechLocalModel = useAtomValue(getSettingsKeyAtom("speech:localmodel")) ?? "";
    const speechLocalModelPath = useAtomValue(getSettingsKeyAtom("speech:localmodelpath")) ?? "E:\\models\\huggingface";
    const speechEndpoint = useAtomValue(getSettingsKeyAtom("speech:endpoint")) ?? "";
    const speechModel = useAtomValue(getSettingsKeyAtom("speech:model")) ?? "gpt-4o-mini-tts";
    const speechVoiceAssistant = useAtomValue(getSettingsKeyAtom("speech:voiceassistant")) ?? "zh-CN-XiaoxiaoNeural";
    const speechVoiceUser = useAtomValue(getSettingsKeyAtom("speech:voiceuser")) ?? speechVoiceAssistant;
    const speechVoiceSystem = useAtomValue(getSettingsKeyAtom("speech:voicesystem")) ?? speechVoiceAssistant;
    const speechFilterUrls = useAtomValue(getSettingsKeyAtom("speech:filterurls")) ?? true;
    const speechFilterPaths = useAtomValue(getSettingsKeyAtom("speech:filterpaths")) ?? true;
    const speechFilterCode = useAtomValue(getSettingsKeyAtom("speech:filtercode")) ?? true;

    const [endpointDraft, setEndpointDraft] = useState(speechEndpoint);
    const [modelDraft, setModelDraft] = useState(speechModel);
    const [localModelDraft, setLocalModelDraft] = useState(speechLocalModel);
    const [localModelPathDraft, setLocalModelPathDraft] = useState(speechLocalModelPath);
    const [assistantVoiceDraft, setAssistantVoiceDraft] = useState(speechVoiceAssistant);
    const [userVoiceDraft, setUserVoiceDraft] = useState(speechVoiceUser);
    const [systemVoiceDraft, setSystemVoiceDraft] = useState(speechVoiceSystem);
    const [scanLoading, setScanLoading] = useState(false);
    const [scanError, setScanError] = useState("");
    const [localModelOptions, setLocalModelOptions] = useState<string[]>([]);

    useEffect(() => setEndpointDraft(speechEndpoint), [speechEndpoint]);
    useEffect(() => setModelDraft(speechModel), [speechModel]);
    useEffect(() => setLocalModelDraft(speechLocalModel), [speechLocalModel]);
    useEffect(() => setLocalModelPathDraft(speechLocalModelPath), [speechLocalModelPath]);
    useEffect(() => setAssistantVoiceDraft(speechVoiceAssistant), [speechVoiceAssistant]);
    useEffect(() => setUserVoiceDraft(speechVoiceUser), [speechVoiceUser]);
    useEffect(() => setSystemVoiceDraft(speechVoiceSystem), [speechVoiceSystem]);

    const localEngineOptions = useMemo(
        () => [
            { label: "浏览器本地语音", value: "browser" },
            { label: "Edge TTS（本地服务）", value: "edge" },
            { label: "MeloTTS（本地模型）", value: "melo" },
        ],
        []
    );

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

    return (
        <div className="h-full overflow-y-auto px-5 py-4">
            <div className="text-lg font-semibold mb-4">语音播报设置</div>

            <div className="rounded-lg border border-border p-4 mb-4">
                <FieldLabel title="总开关" desc="关闭后自动和手动播报都会停用。" />
                <Toggle
                    checked={speechEnabled}
                    onChange={(val) => {
                        void setConfig({ "speech:enabled": val });
                    }}
                />
            </div>

            <div className="rounded-lg border border-border p-4 mb-4">
                <FieldLabel title="播报模式" desc="自动：新回复到达就播报；手动：用面板右上角（齿轮左边）按钮播报当前轮。" />
                <div className="flex flex-col gap-3">
                    <Toggle
                        checked={speechAutoPlay}
                        onChange={(val) => {
                            void setConfig({ "speech:autoplay": val });
                        }}
                        label="自动播报新回复"
                    />
                    <Toggle
                        checked={speechManualButton}
                        onChange={(val) => {
                            void setConfig({ "speech:manualbutton": val });
                        }}
                        label="显示手动播报按钮（齿轮左侧）"
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
                            onChange={() => {
                                void setConfig({ "speech:provider": "local" });
                            }}
                        />
                        <span>本地</span>
                    </label>
                    <label className="flex items-center gap-2">
                        <input
                            type="radio"
                            checked={speechProvider === "api"}
                            onChange={() => {
                                void setConfig({ "speech:provider": "api" });
                            }}
                        />
                        <span>OpenAI 兼容 API</span>
                    </label>
                </div>

                <FieldLabel title="本地引擎" desc="你本地下载的模型在这里配置。" />
                <select
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 mb-3"
                    value={speechLocalEngine}
                    onChange={(e) => {
                        void setConfig({ "speech:localengine": e.target.value });
                    }}
                >
                    {localEngineOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </select>

                <FieldLabel title="本地模型目录" desc="例如 E:\\models\\huggingface" />
                <div className="flex gap-2 mb-3">
                    <input
                        className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2"
                        value={localModelPathDraft}
                        onChange={(e) => setLocalModelPathDraft(e.target.value)}
                        onBlur={() => {
                            void setConfig({ "speech:localmodelpath": localModelPathDraft.trim() });
                        }}
                    />
                    <button
                        className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded cursor-pointer"
                        onClick={() => {
                            const p = localModelPathDraft.trim();
                            if (p) {
                                getApi().openNativePath(p);
                            }
                        }}
                    >
                        打开
                    </button>
                    <button
                        className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded cursor-pointer"
                        onClick={() => {
                            void scanLocalModels();
                        }}
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
                            void setConfig({ "speech:localmodel": localModelDraft.trim() });
                        }}
                        placeholder="例如：melo-zh 或 edge-default"
                    />
                    {localModelOptions.length > 0 && (
                        <select
                            className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2"
                            value=""
                            onChange={(e) => {
                                const val = e.target.value;
                                if (!val) {
                                    return;
                                }
                                setLocalModelDraft(val);
                                void setConfig({ "speech:localmodel": val });
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

            <div className="rounded-lg border border-border p-4 mb-4">
                <FieldLabel title="API 设置" desc="用于 OpenAI 兼容接口或本地 API 服务（Edge/Melo）。" />
                <div className="grid grid-cols-1 gap-3">
                    <div>
                        <FieldLabel title="Endpoint" />
                        <input
                            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2"
                            value={endpointDraft}
                            onChange={(e) => setEndpointDraft(e.target.value)}
                            onBlur={() => {
                                void setConfig({ "speech:endpoint": endpointDraft.trim() });
                            }}
                            placeholder="http://127.0.0.1:5050/v1/audio/speech"
                        />
                    </div>
                    <div>
                        <FieldLabel title="Model" />
                        <input
                            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2"
                            value={modelDraft}
                            onChange={(e) => setModelDraft(e.target.value)}
                            onBlur={() => {
                                void setConfig({ "speech:model": modelDraft.trim() });
                            }}
                            placeholder="gpt-4o-mini-tts"
                        />
                    </div>
                </div>
            </div>

            <div className="rounded-lg border border-border p-4 mb-4">
                <FieldLabel title="角色语音" desc="为不同人物设置单独的声音。" />
                <div className="grid grid-cols-1 gap-3">
                    <div>
                        <FieldLabel title="助手声音（Assistant）" />
                        <input
                            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2"
                            value={assistantVoiceDraft}
                            onChange={(e) => setAssistantVoiceDraft(e.target.value)}
                            onBlur={() => {
                                void setConfig({ "speech:voiceassistant": assistantVoiceDraft.trim() });
                            }}
                            placeholder="zh-CN-XiaoxiaoNeural"
                        />
                    </div>
                    <div>
                        <FieldLabel title="用户声音（User）" />
                        <input
                            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2"
                            value={userVoiceDraft}
                            onChange={(e) => setUserVoiceDraft(e.target.value)}
                            onBlur={() => {
                                void setConfig({ "speech:voiceuser": userVoiceDraft.trim() });
                            }}
                            placeholder="zh-CN-YunxiNeural"
                        />
                    </div>
                    <div>
                        <FieldLabel title="系统声音（System）" />
                        <input
                            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2"
                            value={systemVoiceDraft}
                            onChange={(e) => setSystemVoiceDraft(e.target.value)}
                            onBlur={() => {
                                void setConfig({ "speech:voicesystem": systemVoiceDraft.trim() });
                            }}
                            placeholder="zh-CN-XiaoyiNeural"
                        />
                    </div>
                </div>
            </div>

            <div className="rounded-lg border border-border p-4 mb-4">
                <FieldLabel title="播报过滤" desc="避免把链接、路径、代码原样念出来。" />
                <div className="flex flex-col gap-2">
                    <Toggle
                        checked={speechFilterUrls}
                        onChange={(val) => {
                            void setConfig({ "speech:filterurls": val });
                        }}
                        label="过滤 URL"
                    />
                    <Toggle
                        checked={speechFilterPaths}
                        onChange={(val) => {
                            void setConfig({ "speech:filterpaths": val });
                        }}
                        label="过滤文件路径"
                    />
                    <Toggle
                        checked={speechFilterCode}
                        onChange={(val) => {
                            void setConfig({ "speech:filtercode": val });
                        }}
                        label="过滤代码块"
                    />
                </div>
            </div>
        </div>
    );
});

SpeechSettingsContent.displayName = "SpeechSettingsContent";

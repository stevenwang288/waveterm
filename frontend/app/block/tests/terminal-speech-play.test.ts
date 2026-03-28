import type { ResolvedSpeechSettings } from "@/app/aipanel/speechsettings";
import { speechRuntime } from "@/app/aipanel/speechruntime";
import * as globalModule from "@/app/store/global";
import { globalStore } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as jotai from "jotai";
import {
    getTerminalSpeechAutoPlayBaselineTs,
    getTerminalSpeechCompletionAnchor,
    loadLatestTerminalFormalReplyPayload,
    loadLatestWorkbenchFormalReplyPayload,
    playTerminalFormalReplyPayload,
    shouldAutoPlayTerminalFormalReply,
    speakLatestTerminalFormalReply,
} from "../terminal-speech";

vi.mock("@/app/store/wshrpcutil", () => ({
    TabRpcClient: {},
}));

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        TermGetScrollbackLinesCommand: vi.fn(),
    },
}));

vi.mock("@/app/aipanel/speechruntime", () => ({
    speechRuntime: {
        play: vi.fn(),
        stop: vi.fn(),
    },
}));

const termGetScrollback = vi.mocked(RpcApi.TermGetScrollbackLinesCommand);
const speechPlay = vi.mocked(speechRuntime.play);

class FakeAudioParam {
    setValueAtTime = vi.fn();
    linearRampToValueAtTime = vi.fn();
    exponentialRampToValueAtTime = vi.fn();
}

class FakeGainNode {
    gain = new FakeAudioParam();
    connect = vi.fn();
}

class FakeOscillatorNode {
    type = "sine";
    frequency = new FakeAudioParam();
    onended: (() => void) | null = null;
    connect = vi.fn();
    start = vi.fn();
    stop = vi.fn((when?: number) => {
        this.onended?.();
        return when;
    });
}

class FakeAudioContext {
    static instances: FakeAudioContext[] = [];

    currentTime = 0;
    state: AudioContextState = "running";
    destination = {};
    close = vi.fn().mockResolvedValue(undefined);
    resume = vi.fn().mockResolvedValue(undefined);
    readonly gainNodes: FakeGainNode[] = [];
    readonly oscillators: FakeOscillatorNode[] = [];

    constructor() {
        FakeAudioContext.instances.push(this);
    }

    createGain(): GainNode {
        const gainNode = new FakeGainNode();
        this.gainNodes.push(gainNode);
        return gainNode as unknown as GainNode;
    }

    createOscillator(): OscillatorNode {
        const oscillator = new FakeOscillatorNode();
        this.oscillators.push(oscillator);
        return oscillator as unknown as OscillatorNode;
    }
}

class FakeAudioElement {
    static instances: FakeAudioElement[] = [];

    src: string;
    volume = 1;
    preload = "";
    currentTime = 0;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    play = vi.fn().mockImplementation(() => {
        this.onended?.();
        return Promise.resolve();
    });

    constructor(src: string) {
        this.src = src;
        FakeAudioElement.instances.push(this);
    }
}

function installFakeAudioContext() {
    FakeAudioContext.instances.length = 0;
    (globalThis as any).AudioContext = FakeAudioContext;
    (globalThis as any).webkitAudioContext = FakeAudioContext;
    if (typeof window !== "undefined") {
        (window as any).AudioContext = FakeAudioContext;
        (window as any).webkitAudioContext = FakeAudioContext;
    }
}

function installFakeAudioElement() {
    FakeAudioElement.instances.length = 0;
    (globalThis as any).Audio = FakeAudioElement;
    if (typeof window !== "undefined") {
        (window as any).Audio = FakeAudioElement;
    }
}

function resetFakeAudioContext() {
    FakeAudioContext.instances.length = 0;
    delete (globalThis as any).AudioContext;
    delete (globalThis as any).webkitAudioContext;
    if (typeof window !== "undefined") {
        delete (window as any).AudioContext;
        delete (window as any).webkitAudioContext;
    }
}

function resetFakeAudioElement() {
    FakeAudioElement.instances.length = 0;
    delete (globalThis as any).Audio;
    if (typeof window !== "undefined") {
        delete (window as any).Audio;
    }
}

function makeSettings(): ResolvedSpeechSettings {
    return {
        enabled: true,
        provider: "local",
        localEngine: "edge",
        transport: "api",
        autoPlay: false,
        showManualButton: true,
        rate: 1.25,
        endpoint: "wave://edge-tts/v1/audio/speech",
        model: "edge-tts",
        token: "",
        voice: "zh-CN-XiaoxiaoNeural",
        voiceAssistant: "zh-CN-XiaoxiaoNeural",
        voiceUser: "zh-CN-XiaoxiaoNeural",
        voiceSystem: "zh-CN-XiaoxiaoNeural",
        localModel: "",
        localModelPath: "",
        filterOptions: {
            filterUrls: true,
            filterPaths: true,
            filterCode: true,
        },
    };
}

type FakeBufferLine = {
    translateToString: (trimRight?: boolean) => string;
    isWrapped?: boolean;
};

function makeFakeBuffer(lines: string[]) {
    return {
        length: lines.length,
        getLine: (idx: number): FakeBufferLine | undefined => {
            if (idx < 0 || idx >= lines.length) {
                return undefined;
            }
            return {
                translateToString: () => lines[idx],
                isWrapped: false,
            };
        },
    };
}

function setActiveTerminalFallback(options: {
    blockId: string;
    lines: string[];
    lastUpdated?: number;
    shellState?: "ready" | "running-command" | null;
    promptMarkers?: Array<{ line: number }>;
}) {
    const shellIntegrationStatusAtom = jotai.atom<"ready" | "running-command" | null>(options.shellState ?? null);
    globalStore.set(shellIntegrationStatusAtom, options.shellState ?? null);
    const termWrap = {
        blockId: options.blockId,
        terminal: {
            buffer: {
                active: makeFakeBuffer(options.lines),
            },
        },
        promptMarkers: options.promptMarkers ?? [],
        shellIntegrationStatusAtom,
        lastUpdated: options.lastUpdated ?? 0,
    } as any;
    if (typeof window !== "undefined") {
        (window as any).term = termWrap;
    }
    (globalThis as any).term = termWrap;
    return termWrap;
}

describe("terminal speech command anchors", () => {
    it("prefers command completion timestamp when shell is ready", () => {
        expect(
            getTerminalSpeechCompletionAnchor({
                shellState: "ready",
                lastCommandDoneTs: 420,
                lastOutputTs: 900,
            })
        ).toEqual({
            freshnessTs: 420,
            payloadTs: 420,
            source: "command-done",
        });
    });

    it("falls back to last output timestamp without shell integration", () => {
        expect(
            getTerminalSpeechCompletionAnchor({
                shellState: null,
                lastCommandDoneTs: 0,
                lastOutputTs: 900,
            })
        ).toEqual({
            freshnessTs: 900,
            payloadTs: 900,
            source: "last-output",
        });
    });

    it("does not create a completion anchor while the command is still running", () => {
        expect(
            getTerminalSpeechCompletionAnchor({
                shellState: "running-command",
                lastCommandDoneTs: 420,
                lastOutputTs: 900,
            })
        ).toBeNull();
    });

    it("uses the command completion timestamp as autoplay baseline when available", () => {
        expect(
            getTerminalSpeechAutoPlayBaselineTs(
                {
                    shellState: "ready",
                    lastCommandDoneTs: 420,
                    lastOutputTs: 900,
                },
                1200
            )
        ).toBe(420);
    });

    it("never allows autoplay while the command is still running", () => {
        expect(
            shouldAutoPlayTerminalFormalReply({
                payload: {
                    id: "420:abc:3",
                    text: "完成了",
                    outputTs: 420,
                },
                shellState: "running-command",
                sessionStartTs: 100,
                lastCommandDoneTs: 420,
                baselineTs: 200,
                lastSpokenPayloadId: "",
                pendingPayloadId: "",
                speechActive: false,
            })
        ).toBe(false);
    });

    it("allows workbench autoplay when explicit source mode uses workbench policy", () => {
        expect(
            shouldAutoPlayTerminalFormalReply({
                payload: {
                    id: "320:abc:4",
                    text: "workbench 最终回复",
                    outputTs: 320,
                },
                shellState: null,
                sessionStartTs: 200,
                lastCommandDoneTs: 150,
                baselineTs: 250,
                lastSpokenPayloadId: "",
                pendingPayloadId: "",
                speechActive: false,
                sourceMode: "workbench",
            })
        ).toBe(true);
    });

    it("keeps terminal autoplay gated on command-done after session start in terminal source mode", () => {
        expect(
            shouldAutoPlayTerminalFormalReply({
                payload: {
                    id: "320:def:4",
                    text: "terminal 最终回复",
                    outputTs: 320,
                },
                shellState: "ready",
                sessionStartTs: 200,
                lastCommandDoneTs: 150,
                baselineTs: 250,
                lastSpokenPayloadId: "",
                pendingPayloadId: "",
                speechActive: false,
                sourceMode: "terminal",
            })
        ).toBe(false);
    });

    it("allows terminal autoplay when fresh output arrived this session even without shell integration", () => {
        expect(
            shouldAutoPlayTerminalFormalReply({
                payload: {
                    id: "320:ghi:4",
                    text: "终端正式回复",
                    outputTs: 320,
                },
                shellState: null,
                sessionStartTs: 200,
                lastCommandDoneTs: 0,
                lastOutputTs: 320,
                baselineTs: 250,
                lastSpokenPayloadId: "",
                pendingPayloadId: "",
                speechActive: false,
                sourceMode: "terminal",
            })
        ).toBe(true);
    });
});

describe("speakLatestTerminalFormalReply", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        resetFakeAudioContext();
        resetFakeAudioElement();
        if (typeof window !== "undefined") {
            delete (window as any).term;
        }
        delete (globalThis as any).term;
    });

    it("reads only the latest formal assistant reply", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: [
                "› test question",
                "• final formal reply",
                "",
                "› Run /review on my current changes",
                "? for shortcuts",
                "67% context left",
            ],
            lastupdated: 200,
        } as CommandTermGetScrollbackLinesRtnData);
        speechPlay.mockResolvedValueOnce(true);

        const settings = makeSettings();
        const ok = await speakLatestTerminalFormalReply({
            blockId: "test-block-1",
            speechSettings: settings,
        });

        expect(ok).toBe(true);
        expect(speechPlay).toHaveBeenCalledTimes(1);
        expect(speechPlay).toHaveBeenCalledWith(
            "final formal reply",
            settings,
            "assistant",
            expect.any(Function),
            expect.objectContaining({ ownerId: undefined })
        );
    });

    it("keeps emoji in the UI text but strips them from spoken formal replies", async () => {
        speechPlay.mockResolvedValueOnce(true);

        const settings = makeSettings();
        const ok = await playTerminalFormalReplyPayload({
            payload: {
                id: "payload-emoji",
                text: "你好啊！😊 有什么我可以帮你的吗？",
                outputTs: 123,
            },
            speechSettings: settings,
        });

        expect(ok).toBe(true);
        expect(speechPlay).toHaveBeenCalledTimes(1);
        expect(speechPlay).toHaveBeenCalledWith(
            "你好啊！有什么我可以帮你的吗？",
            settings,
            "assistant",
            expect.any(Function),
            expect.objectContaining({ ownerId: undefined })
        );
    });

    it("does not play the cue for manual terminal formal-reply playback", async () => {
        installFakeAudioContext();
        speechPlay.mockResolvedValueOnce(true);

        const settings = makeSettings();
        const ok = await playTerminalFormalReplyPayload({
            payload: {
                id: "payload-manual",
                text: "这是手动点击后的正式回复",
                outputTs: 140,
            },
            speechSettings: settings,
        });

        expect(ok).toBe(true);
        expect(FakeAudioContext.instances).toHaveLength(0);
        expect(speechPlay).toHaveBeenCalledTimes(1);
        expect(speechPlay).toHaveBeenCalledWith(
            "这是手动点击后的正式回复",
            settings,
            "assistant",
            expect.any(Function),
            expect.objectContaining({ ownerId: undefined })
        );
    });

    it("prefers an inline audio cue before shared autoplay speech when Audio is available", async () => {
        installFakeAudioElement();
        installFakeAudioContext();
        speechPlay.mockResolvedValueOnce(true);

        const payload = {
            id: "payload-autoplay",
            text: "这是自动播报的正式回复",
            outputTs: 520,
        };
        expect(
            shouldAutoPlayTerminalFormalReply({
                payload,
                shellState: "ready",
                sessionStartTs: 100,
                lastCommandDoneTs: 520,
                baselineTs: 300,
                lastSpokenPayloadId: "",
                pendingPayloadId: "",
                speechActive: false,
            })
        ).toBe(true);

        const settings = makeSettings();
        const ok = await playTerminalFormalReplyPayload({
            payload,
            speechSettings: settings,
        });

        expect(ok).toBe(true);
        expect(FakeAudioElement.instances).toHaveLength(1);
        expect(FakeAudioElement.instances[0].src.startsWith("data:audio/wav;base64,")).toBe(true);
        expect(FakeAudioElement.instances[0].volume).toBeGreaterThan(0);
        expect(FakeAudioElement.instances[0].volume).toBeLessThanOrEqual(1);
        expect(FakeAudioElement.instances[0].preload).toBe("auto");
        expect(FakeAudioElement.instances[0].play).toHaveBeenCalledTimes(1);
        expect(FakeAudioContext.instances).toHaveLength(0);
        expect(speechPlay).toHaveBeenCalledTimes(1);
        expect(speechPlay).toHaveBeenCalledWith(
            "这是自动播报的正式回复",
            settings,
            "assistant",
            expect.any(Function),
            expect.objectContaining({ ownerId: undefined })
        );
    });

    it("falls back to AudioContext cue before shared autoplay speech when Audio is unavailable", async () => {
        installFakeAudioContext();
        speechPlay.mockResolvedValueOnce(true);

        const payload = {
            id: "payload-autoplay-fallback",
            text: "这是自动播报的正式回复",
            outputTs: 520,
        };
        expect(
            shouldAutoPlayTerminalFormalReply({
                payload,
                shellState: "ready",
                sessionStartTs: 100,
                lastCommandDoneTs: 520,
                baselineTs: 300,
                lastSpokenPayloadId: "",
                pendingPayloadId: "",
                speechActive: false,
            })
        ).toBe(true);

        const settings = makeSettings();
        const ok = await playTerminalFormalReplyPayload({
            payload,
            speechSettings: settings,
        });

        expect(ok).toBe(true);
        expect(FakeAudioContext.instances).toHaveLength(1);
        expect(FakeAudioContext.instances[0].oscillators).toHaveLength(1);
        expect(FakeAudioContext.instances[0].oscillators[0].start).toHaveBeenCalledWith(0);
        expect(FakeAudioContext.instances[0].oscillators[0].stop).toHaveBeenCalledWith(0.18);
        expect(FakeAudioContext.instances[0].close).toHaveBeenCalledTimes(1);
        expect(speechPlay).toHaveBeenCalledTimes(1);
        expect(speechPlay).toHaveBeenCalledWith(
            "这是自动播报的正式回复",
            settings,
            "assistant",
            expect.any(Function),
            expect.objectContaining({ ownerId: undefined })
        );
    });

    it("sanitizes terminal formal replies before speaking them", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: [
                "› q1",
                "• **最终回复** [Image #1] `E:/code/waveterm-main/frontend/app/block/terminal-speech.ts` README.md $env:TEMP %APPDATA% A1b2C3d4E5f6G7h8J9k0L1m2N3p4Q5r6 task_status_tracker::resume_last_session Ctrl+K F7 F8 星号 asterisk 已完成终端正式回复播报修正",
                "› ",
            ],
            lastupdated: 208,
        } as CommandTermGetScrollbackLinesRtnData);
        speechPlay.mockResolvedValueOnce(true);

        const settings = makeSettings();
        const ok = await speakLatestTerminalFormalReply({
            blockId: "test-block-sanitized-speak",
            speechSettings: settings,
        });

        expect(ok).toBe(true);
        expect(speechPlay).toHaveBeenCalledTimes(1);
        expect(speechPlay).toHaveBeenCalledWith(
            "已完成终端正式回复播报修正",
            settings,
            "assistant",
            expect.any(Function),
            expect.objectContaining({ ownerId: undefined })
        );
    });

    it("keeps Chinese terminal formal replies after sanitization", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: ["› 你好", "• 最终回复：这次只修终端正式回复播报，不影响普通中文朗读", "› "],
            lastupdated: 209,
        } as CommandTermGetScrollbackLinesRtnData);
        speechPlay.mockResolvedValueOnce(true);

        const settings = makeSettings();
        const ok = await speakLatestTerminalFormalReply({
            blockId: "test-block-sanitized-chinese",
            speechSettings: settings,
        });

        expect(ok).toBe(true);
        expect(speechPlay).toHaveBeenCalledTimes(1);
        expect(speechPlay).toHaveBeenCalledWith(
            "这次只修终端正式回复播报，不影响普通中文朗读",
            settings,
            "assistant",
            expect.any(Function),
            expect.objectContaining({ ownerId: undefined })
        );
    });

    it("prefers codex final summary over worked separator and footer noise", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: [
                "› why is this binary big?",
                "• I’m going to scan Cargo manifests first.",
                "─ Worked for 0s ─────────────────────────────────────────────",
                "• 结论：已定位主要体积来源，并给出可执行优化方向。",
                "  ? for shortcuts                                              100% context left",
                "› ",
            ],
            lastupdated: 206,
        } as CommandTermGetScrollbackLinesRtnData);
        speechPlay.mockResolvedValueOnce(true);

        const settings = makeSettings();
        const ok = await speakLatestTerminalFormalReply({
            blockId: "test-block-final-summary",
            speechSettings: settings,
        });

        expect(ok).toBe(true);
        expect(speechPlay).toHaveBeenCalledTimes(1);
        expect(speechPlay).toHaveBeenCalledWith(
            "结论：已定位主要体积来源，并给出可执行优化方向。",
            settings,
            "assistant",
            expect.any(Function),
            expect.objectContaining({ ownerId: undefined })
        );
    });

    it("does not speak codex commentary-like line even with trailing prompt", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: ["› q1", "• I’m going to inspect the files and summarize next.", "› "],
            lastupdated: 207,
        } as CommandTermGetScrollbackLinesRtnData);
        termGetScrollback.mockResolvedValueOnce({
            lines: ["› q1", "• I’m going to inspect the files and summarize next.", "› "],
            lastupdated: 207,
        } as CommandTermGetScrollbackLinesRtnData);

        const onError = vi.fn();
        const ok = await speakLatestTerminalFormalReply({
            blockId: "test-block-commentary-only",
            speechSettings: makeSettings(),
            onError,
        });

        expect(ok).toBe(false);
        expect(speechPlay).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith("没有检测到可播报的 AI 正式回复。");
    });

    it("ignores Codex footer / Ctrl+C hint lines (never speak them)", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: [
                ">_ OpenAI Codex",
                "Ctrl+C reserved for copy. Press consecutively: 3x interrupt, 4x exit.",
                "Ctrl+C 预留给复制。连续按：第 3 次中断，第 4 次退出。",
                "  ctrl + c again to quit",
                "  esc again to edit previous message",
            ],
            lastupdated: 205,
        } as CommandTermGetScrollbackLinesRtnData);

        const onError = vi.fn();
        const ok = await speakLatestTerminalFormalReply({
            blockId: "test-block-hints",
            speechSettings: makeSettings(),
            onError,
        });

        expect(ok).toBe(false);
        expect(speechPlay).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith("没有检测到可播报的 AI 正式回复。");
    });

    it("never speaks Codex working/progress status lines", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: ["› 你好", "• Working (20s  esc 中断)"],
            lastupdated: 215,
        } as CommandTermGetScrollbackLinesRtnData);
        termGetScrollback.mockResolvedValueOnce({
            lines: ["› 你好", "• Working (20s  esc 中断)"],
            lastupdated: 215,
        } as CommandTermGetScrollbackLinesRtnData);

        const onError = vi.fn();
        const ok = await speakLatestTerminalFormalReply({
            blockId: "test-block-working",
            speechSettings: makeSettings(),
            requirePromptAfterCodexReply: true,
            onError,
        });

        expect(ok).toBe(false);
        expect(speechPlay).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith("没有检测到可播报的 AI 正式回复。");
    });

    it("never speaks Codex working status lines with spinner prefixes", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: ["› 你好", "• ⠋ Working (20s  esc 中断)", "› "],
            lastupdated: 215,
        } as CommandTermGetScrollbackLinesRtnData);
        termGetScrollback.mockResolvedValueOnce({
            lines: ["› 你好", "• ⠋ Working (20s  esc 中断)", "› "],
            lastupdated: 215,
        } as CommandTermGetScrollbackLinesRtnData);

        const onError = vi.fn();
        const ok = await speakLatestTerminalFormalReply({
            blockId: "test-block-working-spinner",
            speechSettings: makeSettings(),
            requirePromptAfterCodexReply: true,
            onError,
        });

        expect(ok).toBe(false);
        expect(speechPlay).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith("没有检测到可播报的 AI 正式回复。");
    });

    it("never speaks Codex MCP server startup status lines", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: ["Starting MCP servers (1/3): mcp-deepwiki, sequential-thinking"],
            lastupdated: 225,
        } as CommandTermGetScrollbackLinesRtnData);

        const onError = vi.fn();
        const ok = await speakLatestTerminalFormalReply({
            blockId: "test-block-mcp-startup",
            speechSettings: makeSettings(),
            onError,
        });

        expect(ok).toBe(false);
        expect(speechPlay).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith("没有检测到可播报的 AI 正式回复。");
    });

    it("never speaks Codex MCP server startup status lines in Chinese", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: ["• 正在启动 MCP 服务器（1/4）：mcp-deepwiki，openaiDeveloperDocs，sequential-thinking"],
            lastupdated: 226,
        } as CommandTermGetScrollbackLinesRtnData);

        const onError = vi.fn();
        const ok = await speakLatestTerminalFormalReply({
            blockId: "test-block-mcp-startup-zh",
            speechSettings: makeSettings(),
            onError,
        });

        expect(ok).toBe(false);
        expect(speechPlay).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith("没有检测到可播报的 AI 正式回复。");
    });

    it("does not include Codex Ctrl+C/ESC hints in the spoken assistant reply segment", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: [
                "› q1",
                "• 这是最终正式回复",
                "Ctrl+C reserved for copy. Press consecutively: 3x interrupt, 4x exit.",
                "  esc again to edit previous message",
                "› ",
            ],
            lastupdated: 210,
        } as CommandTermGetScrollbackLinesRtnData);
        speechPlay.mockResolvedValueOnce(true);

        const settings = makeSettings();
        const ok = await speakLatestTerminalFormalReply({
            blockId: "test-block-hints-segment",
            speechSettings: settings,
        });

        expect(ok).toBe(true);
        expect(speechPlay).toHaveBeenCalledTimes(1);
        expect(speechPlay).toHaveBeenCalledWith(
            "这是最终正式回复",
            settings,
            "assistant",
            expect.any(Function),
            expect.objectContaining({ ownerId: undefined })
        );
    });

    it("does not include Codex interruption / feedback hint lines in the spoken assistant reply segment", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: [
                "› q1",
                "• 最终回复",
                "Conversation interrupted - tell the model what to do differently.",
                "Something went wrong? Hit `/feedback` to report the issue.",
                "› ",
            ],
            lastupdated: 211,
        } as CommandTermGetScrollbackLinesRtnData);
        speechPlay.mockResolvedValueOnce(true);

        const settings = makeSettings();
        const ok = await speakLatestTerminalFormalReply({
            blockId: "test-block-interrupted",
            speechSettings: settings,
            requirePromptAfterCodexReply: true,
        });

        expect(ok).toBe(true);
        expect(speechPlay).toHaveBeenCalledTimes(1);
        expect(speechPlay).toHaveBeenCalledWith(
            "最终回复",
            settings,
            "assistant",
            expect.any(Function),
            expect.objectContaining({ ownerId: undefined })
        );
    });

    it("does not include codex inference/streams footer telemetry in spoken text", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: [
                "› q1",
                "• 这是最终正式回复",
                "─ Inference: 1 call (4.5s) • Streams: 191 events (8.2s) ─",
                "› ",
            ],
            lastupdated: 212,
        } as CommandTermGetScrollbackLinesRtnData);
        speechPlay.mockResolvedValueOnce(true);

        const settings = makeSettings();
        const ok = await speakLatestTerminalFormalReply({
            blockId: "test-block-inference-footer",
            speechSettings: settings,
        });

        expect(ok).toBe(true);
        expect(speechPlay).toHaveBeenCalledTimes(1);
        expect(speechPlay).toHaveBeenCalledWith(
            "这是最终正式回复",
            settings,
            "assistant",
            expect.any(Function),
            expect.objectContaining({ ownerId: undefined })
        );
    });

    it("does not include codex bottom status row in spoken text", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: ["› q1", "• 这是最终正式回复", "gpt-5.2 high • 95% left • ~", "› "],
            lastupdated: 213,
        } as CommandTermGetScrollbackLinesRtnData);
        speechPlay.mockResolvedValueOnce(true);

        const settings = makeSettings();
        const ok = await speakLatestTerminalFormalReply({
            blockId: "test-block-status-row",
            speechSettings: settings,
        });

        expect(ok).toBe(true);
        expect(speechPlay).toHaveBeenCalledTimes(1);
        expect(speechPlay).toHaveBeenCalledWith(
            "这是最终正式回复",
            settings,
            "assistant",
            expect.any(Function),
            expect.objectContaining({ ownerId: undefined })
        );
    });

    it("does not speak codex in-progress bullet without trailing prompt boundary when required", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: ["› 你好", "• 还在生成中的回复片段"],
            lastupdated: 220,
        } as CommandTermGetScrollbackLinesRtnData);
        termGetScrollback.mockResolvedValueOnce({
            lines: ["› 你好", "• 还在生成中的回复片段"],
            lastupdated: 220,
        } as CommandTermGetScrollbackLinesRtnData);

        const onError = vi.fn();
        const ok = await speakLatestTerminalFormalReply({
            blockId: "test-block-boundary",
            speechSettings: makeSettings(),
            requirePromptAfterCodexReply: true,
            onError,
        });
        expect(ok).toBe(false);
        expect(speechPlay).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith("没有检测到可播报的 AI 正式回复。");
    });

    it("can relax strict prompt-boundary requirement for manual fallback", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: ["› 你好", "• 最终正式回复（尚未出现下一条提示符）"],
            lastupdated: 220,
        } as CommandTermGetScrollbackLinesRtnData);
        termGetScrollback.mockResolvedValueOnce({
            lines: ["› 你好", "• 最终正式回复（尚未出现下一条提示符）"],
            lastupdated: 220,
        } as CommandTermGetScrollbackLinesRtnData);
        speechPlay.mockResolvedValueOnce(true);

        const ok = await speakLatestTerminalFormalReply({
            blockId: "test-block-relax",
            speechSettings: makeSettings(),
            preferLastCommand: false,
            requirePromptAfterCodexReply: true,
            allowRelaxedFallback: true,
        });
        expect(ok).toBe(true);
        expect(termGetScrollback).toHaveBeenCalledTimes(2);
        expect(speechPlay).toHaveBeenCalledTimes(1);
        expect(speechPlay).toHaveBeenCalledWith(
            "最终正式回复（尚未出现下一条提示符）",
            expect.any(Object),
            "assistant",
            expect.any(Function),
            expect.objectContaining({ ownerId: undefined })
        );
    });

    it("falls back to non-lastcommand scrollback when shell integration request fails", async () => {
        termGetScrollback.mockRejectedValueOnce(new Error("shell integration not enabled"));
        termGetScrollback.mockResolvedValueOnce({
            lines: ["› q2", "• fallback formal reply"],
            lastupdated: 200,
        } as CommandTermGetScrollbackLinesRtnData);
        speechPlay.mockResolvedValueOnce(true);
        const onError = vi.fn();

        const ok = await speakLatestTerminalFormalReply({
            blockId: "test-block-2",
            speechSettings: makeSettings(),
            onError,
        });

        expect(ok).toBe(true);
        expect(termGetScrollback).toHaveBeenCalledTimes(2);
        expect(speechPlay).toHaveBeenCalledWith(
            "fallback formal reply",
            expect.any(Object),
            "assistant",
            expect.any(Function),
            expect.objectContaining({ ownerId: undefined })
        );
        expect(onError).not.toHaveBeenCalled();
    });

    it("falls back to full scrollback when lastcommand returns non-reply lines", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: ["PS D:\\repo>", "random log line"],
            lastupdated: 200,
        } as CommandTermGetScrollbackLinesRtnData);
        termGetScrollback.mockResolvedValueOnce({
            lines: ["› q2", "• fallback from full scrollback"],
            lastupdated: 210,
        } as CommandTermGetScrollbackLinesRtnData);
        speechPlay.mockResolvedValueOnce(true);

        const ok = await speakLatestTerminalFormalReply({
            blockId: "test-block-3",
            speechSettings: makeSettings(),
        });

        expect(ok).toBe(true);
        expect(termGetScrollback).toHaveBeenCalledTimes(2);
        expect(speechPlay).toHaveBeenCalledWith(
            "fallback from full scrollback",
            expect.any(Object),
            "assistant",
            expect.any(Function),
            expect.objectContaining({ ownerId: undefined })
        );
    });

    it("does not replay stale replies when latest extraction is empty", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: ["› q1", "• cached formal reply"],
            lastupdated: 200,
        } as CommandTermGetScrollbackLinesRtnData);
        speechPlay.mockResolvedValueOnce(true);

        const first = await speakLatestTerminalFormalReply({
            blockId: "test-block-4",
            speechSettings: makeSettings(),
        });
        expect(first).toBe(true);

        termGetScrollback.mockResolvedValueOnce({
            lines: ["PS D:\\repo>", "random log line"],
            lastupdated: 210,
        } as CommandTermGetScrollbackLinesRtnData);
        termGetScrollback.mockResolvedValueOnce({
            lines: ["PS D:\\repo>", "another log"],
            lastupdated: 220,
        } as CommandTermGetScrollbackLinesRtnData);

        const second = await speakLatestTerminalFormalReply({
            blockId: "test-block-4",
            speechSettings: makeSettings(),
        });
        expect(second).toBe(false);
        expect(speechPlay).toHaveBeenCalledTimes(1);
    });

    it("skips stale scrollback snapshots older than the requested output timestamp", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: ["› q1", "• final formal reply"],
            lastupdated: 100,
        } as CommandTermGetScrollbackLinesRtnData);

        const onError = vi.fn();
        const ok = await speakLatestTerminalFormalReply({
            blockId: "test-block-5",
            speechSettings: makeSettings(),
            minLastUpdatedTs: 150,
            onError,
        });

        expect(ok).toBe(false);
        expect(speechPlay).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith("没有检测到可播报的 AI 正式回复。");
    });

    it("builds terminal formal-reply payload with stable output timestamp", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: ["› 你好", "• 这是最终正式回复", "› "],
            lastupdated: 260,
        } as CommandTermGetScrollbackLinesRtnData);

        const payload = await loadLatestTerminalFormalReplyPayload({
            blockId: "test-block-payload",
            outputTs: 260,
            requirePromptAfterCodexReply: true,
        });

        expect(payload).toEqual({
            id: expect.any(String),
            text: "这是最终正式回复",
            outputTs: 260,
        });
        expect(payload?.id.startsWith("260:")).toBe(true);
    });

    it("builds payload from active terminal buffer when feblock route is missing", async () => {
        termGetScrollback.mockRejectedValueOnce(new Error('no route for "feblock:test-block-route-missing"'));
        setActiveTerminalFallback({
            blockId: "test-block-route-missing",
            lines: ["› smoke question", "• 这是终端最终正式回复", "› "],
            lastUpdated: 400,
            shellState: null,
        });

        const payload = await loadLatestTerminalFormalReplyPayload({
            blockId: "test-block-route-missing",
            outputTs: 400,
            preferLastCommand: false,
            requirePromptAfterCodexReply: true,
        });

        expect(payload).toEqual({
            id: expect.any(String),
            text: "这是终端最终正式回复",
            outputTs: 400,
        });
        expect(payload?.id.startsWith("400:")).toBe(true);
    });

    it("builds payload from active terminal buffer when feblock scrollback collapses alt-screen into one line", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: [
                "│ >_ OpenAI Codex │ • Starting MCP servers (2/7): context7, exa, filesystem, … › 请只回复：验证  tab to queue message",
            ],
            lastupdated: 410,
        } as CommandTermGetScrollbackLinesRtnData);
        setActiveTerminalFallback({
            blockId: "test-block-alt-screen-collapse",
            lines: ["› smoke question", "• 这是终端最终正式回复", "› "],
            lastUpdated: 410,
            shellState: null,
        });

        const payload = await loadLatestTerminalFormalReplyPayload({
            blockId: "test-block-alt-screen-collapse",
            outputTs: 410,
            preferLastCommand: false,
            requirePromptAfterCodexReply: true,
        });

        expect(payload).toEqual({
            id: expect.any(String),
            text: "这是终端最终正式回复",
            outputTs: 410,
        });
        expect(payload?.id.startsWith("410:")).toBe(true);
    });

    it("uses workbench aidata modts as a stable payload timestamp", async () => {
        vi.spyOn(globalModule, "fetchWaveFile").mockResolvedValueOnce({
            data: new TextEncoder().encode(
                JSON.stringify([
                    { role: "user", content: "你好" },
                    { role: "assistant", content: "这是 workbench 最终正式回复" },
                ])
            ),
            fileInfo: {
                zoneid: "test-block-workbench-payload",
                name: "aidata",
                opts: {},
                createdts: 100,
                size: 1,
                modts: 520,
                meta: {},
            } as WaveFile,
        });

        const payload = await loadLatestWorkbenchFormalReplyPayload({
            blockId: "test-block-workbench-payload",
        });

        expect(payload).toEqual({
            id: expect.any(String),
            text: "这是 workbench 最终正式回复",
            outputTs: 520,
        });
        expect(payload?.id.startsWith("520:")).toBe(true);
    });

    it("does not build a workbench autoplay payload when aidata ends with a user turn", async () => {
        vi.spyOn(globalModule, "fetchWaveFile").mockResolvedValueOnce({
            data: new TextEncoder().encode(
                JSON.stringify([
                    { role: "user", content: "旧问题" },
                    { role: "assistant", content: "旧正式回复" },
                    { role: "user", content: "新问题，回复还没完成" },
                ])
            ),
            fileInfo: {
                zoneid: "test-block-workbench-user-tail",
                name: "aidata",
                opts: {},
                createdts: 100,
                size: 1,
                modts: 620,
                meta: {},
            } as WaveFile,
        });

        const payload = await loadLatestWorkbenchFormalReplyPayload({
            blockId: "test-block-workbench-user-tail",
            requireLatestEntryAssistant: true,
        });

        expect(payload).toBeNull();
    });

    it("speaks from active terminal buffer when feblock route is missing", async () => {
        termGetScrollback.mockRejectedValueOnce(new Error('no route for "feblock:test-block-active-fallback"'));
        setActiveTerminalFallback({
            blockId: "test-block-active-fallback",
            lines: ["› smoke question", "• 这是终端最终正式回复", "› "],
            lastUpdated: 410,
            shellState: null,
        });
        speechPlay.mockResolvedValueOnce(true);

        const settings = makeSettings();
        const ok = await speakLatestTerminalFormalReply({
            blockId: "test-block-active-fallback",
            speechSettings: settings,
            preferLastCommand: false,
            requirePromptAfterCodexReply: true,
        });

        expect(ok).toBe(true);
        expect(speechPlay).toHaveBeenCalledWith(
            "这是终端最终正式回复",
            settings,
            "assistant",
            expect.any(Function),
            expect.objectContaining({ ownerId: undefined })
        );
    });

    it("does not build payload for in-progress codex chunks", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: ["› 你好", "• 还在生成中的回复片段"],
            lastupdated: 300,
        } as CommandTermGetScrollbackLinesRtnData);
        termGetScrollback.mockResolvedValueOnce({
            lines: ["› 你好", "• 还在生成中的回复片段"],
            lastupdated: 300,
        } as CommandTermGetScrollbackLinesRtnData);

        const payload = await loadLatestTerminalFormalReplyPayload({
            blockId: "test-block-payload-empty",
            outputTs: 300,
            requirePromptAfterCodexReply: true,
        });

        expect(payload).toBeNull();
    });

    it("treats fully sanitized latest formal reply as no speakable formal reply", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: [
                "› q1",
                "• **最终回复** [Image #1] `E:/code/waveterm-main/frontend/app/block/terminal-speech.ts` README.md $env:TEMP %APPDATA% A1b2C3d4E5f6G7h8J9k0L1m2N3p4Q5r6 task_status_tracker::resume_last_session Ctrl+K F7 F8 星号 asterisk",
                "› ",
            ],
            lastupdated: 301,
        } as CommandTermGetScrollbackLinesRtnData);

        const onError = vi.fn();
        const ok = await speakLatestTerminalFormalReply({
            blockId: "test-block-sanitized-empty-speak",
            speechSettings: makeSettings(),
            onError,
        });

        expect(ok).toBe(false);
        expect(speechPlay).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith("没有检测到可播报的 AI 正式回复。");
    });

    it("treats fully sanitized payload text as no speakable formal reply", async () => {
        const onError = vi.fn();

        const ok = await playTerminalFormalReplyPayload({
            payload: {
                id: "999:noise:0",
                text: "**最终回复** [Image #1] README.md $env:TEMP %APPDATA% A1b2C3d4E5f6G7h8J9k0L1m2N3p4Q5r6 task_status_tracker::resume_last_session Ctrl+K F7 F8 星号 asterisk",
                outputTs: 999,
            },
            speechSettings: makeSettings(),
            onError,
        });

        expect(ok).toBe(false);
        expect(speechPlay).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith("没有检测到可播报的 AI 正式回复。");
    });

    it("does not build payload for codex commentary-like line even with trailing prompt", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: ["› q1", "• I’m going to inspect the files and summarize next.", "› "],
            lastupdated: 310,
        } as CommandTermGetScrollbackLinesRtnData);
        termGetScrollback.mockResolvedValueOnce({
            lines: ["› q1", "• I’m going to inspect the files and summarize next.", "› "],
            lastupdated: 310,
        } as CommandTermGetScrollbackLinesRtnData);

        const payload = await loadLatestTerminalFormalReplyPayload({
            blockId: "test-block-payload-commentary-empty",
            outputTs: 310,
            requirePromptAfterCodexReply: true,
        });

        expect(payload).toBeNull();
    });

    it("does not build payload for plain replies without trailing prompt when strict", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: ["› q1", "这是一个没有提示符结尾的纯文本回复。"],
            lastupdated: 320,
        } as CommandTermGetScrollbackLinesRtnData);

        const payload = await loadLatestTerminalFormalReplyPayload({
            blockId: "test-block-payload-plain-strict-empty",
            outputTs: 320,
            preferLastCommand: false,
            requirePromptAfterCodexReply: true,
        });

        expect(payload).toBeNull();
    });

    it("builds payload for plain replies with trailing prompt when strict", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: ["› q1", "这是一个纯文本最终回复。", "› "],
            lastupdated: 340,
        } as CommandTermGetScrollbackLinesRtnData);

        const payload = await loadLatestTerminalFormalReplyPayload({
            blockId: "test-block-payload-plain-strict",
            outputTs: 340,
            preferLastCommand: false,
            requirePromptAfterCodexReply: true,
        });

        expect(payload).toEqual({
            id: expect.any(String),
            text: "这是一个纯文本最终回复。",
            outputTs: 340,
        });
        expect(payload?.id.startsWith("340:")).toBe(true);
    });

    it("builds a fresh payload id when the same final reply text belongs to a newer completion", async () => {
        termGetScrollback.mockResolvedValueOnce({
            lines: ["› 你好", "• 同一条最终回复", "› "],
            lastupdated: 360,
        } as CommandTermGetScrollbackLinesRtnData);
        const firstPayload = await loadLatestTerminalFormalReplyPayload({
            blockId: "test-block-payload-repeat-1",
            outputTs: 360,
            requirePromptAfterCodexReply: true,
        });

        termGetScrollback.mockResolvedValueOnce({
            lines: ["› 你好", "• 同一条最终回复", "› "],
            lastupdated: 460,
        } as CommandTermGetScrollbackLinesRtnData);
        const secondPayload = await loadLatestTerminalFormalReplyPayload({
            blockId: "test-block-payload-repeat-2",
            outputTs: 460,
            requirePromptAfterCodexReply: true,
        });

        expect(firstPayload?.text).toBe("同一条最终回复");
        expect(secondPayload?.text).toBe("同一条最终回复");
        expect(firstPayload?.id).not.toBe(secondPayload?.id);
        expect(secondPayload?.id.startsWith("460:")).toBe(true);
    });
});

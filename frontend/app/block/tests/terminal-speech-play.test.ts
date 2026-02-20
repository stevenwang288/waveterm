import type { ResolvedSpeechSettings } from "@/app/aipanel/speechsettings";
import { speechRuntime } from "@/app/aipanel/speechruntime";
import { RpcApi } from "@/app/store/wshclientapi";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadLatestTerminalFormalReplyPayload, speakLatestTerminalFormalReply } from "../terminal-speech";

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

function makeSettings(): ResolvedSpeechSettings {
    return {
        enabled: true,
        provider: "local",
        localEngine: "edge",
        transport: "api",
        autoPlay: false,
        showManualButton: true,
        rate: 1.25,
        endpoint: "http://127.0.0.1:5050/v1/audio/speech",
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

describe("speakLatestTerminalFormalReply", () => {
    beforeEach(() => {
        vi.resetAllMocks();
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
});

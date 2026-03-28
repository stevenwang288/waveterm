import { resolveAssistantAutoPlayTarget } from "@/app/aipanel/aipanel-autoplay";
import { resolveSpeechSettings } from "@/app/aipanel/speechsettings";
import type { WaveUIMessage } from "@/app/aipanel/aitypes";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/aipanel/aispeech", () => {
    return {
        resolveOpenAICompatibleSpeechEndpoint: vi.fn((endpoint: string) => endpoint),
    };
});

function assistantMessage(id: string, parts: any[]): WaveUIMessage {
    return {
        id,
        role: "assistant",
        parts,
    } as WaveUIMessage;
}

describe("resolveSpeechSettings", () => {
    it("treats missing speech:autoplay as enabled by default", () => {
        const settings = resolveSpeechSettings({}, null);

        expect(settings.autoPlay).toBe(true);
        expect(settings.model).toBe("edge-tts");
        expect(settings.endpoint).toBe("wave://edge-tts/v1/audio/speech");
    });
});

describe("resolveAssistantAutoPlayTarget", () => {
    it("does not auto-play the historical assistant message restored at startup", () => {
        const restoredMessage = assistantMessage("assistant-1", [{ type: "text", text: "历史回复" }]);

        const target = resolveAssistantAutoPlayTarget({
            initialLoadDone: true,
            status: "ready",
            prevStatus: "submitted",
            isAIStreaming: false,
            latestAssistantMessage: restoredMessage,
            latestAssistantMessageText: "历史回复",
            lastAutoPlayedMessageId: "assistant-1",
        });

        expect(target).toBeNull();
    });

    it("returns the new completed assistant reply once", () => {
        const completedMessage = assistantMessage("assistant-2", [{ type: "text", text: "自动播报验收通过" }]);

        const target = resolveAssistantAutoPlayTarget({
            initialLoadDone: true,
            status: "ready",
            prevStatus: "submitted",
            isAIStreaming: false,
            latestAssistantMessage: completedMessage,
            latestAssistantMessageText: "自动播报验收通过",
            lastAutoPlayedMessageId: null,
        });

        expect(target).toEqual({
            messageId: "assistant-2",
            text: "自动播报验收通过",
        });
    });

    it("falls back to the latest assistant message text when the mirrored text cache is temporarily empty", () => {
        const completedMessage = assistantMessage("assistant-2-cache-miss", [
            { type: "text", text: "手工发送也应该自动播报" },
        ]);

        const target = resolveAssistantAutoPlayTarget({
            initialLoadDone: true,
            status: "ready",
            prevStatus: "streaming",
            isAIStreaming: false,
            latestAssistantMessage: completedMessage,
            latestAssistantMessageText: "",
            lastAutoPlayedMessageId: null,
        });

        expect(target).toEqual({
            messageId: "assistant-2-cache-miss",
            text: "手工发送也应该自动播报",
        });
    });

    it("strips <current_tab_state> structured tail before auto-play", () => {
        const completedMessage = assistantMessage("assistant-2b", [
            {
                type: "text",
                text: '自动播报验收通过<current_tab_state>\nOpen Widgets:\n* unknown widget with type "workbench"',
            },
        ]);

        const target = resolveAssistantAutoPlayTarget({
            initialLoadDone: true,
            status: "ready",
            prevStatus: "submitted",
            isAIStreaming: false,
            latestAssistantMessage: completedMessage,
            latestAssistantMessageText:
                '自动播报验收通过<current_tab_state>\nOpen Widgets:\n* unknown widget with type "workbench"',
            lastAutoPlayedMessageId: null,
        });

        expect(target).toEqual({
            messageId: "assistant-2b",
            text: "自动播报验收通过",
        });
    });

    it("does not auto-play when the latest assistant reply was already played", () => {
        const completedMessage = assistantMessage("assistant-3", [{ type: "text", text: "重复回复" }]);

        const target = resolveAssistantAutoPlayTarget({
            initialLoadDone: true,
            status: "ready",
            prevStatus: "submitted",
            isAIStreaming: false,
            latestAssistantMessage: completedMessage,
            latestAssistantMessageText: "重复回复",
            lastAutoPlayedMessageId: "assistant-3",
        });

        expect(target).toBeNull();
    });

    it("does not auto-play tool progress, empty text, or incomplete assistant messages", () => {
        const toolProgressOnly = assistantMessage("assistant-4", [
            {
                type: "data-toolprogress",
                data: {
                    toolcallid: "tool-1",
                    toolname: "shell",
                    statuslines: ["running"],
                },
            },
        ]);
        const emptyText = assistantMessage("assistant-5", [{ type: "text", text: "   " }]);
        const incomplete = assistantMessage("assistant-6", []);

        expect(
            resolveAssistantAutoPlayTarget({
                initialLoadDone: true,
                status: "ready",
                prevStatus: "submitted",
                isAIStreaming: false,
                latestAssistantMessage: toolProgressOnly,
                latestAssistantMessageText: "",
                lastAutoPlayedMessageId: null,
            })
        ).toBeNull();

        expect(
            resolveAssistantAutoPlayTarget({
                initialLoadDone: true,
                status: "ready",
                prevStatus: "submitted",
                isAIStreaming: false,
                latestAssistantMessage: emptyText,
                latestAssistantMessageText: "",
                lastAutoPlayedMessageId: null,
            })
        ).toBeNull();

        expect(
            resolveAssistantAutoPlayTarget({
                initialLoadDone: true,
                status: "ready",
                prevStatus: "submitted",
                isAIStreaming: false,
                latestAssistantMessage: incomplete,
                latestAssistantMessageText: "",
                lastAutoPlayedMessageId: null,
            })
        ).toBeNull();
    });

    it("does not auto-play while still streaming or without a fresh ready transition", () => {
        const completedMessage = assistantMessage("assistant-7", [{ type: "text", text: "还没结束" }]);

        expect(
            resolveAssistantAutoPlayTarget({
                initialLoadDone: true,
                status: "ready",
                prevStatus: "ready",
                isAIStreaming: false,
                latestAssistantMessage: completedMessage,
                latestAssistantMessageText: "还没结束",
                lastAutoPlayedMessageId: null,
            })
        ).toBeNull();

        expect(
            resolveAssistantAutoPlayTarget({
                initialLoadDone: true,
                status: "ready",
                prevStatus: "submitted",
                isAIStreaming: true,
                latestAssistantMessage: completedMessage,
                latestAssistantMessageText: "还没结束",
                lastAutoPlayedMessageId: null,
            })
        ).toBeNull();
    });
});

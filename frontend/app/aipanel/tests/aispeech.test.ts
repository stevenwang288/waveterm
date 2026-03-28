import { afterEach, describe, expect, it, vi } from "vitest";
import {
    chunkSpeechInput,
    MainProcessSpeechRequestTimeoutMs,
    requestOpenAICompatibleSpeechAudio,
} from "../aispeech";

describe("内置语音主进程请求", () => {
    const originalWindow = globalThis.window as any;

    afterEach(() => {
        vi.useRealTimers();
        if (originalWindow == null) {
            delete (globalThis as any).window;
            return;
        }
        (globalThis as any).window = originalWindow;
    });

    it("主进程无响应时不会无限挂起", async () => {
        vi.useFakeTimers();
        (globalThis as any).window = {
            api: {
                speechRequest: vi.fn(() => new Promise(() => {})),
            },
        };

        const promise = requestOpenAICompatibleSpeechAudio("你好", {
            endpoint: "wave://edge-tts/v1/audio/speech",
            model: "edge-tts",
            voice: "zh-CN-XiaoxiaoNeural",
        });
        const expectation = expect(promise).rejects.toThrow("语音主进程无响应");

        await vi.advanceTimersByTimeAsync(MainProcessSpeechRequestTimeoutMs);
        await expectation;
    });

    it("splits long speech text into smaller chunks so the first Edge TTS request starts sooner", () => {
        const longText = Array.from({ length: 900 }, (_, idx) => `chunk${idx}`).join(" ");

        const chunks = chunkSpeechInput(longText, {
            filterUrls: false,
            filterPaths: false,
            filterCode: false,
        });

        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks[0]?.length ?? 0).toBeLessThanOrEqual(1600);
    });
});

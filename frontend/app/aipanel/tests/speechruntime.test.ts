import type { ResolvedSpeechSettings } from "@/app/aipanel/speechsettings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/aipanel/aispeech", () => {
    return {
        canUseLocalSpeechSynthesis: vi.fn(() => false),
        requestOpenAICompatibleSpeechAudio: vi.fn(async () => new Blob(["mock-audio"], { type: "audio/mpeg" })),
        speakLocally: vi.fn(() => false),
        stopLocalSpeechSynthesis: vi.fn(),
    };
});

class MockAudio {
    static instances: MockAudio[] = [];
    static nextPlayError: Error | null = null;

    src: string;
    defaultPlaybackRate = 1;
    playbackRate = 1;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    pause = vi.fn();
    play = vi.fn(async () => {
        if (MockAudio.nextPlayError) {
            const error = MockAudio.nextPlayError;
            MockAudio.nextPlayError = null;
            throw error;
        }
        return undefined;
    });

    constructor(src: string) {
        this.src = src;
        MockAudio.instances.push(this);
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
        rate: 1,
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

describe("speechRuntime race handling", () => {
    const originalAudio = globalThis.Audio as any;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    beforeEach(async () => {
        MockAudio.instances = [];
        MockAudio.nextPlayError = null;
        let nextBlobId = 1;
        globalThis.Audio = MockAudio as any;
        URL.createObjectURL = vi.fn(() => `blob:mock-${nextBlobId++}`);
        URL.revokeObjectURL = vi.fn();

        const { speechRuntime } = await import("@/app/aipanel/speechruntime");
        speechRuntime.stop();
    });

    afterEach(async () => {
        const { speechRuntime } = await import("@/app/aipanel/speechruntime");
        speechRuntime.stop();
        globalThis.Audio = originalAudio;
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
        vi.clearAllMocks();
    });

    it("ignores stale onended from a previous audio instance", async () => {
        const { speechRuntime } = await import("@/app/aipanel/speechruntime");
        const settings = makeSettings();
        const onError = vi.fn();
        const activeStates: boolean[] = [];
        const unsubscribe = speechRuntime.subscribe((isActive) => activeStates.push(isActive));

        await speechRuntime.play("first reply", settings, "assistant", onError);
        expect(MockAudio.instances.length).toBe(1);
        const firstAudio = MockAudio.instances[0];

        await speechRuntime.play("second reply", settings, "assistant", onError);
        expect(MockAudio.instances.length).toBe(2);
        const secondAudio = MockAudio.instances[1];

        firstAudio.onended?.();

        expect(secondAudio.pause).not.toHaveBeenCalled();
        expect(activeStates[activeStates.length - 1]).toBe(true);

        secondAudio.onended?.();
        expect(activeStates[activeStates.length - 1]).toBe(false);

        unsubscribe();
    });

    it("ignores stale onerror from a previous audio instance", async () => {
        const { speechRuntime } = await import("@/app/aipanel/speechruntime");
        const settings = makeSettings();
        const onError = vi.fn();
        const activeStates: boolean[] = [];
        const unsubscribe = speechRuntime.subscribe((isActive) => activeStates.push(isActive));

        await speechRuntime.play("first reply", settings, "assistant", onError);
        expect(MockAudio.instances.length).toBe(1);
        const firstAudio = MockAudio.instances[0];

        await speechRuntime.play("second reply", settings, "assistant", onError);
        expect(MockAudio.instances.length).toBe(2);
        const secondAudio = MockAudio.instances[1];

        firstAudio.onerror?.();

        expect(secondAudio.pause).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        expect(activeStates[activeStates.length - 1]).toBe(true);

        secondAudio.onended?.();
        expect(activeStates[activeStates.length - 1]).toBe(false);

        unsubscribe();
    });

    it("does not surface interrupted playback as a user-facing error", async () => {
        const { speechRuntime } = await import("@/app/aipanel/speechruntime");
        const settings = makeSettings();
        const onError = vi.fn();
        const activeStates: boolean[] = [];
        const unsubscribe = speechRuntime.subscribe((isActive) => activeStates.push(isActive));

        MockAudio.nextPlayError = new Error("The play() request was interrupted by a call to pause().");
        const started = await speechRuntime.play("interrupted case", settings, "assistant", onError);

        expect(started).toBe(false);
        expect(onError).not.toHaveBeenCalled();
        expect(activeStates[activeStates.length - 1]).toBe(false);

        unsubscribe();
    });

    it("does not let another owner stop active playback", async () => {
        const { speechRuntime } = await import("@/app/aipanel/speechruntime");
        const settings = makeSettings();
        const onError = vi.fn();
        const ownerAStates: boolean[] = [];
        const ownerBStates: boolean[] = [];
        const unsubA = speechRuntime.subscribe((isActive) => ownerAStates.push(isActive), "term-a");
        const unsubB = speechRuntime.subscribe((isActive) => ownerBStates.push(isActive), "term-b");

        await speechRuntime.play("owner a reply", settings, "assistant", onError, { ownerId: "term-a" });
        expect(ownerAStates[ownerAStates.length - 1]).toBe(true);
        expect(ownerBStates[ownerBStates.length - 1]).toBe(false);

        speechRuntime.stop("term-b");
        expect(ownerAStates[ownerAStates.length - 1]).toBe(true);
        expect(MockAudio.instances[0]?.pause).not.toHaveBeenCalled();

        speechRuntime.stop("term-a");
        expect(ownerAStates[ownerAStates.length - 1]).toBe(false);

        unsubA();
        unsubB();
    });
});

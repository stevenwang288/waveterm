import type { ResolvedSpeechSettings } from "@/app/aipanel/speechsettings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/aipanel/aispeech", () => {
    return {
        chunkSpeechInput: vi.fn((text: string) => [text]),
        requestOpenAICompatibleSpeechAudio: vi.fn(async () => new Blob(["mock-audio"], { type: "audio/mpeg" })),
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

describe("speechRuntime race handling", () => {
    const originalAudio = globalThis.Audio as any;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    let originalWindowApi: any;

    const getSpeechLogMock = () => (globalThis as any).window?.api?.speechLog as ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        MockAudio.instances = [];
        MockAudio.nextPlayError = null;
        let nextBlobId = 1;
        globalThis.Audio = MockAudio as any;
        URL.createObjectURL = vi.fn(() => `blob:mock-${nextBlobId++}`);
        URL.revokeObjectURL = vi.fn();
        const globalAny = globalThis as any;
        originalWindowApi = globalAny.window?.api;
        if (!globalAny.window) {
            globalAny.window = {};
        }
        globalAny.window.api = {
            ...(originalWindowApi ?? {}),
            speechLog: vi.fn(async () => true),
        };

        const { speechRuntime } = await import("@/app/aipanel/speechruntime");
        speechRuntime.stop();
    });

    afterEach(async () => {
        const { speechRuntime } = await import("@/app/aipanel/speechruntime");
        speechRuntime.stop();
        globalThis.Audio = originalAudio;
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
        const globalAny = globalThis as any;
        if (globalAny.window) {
            globalAny.window.api = originalWindowApi;
        }
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

    it("logs spoken chunks and completion for api transport", async () => {
        const { speechRuntime } = await import("@/app/aipanel/speechruntime");
        const settings = makeSettings();
        const onError = vi.fn();

        const started = await speechRuntime.play("  assistant reply  ", settings, "assistant", onError);
        expect(started).toBe(true);

        const speechLog = getSpeechLogMock();
        expect(speechLog).toHaveBeenCalled();
        const payloads = speechLog.mock.calls.map((call) => call[0]);
        expect(payloads.some((payload) => payload?.event === "start")).toBe(true);
        expect(
            payloads.some(
                (payload) => payload?.event === "chunk" && payload?.chunkIndex === 0 && payload?.text === "assistant reply"
            )
        ).toBe(true);

        MockAudio.instances[0]?.onended?.();
        const postEndPayloads = speechLog.mock.calls.map((call) => call[0]);
        expect(postEndPayloads.some((payload) => payload?.event === "end")).toBe(true);
        expect(onError).not.toHaveBeenCalled();
    });

    it("logs speech-error when non-benign playback failure occurs", async () => {
        const { speechRuntime } = await import("@/app/aipanel/speechruntime");
        const settings = makeSettings();
        const onError = vi.fn();
        MockAudio.nextPlayError = new Error("network failure");

        const started = await speechRuntime.play("assistant reply", settings, "assistant", onError);

        expect(started).toBe(false);
        expect(onError).toHaveBeenCalled();
        const speechLog = getSpeechLogMock();
        const payloads = speechLog.mock.calls.map((call) => call[0]);
        expect(payloads.some((payload) => payload?.event === "error")).toBe(true);
    });
});

import { atom } from "jotai";
import { describe, expect, it, vi } from "vitest";

const getTraditionalViewMock = vi.fn((meta?: MetaType | null) => {
    const returnView =
        typeof meta?.["workbench:returnview"] === "string" &&
        meta["workbench:returnview"].trim() !== "System.Collections.Specialized.OrderedDictionary"
            ? meta["workbench:returnview"].trim()
            : "";
    if (returnView) {
        return returnView;
    }
    const currentView =
        typeof meta?.view === "string" && meta.view.trim() !== "System.Collections.Specialized.OrderedDictionary"
            ? meta.view.trim()
            : "";
    if (currentView && currentView !== "workbench") {
        return currentView;
    }
    return "term";
});

vi.mock("@/app/aipanel/speechruntime", () => ({
    speechRuntime: {
        subscribe: vi.fn(() => () => {}),
        stop: vi.fn(),
    },
}));

vi.mock("@/app/aipanel/speechsettings", () => ({
    resolveSpeechSettings: vi.fn(() => ({
        autoPlay: true,
        enabled: false,
        showManualButton: false,
        transport: "api",
        model: "",
        voice: "",
        voiceAssistant: "",
    })),
}));

vi.mock("@/app/aipanel/waveai-model", () => ({
    WaveAIModel: {
        getInstance: () => ({
            currentAIMode: null,
            aiModeConfigs: null,
            latestAssistantMessageText: null,
            isAIStreaming: null,
        }),
    },
}));

vi.mock("@/app/block/blockutil", () => ({
    blockViewToIcon: () => null,
    blockViewToName: (view?: string) =>
        ({
            term: "终端",
            preview: "预览",
            waveai: "AI",
            workbench: "工作台",
        })[String(view ?? "").trim()] ?? String(view ?? ""),
    getViewIconElem: () => null,
    OptMagnifyButton: () => null,
    renderHeaderElements: () => [],
}));

vi.mock("@/app/block/connectionbutton", () => ({
    ConnectionButton: () => null,
}));

vi.mock("@/app/block/codex-resume", () => ({
    canRunCodexResume: vi.fn(() => false),
    hasCodexResumeUiCues: vi.fn(() => false),
    runCodexResumeSequence: vi.fn(),
    shouldShowCodexResumeButton: vi.fn(() => false),
    waitForCodexResumeToBecomeInteractive: vi.fn(),
}));

vi.mock("@/app/block/terminal-speech", () => ({
    getTerminalFormalReplyRefreshDelayMs: vi.fn(),
    getTerminalSpeechAutoPlayBaselineTs: vi.fn(),
    getTerminalSpeechCompletionAnchor: vi.fn(),
    loadLatestTerminalFormalReplyPayload: vi.fn(),
    loadLatestWorkbenchFormalReplyPayload: vi.fn(),
    playTerminalFormalReplyPayload: vi.fn(),
    shouldAutoPlayTerminalFormalReply: vi.fn(),
}));

vi.mock("@/app/store/contextmenu", () => ({
    ContextMenuModel: {
        showContextMenu: vi.fn(),
    },
}));

vi.mock("@/app/store/global", () => ({
    atoms: {
        documentHasFocus: null,
        codexAuthReadyAtom: null,
    },
    getConnStatusAtom: vi.fn(),
    getOverrideConfigAtom: vi.fn(),
    getSettingsKeyAtom: vi.fn(),
    pushFlashError: vi.fn(),
    recordTEvent: vi.fn(),
    useBlockAtom: vi.fn(),
    WOS: {
        getWaveObjectAtom: vi.fn(() => atom({ meta: { view: "workbench" } } as any)),
        makeORef: vi.fn(),
        useWaveObjectValue: vi.fn(() => [null]),
    },
}));

vi.mock("@/app/store/jotaiStore", () => ({
    globalStore: {
        get: vi.fn(),
    },
}));

vi.mock("@/app/store/keymodel", () => ({
    uxCloseBlock: vi.fn(),
}));

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        ActivityCommand: vi.fn(),
        ControllerInputCommand: vi.fn(),
        SetConfigCommand: vi.fn(),
        TermGetScrollbackLinesCommand: vi.fn(),
    },
}));

vi.mock("@/app/store/wshrpcutil", () => ({
    TabRpcClient: {},
}));

vi.mock("@/app/view/workbench/workbench-mode", () => ({
    getTraditionalView: getTraditionalViewMock,
    toggleWorkbenchMode: vi.fn(),
}));

vi.mock("@/element/iconbutton", () => ({
    IconButton: () => null,
}));

vi.mock("@/util/launchcwd", () => ({
    getTerminalDisplayCwd: vi.fn(),
    getTerminalInheritableCwd: vi.fn(),
}));

vi.mock(import("@/util/util"), async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/util/util")>();
    return {
        ...actual,
        cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" "),
        fireAndForget: vi.fn(),
        isBlank: (value?: string) => value == null || value.trim() === "",
        stringToBase64: vi.fn(),
        useAtomValueSafe: (value?: unknown) => value,
    };
});

vi.mock("@/layout/index", () => ({}));

vi.mock("react-i18next", () => ({
    initReactI18next: {
        type: "3rdParty",
        init: () => {},
    },
    useTranslation: () => ({
        t: (value: string) => value,
    }),
}));

const {
    getTerminalSpeechAutoPlayTitle,
    getTerminalSpeechManualButtonTitle,
    isTerminalLikeBlockView,
    resolveTerminalHeaderPathLabel,
    shouldReplaceTerminalSpeechPayload,
    shouldRefreshWorkbenchFormalReplyFromFile,
    shouldRefreshTerminalFormalReplyFromScrollback,
    shouldShowSharedHeaderSpeechButton,
    shouldUseTerminalFormalReplySource,
} = await import("../blockframe-header");
const launchcwdModule = await import("@/util/launchcwd");

describe("blockframe header speech controls", () => {
    it("treats term and workbench as the same terminal-like source for shared formal-reply speech controls", () => {
        expect(isTerminalLikeBlockView("term")).toBe(true);
        expect(isTerminalLikeBlockView("workbench")).toBe(true);
        expect(isTerminalLikeBlockView("preview")).toBe(false);

        expect(shouldUseTerminalFormalReplySource("term")).toBe(true);
        expect(shouldUseTerminalFormalReplySource("workbench")).toBe(true);
        expect(shouldUseTerminalFormalReplySource("waveai")).toBe(false);
        expect(shouldRefreshTerminalFormalReplyFromScrollback("term")).toBe(true);
        expect(shouldRefreshTerminalFormalReplyFromScrollback("workbench")).toBe(false);
        expect(shouldRefreshWorkbenchFormalReplyFromFile("term")).toBe(false);
        expect(shouldRefreshWorkbenchFormalReplyFromFile("workbench")).toBe(true);
    });

    it("keeps the Chinese speech titles on the single shared header control surface", () => {
        expect(shouldShowSharedHeaderSpeechButton(true)).toBe(true);
        expect(shouldShowSharedHeaderSpeechButton(false)).toBe(false);
        expect(getTerminalSpeechAutoPlayTitle(true)).toBe("自动播报");
        expect(getTerminalSpeechManualButtonTitle(false)).toBe("播放最近正式回复");
        expect(getTerminalSpeechManualButtonTitle(true)).toBe("停止当前播报");
    });

    it("keeps the absolute persisted path when the live header value is only a shortened tail", () => {
        vi.mocked(launchcwdModule.getTerminalDisplayCwd).mockReturnValue("E:/code/cx-workbench");
        expect(resolveTerminalHeaderPathLabel("cx-workbench", {} as any)).toBe("E:/code/cx-workbench");
    });

    it("uses the live path when it is already a full absolute path", () => {
        vi.mocked(launchcwdModule.getTerminalDisplayCwd).mockReturnValue("E:/code/old-project");
        expect(resolveTerminalHeaderPathLabel("E:/code/new-project", {} as any)).toBe("E:/code/new-project");
    });

    it("does not replace a workbench speech payload when only a rapid duplicate modts changes", () => {
        expect(
            shouldReplaceTerminalSpeechPayload(
                {
                    id: "1000:old",
                    text: "同一条 workbench 正式回复",
                    outputTs: 1000,
                },
                {
                    id: "1500:new",
                    text: "同一条 workbench 正式回复",
                    outputTs: 1500,
                }
            )
        ).toBe(false);
    });

    it("still replaces the speech payload when text changes or the duplicate gap is long enough", () => {
        expect(
            shouldReplaceTerminalSpeechPayload(
                {
                    id: "1000:old",
                    text: "旧正式回复",
                    outputTs: 1000,
                },
                {
                    id: "1400:new",
                    text: "新正式回复",
                    outputTs: 1400,
                }
            )
        ).toBe(true);

        expect(
            shouldReplaceTerminalSpeechPayload(
                {
                    id: "1000:old",
                    text: "同一条正式回复",
                    outputTs: 1000,
                },
                {
                    id: "5000:new",
                    text: "同一条正式回复",
                    outputTs: 5000,
                }
            )
        ).toBe(true);
    });
});

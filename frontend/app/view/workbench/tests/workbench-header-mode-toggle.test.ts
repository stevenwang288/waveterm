import { atom, getDefaultStore } from "jotai";
import { describe, expect, it, vi } from "vitest";

const setWorkbenchModeMock = vi.fn();
const toggleWorkbenchModeMock = vi.fn();
const waveEventSubscribeSingleMock = vi.fn(() => vi.fn());

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

vi.mock("@/app/i18n", () => ({
    default: {
        t: (value: string, options?: Record<string, string>) => {
            if (options?.host) {
                return `${value}:${options.host}`;
            }
            if (options?.value) {
                return `${value}:${options.value}`;
            }
            return value;
        },
    },
}));

vi.mock("@/app/view/term/term-settings-menu", () => ({
    CLI_LAYOUT_PRESETS: [{ key: "2", label: "两分屏", rows: 1, cols: 2 }],
    addPathToCliLayoutPreset: vi.fn().mockResolvedValue(undefined),
    buildFavoriteLaunchMenuItems: vi.fn(() => []),
    buildOpenWithAiMenuItems: vi.fn(() => []),
    buildSharedTermContextMenuItems: vi.fn(
        ({ clipboardItems = [], selectionItems = [], workspaceItems = [], editItems = [], blockItems = [], settingsItems = [] }) =>
            [...clipboardItems, ...selectionItems, ...workspaceItems, ...editItems, ...blockItems, ...settingsItems]
    ),
    buildSharedTermSettingsMenuItems: vi.fn(() => []),
    getCliLayoutPresetLabel: vi.fn((preset: { label: string }) => preset.label),
    makeUnavailableMenuItem: vi.fn((label: string, sublabel: string) => ({
        label,
        sublabel,
        enabled: false,
    })),
}));

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
    loadLatestTerminalFormalReplyPayload: vi.fn(),
    playTerminalFormalReplyPayload: vi.fn(),
}));

vi.mock("@/app/store/client-model", () => ({
    ClientModel: {},
}));

vi.mock("@/app/store/favorites-model", () => ({
    FavoritesModel: {
        getInstance: () => ({
            addFavorite: vi.fn(),
            getItems: vi.fn(() => []),
            updateFavoriteAutoCmd: vi.fn(),
        }),
    },
}));

vi.mock("@/app/store/modalmodel", () => ({
    modalsModel: {
        pushModal: vi.fn(),
    },
}));

vi.mock("@/app/store/contextmenu", () => ({
    ContextMenuModel: {
        showContextMenu: vi.fn(),
    },
}));

vi.mock("@/app/store/global", () => ({
    atoms: {
        settingsAtom: null,
        fullConfigAtom: null,
        documentHasFocus: null,
        codexAuthReadyAtom: null,
    },
    createBlock: vi.fn(),
    createBlockSplitHorizontally: vi.fn(),
    createBlockSplitVertically: vi.fn(),
    fetchWaveFile: vi.fn(),
    getApi: vi.fn(() => ({
        nativePaste: vi.fn(),
        openExternal: vi.fn(),
    })),
    getConnStatusAtom: vi.fn(),
    getLocalHostDisplayNameAtom: vi.fn(),
    getOverrideConfigAtom: vi.fn(),
    getSettingsKeyAtom: vi.fn(),
    globalStore: {
        get: vi.fn(),
        set: vi.fn(),
    },
    pushFlashError: vi.fn(),
    pushNotification: vi.fn(),
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

vi.mock("@/app/store/services", () => ({
    BlockService: {
        SaveWaveAiData: vi.fn(),
    },
}));

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        ActivityCommand: vi.fn(),
        BlockJobStatusCommand: vi.fn().mockResolvedValue(null),
        ControllerInputCommand: vi.fn(),
        SetConfigCommand: vi.fn(),
        SetMetaCommand: vi.fn(),
        TermGetScrollbackLinesCommand: vi.fn(),
    },
}));

vi.mock("@/app/store/wshrpcutil", () => ({
    TabRpcClient: {},
}));

vi.mock("@/app/store/wps", () => ({
    waveEventSubscribeSingle: waveEventSubscribeSingleMock,
}));

vi.mock("@/app/view/workbench/workbench-mode", () => ({
    getTraditionalView: getTraditionalViewMock,
    setWorkbenchMode: setWorkbenchModeMock,
    toggleWorkbenchMode: toggleWorkbenchModeMock,
}));

vi.mock("@/element/iconbutton", () => ({
    IconButton: () => null,
}));

vi.mock("@/util/composition-input", () => ({
    useCompositionSafeTextarea: vi.fn(),
}));

vi.mock("@/util/clilayout", () => ({
    openCliLayoutInNewTab: vi.fn(),
}));

vi.mock("@/util/keyutil", () => ({
    checkKeyPressed: vi.fn(),
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
        isLocalConnName: vi.fn(),
        isWslConnName: vi.fn(),
        mergeMeta: (...values: Array<Record<string, unknown> | null | undefined>) => Object.assign({}, ...values),
        stringToBase64: vi.fn(),
        useAtomValueSafe: (value?: unknown) => value,
    };
});

vi.mock("@/layout/index", () => ({}));

vi.mock("react-i18next", () => ({
    useTranslation: () => ({
        t: (value: string) => value,
    }),
}));

vi.mock("../term/termutil", () => ({
    computeTheme: () => [{}, "#000"],
    DefaultTermTheme: "default",
}));

vi.mock("../workbench-mode", () => ({
    getTraditionalView: getTraditionalViewMock,
    setWorkbenchMode: setWorkbenchModeMock,
    toggleWorkbenchMode: toggleWorkbenchModeMock,
}));

const {
    WorkbenchViewModel,
    WORKBENCH_DRAWER_CONTROL_HINT,
    buildWorkbenchBlockMeta,
    buildWorkbenchSourceMetaFromPickedPath,
    launchWorkbenchTerminalInBlock,
} =
    await import("../workbench");
const { WOS, globalStore } = await import("@/app/store/global");
const { RpcApi } = await import("@/app/store/wshclientapi");
const keyutil = await import("@/util/keyutil");
const util = await import("@/util/util");
const {
    buildBlockFrameContextMenuItems,
    createWorkbenchModeToggleButton,
    getTerminalSpeechAutoPlayTitle,
    getTerminalSpeechManualButtonTitle,
    getTerminalSpeechChainLabel,
    getModeToggleButtonTitle,
    resolveTerminalSpeechAutoPlay,
    resolveTerminalSpeechAutoPlayVisualState,
    shouldShowSharedHeaderSpeechButton,
    shouldReplaceTerminalSpeechPayload,
    shouldSeedTerminalSpeechAutoPlayConfig,
} = await import("../../../block/blockframe-header");

vi.mocked(util.isLocalConnName).mockImplementation((value?: string) => {
    const normalized = String(value ?? "").trim();
    return normalized === "" || normalized === "local";
});
vi.mocked(util.isWslConnName).mockImplementation((value?: string) => String(value ?? "").startsWith("wsl://"));

describe("workbench header source", () => {
    it("does not inject a custom summary into the shared header", () => {
        const blockAtom = atom({
            meta: {
                view: "workbench",
                connection: "wsl://ubuntu",
                "display:launchcwd": "/workspace/app",
            },
        } as any);
        vi.mocked(WOS.getWaveObjectAtom).mockReturnValue(blockAtom as any);

        const model = new WorkbenchViewModel("block-1", { toggleMagnify: vi.fn() } as any, {} as any);

        expect(getDefaultStore().get(model.viewText)).toBe("");
    });

    it("keeps drawer control on the shared header bus and adds the path picker alongside the drawer toggle", () => {
        const blockAtom = atom({
            meta: {
                view: "workbench",
            },
        } as any);
        vi.mocked(WOS.getWaveObjectAtom).mockReturnValue(blockAtom as any);
        const model = new WorkbenchViewModel("block-1", { toggleMagnify: vi.fn() } as any, {} as any);
        const toggleDrawer = vi.fn();
        const adjustDrawerWidth = vi.fn();
        model.toggleDrawer = toggleDrawer;
        model.adjustDrawerWidth = adjustDrawerWidth;

        const buttons = getDefaultStore().get(model.endIconButtons);
        expect(buttons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    elemtype: "iconbutton",
                    icon: "folder-open",
                    title: "选择路径",
                }),
                expect.objectContaining({
                    elemtype: "iconbutton",
                    icon: "clock-rotate-left",
                    title: "恢复工作台记录",
                }),
                expect.objectContaining({
                    elemtype: "iconbutton",
                    icon: "sliders",
                    title: "切换右栏 (Alt+S)",
                }),
            ])
        );
        expect(buttons.map((button) => button.title)).not.toContain("继续 Codex 历史会话");
        expect(WORKBENCH_DRAWER_CONTROL_HINT).toBe("仅保留头部开关 / Alt+S 开关，Alt+[ / ] 缩放");

        buttons.find((button) => button.title === "切换右栏 (Alt+S)")?.click?.();
        expect(toggleDrawer).toHaveBeenCalledTimes(1);
        toggleDrawer.mockClear();

        vi.mocked(keyutil.checkKeyPressed).mockImplementation((_, key) => key === "Alt:c{BracketLeft}");
        expect(model.keyDownHandler({} as any)).toBe(true);
        expect(adjustDrawerWidth).toHaveBeenCalledWith(-32);

        vi.mocked(keyutil.checkKeyPressed).mockImplementation((_, key) => key === "Alt:c{BracketRight}");
        expect(model.keyDownHandler({} as any)).toBe(true);
        expect(adjustDrawerWidth).toHaveBeenCalledWith(32);
        expect(toggleDrawer).not.toHaveBeenCalled();

        vi.mocked(keyutil.checkKeyPressed).mockImplementation((_, key) => key === "Alt:c{KeyS}");
        expect(model.keyDownHandler({} as any)).toBe(true);
        expect(toggleDrawer).toHaveBeenCalledTimes(1);
    });

    it("dispatches the shared pick-directory intent from the header path button", async () => {
        const blockData = {
            meta: {
                view: "workbench",
                connection: "local",
                "term:displaycwd": "E:/code/waveterm-main",
            },
        } as any;
        const blockAtom = atom(blockData);
        vi.mocked(WOS.getWaveObjectAtom).mockReturnValue(blockAtom as any);
        const globalAny = globalThis as any;
        globalAny.window ??= {};
        const originalDispatchEvent = globalAny.window.dispatchEvent;
        globalAny.window.dispatchEvent = vi.fn();
        const dispatchEventSpy = globalAny.window.dispatchEvent as ReturnType<typeof vi.fn>;

        try {
            const model = new WorkbenchViewModel("block-1", { toggleMagnify: vi.fn() } as any, {} as any);
            const buttons = getDefaultStore().get(model.endIconButtons);

            buttons.find((button) => button.title === "选择路径")?.click?.({} as any);
            expect(dispatchEventSpy).toHaveBeenCalledTimes(1);
            const dispatchedEvent = dispatchEventSpy.mock.calls[0][0] as CustomEvent<{
                blockId: string;
                intent: { kind: string; actionId: string; connection?: string };
            }>;
            expect(dispatchedEvent.type).toBe("waveterm:workbench-dispatch");
            expect(dispatchedEvent.detail).toEqual({
                blockId: "block-1",
                intent: {
                    kind: "local-action",
                    actionId: "pick-directory",
                    connection: "local",
                },
            });
        } finally {
            globalAny.window.dispatchEvent = originalDispatchEvent;
        }
    });

    it("dispatches the shared launch-terminal intent from the header Codex button", async () => {
        const blockData = {
            meta: {
                view: "workbench",
                connection: "local",
                "term:displaycwd": "E:/code/waveterm-main",
            },
        } as any;
        const blockAtom = atom(blockData);
        vi.mocked(WOS.getWaveObjectAtom).mockReturnValue(blockAtom as any);
        const globalAny = globalThis as any;
        globalAny.window ??= {};
        const originalDispatchEvent = globalAny.window.dispatchEvent;
        globalAny.window.dispatchEvent = vi.fn();
        const dispatchEventSpy = globalAny.window.dispatchEvent as ReturnType<typeof vi.fn>;

        try {
            const model = new WorkbenchViewModel("block-1", { toggleMagnify: vi.fn() } as any, {} as any);
            const buttons = getDefaultStore().get(model.endIconButtons);
            buttons.find((button) => button.title === "启动 Codex")?.click?.({} as any);
            expect(dispatchEventSpy).toHaveBeenCalledTimes(1);
            const dispatchedEvent = dispatchEventSpy.mock.calls[0][0] as CustomEvent<{
                blockId: string;
                intent: { kind: string; actionId: string; path: string; command: string; connection?: string };
            }>;
            expect(dispatchedEvent.type).toBe("waveterm:workbench-dispatch");
            expect(dispatchedEvent.detail.blockId).toBe("block-1");
            expect(dispatchedEvent.detail.intent.kind).toBe("local-action");
            expect(dispatchedEvent.detail.intent.actionId).toBe("launch-terminal");
            expect(dispatchedEvent.detail.intent.path).toBe("E:/code/waveterm-main");
            expect(dispatchedEvent.detail.intent.command).toContain("codex");
            expect(dispatchedEvent.detail.intent.connection).toBe("local");
        } finally {
            globalAny.window.dispatchEvent = originalDispatchEvent;
        }
    });

    it("launchWorkbenchTerminalInBlock still targets the current workbench block", async () => {
        const currentMeta = {
            view: "workbench",
            connection: "local",
            "term:displaycwd": "E:/code/waveterm-main",
        } as any;
        vi.mocked(RpcApi.SetMetaCommand).mockClear();
        vi.mocked(RpcApi.ControllerInputCommand).mockClear();

        await launchWorkbenchTerminalInBlock({
            blockId: "block-1",
            path: "E:/code/waveterm-main",
            command: "codex.cmd",
            currentMeta,
            connection: "local",
        });

        expect(RpcApi.SetMetaCommand).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                meta: buildWorkbenchBlockMeta(buildWorkbenchSourceMetaFromPickedPath("E:/code/waveterm-main")),
            })
        );
        expect(RpcApi.ControllerInputCommand).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                blockid: "block-1",
            })
        );
    });

    it("launchWorkbenchTerminalInBlock sanitizes poisoned workbench controller metadata back to shell/term", async () => {
        vi.mocked(RpcApi.SetMetaCommand).mockClear();

        await launchWorkbenchTerminalInBlock({
            blockId: "block-1",
            path: "E:/code/waveterm-main",
            command: "codex.cmd",
            currentMeta: {
                view: "workbench",
                connection: "local",
                controller: "System.Collections.Specialized.OrderedDictionary",
                "workbench:returnview": "System.Collections.Specialized.OrderedDictionary",
            } as any,
            connection: "local",
        });

        expect(RpcApi.SetMetaCommand).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                meta: expect.objectContaining({
                    controller: "shell",
                    "workbench:returnview": "term",
                }),
            })
        );
    });

    it("launchWorkbenchTerminalInBlock bootstraps a standalone workbench through term when the controller route is missing", async () => {
        vi.mocked(RpcApi.SetMetaCommand).mockClear();
        vi.mocked(RpcApi.ControllerInputCommand).mockReset();
        vi.mocked(RpcApi.ControllerInputCommand)
            .mockRejectedValueOnce(new Error("no controller found for block block-1"))
            .mockResolvedValueOnce(undefined);

        await launchWorkbenchTerminalInBlock({
            blockId: "block-1",
            path: "E:/code/waveterm-main",
            command: "codex.cmd",
            currentMeta: {
                view: "workbench",
                connection: "local",
                controller: { bogus: true } as any,
                "workbench:returnview": { bogus: true } as any,
            } as any,
            connection: "local",
        });

        expect(RpcApi.ControllerInputCommand).toHaveBeenCalledTimes(2);
        expect(RpcApi.SetMetaCommand).toHaveBeenNthCalledWith(
            1,
            expect.anything(),
            expect.objectContaining({
                meta: expect.objectContaining({
                    view: "workbench",
                    controller: "shell",
                    "workbench:returnview": "term",
                }),
            })
        );
        expect(RpcApi.SetMetaCommand).toHaveBeenNthCalledWith(
            2,
            expect.anything(),
            expect.objectContaining({
                meta: expect.objectContaining({
                    view: "term",
                    controller: "shell",
                    "workbench:returnview": null,
                }),
            })
        );
        expect(RpcApi.SetMetaCommand).toHaveBeenNthCalledWith(
            3,
            expect.anything(),
            expect.objectContaining({
                meta: expect.objectContaining({
                    view: "workbench",
                    controller: "shell",
                    "workbench:returnview": "term",
                }),
            })
        );
    });

    it("launchWorkbenchTerminalInBlock retries through term when the shell input channel is not ready yet", async () => {
        vi.mocked(RpcApi.SetMetaCommand).mockClear();
        vi.mocked(RpcApi.ControllerInputCommand).mockReset();
        vi.mocked(RpcApi.ControllerInputCommand)
            .mockRejectedValueOnce(new Error("no shell input chan"))
            .mockResolvedValueOnce(undefined);

        await launchWorkbenchTerminalInBlock({
            blockId: "block-1",
            path: "E:/code/waveterm-main",
            command: "codex.cmd",
            currentMeta: {
                view: "workbench",
                connection: "local",
                controller: "shell",
                "workbench:returnview": "term",
            } as any,
            connection: "local",
        });

        expect(RpcApi.ControllerInputCommand).toHaveBeenCalledTimes(2);
        expect(RpcApi.SetMetaCommand).toHaveBeenNthCalledWith(
            1,
            expect.anything(),
            expect.objectContaining({
                meta: expect.objectContaining({
                    view: "workbench",
                    controller: "shell",
                    "workbench:returnview": "term",
                }),
            })
        );
        expect(RpcApi.SetMetaCommand).toHaveBeenNthCalledWith(
            2,
            expect.anything(),
            expect.objectContaining({
                meta: expect.objectContaining({
                    view: "term",
                    controller: "shell",
                    "workbench:returnview": null,
                }),
            })
        );
        expect(RpcApi.SetMetaCommand).toHaveBeenNthCalledWith(
            3,
            expect.anything(),
            expect.objectContaining({
                meta: expect.objectContaining({
                    view: "workbench",
                    controller: "shell",
                    "workbench:returnview": "term",
                }),
            })
        );
    });

    it("dispatches the shared restore-history intent from the header restore button", () => {
        const blockAtom = atom({
            meta: {
                view: "workbench",
                connection: "local",
            },
        } as any);
        vi.mocked(WOS.getWaveObjectAtom).mockReturnValue(blockAtom as any);
        const globalAny = globalThis as any;
        globalAny.window ??= {};
        const originalDispatchEvent = globalAny.window.dispatchEvent;
        globalAny.window.dispatchEvent = vi.fn();
        const dispatchEventSpy = globalAny.window.dispatchEvent as ReturnType<typeof vi.fn>;

        try {
            const model = new WorkbenchViewModel("block-1", { toggleMagnify: vi.fn() } as any, {} as any);
            const buttons = getDefaultStore().get(model.endIconButtons);
            buttons.find((button) => button.title === "恢复工作台记录")?.click?.({} as any);
            expect(dispatchEventSpy).toHaveBeenCalledTimes(1);
            const dispatchedEvent = dispatchEventSpy.mock.calls[0][0] as CustomEvent<{
                blockId: string;
                intent: { kind: string; actionId: string };
            }>;
            expect(dispatchedEvent.type).toBe("waveterm:workbench-dispatch");
            expect(dispatchedEvent.detail).toEqual({
                blockId: "block-1",
                intent: {
                    kind: "local-action",
                    actionId: "restore-history",
                },
            });
        } finally {
            globalAny.window.dispatchEvent = originalDispatchEvent;
        }
    });

    it("does not prepend a return action into the shared workbench menu", () => {
        const blockData = {
            meta: {
                view: "workbench",
                connection: "local",
            },
        } as any;
        const blockAtom = atom(blockData);
        vi.mocked(WOS.getWaveObjectAtom).mockReturnValue(blockAtom as any);
        vi.mocked(globalStore.get).mockReturnValue(blockData);

        const model = new WorkbenchViewModel("block-1", { toggleMagnify: vi.fn() } as any, {} as any);
        const labels = model
            .getSettingsMenuItems()
            .filter((item) => "label" in item && typeof item.label === "string")
            .map((item) => item.label as string);

        expect(labels).not.toContain("返回终端");
        expect(labels).not.toContain("返回预览");
    });

    it("exposes term durable status for workbench headers when the block is durable", () => {
        const blockAtom = atom({
            meta: {
                view: "workbench",
                "term:durable": true,
            },
        } as any);
        vi.mocked(WOS.getWaveObjectAtom).mockReturnValue(blockAtom as any);
        const model = new WorkbenchViewModel("block-1", { toggleMagnify: vi.fn() } as any, {} as any);

        getDefaultStore().set(model.blockJobStatusAtom, {
            jobid: "job-1",
            status: "connected",
            versionts: 1,
        } as any);

        expect(getDefaultStore().get(model.termDurableStatus)).toMatchObject({
            jobid: "job-1",
            status: "connected",
        });
    });

    it("reuses the same block wrapper for header menus that canvas right-click now consumes", () => {
        const nodeModel = {
            blockId: "block-1",
            isMagnified: atom(false),
            toggleMagnify: vi.fn(),
        } as any;
        const viewModel = {
            getSettingsMenuItems: vi.fn(() => [{ label: "共享 workbench 菜单", click: vi.fn() }]),
        } as any;

        const menu = buildBlockFrameContextMenuItems("block-1", viewModel, nodeModel, (value: string) => value);
        const labels = menu
            .filter((item) => "label" in item && typeof item.label === "string")
            .map((item) => item.label as string);

        expect(labels).toEqual([
            "block.magnifyBlock",
            "block.copyBlockId",
            "共享 workbench 菜单",
            "block.closeBlock",
        ]);
    });
});

describe("blockframe header mode toggle", () => {
    it("treats missing speech autoplay config as enabled by default", () => {
        expect(resolveTerminalSpeechAutoPlay(undefined)).toBe(true);
        expect(resolveTerminalSpeechAutoPlay(null)).toBe(true);
        expect(resolveTerminalSpeechAutoPlay(false)).toBe(false);
    });

    it("seeds terminal speech autoplay config only once when missing", () => {
        expect(
            shouldSeedTerminalSpeechAutoPlayConfig({
                isTerminalBlock: true,
                speechAutoPlayRaw: undefined,
                hasSeeded: false,
            })
        ).toBe(true);
        expect(
            shouldSeedTerminalSpeechAutoPlayConfig({
                isTerminalBlock: true,
                speechAutoPlayRaw: undefined,
                hasSeeded: true,
            })
        ).toBe(false);
        expect(
            shouldSeedTerminalSpeechAutoPlayConfig({
                isTerminalBlock: false,
                speechAutoPlayRaw: undefined,
                hasSeeded: false,
            })
        ).toBe(false);
        expect(
            shouldSeedTerminalSpeechAutoPlayConfig({
                isTerminalBlock: true,
                speechAutoPlayRaw: false,
                hasSeeded: false,
            })
        ).toBe(false);
    });

    it("uses unified Chinese titles for both term and workbench states", () => {
        expect(getModeToggleButtonTitle("term")).toBe("进入工作台");
        expect(getModeToggleButtonTitle("preview", { view: "preview" })).toBe("进入工作台");
        expect(getModeToggleButtonTitle("workbench", { view: "workbench", "workbench:returnview": "term" })).toBe(
            "返回终端"
        );
        expect(
            getModeToggleButtonTitle("workbench", {
                view: "workbench",
                "workbench:returnview": "preview",
            })
        ).toBe("返回预览");
    });

    it("lets the shared header toggle workbench mode in both directions", () => {
        toggleWorkbenchModeMock.mockClear();

        const button = createWorkbenchModeToggleButton("workbench", "block-1", {
            view: "workbench",
            "workbench:returnview": "term",
        });

        expect(button).toMatchObject({
            elemtype: "iconbutton",
            icon: "gauge-high",
            className: "toggle active",
            title: "返回终端",
        });

        button?.click?.();

        expect(toggleWorkbenchModeMock).toHaveBeenCalledWith("block-1");

        const termButton = createWorkbenchModeToggleButton("term", "block-1", { view: "term" });
        expect(termButton).toMatchObject({
            elemtype: "iconbutton",
            icon: "gauge-high",
            className: "toggle",
            title: "进入工作台",
        });

        termButton?.click?.();

        expect(toggleWorkbenchModeMock).toHaveBeenNthCalledWith(2, "block-1");
    });

    it("uses unified Chinese speech titles and built-in Edge chain labels", () => {
        expect(getTerminalSpeechAutoPlayTitle(true)).toBe("自动播报");
        expect(getTerminalSpeechAutoPlayTitle(false)).toBe("自动播报");
        expect(getTerminalSpeechManualButtonTitle(false)).toBe("播放最近正式回复");
        expect(getTerminalSpeechManualButtonTitle(true)).toBe("停止当前播报");
        expect(
            getTerminalSpeechChainLabel({
                endpoint: "wave://edge-tts/v1/audio/speech",
                localEngine: "edge",
                model: "edge-tts",
                transport: "api",
                voice: "zh-CN-XiaoxiaoNeural",
                voiceAssistant: "",
            })
        ).toBe("Edge 内置语音 / edge-tts / zh-CN-XiaoxiaoNeural");
    });

    it("prefers optimistic speech autoplay state for immediate header feedback", () => {
        expect(resolveTerminalSpeechAutoPlayVisualState(undefined, null)).toBe(true);
        expect(resolveTerminalSpeechAutoPlayVisualState(undefined, false)).toBe(false);
        expect(resolveTerminalSpeechAutoPlayVisualState(false, true)).toBe(true);
        expect(resolveTerminalSpeechAutoPlayVisualState(true, false)).toBe(false);
    });

    it("only keeps shared header speech buttons for terminal and workbench blocks", () => {
        expect(shouldShowSharedHeaderSpeechButton(true)).toBe(true);
        expect(shouldShowSharedHeaderSpeechButton(false)).toBe(false);
    });

    it("suppresses rapid duplicate payloads but still accepts the same reply text after the duplicate window", () => {
        expect(
            shouldReplaceTerminalSpeechPayload(
                {
                    id: "420:deadbeef:2",
                    text: "完成",
                    outputTs: 420,
                },
                {
                    id: "520:deadbeef:2",
                    text: "完成",
                    outputTs: 520,
                }
            )
        ).toBe(false);
        expect(
            shouldReplaceTerminalSpeechPayload(
                {
                    id: "420:deadbeef:2",
                    text: "完成",
                    outputTs: 420,
                },
                {
                    id: "3001:deadbeef:2",
                    text: "完成",
                    outputTs: 3001,
                }
            )
        ).toBe(true);
        expect(
            shouldReplaceTerminalSpeechPayload(
                {
                    id: "520:deadbeef:2",
                    text: "完成",
                    outputTs: 520,
                },
                {
                    id: "520:deadbeef:2",
                    text: "完成",
                    outputTs: 520,
                }
            )
        ).toBe(false);
    });
});



import { readFileSync } from "node:fs";
import { atom, getDefaultStore } from "jotai";
import {
    TerminalAutoFollowResumeController,
    TerminalAutoFollowResumeDelayMs,
    WorkbenchBottomFollowThresholdPx,
    getWorkbenchDistanceFromBottom,
    isWorkbenchViewportNearBottom,
    resolveWorkbenchFollowLatestState,
} from "../workbench-scroll";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const defaultJotaiStore = getDefaultStore();
const buildSharedTermSettingsMenuItemsMock = vi.fn(() => [{ label: "终端共享菜单项", click: vi.fn() }]);
const buildSharedTermContextMenuItemsMock = vi.fn(
    ({
        clipboardItems = [],
        selectionItems = [],
        workspaceItems = [],
        editItems = [],
        blockItems = [],
        settingsItems = [],
    }: Record<string, ContextMenuItem[]>) => [
        ...clipboardItems,
        ...selectionItems,
        ...workspaceItems,
        ...editItems,
        ...blockItems,
        ...settingsItems,
    ]
);
const setAIModeMock = vi.fn();
const getApiMock = vi.fn(() => ({
    nativePaste: vi.fn(),
    openExternal: vi.fn(),
    getIsDev: vi.fn(() => true),
    getHomeDir: vi.fn(() => "C:/Users/baba1"),
}));
const useCompositionSafeTextareaMock = vi.fn((value: string, setValue: (nextValue: string) => void) => ({
    value,
    handleChange: vi.fn((event?: { target?: { value?: string } }) => setValue?.(event?.target?.value ?? "")),
    handleCompositionStart: vi.fn(),
    handleCompositionEnd: vi.fn(),
    handleBlurWhileComposing: vi.fn(),
    commitDraftValue: vi.fn((nextValue?: string) => String(nextValue ?? value ?? "")),
    isComposingRef: { current: { isComposing: false } },
}));

vi.mock("@/app/i18n", () => ({
    default: {
        t: (key: string, options?: Record<string, string>) => {
            if (options?.value) {
                return `${key}:${options.value}`;
            }
            return key;
        },
    },
}));

vi.mock("@/app/view/term/term-settings-menu", () => ({
    CLI_LAYOUT_PRESETS: [{ key: "2", label: "两分屏", rows: 1, cols: 2 }],
    addPathToCliLayoutPreset: vi.fn().mockResolvedValue(undefined),
    buildFavoriteLaunchMenuItems: vi.fn(() => [{ label: "共享收藏菜单", click: vi.fn() }]),
    buildOpenWithAiMenuItems: vi.fn(() => [{ label: "共享 AI 打开", click: vi.fn() }]),
    buildSharedTermContextMenuItems: buildSharedTermContextMenuItemsMock,
    buildSharedTermSettingsMenuItems: buildSharedTermSettingsMenuItemsMock,
    getCliLayoutPresetLabel: vi.fn((preset: { label: string }) => preset.label),
    makeUnavailableMenuItem: vi.fn((label: string, sublabel: string) => ({
        label,
        sublabel,
        enabled: false,
    })),
}));

vi.mock("@/app/block/blockutil", () => ({
    blockViewToName: () => "终端",
}));

vi.mock("@/app/block/blockframe-header", () => ({
    buildBlockFrameContextMenuItems: vi.fn(() => [{ label: "块级框架菜单项", click: vi.fn() }]),
}));

vi.mock("@/app/element/markdown", () => ({
    Markdown: () => null,
}));

vi.mock("@/app/element/typingindicator", () => ({
    TypingIndicator: () => null,
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

vi.mock("@/app/aipanel/waveai-model", () => ({
    WaveAIModel: {
        getInstance: () => ({
            currentAIMode: atom("waveai@balanced"),
            aiModeConfigs: atom({
                "waveai@balanced": {
                    "display:name": "平衡模式",
                    "display:order": 0,
                    "ai:model": "gpt-5.4",
                },
            }),
            setAIMode: setAIModeMock,
        }),
    },
}));

vi.mock("@/app/store/contextmenu", () => ({
    ContextMenuModel: {
        showContextMenu: vi.fn(),
    },
}));

vi.mock("@/app/store/global", () => ({
    atoms: {
        settingsAtom: atom({}),
        fullConfigAtom: atom({
            termthemes: {
                default: {
                    "display:order": 0,
                    "display:name": "Default Dark",
                },
            },
        }),
    },
    createBlock: vi.fn(),
    createBlockSplitHorizontally: vi.fn(),
    createBlockSplitVertically: vi.fn(),
    fetchWaveFile: vi.fn(),
    getApi: getApiMock,
    getBlockMetaKeyAtom: vi.fn(() => atom(null)),
    getConnStatusAtom: vi.fn(() => atom(null)),
    getLocalHostDisplayNameAtom: vi.fn(() => atom("本机")),
    getOverrideConfigAtom: vi.fn(() => atom(null)),
    getSettingsKeyAtom: vi.fn(() => atom(undefined)),
    globalStore: {
        get: vi.fn((targetAtom) => defaultJotaiStore.get(targetAtom)),
        set: vi.fn((targetAtom, value) => defaultJotaiStore.set(targetAtom, value)),
    },
    pushNotification: vi.fn(),
    useBlockAtom: vi.fn(),
    WOS: {
        getWaveObjectAtom: vi.fn(() => atom({ meta: { view: "workbench" } } as any)),
        makeORef: vi.fn(),
    },
}));

vi.mock("@/app/store/services", () => ({
    BlockService: {
        SaveWaveAiData: vi.fn(),
    },
}));

vi.mock("@/app/store/wshclientapi", () => ({
    RpcApi: {
        BlockJobStatusCommand: vi.fn().mockResolvedValue(null),
        FileListCommand: vi.fn(),
        FileReadCommand: vi.fn(),
        FileWriteCommand: vi.fn(),
        SetMetaCommand: vi.fn(),
    },
}));

vi.mock("@/app/store/wshrpcutil", () => ({
    TabRpcClient: {},
}));

vi.mock("@/app/store/wps", () => ({
    waveEventSubscribeSingle: vi.fn(() => vi.fn()),
}));

vi.mock("@/util/composition-input", () => ({
    useCompositionSafeTextarea: useCompositionSafeTextareaMock,
}));

vi.mock("@/util/clilayout", () => ({
    openCliLayoutInNewTab: vi.fn(),
}));

vi.mock("@/util/keyutil", () => ({
    checkKeyPressed: vi.fn(),
}));

vi.mock("@/util/launchcwd", () => ({
    getTerminalDisplayCwd: vi.fn((meta?: Record<string, any>) => {
        const candidates = [
            String(meta?.["term:displaycwd"] ?? "").trim(),
            String(meta?.["display:launchcwd"] ?? "").trim(),
            String(meta?.["cmd:cwd"] ?? "").trim(),
            String(meta?.cwd ?? "").trim(),
        ];
        return candidates.find((value) => value.length > 0) ?? "";
    }),
    getTerminalInheritableCwd: vi.fn(() => ""),
}));

vi.mock("@/util/platformutil", () => ({
    isWindows: vi.fn(() => true),
}));

vi.mock("@/util/util", () => ({
    fireAndForget: vi.fn(),
    isBlank: (value?: string) => value == null || value.trim() === "",
    isLocalConnName: vi.fn(),
    isWslConnName: vi.fn(),
    mergeMeta: (...values: Array<Record<string, unknown> | null | undefined>) => Object.assign({}, ...values),
    sortByDisplayOrder: (
        left: { "display:order"?: number | string },
        right: { "display:order"?: number | string }
    ) => Number(left?.["display:order"] ?? 0) - Number(right?.["display:order"] ?? 0),
}));

vi.mock("../term/termutil", () => ({
    computeTheme: () => [{}, "#000"],
    DefaultTermTheme: "default",
}));

vi.mock("../workbench-mode", () => ({
    getTraditionalView: (meta?: Record<string, any> | null) => {
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
    },
    setWorkbenchMode: vi.fn(),
}));

const {
    DEFAULT_WORKBENCH_DRAWER_SECTION,
    THINKING_LEVEL_OPTIONS,
    WORKBENCH_DRAWER_CONTROL_NOTES,
    WORKBENCH_CODEX_AUTH_PATH,
    applyWorkbenchAiPreferenceUpdate,
    buildWorkbenchPersistedHistory,
    buildWorkbenchSendPrompt,
    buildWorkbenchAIModeOptions,
    buildWorkbenchBlockMeta,
    buildWorkbenchSourceMetaFromPickedPath,
    makeWorkbenchBlockDef,
    canResumeWorkbenchAutoFollowAfterInactivity,
    createWorkbenchBlockFromPickedDirectory,
    createWorkbenchAiPreferenceUpdate,
    discoverWorkbenchRuntimeModelOptions,
    deriveWorkbenchTaskPanelData,
    deriveWorkbenchLspPanelData,
    extractStructuredTodoItems,
    getWorkbenchAIModeDisplayName,
    getWorkbenchHeaderSummary,
    getThinkingLevelLabel,
    limitWorkbenchPromptHistory,
    mergeWorkbenchPinnedModelOptions,
    normalizeWorkbenchDrawerSection,
    normalizeWorkbenchModel,
    normalizeWorkbenchThinkingLevel,
    persistWorkbenchAiPreferenceConfig,
    resolveWorkbenchCodexPreferenceSnapshotFromConfigText,
    resolveWorkbenchDisplayedThinkingLevel,
    resolveWorkbenchInitialHistoryState,
    resolveWorkbenchPreferredModelOptions,
    resolveWorkbenchAIModeState,
    resolveWorkbenchComposerPrimaryStatusItems,
    resolveWorkbenchModelOptions,
    resolveWorkbenchMetaRepairPatch,
    resolveWorkbenchPickDirectoryDefaultPath,
    resolveWorkbenchPickedDirectoryPath,
    resolveWorkbenchSpeechPayload,
    resolveWorkbenchWorkspacePath,
    restoreWorkbenchHistoryState,
    shouldRestoreWorkbenchCodexSession,
    updateWorkbenchCodexConfigText,
    WORKBENCH_CODEX_CONFIG_PATH,
} = await import("../workbench");
const { WorkbenchViewModel } = await import("../workbench");
const { WOS } = await import("@/app/store/global");
const { RpcApi } = await import("@/app/store/wshclientapi");
const { waveEventSubscribeSingle } = await import("@/app/store/wps");
const util = await import("@/util/util");

vi.mocked(util.isLocalConnName).mockImplementation((value?: string) => {
    const normalized = String(value ?? "").trim();
    return normalized === "" || normalized === "local";
});
vi.mocked(util.isWslConnName).mockImplementation((value?: string) => String(value ?? "").startsWith("wsl://"));

function encodeTextToBase64(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

function decodeTextFromBase64(value: string): string {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

describe("workbench scroll follow logic", () => {
    it("treats near-bottom viewport as still following latest output", () => {
        expect(getWorkbenchDistanceFromBottom(500, 300, 200)).toBe(0);
        expect(isWorkbenchViewportNearBottom(500, 292, 200)).toBe(true);
        expect(isWorkbenchViewportNearBottom(500, 291, 200)).toBe(
            WorkbenchBottomFollowThresholdPx >= 9
        );
    });

    it("keeps manual upward scrolling detached until the viewport returns to the exact bottom", () => {
        expect(resolveWorkbenchFollowLatestState(500, 260, 200, true)).toEqual({
            followLatestOutput: false,
            manuallyDetached: true,
        });
        expect(resolveWorkbenchFollowLatestState(900, 260, 200, true)).toEqual({
            followLatestOutput: false,
            manuallyDetached: true,
        });
        expect(resolveWorkbenchFollowLatestState(500, 300, 200, true)).toEqual({
            followLatestOutput: true,
            manuallyDetached: false,
        });
    });
});

describe("workbench composer option guards", () => {
    it("defaults the right drawer to settings so model and reasoning stay visible on open", () => {
        expect(DEFAULT_WORKBENCH_DRAWER_SECTION).toBe("settings");
        expect(normalizeWorkbenchDrawerSection(undefined)).toBe("settings");
        expect(normalizeWorkbenchDrawerSection("task")).toBe("task");
        expect(normalizeWorkbenchDrawerSection("settings")).toBe("settings");
        expect(normalizeWorkbenchDrawerSection("integrations")).toBe("integrations");
        expect(normalizeWorkbenchDrawerSection("unknown-panel")).toBe("settings");
    });

    it("derives cloud model options from loaded wave modes instead of a hardcoded fallback", () => {
        expect(
            resolveWorkbenchModelOptions(
                "auto",
                true,
                { "ai:model": "gpt-5.1" } as any,
                {
                    "waveai@quick": {
                        "display:name": "Quick",
                        "display:order": -2,
                        "ai:model": "gpt-5-mini",
                        "ai:provider": "wave",
                    },
                    "waveai@balanced": {
                        "display:name": "Balanced",
                        "display:order": -1,
                        "ai:model": "gpt-5.1",
                        "ai:provider": "wave",
                    },
                    "waveai@latest": {
                        "display:name": "Latest",
                        "display:order": 0,
                        "ai:model": "gpt-5.2",
                        "ai:provider": "wave",
                    },
                    "custom@deepseek": {
                        "display:name": "DeepSeek",
                        "display:order": 1,
                        "ai:model": "deepseek-chat",
                        "ai:provider": "custom",
                    },
                },
                {
                    "ai:model": "gpt-5.1",
                    "ai:provider": "wave",
                }
            )
        ).toEqual({
            options: ["gpt-5-mini", "gpt-5.2"],
            sourceLabel: "Wave AI 已加载模式",
        });
        expect(normalizeWorkbenchModel("gpt-5.1", ["gpt-5-mini", "gpt-5.2"])).toBe("");
        expect(normalizeWorkbenchModel("gpt-5.2", ["gpt-5-mini", "gpt-5.2"])).toBe("gpt-5.2");
        expect(normalizeWorkbenchModel("claude-sonnet-4.5", ["gpt-5-mini", "gpt-5.2"])).toBe("");
    });

    it("keeps manual endpoint model options on the minimal trusted config set", () => {
        expect(
            resolveWorkbenchModelOptions(
                "manual",
                false,
                {
                    "ai:model": "deepseek-chat",
                    "ai:provider": "custom",
                    "ai:apitype": "openai-chat",
                    "ai:baseurl": "https://api.example.com/v1",
                } as any,
                {
                    precise: {
                        "display:name": "Precise",
                        "display:order": 1,
                        "ai:model": "deepseek-reasoner",
                        "ai:provider": "custom",
                        "ai:apitype": "openai-chat",
                        "ai:endpoint": "https://api.example.com/v1",
                    },
                    fallback: {
                        "display:name": "Fallback",
                        "display:order": 2,
                        "ai:model": "gpt-4.1",
                        "ai:provider": "openai",
                    },
                },
                {
                    "ai:model": "deepseek-reasoner",
                    "ai:provider": "custom",
                    "ai:apitype": "openai-chat",
                    "ai:endpoint": "https://api.example.com/v1",
                }
            )
        ).toEqual({
            options: ["deepseek-reasoner", "deepseek-chat"],
            sourceLabel: "当前模式 / 预设配置（手动端点未探测）",
        });
    });

    it("prefers runtime endpoint models when codex provider discovery succeeds", async () => {
        const runtimeState = await discoverWorkbenchRuntimeModelOptions(
            {
                endpointMode: "auto",
                manualBaseUrl: "",
                fallbackBaseUrl: "",
                apiToken: "",
            },
            {
                readFileText: vi.fn(async (path: string) => {
                    if (path === WORKBENCH_CODEX_CONFIG_PATH) {
                        return [
                            'model_provider = "custom"',
                            "",
                            "[model_providers.custom]",
                            'base_url = "http://192.204.35.73:8080/v1"',
                            'wire_api = "responses"',
                            "requires_openai_auth = true",
                        ].join("\n");
                    }
                    if (path === WORKBENCH_CODEX_AUTH_PATH) {
                        return JSON.stringify({
                            OPENAI_API_KEY: "sk-runtime-token",
                        });
                    }
                    throw new Error(`unexpected path: ${path}`);
                }),
                fetchImpl: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
                    expect(String(input)).toBe("http://192.204.35.73:8080/v1/models");
                    expect(init?.headers).toEqual(
                        expect.objectContaining({
                            Accept: "application/json",
                            Authorization: "Bearer sk-runtime-token",
                        })
                    );
                    const payload = {
                        data: [
                            { id: "gpt-5.1" },
                            { id: "gpt-5.1-codex" },
                            { id: "gpt-5.2" },
                            { id: "gpt-5.2-codex" },
                            { id: "gpt-5.2-pro" },
                            { id: "gpt-5.3-codex" },
                            { id: "gpt-5.3-codex-spark" },
                            { id: "gpt-5.4" },
                            { id: "deepseek-chat" },
                        ],
                    };
                    return {
                        ok: true,
                        headers: {
                            get: (name: string) => (name.toLowerCase() === "content-type" ? "application/json" : null),
                        },
                        text: async () => JSON.stringify(payload),
                    } as Response;
                }),
            }
        );

        const fallbackState = resolveWorkbenchModelOptions(
            "auto",
            false,
            { "ai:model": "gpt-5-mini" } as any,
            {
                balanced: {
                    "display:name": "Balanced",
                    "display:order": 1,
                    "ai:model": "gpt-5-mini",
                    "ai:provider": "wave",
                },
            },
            {
                "ai:model": "gpt-5-mini",
                "ai:provider": "wave",
            }
        );

        expect(runtimeState).toEqual({
            options: [
                "gpt-5.2",
                "gpt-5.2-codex",
                "gpt-5.2-pro",
                "gpt-5.3-codex",
                "gpt-5.3-codex-spark",
                "gpt-5.4",
                "deepseek-chat",
            ],
            sourceLabel: "Codex custom 实时探测",
            requestOverride: {
                baseurl: "http://192.204.35.73:8080/v1",
                apitoken: "sk-runtime-token",
                apitype: "openai-responses",
            },
        });
        expect(resolveWorkbenchPreferredModelOptions(runtimeState, fallbackState)).toEqual(runtimeState);
    });

    it("keeps provider requestOverride and visible fallback options when runtime endpoint discovery fails", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            const runtimeState = await discoverWorkbenchRuntimeModelOptions(
                {
                    endpointMode: "auto",
                    manualBaseUrl: "",
                    fallbackBaseUrl: "",
                    apiToken: "",
                },
                {
                    readFileText: vi.fn(async (path: string) => {
                        if (path === WORKBENCH_CODEX_CONFIG_PATH) {
                            return [
                                'model_provider = "custom"',
                                "",
                                "[model_providers.custom]",
                                'base_url = "http://192.204.35.73:8080/v1"',
                                'wire_api = "responses"',
                                "requires_openai_auth = true",
                            ].join("\n");
                        }
                        if (path === WORKBENCH_CODEX_AUTH_PATH) {
                            return JSON.stringify({
                                OPENAI_API_KEY: "sk-runtime-token",
                            });
                        }
                        throw new Error(`unexpected path: ${path}`);
                    }),
                    fetchImpl: vi.fn(async () => {
                        throw new Error("network failed");
                    }),
                }
            );

            const fallbackState = resolveWorkbenchModelOptions(
                "manual",
                false,
                {
                    "ai:model": "deepseek-chat",
                    "ai:provider": "custom",
                    "ai:apitype": "openai-chat",
                    "ai:baseurl": "https://api.example.com/v1",
                } as any,
                {
                    precise: {
                        "display:name": "Precise",
                        "display:order": 1,
                        "ai:model": "deepseek-reasoner",
                        "ai:provider": "custom",
                        "ai:apitype": "openai-chat",
                        "ai:endpoint": "https://api.example.com/v1",
                    },
                },
                {
                    "ai:model": "deepseek-reasoner",
                    "ai:provider": "custom",
                    "ai:apitype": "openai-chat",
                    "ai:endpoint": "https://api.example.com/v1",
                }
            );

            expect(runtimeState).toEqual({
                options: ["gpt-5.2", "gpt-5.2-codex", "gpt-5.2-pro", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.4"],
                sourceLabel: "Codex custom 运行时路由（/models 探测失败，回退到允许模型列表）",
                requestOverride: {
                    baseurl: "http://192.204.35.73:8080/v1",
                    apitoken: "sk-runtime-token",
                    apitype: "openai-responses",
                },
            });
            expect(resolveWorkbenchPreferredModelOptions(runtimeState, fallbackState)).toEqual(runtimeState);
        } finally {
            warnSpy.mockRestore();
        }
    });

    it("keeps the config.toml model pinned even when fallback options come from the current mode", () => {
        const fallbackState = resolveWorkbenchModelOptions(
            "auto",
            false,
            { "ai:model": "gpt-5-mini" } as any,
            {
                balanced: {
                    "display:name": "Balanced",
                    "display:order": 1,
                    "ai:model": "gpt-5-mini",
                    "ai:provider": "wave",
                },
            },
            {
                "ai:model": "gpt-5-mini",
                "ai:provider": "wave",
            }
        );

        const effectiveOptions = mergeWorkbenchPinnedModelOptions(fallbackState.options, ["gpt-5.4"]);

        expect(fallbackState.options).toEqual(["gpt-5-mini"]);
        expect(effectiveOptions).toEqual(["gpt-5.4", "gpt-5-mini"]);
        expect(normalizeWorkbenchModel("gpt-5.4", effectiveOptions)).toBe("gpt-5.4");
    });

    it("does not let mode fallback replace an explicit config.toml model on startup", () => {
        const startupOptions = mergeWorkbenchPinnedModelOptions(["gpt-5-mini"], ["gpt-5.4"]);
        const configuredModel = normalizeWorkbenchModel("gpt-5.4", startupOptions);

        expect(configuredModel).toBe("gpt-5.4");
        expect(configuredModel).not.toBe("gpt-5-mini");
    });

    it("treats HTML runtime discovery responses as non-discoverable instead of parsing them as JSON", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            const runtimeState = await discoverWorkbenchRuntimeModelOptions(
                {
                    endpointMode: "auto",
                    manualBaseUrl: "",
                    fallbackBaseUrl: "",
                    apiToken: "",
                },
                {
                    readFileText: vi.fn(async (path: string) => {
                        if (path === WORKBENCH_CODEX_CONFIG_PATH) {
                            return [
                                'model_provider = "custom"',
                                "",
                                "[model_providers.custom]",
                                'base_url = "https://cdn-gmn.chuangzuoli.com"',
                                'wire_api = "responses"',
                                "requires_openai_auth = true",
                            ].join("\n");
                        }
                        if (path === WORKBENCH_CODEX_AUTH_PATH) {
                            return JSON.stringify({
                                OPENAI_API_KEY: "sk-runtime-token",
                            });
                        }
                        throw new Error(`unexpected path: ${path}`);
                    }),
                    fetchImpl: vi.fn(async () => {
                        return {
                            ok: true,
                            headers: {
                                get: (name: string) => (name.toLowerCase() === "content-type" ? "text/html; charset=utf-8" : null),
                            },
                            text: async () => "<!doctype html><html></html>",
                        } as Response;
                    }),
                }
            );

            expect(runtimeState).toEqual({
                options: ["gpt-5.2", "gpt-5.2-codex", "gpt-5.2-pro", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.4"],
                sourceLabel: "Codex custom 运行时路由（/models 响应无效，回退到允许模型列表）",
                requestOverride: {
                    baseurl: "https://cdn-gmn.chuangzuoli.com",
                    apitoken: "sk-runtime-token",
                    apitype: "openai-responses",
                },
            });
            expect(warnSpy).toHaveBeenCalledWith(
                "failed to discover workbench runtime models",
                expect.objectContaining({
                    message: expect.stringContaining("expected JSON from https://cdn-gmn.chuangzuoli.com/models"),
                })
            );
        } finally {
            warnSpy.mockRestore();
        }
    });

    it("prefers config.toml provider base_url and auth.json token over window fallback values when /models returns 401", async () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            const runtimeState = await discoverWorkbenchRuntimeModelOptions(
                {
                    endpointMode: "auto",
                    manualBaseUrl: "",
                    fallbackBaseUrl: "http://192.204.35.73:8080/v1",
                    apiToken: "sk-window-token",
                },
                {
                    readFileText: vi.fn(async (path: string) => {
                        if (path === WORKBENCH_CODEX_CONFIG_PATH) {
                            return [
                                'model_provider = "custom"',
                                "",
                                "[model_providers.custom]",
                                'base_url = "https://nowcoding.ai/v1"',
                                'wire_api = "responses"',
                                "requires_openai_auth = true",
                            ].join("\n");
                        }
                        if (path === WORKBENCH_CODEX_AUTH_PATH) {
                            return JSON.stringify({
                                OPENAI_API_KEY: "sk-auth-token",
                            });
                        }
                        throw new Error(`unexpected path: ${path}`);
                    }),
                    fetchImpl: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
                        expect(String(input)).toBe("https://nowcoding.ai/v1/models");
                        expect(init?.headers).toEqual(
                            expect.objectContaining({
                                Accept: "application/json",
                                Authorization: "Bearer sk-auth-token",
                            })
                        );
                        return {
                            ok: false,
                            status: 401,
                        } as Response;
                    }),
                }
            );

            expect(runtimeState).toEqual({
                options: ["gpt-5.2", "gpt-5.2-codex", "gpt-5.2-pro", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.4"],
                sourceLabel: "Codex custom 运行时路由（/models 401，回退到允许模型列表）",
                requestOverride: {
                    baseurl: "https://nowcoding.ai/v1",
                    apitoken: "sk-auth-token",
                    apitype: "openai-responses",
                },
            });
        } finally {
            warnSpy.mockRestore();
        }
    });

    it("only exposes high/xhigh in the visible thinking level allowlist", () => {
        expect(THINKING_LEVEL_OPTIONS.map((item) => item.value)).toEqual(["high", "xhigh"]);
        expect(normalizeWorkbenchThinkingLevel("minimal")).toBe("low");
        expect(normalizeWorkbenchThinkingLevel("xhigh")).toBe("xhigh");
        expect(THINKING_LEVEL_OPTIONS.map((item) => item.label)).toEqual(["高", "极高"]);
        expect(getThinkingLevelLabel("xhigh")).toBe("极高");
    });

    it("keeps the input primary bar focused on send state and real connection status", () => {
        expect(
            resolveWorkbenchComposerPrimaryStatusItems({
                sending: false,
                connectionStatusLabel: "本机就绪",
            })
        ).toEqual(["准备发送", "本机就绪"]);
        expect(
            resolveWorkbenchComposerPrimaryStatusItems({
                sending: true,
                connectionStatusLabel: "已连接",
                agentLabels: ["@planner", "@reviewer", "@planner"],
            })
        ).toEqual(["AI 正在工作", "已连接", "代理：@planner、@reviewer"]);
    });
});

describe("workbench ai mode state", () => {
    it("builds mode options from real config order and existing display-name fallback rules", () => {
        expect(
            buildWorkbenchAIModeOptions({
                precise: {
                    "display:name": "精确修复",
                    "display:order": 2,
                    "display:description": "适合需要稳定工具链和更强推理的任务。",
                    "ai:model": "gpt-5.3-codex",
                },
                custom: {
                    "display:order": 1,
                    "ai:model": "deepseek-chat",
                    "ai:provider": "custom",
                },
            })
        ).toEqual([
            {
                value: "custom",
                label: "deepseek-chat (custom)",
                description: "",
            },
            {
                value: "precise",
                label: "精确修复",
                description: "适合需要稳定工具链和更强推理的任务。",
            },
        ]);
    });

    it("uses display:name first and falls back to model/provider when needed", () => {
        expect(
            getWorkbenchAIModeDisplayName({
                "display:name": "精确修复",
                "ai:model": "gpt-5.3-codex",
                "ai:provider": "openai",
            })
        ).toBe("精确修复");

        expect(
            getWorkbenchAIModeDisplayName({
                "display:name": "",
                "ai:model": "deepseek-chat",
                "ai:provider": "custom",
            })
        ).toBe("deepseek-chat (custom)");
    });

    it("surfaces available modes in display order and keeps invalid current mode explicit", () => {
        const state = resolveWorkbenchAIModeState("missing-mode", {
            quick: {
                "display:name": "快速模式",
                "display:order": 2,
                "ai:model": "gpt-5.2",
            },
            precise: {
                "display:name": "精确修复",
                "display:order": 1,
                "display:description": "适合需要稳定工具链和更强推理的任务。",
                "ai:model": "gpt-5.3-codex",
            },
        });

        expect(state.hasAvailableModes).toBe(true);
        expect(state.selectValue).toBe("__invalid__");
        expect(state.currentModeLabel).toBe("当前模式不可用（missing-mode）");
        expect(state.currentModeDescription).toBe("已加载 2 个可用工作模式，请重新选择。");
        expect(state.modeOptions).toEqual([
            {
                value: "precise",
                label: "精确修复",
                description: "适合需要稳定工具链和更强推理的任务。",
            },
            {
                value: "quick",
                label: "快速模式",
                description: "",
            },
        ]);
    });

    it("falls back to an explicit empty state when no mode config is available", () => {
        const state = resolveWorkbenchAIModeState("missing-mode", {});

        expect(state.hasAvailableModes).toBe(false);
        expect(state.selectValue).toBe("__empty__");
        expect(state.currentModeLabel).toBe("暂无可用模式");
        expect(state.currentModeDescription).toBe("当前未发现可切换的工作模式。");
        expect(state.modeOptions).toEqual([]);
    });
});

describe("workbench ai preference persistence", () => {
    it("reads ordinary and plan reasoning directly from config.toml text", () => {
        expect(
            resolveWorkbenchCodexPreferenceSnapshotFromConfigText(
                ['model = "gpt-5.4"', 'model_reasoning_effort = "low"', 'plan_mode_reasoning_effort = "xhigh"'].join("\n")
            )
        ).toEqual({
            model: "gpt-5.4",
            modelReasoningEffort: "low",
            planModeReasoningEffort: "xhigh",
        });
    });

    it("keeps reasoning empty when config.toml does not declare it instead of inventing a preset fallback", () => {
        expect(resolveWorkbenchCodexPreferenceSnapshotFromConfigText('model = "gpt-5.4"')).toEqual({
            model: "gpt-5.4",
            modelReasoningEffort: "",
            planModeReasoningEffort: "",
        });
    });

    it("only uses top-level model_reasoning_effort for the startup display", () => {
        expect(
            resolveWorkbenchDisplayedThinkingLevel({
                modelReasoningEffort: "",
                planModeReasoningEffort: "xhigh",
            } as any)
        ).toBe("");
        expect(
            resolveWorkbenchDisplayedThinkingLevel({
                modelReasoningEffort: "xhigh",
                planModeReasoningEffort: "",
            } as any)
        ).toBe("xhigh");
        expect(
            resolveWorkbenchDisplayedThinkingLevel({
                modelReasoningEffort: "low",
                planModeReasoningEffort: "xhigh",
            } as any)
        ).toBe("");
    });

    it("keeps the startup reasoning selection empty before config.toml loads", () => {
        expect(resolveWorkbenchDisplayedThinkingLevel(null)).toBe("");
        expect(
            resolveWorkbenchDisplayedThinkingLevel({
                modelReasoningEffort: "",
            })
        ).toBe("");
    });

    it("builds model updates for both config.toml defaults and block meta", () => {
        expect(createWorkbenchAiPreferenceUpdate("ai:model", "gpt-5.4")).toEqual({
            configFiles: [{ key: "model", value: "gpt-5.4" }],
            meta: { "ai:model": "gpt-5.4" },
        });
    });

    it("builds thinking level updates for both config.toml defaults and block meta", () => {
        expect(createWorkbenchAiPreferenceUpdate("ai:thinkinglevel", "xhigh")).toEqual({
            configFiles: [
                { key: "model_reasoning_effort", value: "xhigh" },
                { key: "plan_mode_reasoning_effort", value: "xhigh" },
            ],
            meta: { "ai:thinkinglevel": "xhigh", "ai:planthinkinglevel": "xhigh" },
        });
    });

    it("persists model updates through both config and meta writers", async () => {
        const persistConfig = vi.fn().mockResolvedValue(undefined);
        const persistMeta = vi.fn().mockResolvedValue(undefined);

        await applyWorkbenchAiPreferenceUpdate(createWorkbenchAiPreferenceUpdate("ai:model", "gpt-5.3-codex"), {
            persistConfig,
            persistMeta,
        });

        expect(persistConfig).toHaveBeenCalledTimes(1);
        expect(persistConfig).toHaveBeenCalledWith({ key: "model", value: "gpt-5.3-codex" });
        expect(persistMeta).toHaveBeenCalledWith({ "ai:model": "gpt-5.3-codex" });
    });

    it("persists thinking level updates through both config and meta writers", async () => {
        const persistConfig = vi.fn().mockResolvedValue(undefined);
        const persistMeta = vi.fn().mockResolvedValue(undefined);

        await applyWorkbenchAiPreferenceUpdate(createWorkbenchAiPreferenceUpdate("ai:thinkinglevel", "high"), {
            persistConfig,
            persistMeta,
        });

        expect(persistConfig).toHaveBeenCalledTimes(2);
        expect(persistConfig).toHaveBeenNthCalledWith(1, { key: "model_reasoning_effort", value: "high" });
        expect(persistConfig).toHaveBeenNthCalledWith(2, { key: "plan_mode_reasoning_effort", value: "high" });
        expect(persistMeta).toHaveBeenCalledWith({ "ai:thinkinglevel": "high", "ai:planthinkinglevel": "high" });
    });

    it("replaces the top-level model without touching plan_mode_reasoning_effort", () => {
        const current = [
            'model = "gpt-5.4"',
            'plan_mode_reasoning_effort = "high"',
            '[profiles.default]',
            'model = "should-stay-scoped"',
        ].join("\n");

        expect(updateWorkbenchCodexConfigText(current, { key: "model", value: "gpt-5.3-codex" })).toBe(
            [
                'model = "gpt-5.3-codex"',
                'plan_mode_reasoning_effort = "high"',
                '[profiles.default]',
                'model = "should-stay-scoped"',
            ].join("\n")
        );
    });

    it("replaces the top-level model_reasoning_effort without touching plan_mode_reasoning_effort", () => {
        const current = [
            'model_reasoning_effort = "medium"',
            'plan_mode_reasoning_effort = "high"',
            "[profiles.default]",
        ].join("\n");

        expect(updateWorkbenchCodexConfigText(current, { key: "model_reasoning_effort", value: "xhigh" })).toBe(
            [
                'model_reasoning_effort = "xhigh"',
                'plan_mode_reasoning_effort = "high"',
                "[profiles.default]",
            ].join("\n")
        );
    });

    it("inserts missing top-level fields before the first section", () => {
        const current = ['telemetry = "off"', "", "[profiles.default]", 'model = "scoped"'].join("\n");

        expect(updateWorkbenchCodexConfigText(current, { key: "model", value: "gpt-5.2" })).toBe(
            ['telemetry = "off"', 'model = "gpt-5.2"', "", "[profiles.default]", 'model = "scoped"'].join("\n")
        );
        expect(updateWorkbenchCodexConfigText(current, { key: "model_reasoning_effort", value: "low" })).toBe(
            [
                'telemetry = "off"',
                'model_reasoning_effort = "low"',
                "",
                "[profiles.default]",
                'model = "scoped"',
            ].join("\n")
        );
    });

    it("ignores section-looking lines inside multiline strings when updating top-level codex defaults", () => {
        const current = [
            'developer_instructions = """',
            "[profiles.fake]",
            '"""',
            'plan_mode_reasoning_effort = "high"',
            "[profiles.default]",
        ].join("\n");

        expect(updateWorkbenchCodexConfigText(current, { key: "model_reasoning_effort", value: "xhigh" })).toBe(
            [
                'developer_instructions = """',
                "[profiles.fake]",
                '"""',
                'plan_mode_reasoning_effort = "high"',
                'model_reasoning_effort = "xhigh"',
                "[profiles.default]",
            ].join("\n")
        );
    });

    it("appends missing top-level fields when the file has no section", () => {
        const current = ['telemetry = "off"', 'plan_mode_reasoning_effort = "high"'].join("\n");

        expect(updateWorkbenchCodexConfigText(current, { key: "model_reasoning_effort", value: "medium" })).toBe(
            ['telemetry = "off"', 'plan_mode_reasoning_effort = "high"', 'model_reasoning_effort = "medium"'].join(
                "\n"
            )
        );
    });

    it("reads and writes the codex config through file commands", async () => {
        vi.mocked(RpcApi.FileReadCommand).mockResolvedValue({
            info: { path: WORKBENCH_CODEX_CONFIG_PATH },
            data64: encodeTextToBase64(['model = "gpt-5.4"', 'plan_mode_reasoning_effort = "high"'].join("\n")),
        });
        vi.mocked(RpcApi.FileWriteCommand).mockResolvedValue(undefined);

        await persistWorkbenchAiPreferenceConfig({ key: "model_reasoning_effort", value: "xhigh" });

        expect(RpcApi.FileReadCommand).toHaveBeenCalledWith({}, {
            info: { path: WORKBENCH_CODEX_CONFIG_PATH },
        });
        expect(RpcApi.FileWriteCommand).toHaveBeenCalledTimes(1);
        expect(RpcApi.FileWriteCommand).toHaveBeenCalledWith(
            {},
            expect.objectContaining({
                info: { path: WORKBENCH_CODEX_CONFIG_PATH },
            })
        );
        expect(
            decodeTextFromBase64(
                vi.mocked(RpcApi.FileWriteCommand).mock.calls[0]?.[1]?.data64 as string
            )
        ).toBe(['model = "gpt-5.4"', 'plan_mode_reasoning_effort = "high"', 'model_reasoning_effort = "xhigh"'].join("\n"));
    });
});

describe("workbench header summary", () => {
    it("stays empty so the shared header path label remains the only title source", () => {
        expect(
            getWorkbenchHeaderSummary({
                connection: "local",
                "term:displaycwd": "/workspace/app",
            } as any)
        ).toBe("");
    });
});

describe("workbench block meta inheritance", () => {
    it("inherits absolute path and connection fields from the source block", () => {
        expect(
            buildWorkbenchBlockMeta({
                connection: "local",
                "cmd:cwd": "E:/code/cx-workbench",
                "display:launchcwd": "E:/code/cx-workbench",
                "term:displaycwd": "E:/code/cx-workbench",
            } as any)
        ).toMatchObject({
            view: "workbench",
            "display:name": "工作台",
            connection: "local",
            "cmd:cwd": "E:/code/cx-workbench",
            "display:launchcwd": "E:/code/cx-workbench",
            "term:displaycwd": "E:/code/cx-workbench",
            cwd: "E:/code/cx-workbench",
        });
    });

    it("fills all shared workbench path fields when only launch cwd exists", () => {
        expect(
            buildWorkbenchBlockMeta({
                connection: "local",
                "display:launchcwd": "E:/code/waveterm-main",
            } as any)
        ).toMatchObject({
            view: "workbench",
            "display:name": "工作台",
            connection: "local",
            "cmd:cwd": "E:/code/waveterm-main",
            "display:launchcwd": "E:/code/waveterm-main",
            "term:displaycwd": "E:/code/waveterm-main",
            cwd: "E:/code/waveterm-main",
        });
    });

    it("defaults new workbench blocks to shell controller and returnview term", () => {
        expect(buildWorkbenchBlockMeta()).toMatchObject({
            view: "workbench",
            "display:name": "工作台",
            controller: "shell",
            "workbench:returnview": "term",
        });
    });

    it("keeps the normalized shell controller and returnview when splitting an existing workbench", () => {
        const sourceMeta = {
            view: "workbench",
            controller: "shell",
            "workbench:returnview": "preview",
            connection: "local",
            "cmd:cwd": "E:/code/cx-workbench",
        } as any;

        expect(makeWorkbenchBlockDef(sourceMeta).meta).toEqual(buildWorkbenchBlockMeta(sourceMeta));
        expect(makeWorkbenchBlockDef(sourceMeta).meta).toMatchObject({
            view: "workbench",
            "display:name": "工作台",
            controller: "shell",
            "workbench:returnview": "preview",
            connection: "local",
            "cmd:cwd": "E:/code/cx-workbench",
            "display:launchcwd": "E:/code/cx-workbench",
            "term:displaycwd": "E:/code/cx-workbench",
            cwd: "E:/code/cx-workbench",
        });
    });

    it("builds local source meta from a picked directory path before passing through the shared builder", () => {
        expect(buildWorkbenchSourceMetaFromPickedPath("E:/code/waveterm-main")).toEqual({
            view: "term",
            controller: "shell",
            connection: "local",
            "cmd:cwd": "E:/code/waveterm-main",
            "display:launchcwd": "E:/code/waveterm-main",
            "term:displaycwd": "E:/code/waveterm-main",
            cwd: "E:/code/waveterm-main",
        });
        expect(buildWorkbenchBlockMeta(buildWorkbenchSourceMetaFromPickedPath("E:/code/waveterm-main"))).toMatchObject({
            view: "workbench",
            "display:name": "工作台",
            controller: "shell",
            "workbench:returnview": "term",
            connection: "local",
            "cmd:cwd": "E:/code/waveterm-main",
            "display:launchcwd": "E:/code/waveterm-main",
            "term:displaycwd": "E:/code/waveterm-main",
            cwd: "E:/code/waveterm-main",
        });
    });

    it("sanitizes non-scalar controller and returnview metadata before reusing the current block source", () => {
        expect(
            buildWorkbenchBlockMeta({
                view: "workbench",
                controller: "System.Collections.Specialized.OrderedDictionary",
                "workbench:returnview": "System.Collections.Specialized.OrderedDictionary",
                connection: "local",
                "display:launchcwd": "E:/code/waveterm-main",
            } as any)
        ).toMatchObject({
            controller: "shell",
            "workbench:returnview": "term",
            connection: "local",
        });
    });

    it("builds a minimal repair patch for persisted workbench metadata polluted by OrderedDictionary values", () => {
        expect(
            resolveWorkbenchMetaRepairPatch({
                view: "workbench",
                controller: "System.Collections.Specialized.OrderedDictionary",
                "workbench:returnview": "System.Collections.Specialized.OrderedDictionary",
                "display:launchcwd": "E:/code/waveterm-main",
            } as any)
        ).toMatchObject({
            connection: "local",
            controller: "shell",
            "workbench:returnview": "term",
            "cmd:cwd": "E:/code/waveterm-main",
            "term:displaycwd": "E:/code/waveterm-main",
            cwd: "E:/code/waveterm-main",
        });
    });

    it("prefers the current local workbench path for the picker default and falls back to home for remote paths", () => {
        expect(
            resolveWorkbenchPickDirectoryDefaultPath(
                {
                    connection: "local",
                    "term:displaycwd": "E:/code/waveterm-main",
                } as any,
                "C:/Users/baba1"
            )
        ).toBe("E:/code/waveterm-main");
        expect(
            resolveWorkbenchPickDirectoryDefaultPath(
                {
                    connection: "ssh://devbox",
                    "term:displaycwd": "/srv/project",
                } as any,
                "C:/Users/baba1"
            )
        ).toBe("C:/Users/baba1");
    });

    it("normalizes picker results and creates new workbench blocks through buildWorkbenchBlockMeta", async () => {
        const pickDirectory = vi.fn().mockResolvedValue({
            canceled: false,
            filePaths: ["E:/code/selected-workbench"],
        });
        const createBlockSpy = vi.fn();

        await expect(
            createWorkbenchBlockFromPickedDirectory(
                {
                    connection: "local",
                    "term:displaycwd": "E:/code/waveterm-main",
                } as any,
                {
                    pickDirectory,
                    getHomeDir: () => "C:/Users/baba1",
                    createBlock: createBlockSpy,
                }
            )
        ).resolves.toBe(true);

        expect(resolveWorkbenchPickedDirectoryPath("E:/code/direct-string")).toBe("E:/code/direct-string");
        expect(resolveWorkbenchPickedDirectoryPath({ canceled: false, path: "E:/code/from-path-field" })).toBe(
            "E:/code/from-path-field"
        );
        expect(pickDirectory).toHaveBeenCalledWith({
            title: "选择路径",
            defaultPath: "E:/code/waveterm-main",
        });
        expect(createBlockSpy).toHaveBeenCalledWith({
            meta: buildWorkbenchBlockMeta(buildWorkbenchSourceMetaFromPickedPath("E:/code/selected-workbench")),
        });
    });
});

describe("workbench workspace path display", () => {
    it("prefers term:displaycwd over display:launchcwd", () => {
        expect(
            resolveWorkbenchWorkspacePath({
                "term:displaycwd": "/term/project",
                "display:launchcwd": "/launch/project",
            })
        ).toBe("/term/project");
    });
});

describe("workbench lsp panel", () => {
    it("builds clear lsp status for ssh workspaces without pretending remote lsp is already wired", () => {
        const panel = deriveWorkbenchLspPanelData({
            connectionInfo: {
                kind: "ssh",
                kindLabel: "SSH",
                title: "devbox",
                subtitle: "SSH · devbox · 已连接，WSH未启用",
                footerLabel: "root@10.0.0.8",
                hostDisplay: "10.0.0.8",
                userDisplay: "root",
                proxyJumpDisplay: "",
                wshDisplay: "未启用",
                statusLabel: "已连接，WSH未启用",
                healthClassName: "is-checking",
                badgeClassName: "is-warn",
            },
            messages: [
                {
                    id: "assistant-1710000000000",
                    role: "assistant",
                    content: "最后结论：可以继续接线。",
                    timestamp: "now",
                },
            ],
            model: "gpt-5.4",
            thinkingLabel: "极高",
            timeoutMs: 60000,
            traditionalViewName: "终端",
            workbenchPath: "/srv/demo",
        });

        expect(panel.overviewItems).toContainEqual(["工作区路径", "/srv/demo"]);
        expect(panel.overviewItems).toContainEqual(["WSH 接线", "未启用"]);
        expect(panel.diagnosticsItems).toContainEqual(["诊断状态", "远端诊断待接线"]);
        expect(panel.diagnosticsItems[0]?.[1]).toContain("仍未就绪");
        expect(panel.capabilityItems.some((item) => item.label === "远端工程 LSP" && item.tone === "warn")).toBe(true);
        expect(panel.schemaItems.some((item) => item.label === "settings.json")).toBe(true);
    });
});

describe("workbench menu composition", () => {
    it("keeps the shared term helper settings-only by default", async () => {
        const { buildSharedTermSettingsMenuItems } = await vi.importActual<
            typeof import("@/app/view/term/term-settings-menu")
        >("@/app/view/term/term-settings-menu");

        const menu = buildSharedTermSettingsMenuItems({
            blockId: "block-1",
            blockData: {
                meta: {
                    view: "workbench",
                },
            } as any,
            includeFontSize: false,
            setTheme: vi.fn(),
        });
        const labels = menu
            .filter((item) => "label" in item && typeof item.label === "string")
            .map((item) => item.label as string);

        expect(labels).toContain("term.themes");
        expect(labels).toContain("term.transparency");
        expect(labels).not.toContain("term.newBlockInheritCwd");
        expect(labels).not.toContain("term.fileBrowser");
        expect(labels).not.toContain("Save Session As...");
    });

    it("routes both workbench menus through the shared term context skeleton and only adds workbench extras incrementally", () => {
        buildSharedTermSettingsMenuItemsMock.mockClear();
        buildSharedTermContextMenuItemsMock.mockClear();
        const model = new WorkbenchViewModel("block-1", { toggleMagnify: vi.fn() } as any, {} as any);
        const menu = model.getSettingsMenuItems();
        const labels = menu
            .filter((item) => "label" in item && typeof item.label === "string")
            .map((item) => item.label as string);

        expect(buildSharedTermContextMenuItemsMock).toHaveBeenCalledTimes(1);
        expect(buildSharedTermSettingsMenuItemsMock).toHaveBeenCalledWith(
            expect.objectContaining({
                blockId: "block-1",
                includeNewBlockInheritCwd: true,
                includeFileBrowser: true,
                includeFontSize: false,
            })
        );
        expect(buildSharedTermContextMenuItemsMock).toHaveBeenCalledWith(
            expect.objectContaining({
                workspaceItems: expect.arrayContaining([
                    expect.objectContaining({ label: "favorites.add" }),
                    expect.objectContaining({ label: "block.addToLayout" }),
                    expect.objectContaining({ label: "preview.openWithAi" }),
                ]),
                editItems: expect.arrayContaining([expect.objectContaining({ label: "ctx.paste" })]),
                blockItems: expect.arrayContaining([expect.objectContaining({ label: "term.reflowHistory" })]),
                settingsItems: expect.arrayContaining([expect.objectContaining({ label: "终端共享菜单项" })]),
            })
        );
        expect(labels).toContain("term.copySmartParagraph");
        expect(labels).toContain("favorites.add");
        expect(labels).toContain("block.addToLayout");
        expect(labels).toContain("preview.openWithAi");
        expect(labels).toContain("ctx.paste");
        expect(labels).toContain("终端共享菜单项");
        expect(labels).not.toContain("返回终端");
        expect(labels).not.toContain("切换右栏");
        expect(labels).not.toContain("打开任务抽屉");
        expect(labels).not.toContain("打开设置抽屉");
        expect(labels).not.toContain("打开工作区抽屉");
        expect(labels).not.toContain("打开状态抽屉");
        expect(labels).not.toContain("切换连接 / SSH");
        expect(labels).not.toContain("查看连接设置");

        model.dispose();
        vi.mocked(waveEventSubscribeSingle).mockClear();
        vi.mocked(RpcApi.BlockJobStatusCommand).mockClear();
    });

    it("routes the real workbench canvas context-menu entry through the workbench menu chain", () => {
        const source = readFileSync(new URL("../workbench.tsx", import.meta.url), "utf8");
        const handlerStart = source.indexOf("const handleWorkbenchContextMenu = useCallback(");
        const handlerEnd = source.indexOf("const send = async () => {", handlerStart);
        const handlerSource = source.slice(handlerStart, handlerEnd);

        expect(handlerStart).toBeGreaterThanOrEqual(0);
        expect(handlerEnd).toBeGreaterThan(handlerStart);
        expect(handlerSource).toContain("ContextMenuModel.showContextMenu(");
        expect(handlerSource).toContain("model.getSettingsMenuItems()");
        expect(handlerSource).not.toContain("buildBlockFrameContextMenuItems(");
    });
});

describe("workbench durable status wiring", () => {
    it("keeps drawer body copy aligned to the single header and shortcut control path", () => {
        expect(WORKBENCH_DRAWER_CONTROL_NOTES).toEqual([
            "Alt+S 收起或展开右栏。",
            "Alt+[ / Alt+] 调整右栏宽度。",
            "共享头部负责返回、分屏、连接与右栏开关。",
            "模型、推理与工作模式统一放在右栏设置，不在输入主条或菜单重复提供。",
            "右栏只负责任务、设置、集成、工作区与状态说明。",
        ]);
    });

    it("initializes block job status, listens for updates, and cleans up the subscription", async () => {
        const blockAtom = atom({
            meta: {
                view: "workbench",
                "term:durable": true,
            },
        } as any);
        const unsubscribe = vi.fn();
        const initialStatus = {
            jobid: "job-1",
            status: "connected",
            versionts: 2,
        } as any;
        vi.mocked(waveEventSubscribeSingle).mockClear();
        vi.mocked(RpcApi.BlockJobStatusCommand).mockClear();
        vi.mocked(WOS.getWaveObjectAtom).mockReturnValue(blockAtom as any);
        vi.mocked(RpcApi.BlockJobStatusCommand).mockResolvedValue(initialStatus);
        vi.mocked(waveEventSubscribeSingle).mockReturnValue(unsubscribe);

        const model = new WorkbenchViewModel("block-1", { toggleMagnify: vi.fn() } as any, {} as any);

        await Promise.resolve();
        await Promise.resolve();

        expect(RpcApi.BlockJobStatusCommand).toHaveBeenCalledWith({}, "block-1");
        expect(waveEventSubscribeSingle).toHaveBeenCalledWith(
            expect.objectContaining({
                eventType: "block:jobstatus",
                scope: "block:block-1",
            })
        );
        expect(getDefaultStore().get(model.termDurableStatus)).toMatchObject(initialStatus);

        const subscriptionConfig = vi.mocked(waveEventSubscribeSingle).mock.calls.at(-1)?.[0];
        subscriptionConfig?.handler?.({
            data: {
                jobid: "job-1",
                status: "done",
                versionts: 1,
            },
        });
        expect(getDefaultStore().get(model.termDurableStatus)).toMatchObject(initialStatus);

        subscriptionConfig?.handler?.({
            data: {
                jobid: "job-1",
                status: "done",
                versionts: 3,
            },
        });
        expect(getDefaultStore().get(model.termDurableStatus)).toMatchObject({
            jobid: "job-1",
            status: "done",
            versionts: 3,
        });

        model.dispose();

        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
});

describe("workbench task panel derivation", () => {
    it("extracts structured todos from checkboxes, todo labels, and next-step lines", () => {
        const todos = extractStructuredTodoItems([
            {
                id: "assistant-1",
                role: "assistant",
                content: ["## 待办", "- [ ] 补任务视图", "- [x] 对齐右栏文案", "行动项：跑 vitest"].join("\n"),
                timestamp: "10:00",
            },
            {
                id: "user-1",
                role: "user",
                content: "TODO: 保持 settings / status 不坏",
                timestamp: "10:01",
            },
        ] as any);

        expect(todos).toEqual([
            { text: "保持 settings / status 不坏", state: "pending", sourceLabel: "来自用户消息" },
            { text: "补任务视图", state: "pending", sourceLabel: "来自助手回复" },
            { text: "对齐右栏文案", state: "done", sourceLabel: "来自助手回复" },
            { text: "跑 vitest", state: "pending", sourceLabel: "来自助手回复" },
        ]);
    });

    it("derives current task, recent conclusion, and basic work status from the real message flow", () => {
        const panel = deriveWorkbenchTaskPanelData(
            [
                {
                    id: "user-1",
                    role: "user",
                    content: ["任务：给 workbench 补一个任务视图", "- [ ] 解析消息里的 TODO"].join("\n"),
                    timestamp: "10:00",
                },
                {
                    id: "assistant-1",
                    role: "assistant",
                    content: ["当前结论：先基于真实消息历史提取。", "下一步：补右栏状态卡。"].join("\n"),
                    timestamp: "10:01",
                },
            ] as any,
            {
                sending: false,
                modelLabel: "gpt-5.4",
                modeLabel: "精确修复",
                thinkingLabel: "medium",
                connectionLabel: "本机",
                connectionStatusLabel: "本机就绪",
            }
        );

        expect(panel.currentTask).toMatchObject({
            title: "给 workbench 补一个任务视图",
            sourceLabel: "最近一条用户消息",
        });
        expect(panel.recentConclusion).toMatchObject({
            title: "先基于真实消息历史提取。",
            sourceLabel: "最近一条助手回复",
            tone: "default",
        });
        expect(panel.statusLabel).toBe("最近一轮已有结论");
        expect(panel.statusItems).toContainEqual(["当前模式", "精确修复"]);
        expect(panel.statusItems).toContainEqual(["结构化待办", "2 条"]);
        expect(panel.todos).toEqual([
            { text: "补右栏状态卡。", state: "pending", sourceLabel: "来自助手回复" },
            { text: "解析消息里的 TODO", state: "pending", sourceLabel: "来自用户消息" },
        ]);
    });

    it("keeps the empty fallback explicit when no structured todo can be identified", () => {
        const panel = deriveWorkbenchTaskPanelData(
            [
                {
                    id: "user-1",
                    role: "user",
                    content: "帮我看看当前工作状态",
                    timestamp: "10:00",
                },
                {
                    id: "error-1",
                    role: "error",
                    content: "request timeout",
                    timestamp: "10:01",
                },
            ] as any,
            {
                sending: false,
                modelLabel: "gpt-5.4",
                modeLabel: "暂无可用工作模式",
                thinkingLabel: "medium",
                connectionLabel: "本机",
                connectionStatusLabel: "本机就绪",
            }
        );

        expect(panel.todos).toEqual([]);
        expect(panel.recentConclusion).toMatchObject({
            title: "request timeout",
            sourceLabel: "最近一次错误",
            tone: "error",
        });
        expect(panel.statusLabel).toBe("最近一次调用失败");
        expect(panel.statusItems).toContainEqual(["结构化待办", "暂未识别结构化待办"]);
    });
});

describe("workbench auto follow cooldown policy", () => {
    it("does not reattach after inactivity if the user is still reading above the bottom", () => {
        expect(canResumeWorkbenchAutoFollowAfterInactivity(900, 260, 200, true)).toBe(false);
    });

    it("allows reattaching after inactivity once the viewport is back near the bottom", () => {
        expect(
            canResumeWorkbenchAutoFollowAfterInactivity(
                500,
                500 - 200 - WorkbenchBottomFollowThresholdPx,
                200,
                true
            )
        ).toBe(true);
    });
});

describe("workbench speech payload", () => {
    it("publishes the latest completed assistant reply into shared speech state", () => {
        expect(
            resolveWorkbenchSpeechPayload([
                { id: "user-111111", role: "user", content: "你好" },
                { id: "assistant-222222", role: "assistant", content: "第一条完成回复" },
                { id: "assistant-333333", role: "assistant", content: "最新完成回复" },
            ] as any)
        ).toEqual({
            id: "workbench:assistant-333333",
            text: "最新完成回复",
            outputTs: 333333,
        });
    });

    it("ignores empty assistant content when publishing shared speech payload", () => {
        expect(
            resolveWorkbenchSpeechPayload([
                { id: "user-111111", role: "user", content: "你好" },
                { id: "assistant-222222", role: "assistant", content: "   " },
            ] as any)
        ).toBeNull();
    });
});

describe("workbench codex session restore guard", () => {
    it("allows restoring the current codex session only for local workbench blocks backed by term", () => {
        expect(
            shouldRestoreWorkbenchCodexSession(
                {
                    view: "workbench",
                    connection: "local",
                    "workbench:returnview": "term",
                } as any,
                "ready"
            )
        ).toBe(true);
        expect(
            shouldRestoreWorkbenchCodexSession(
                {
                    view: "workbench",
                    connection: "ssh://devbox",
                    "workbench:returnview": "term",
                } as any,
                "ready"
            )
        ).toBe(false);
        expect(
            shouldRestoreWorkbenchCodexSession(
                {
                    view: "workbench",
                    connection: "local",
                    "workbench:returnview": "preview",
                } as any,
                "ready"
            )
        ).toBe(false);
        expect(
            shouldRestoreWorkbenchCodexSession(
                {
                    view: "workbench",
                    connection: "local",
                    "workbench:returnview": "term",
                } as any,
                "running-command"
            )
        ).toBe(false);
    });
});

describe("workbench prompt history window", () => {
    it("does not apply a local hard cap when the context window is unset", () => {
        const history = [
            { role: "user", content: "1" },
            { role: "assistant", content: "2" },
            { role: "user", content: "3" },
            { role: "assistant", content: "4" },
        ] as any;

        expect(limitWorkbenchPromptHistory(history)).toEqual(history);
    });

    it("still supports an explicit window size when the caller wants one", () => {
        const history = [
            { role: "user", content: "1" },
            { role: "assistant", content: "2" },
            { role: "user", content: "3" },
            { role: "assistant", content: "4" },
        ] as any;

        expect(limitWorkbenchPromptHistory(history, 2)).toEqual(history.slice(-2));
    });

    it("filters persisted error roles and empty content before building the next send prompt", () => {
        expect(
            buildWorkbenchSendPrompt(
                [
                    { role: "system", content: "system" },
                    { role: "error", content: "upstream 502" },
                    { role: "assistant", content: "  " },
                    { role: "assistant", content: "still valid" },
                ] as any,
                { role: "user", content: "继续" }
            )
        ).toEqual([
            { role: "system", content: "system" },
            { role: "assistant", content: "still valid" },
            { role: "user", content: "继续" },
        ]);
    });

    it("does not persist error role messages back into aidata after a failed send", () => {
        expect(
            buildWorkbenchPersistedHistory(
                [
                    { role: "assistant", content: "历史回复" },
                    { role: "error", content: "旧错误" },
                ] as any,
                [{ role: "user", content: "重试一下" }] as any
            )
        ).toEqual([
            { role: "assistant", content: "历史回复" },
            { role: "user", content: "重试一下" },
        ]);
    });

    it("rewrites successful aidata saves from the sanitized history base", () => {
        expect(
            buildWorkbenchPersistedHistory(
                [
                    { role: "system", content: "系统提示" },
                    { role: "error", content: "旧错误" },
                    { role: "assistant", content: "" },
                    { role: "assistant", content: "旧回复" },
                ] as any,
                [
                    { role: "user", content: "新的问题" },
                    { role: "assistant", content: "新的答案" },
                ] as any
            )
        ).toEqual([
            { role: "system", content: "系统提示" },
            { role: "assistant", content: "旧回复" },
            { role: "user", content: "新的问题" },
            { role: "assistant", content: "新的答案" },
        ]);
    });

    it("keeps persisted workbench history hidden until the user explicitly restores it", () => {
        expect(
            resolveWorkbenchInitialHistoryState([
                { role: "assistant", content: "旧回复" },
                { role: "user", content: "旧问题" },
            ] as any)
        ).toMatchObject({
            hasRestorableHistory: true,
            hiddenHistory: [
                { role: "assistant", content: "旧回复" },
                { role: "user", content: "旧问题" },
            ],
            messages: [],
            persistedHistory: [],
        });
    });

    it("restores persisted workbench history into visible messages only on explicit restore", () => {
        const restored = restoreWorkbenchHistoryState([
            { role: "assistant", content: "旧回复" },
            { role: "error", content: "旧错误" },
            { role: "user", content: "旧问题" },
        ] as any);
        expect(restored.hasRestorableHistory).toBe(false);
        expect(restored.hiddenHistory).toEqual([]);
        expect(restored.persistedHistory).toEqual([
            { role: "assistant", content: "旧回复" },
            { role: "user", content: "旧问题" },
        ]);
        expect(restored.messages.map((item) => ({ role: item.role, content: item.content }))).toEqual([
            { role: "assistant", content: "旧回复" },
            { role: "user", content: "旧问题" },
        ]);
    });
});

describe("workbench auto follow resume controller", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("waits for 10 seconds of inactivity before resuming", () => {
        const onResume = vi.fn();
        const controller = new TerminalAutoFollowResumeController(onResume);

        controller.markActivity(true);
        vi.advanceTimersByTime(TerminalAutoFollowResumeDelayMs - 1);
        expect(onResume).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(onResume).toHaveBeenCalledTimes(1);
    });

    it("resets the countdown whenever new manual activity happens", () => {
        const onResume = vi.fn();
        const controller = new TerminalAutoFollowResumeController(onResume);

        controller.markActivity(true);
        vi.advanceTimersByTime(4_000);
        controller.markActivity(true);
        vi.advanceTimersByTime(9_999);
        expect(onResume).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(onResume).toHaveBeenCalledTimes(1);
    });
});


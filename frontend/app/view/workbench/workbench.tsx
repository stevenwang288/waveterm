// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getModeDisplayName } from "@/app/aipanel/ai-utils";
import { resolveSpeechSettings } from "@/app/aipanel/speechsettings";
import { waveAICurrentModeAtom } from "@/app/aipanel/waveai-shared";
import type { BlockNodeModel } from "@/app/block/blocktypes";
import { blockViewToName } from "@/app/block/blockutil";
import {
    canRunCodexResume,
    type CodexResumeShellState,
    hasCodexResumeUiCues,
    runCodexResumeSequence,
    shouldShowCodexResumeButton,
    waitForCodexResumeToBecomeInteractive,
} from "@/app/block/codex-resume";
import type { TerminalFormalReplyPayload } from "@/app/block/terminal-speech";
import { Markdown } from "@/app/element/markdown";
import { TypingIndicator } from "@/app/element/typingindicator";
import i18next from "@/app/i18n";
import { MonacoSchemaSummary } from "@/app/monaco/schema-summary";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { FavoriteItem, FavoritesModel } from "@/app/store/favorites-model";
import {
    atoms,
    createBlock,
    createBlockSplitHorizontally,
    createBlockSplitVertically,
    fetchWaveFile,
    getApi,
    getConnStatusAtom,
    getLocalHostDisplayNameAtom,
    getOverrideConfigAtom,
    globalStore,
    pushNotification,
    useBlockAtom,
    WOS,
} from "@/app/store/global";
import { modalsModel } from "@/app/store/modalmodel";
import { BlockService } from "@/app/store/services";
import type { TabModel } from "@/app/store/tab-model";
import { waveEventSubscribeSingle } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getWorkbenchSourceMetaPatch, normalizeWorkbenchSourceMeta } from "@/app/workspace/workbench-source";
import { useCompositionSafeTextarea } from "@/util/composition-input";
import { fetch as fetchWithElectronNet } from "@/util/fetchutil";
import * as keyutil from "@/util/keyutil";
import { fireAndForget, isBlank, isLocalConnName, isWslConnName, mergeMeta, stringToBase64 } from "@/util/util";
import { colord } from "colord";
import { atom, type Atom, type PrimitiveAtom, useAtom, useAtomValue } from "jotai";
import { type CSSProperties, memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    addPathToCliLayoutPreset,
    buildFavoriteLaunchMenuItems,
    buildOpenWithAiMenuItems,
    buildSharedTermContextMenuItems,
    buildSharedTermSettingsMenuItems,
    CLI_LAYOUT_PRESETS,
    getCliLayoutPresetLabel,
    makeUnavailableMenuItem,
} from "../term/term-settings-menu";
import { computeTheme, DefaultTermTheme } from "../term/termutil";
import { getWorkbenchAgentSpec } from "./workbench-agent-spec";
import { dispatchWorkbenchIntent } from "./workbench-dispatch";
import { resolveWorkbenchCodexBootstrapMode, streamWorkbenchCodexTerminalGateway } from "./workbench-gateway";
import { resolveWorkbenchDispatchIntent } from "./workbench-input-parser";
import {
    createWorkbenchComposerEntry,
    createWorkbenchLaunchTerminalIntent,
    createWorkbenchPickDirectoryIntent,
    createWorkbenchRestoreHistoryIntent,
    type WorkbenchDispatchIntent,
} from "./workbench-input-types";
import {
    createDefaultWorkbenchIntegrationsConfig,
    parseWorkbenchIntegrationsConfig,
    updateWorkbenchIntegrationsConfigText,
    type WorkbenchIntegrationsConfig,
    type WorkbenchMcpServerConfig,
    type WorkbenchMcpServerType,
} from "./workbench-integrations";
import { getTraditionalView } from "./workbench-mode";
import {
    appendWorkbenchComposerText,
    buildWorkbenchDiagnosticsInsertText,
    findLatestWorkbenchReplayText,
} from "./workbench-quick-insert";
import { routeWorkbenchCommand } from "./workbench-router";
import {
    isWorkbenchViewportNearBottom,
    resolveWorkbenchFollowLatestState,
    TerminalAutoFollowResumeController,
} from "./workbench-scroll";
import "./workbench.scss";

type DrawerSection = "task" | "settings" | "integrations" | "lsp" | "status";
type EndpointMode = "auto" | "manual";
type MessageRole = "system" | "user" | "assistant" | "error";
type ConnectionKind = "local" | "wsl" | "ssh";
type WorkbenchAiPreferenceKey = "ai:model" | "ai:thinkinglevel" | "ai:planthinkinglevel";
type WorkbenchCodexConfigKey = "model" | "model_reasoning_effort" | "plan_mode_reasoning_effort";
export type WorkbenchThinkingLevel = "low" | "medium" | "high" | "xhigh";
type WorkbenchVisibleThinkingLevel = "high" | "xhigh";
type WorkbenchDisplayedThinkingLevel = WorkbenchVisibleThinkingLevel | "";
type WorkbenchThemeVariant = "wave" | "sea" | "ember";
type WorkbenchLayoutDensity = "default" | "compact" | "cramped";
type WorkbenchTaskHighlightTone = "default" | "error";
type WorkbenchTaskTodoState = "pending" | "done";
type WorkbenchAIModeOption = {
    value: string;
    label: string;
    description: string;
};
type WorkbenchAIModeState = {
    currentModeConfig: AIModeConfigType | null;
    currentModeDescription: string;
    currentModeLabel: string;
    hasAvailableModes: boolean;
    modeOptions: WorkbenchAIModeOption[];
    modeSyncKey: string;
    selectValue: string;
};
type WorkbenchAiPreferenceUpdate<K extends WorkbenchAiPreferenceKey = WorkbenchAiPreferenceKey> = {
    configFiles: Array<{
        key: WorkbenchCodexConfigKey;
        value: string;
    }>;
    meta: Record<string, string>;
};
type WorkbenchAiPreferencePersistence = {
    persistConfig: (config: WorkbenchAiPreferenceUpdate["configFiles"][number]) => Promise<void>;
    persistMeta: (meta: Record<string, string | null>) => Promise<void>;
    onError?: (target: "config" | "meta", error: unknown) => void;
};
type WorkbenchModelOptionsState = {
    options: string[];
    sourceLabel: string;
    requestOverride?: WorkbenchRuntimeRequestOverride;
};
type WorkbenchRuntimeRequestOverride = {
    apitype: string;
    apitoken: string;
    baseurl: string;
};
type WorkbenchRuntimeModelDiscoveryFallbackOptions = {
    endpointMode: EndpointMode;
    error?: unknown;
    isEmptyResult?: boolean;
    providerConfig: WorkbenchCodexProviderConfig | null;
    requestOverride?: WorkbenchRuntimeRequestOverride;
    usedProviderBaseUrl: boolean;
};
type WorkbenchDirectoryPickerOptions = {
    title: string;
    defaultPath?: string;
};
type WorkbenchDirectoryPickerResult =
    | string
    | null
    | undefined
    | {
          canceled?: boolean;
          filePaths?: string[];
          path?: string;
      };
type WorkbenchDirectoryPicker = (
    options: WorkbenchDirectoryPickerOptions
) => Promise<WorkbenchDirectoryPickerResult> | WorkbenchDirectoryPickerResult;
type WorkbenchDirectoryPickerDeps = {
    createBlock?: ((blockDef: BlockDef) => void | Promise<void>) | null;
    getHomeDir?: (() => string) | null;
    pickDirectory?: WorkbenchDirectoryPicker | null;
};
type WorkbenchRuntimeModelDiscoveryInput = {
    endpointMode: EndpointMode;
    manualBaseUrl: string;
    fallbackBaseUrl: string;
    apiToken: string;
};
type WorkbenchRuntimeModelDiscoveryDeps = {
    fetchImpl?: typeof fetch;
    readFileText?: (path: string) => Promise<string>;
};
type WorkbenchCodexProviderConfig = {
    providerName: string;
    baseUrl: string;
    requiresOpenAIAuth: boolean;
    wireApi: string;
    apiType: string;
};
type WorkbenchCodexPreferenceSnapshot = {
    model: string;
    modelReasoningEffort: WorkbenchThinkingLevel | "";
    planModeReasoningEffort: WorkbenchThinkingLevel | "";
};

type WorkbenchMessage = {
    id: string;
    role: MessageRole;
    title?: string;
    content: string;
    timestamp: string;
    isUpdating?: boolean;
};

type WorkbenchTaskSummaryCardData = {
    title: string;
    detail: string;
    sourceLabel: string;
    tone: WorkbenchTaskHighlightTone;
    empty: boolean;
};

type WorkbenchTaskTodoItem = {
    text: string;
    state: WorkbenchTaskTodoState;
    sourceLabel: string;
};

type WorkbenchTaskPanelData = {
    currentTask: WorkbenchTaskSummaryCardData;
    recentConclusion: WorkbenchTaskSummaryCardData;
    todos: WorkbenchTaskTodoItem[];
    statusLabel: string;
    statusDetail: string;
    statusItems: Array<[string, string]>;
};

type WorkbenchLspCapabilityItem = {
    label: string;
    detail: string;
    tone: "ready" | "warn";
};

type WorkbenchLspSchemaItem = {
    label: string;
    detail: string;
};

type WorkbenchLspPanelData = {
    overviewItems: Array<[string, string]>;
    diagnosticsItems: Array<[string, string]>;
    capabilityItems: WorkbenchLspCapabilityItem[];
    schemaItems: WorkbenchLspSchemaItem[];
};

type WorkbenchInitialHistoryState = {
    hasRestorableHistory: boolean;
    hiddenHistory: WaveAIPromptMessageType[];
    messages: WorkbenchMessage[];
    persistedHistory: WaveAIPromptMessageType[];
};

type WorkbenchThemeStyle = CSSProperties & Record<string, string | number | undefined>;

export const THINKING_LEVEL_OPTIONS: Array<{ value: WorkbenchVisibleThinkingLevel; label: string }> = [
    { value: "high", label: "高" },
    { value: "xhigh", label: "极高" },
];
const TABS: Array<{ id: DrawerSection; label: string }> = [
    { id: "task", label: "任务" },
    { id: "settings", label: "设置" },
    { id: "integrations", label: "集成" },
    { id: "lsp", label: "LSP" },
    { id: "status", label: "状态" },
];
const INITIAL: WorkbenchMessage[] = [];
const DRAWER_WIDTH_KEY = "waveterm-workbench-drawer-width";
const DRAWER_COLLAPSED_KEY = "waveterm-workbench-drawer-collapsed";
const DRAWER_SECTION_KEY = "waveterm-workbench-drawer-section";
const DRAWER_WIDTH_MIN = 280;
const DRAWER_WIDTH_MAX = 560;
const DRAWER_WIDTH_DEFAULT = 364;
const DRAWER_WIDTH_STEP = 32;
export const WORKBENCH_DRAWER_CONTROL_HINT = "仅保留头部开关 / Alt+S 开关，Alt+[ / ] 缩放";
export const WORKBENCH_DRAWER_CONTROL_NOTES = [
    "Alt+S 收起或展开右栏。",
    "Alt+[ / Alt+] 调整右栏宽度。",
    "共享头部负责返回、分屏、连接与右栏开关。",
    "模型、推理与工作模式统一放在右栏设置，不在输入主条或菜单重复提供。",
    "右栏只负责任务、设置、集成、工作区与状态说明。",
] as const;
const CHAT_CONTEXT_WINDOW = 0;
const WORKBENCH_ALLOWED_PROMPT_ROLES = new Set(["system", "user", "assistant"]);
export const DEFAULT_THINKING_LEVEL: WorkbenchThinkingLevel = "xhigh";
export const DEFAULT_WORKBENCH_DRAWER_SECTION = "settings";
export const WORKBENCH_CODEX_CONFIG_PATH = "C:/Users/baba1/.codex/config.toml";
export const WORKBENCH_CODEX_AUTH_PATH = "C:/Users/baba1/.codex/auth.json";
export const WORKBENCH_CODEX_SKILLS_PATH = "C:/Users/baba1/.codex/skills";
const WORKBENCH_AIMODE_INVALID_SELECT_VALUE = "__invalid__";
const WORKBENCH_AIMODE_EMPTY_SELECT_VALUE = "__empty__";
const WORKBENCH_THINKING_LEVEL_UNSET_VALUE = "__unset__";
const WORKBENCH_RUNTIME_MODEL_FALLBACK_OPTIONS = [
    "gpt-5.2",
    "gpt-5.2-codex",
    "gpt-5.2-pro",
    "gpt-5.3-codex",
    "gpt-5.3-codex-spark",
    "gpt-5.4",
] as const;
const WORKBENCH_THEME_VARIANT_KEY = "waveterm-workbench-theme-variant";
const WORKBENCH_THEME_OPTIONS: Array<{ value: WorkbenchThemeVariant; label: string }> = [
    { value: "wave", label: "Wave" },
    { value: "sea", label: "Sea" },
    { value: "ember", label: "Ember" },
];
const WORKBENCH_MENU_SMART_COPY_UNAVAILABLE = "工作台没有终端段落上下文";
const WORKBENCH_MENU_SEND_SELECTION_UNAVAILABLE = "工作台已是 AI 主界面，请直接粘贴到输入框";
const WORKBENCH_MENU_REFLOW_UNAVAILABLE = "工作台没有终端 scrollback 可重排";
const WORKBENCH_MENU_SAVE_UNAVAILABLE = "工作台没有终端 session scrollback 可导出";
const WORKBENCH_MENU_FONT_SIZE_UNAVAILABLE = "工作台当前不消费 term:fontsize";
const WORKBENCH_MENU_ADVANCED_UNAVAILABLE = "终端 advanced 控制仍在原 term 块生效";
const WORKBENCH_APPROVAL_POLICY_OPTIONS = [
    { value: "never", label: "永不审批" },
    { value: "on-request", label: "按需审批" },
    { value: "on-failure", label: "失败后审批" },
    { value: "untrusted", label: "不可信" },
] as const;
const WORKBENCH_SANDBOX_MODE_OPTIONS = [
    { value: "danger-full-access", label: "完全访问" },
    { value: "workspace-write", label: "工作区可写" },
    { value: "read-only", label: "只读" },
] as const;
const WORKBENCH_WIRE_API_OPTIONS = [
    { value: "responses", label: "Responses" },
    { value: "chat_completions", label: "Chat Completions" },
] as const;
const WORKBENCH_PICK_DIRECTORY_TITLE = "选择路径";
const WORKBENCH_RESTORE_HISTORY_TITLE = "恢复工作台记录";
const WORKBENCH_DISPATCH_EVENT = "waveterm:workbench-dispatch";
const WORKBENCH_LAUNCH_CODEX_COMMAND = getWorkbenchAgentSpec("codex").launchCommand;
const WORKBENCH_LSP_CAPABILITIES: WorkbenchLspCapabilityItem[] = [
    { label: "TypeScript / JavaScript", detail: "Monaco 语义提示与基础诊断已内置。", tone: "ready" },
    { label: "JSON", detail: "支持 schema 约束与配置校验。", tone: "ready" },
    { label: "YAML", detail: "支持 schema 校验与键值提示。", tone: "ready" },
    { label: "HTML / CSS", detail: "支持基础语言服务。", tone: "ready" },
    { label: "远端工程 LSP", detail: "需后续接入真实语言服务器进程。", tone: "warn" },
    { label: "工作区索引", detail: "当前还未接入项目级索引与诊断汇总。", tone: "warn" },
];

function buildWorkbenchBlockDefInternal(sourceMeta?: MetaType | null): BlockDef {
    const controller = readWorkbenchScalarMetaText(sourceMeta?.controller) || "shell";
    const returnView = getTraditionalView(sourceMeta);
    const meta: MetaType = {
        view: "workbench",
        "display:name": "工作台",
        controller,
        "workbench:returnview": returnView,
    };
    Object.assign(meta, getWorkbenchSourceMetaPatch(sourceMeta));
    return { meta };
}

function quoteWorkbenchPowerShellPath(path: string): string {
    return `'${String(path ?? "").replace(/'/g, "''")}'`;
}

function quoteWorkbenchPosixPath(path: string): string {
    return `'${String(path ?? "").replace(/'/g, `'\"'\"'`)}'`;
}

function readWorkbenchScalarMetaText(value: unknown): string {
    const normalize = (text: string): string => {
        const trimmed = text.trim();
        if (trimmed === "System.Collections.Specialized.OrderedDictionary") {
            return "";
        }
        return trimmed;
    };
    if (typeof value === "string") {
        return normalize(value);
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return normalize(String(value));
    }
    return "";
}

function buildWorkbenchChangeDirectoryCommand(path: string, connection?: string): string {
    const normalizedPath = String(path ?? "").trim();
    if (isBlank(normalizedPath)) {
        return "";
    }
    if (isLocalConnName(connection)) {
        return `Set-Location -LiteralPath ${quoteWorkbenchPowerShellPath(normalizedPath)}`;
    }
    return `cd ${quoteWorkbenchPosixPath(normalizedPath)}`;
}

async function sendWorkbenchTerminalInput(blockId: string, input: string): Promise<void> {
    await RpcApi.ControllerInputCommand(TabRpcClient, {
        blockid: blockId,
        inputdata64: stringToBase64(input),
    });
}

function buildWorkbenchRetargetSourceMeta(
    path: string,
    currentMeta?: MetaType | null,
    connection?: string
): MetaType | null {
    const normalizedPath = String(path ?? "").trim();
    if (isBlank(normalizedPath)) {
        return null;
    }
    const nextConnection = readWorkbenchScalarMetaText(connection ?? currentMeta?.connection) || "local";
    return (
        normalizeWorkbenchSourceMeta(
            {
                ...currentMeta,
                view: "term",
                controller: readWorkbenchScalarMetaText(currentMeta?.controller) || "shell",
                "workbench:returnview": null,
                connection: nextConnection,
                "cmd:cwd": normalizedPath,
                "display:launchcwd": normalizedPath,
                "term:displaycwd": normalizedPath,
                cwd: normalizedPath,
            },
            normalizedPath
        ) ?? {
            ...currentMeta,
            view: "term",
            controller: readWorkbenchScalarMetaText(currentMeta?.controller) || "shell",
            "workbench:returnview": null,
            connection: nextConnection,
            "cmd:cwd": normalizedPath,
            "display:launchcwd": normalizedPath,
            "term:displaycwd": normalizedPath,
            cwd: normalizedPath,
        }
    );
}

async function updateWorkbenchBlockMeta(blockId: string, meta: MetaType): Promise<void> {
    await RpcApi.SetMetaCommand(TabRpcClient, {
        oref: WOS.makeORef("block", blockId),
        meta,
    });
}

function isWorkbenchTerminalBootstrapRetryableError(error: unknown): boolean {
    const message = formatWorkbenchError(error, "");
    return /no controller found/i.test(message) || /no shell input chan/i.test(message);
}

export async function retargetWorkbenchBlock(
    blockId: string,
    path: string,
    currentMeta?: MetaType | null,
    connection?: string
): Promise<void> {
    const normalizedSourceMeta = buildWorkbenchRetargetSourceMeta(path, currentMeta, connection);
    if (normalizedSourceMeta == null) {
        return;
    }
    await updateWorkbenchBlockMeta(blockId, buildWorkbenchBlockMeta(normalizedSourceMeta));
}

export async function launchWorkbenchTerminalInBlock(params: {
    blockId: string;
    path: string;
    command?: string;
    currentMeta?: MetaType | null;
    connection?: string;
}): Promise<void> {
    const normalizedPath = String(params.path ?? "").trim();
    const normalizedCommand = String(params.command ?? "").trim();
    const normalizedSourceMeta = buildWorkbenchRetargetSourceMeta(
        normalizedPath,
        params.currentMeta,
        params.connection
    );
    if (!isBlank(normalizedPath)) {
        await retargetWorkbenchBlock(params.blockId, normalizedPath, params.currentMeta, params.connection);
    }
    if (isBlank(normalizedCommand)) {
        return;
    }
    const commands = [
        buildWorkbenchChangeDirectoryCommand(normalizedPath, params.connection),
        normalizedCommand,
    ].filter((value) => !isBlank(value));
    if (commands.length === 0) {
        return;
    }
    const commandInput = `${commands.join("\n")}\r`;
    try {
        await sendWorkbenchTerminalInput(params.blockId, commandInput);
        return;
    } catch (error) {
        if (!isWorkbenchTerminalBootstrapRetryableError(error) || normalizedSourceMeta == null) {
            throw error;
        }
    }

    const shouldRestoreWorkbench =
        readWorkbenchScalarMetaText(params.currentMeta?.view) === "workbench" || params.currentMeta == null;
    await updateWorkbenchBlockMeta(params.blockId, normalizedSourceMeta);
    let lastError: unknown = null;
    try {
        for (let attempt = 0; attempt < 6; attempt++) {
            if (attempt > 0) {
                await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
            }
            try {
                await sendWorkbenchTerminalInput(params.blockId, commandInput);
                return;
            } catch (error) {
                lastError = error;
                if (!isWorkbenchTerminalBootstrapRetryableError(error)) {
                    throw error;
                }
            }
        }
        throw lastError instanceof Error ? lastError : new Error("workbench terminal bootstrap did not become ready");
    } finally {
        if (shouldRestoreWorkbench) {
            await updateWorkbenchBlockMeta(params.blockId, buildWorkbenchBlockMeta(normalizedSourceMeta)).catch(
                () => {}
            );
        }
    }
}

export function resolveWorkbenchMetaRepairPatch(meta?: MetaType | null): MetaType | null {
    if (meta == null || readWorkbenchScalarMetaText(meta.view) !== "workbench") {
        return null;
    }
    const nextConnection = readWorkbenchScalarMetaText(meta.connection) || "local";
    const nextController = readWorkbenchScalarMetaText(meta.controller) || "shell";
    const nextReturnView = getTraditionalView({
        ...meta,
        connection: nextConnection,
    });
    const sourcePatch = getWorkbenchSourceMetaPatch({
        ...meta,
        connection: nextConnection,
    });
    const patch: MetaType = {};
    if (readWorkbenchScalarMetaText(meta.connection) !== nextConnection) {
        patch.connection = nextConnection;
    }
    if (readWorkbenchScalarMetaText(meta.controller) !== nextController) {
        patch.controller = nextController;
    }
    if (readWorkbenchScalarMetaText(meta["workbench:returnview"]) !== nextReturnView) {
        patch["workbench:returnview"] = nextReturnView;
    }
    for (const [key, value] of Object.entries(sourcePatch)) {
        if (readWorkbenchScalarMetaText(meta[key]) !== readWorkbenchScalarMetaText(value)) {
            patch[key] = value;
        }
    }
    return Object.keys(patch).length > 0 ? patch : null;
}

export function buildWorkbenchBlockMeta(sourceMeta?: MetaType | null): MetaType {
    return buildWorkbenchBlockDefInternal(sourceMeta).meta;
}

export function makeWorkbenchBlockDef(sourceMeta?: MetaType | null): BlockDef {
    return buildWorkbenchBlockDefInternal(sourceMeta);
}

export function requestWorkbenchDispatch(blockId: string, intent: WorkbenchDispatchIntent) {
    if (typeof window === "undefined") {
        return;
    }
    window.dispatchEvent(
        new CustomEvent<{ blockId: string; intent: WorkbenchDispatchIntent }>(WORKBENCH_DISPATCH_EVENT, {
            detail: { blockId, intent },
        })
    );
}

function getWorkbenchDirectoryPicker(): WorkbenchDirectoryPicker | undefined {
    if (typeof window === "undefined") {
        return undefined;
    }
    return (window as { api?: { pickDirectory?: WorkbenchDirectoryPicker } }).api?.pickDirectory;
}

export function buildWorkbenchSourceMetaFromPickedPath(path: string): MetaType {
    const normalizedPath = String(path ?? "").trim();
    return (
        normalizeWorkbenchSourceMeta(
            {
                view: "term",
                controller: "shell",
                connection: "local",
                "cmd:cwd": normalizedPath,
            },
            normalizedPath
        ) ?? {
            view: "term",
            controller: "shell",
            connection: "local",
            "cmd:cwd": normalizedPath,
            "display:launchcwd": normalizedPath,
            "term:displaycwd": normalizedPath,
            cwd: normalizedPath,
        }
    );
}

export function resolveWorkbenchPickedDirectoryPath(result: unknown): string {
    if (typeof result === "string") {
        return result.trim();
    }
    if (result == null || typeof result !== "object") {
        return "";
    }
    const objectResult = result as {
        filePaths?: unknown;
        path?: unknown;
    };
    const directPath = typeof objectResult.path === "string" ? objectResult.path.trim() : "";
    if (!isBlank(directPath)) {
        return directPath;
    }
    const filePaths = Array.isArray(objectResult.filePaths) ? objectResult.filePaths : [];
    const firstFilePath = typeof filePaths[0] === "string" ? filePaths[0].trim() : "";
    return firstFilePath;
}

export function resolveWorkbenchPickDirectoryDefaultPath(meta?: MetaType | null, homeDir?: string | null): string {
    const connection = String(meta?.connection ?? "").trim();
    const workspacePath = resolveWorkbenchWorkspacePath(meta);
    const canReuseWorkspacePath =
        (isBlank(connection) || isLocalConnName(connection)) && workspacePath !== "未记录" && workspacePath !== "~";
    if (canReuseWorkspacePath) {
        return workspacePath;
    }
    return String(homeDir ?? "").trim();
}

export async function createWorkbenchBlockFromPickedDirectory(
    currentMeta?: MetaType | null,
    deps: WorkbenchDirectoryPickerDeps = {}
): Promise<boolean> {
    const pickDirectory = deps.pickDirectory ?? getWorkbenchDirectoryPicker();
    if (typeof pickDirectory !== "function") {
        console.warn("workbench directory picker unavailable");
        return false;
    }
    const defaultPath = resolveWorkbenchPickDirectoryDefaultPath(
        currentMeta,
        deps.getHomeDir?.() ?? getApi().getHomeDir?.()
    );
    const pickResult = await pickDirectory({
        title: WORKBENCH_PICK_DIRECTORY_TITLE,
        defaultPath: isBlank(defaultPath) ? undefined : defaultPath,
    });
    const pickedPath = resolveWorkbenchPickedDirectoryPath(pickResult);
    if (isBlank(pickedPath)) {
        return false;
    }
    const sourceMeta = buildWorkbenchSourceMetaFromPickedPath(pickedPath);
    await Promise.resolve((deps.createBlock ?? createBlock)({ meta: buildWorkbenchBlockMeta(sourceMeta) }));
    return true;
}

export function resolveWorkbenchInitialHistoryState(history: WaveAIPromptMessageType[]): WorkbenchInitialHistoryState {
    const sanitizedHistory = sanitizeWorkbenchPromptHistory(history);
    if (sanitizedHistory.length === 0) {
        return {
            hasRestorableHistory: false,
            hiddenHistory: [],
            messages: [],
            persistedHistory: [],
        };
    }
    return {
        hasRestorableHistory: true,
        hiddenHistory: sanitizedHistory,
        messages: [],
        persistedHistory: [],
    };
}

export function restoreWorkbenchHistoryState(history: WaveAIPromptMessageType[]): WorkbenchInitialHistoryState {
    const sanitizedHistory = sanitizeWorkbenchPromptHistory(history);
    return {
        hasRestorableHistory: false,
        hiddenHistory: [],
        messages: sanitizedHistory.map(promptToWorkbenchMessage),
        persistedHistory: sanitizedHistory,
    };
}

export function shouldRestoreWorkbenchCodexSession(
    meta?: MetaType | null,
    shellState?: CodexResumeShellState
): boolean {
    return (
        shouldShowCodexResumeButton(
            "workbench",
            readWorkbenchScalarMetaText(meta?.connection),
            getTraditionalView(meta)
        ) && canRunCodexResume(shellState ?? null)
    );
}

function isFavoriteCategoryPath(path: string): boolean {
    return path.endsWith("/__category__") || path.endsWith("\\__category__");
}

class WorkbenchViewModel implements ViewModel {
    viewType: string;
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    blockAtom: Atom<Block>;
    blockJobStatusAtom: PrimitiveAtom<BlockJobStatusData | null>;
    blockJobStatusVersionTs: number;
    blockJobStatusUnsubFn?: () => void;
    viewIcon = atom("gauge-high");
    viewName = atom("工作台");
    noPadding = atom(true);
    termDurableStatus: Atom<BlockJobStatusData | null>;
    viewText: Atom<any>;
    endIconButtons: Atom<IconButtonDecl[]>;
    useTermHeader: Atom<boolean>;
    manageConnection: Atom<boolean>;
    toggleDrawer?: () => void;
    adjustDrawerWidth?: (delta: number) => void;
    openDrawerPanel?: (section: DrawerSection) => void;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.viewType = "workbench";
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.blockJobStatusAtom = atom(null) as PrimitiveAtom<BlockJobStatusData | null>;
        this.blockJobStatusVersionTs = 0;
        this.termDurableStatus = atom((get) => {
            const block = get(this.blockAtom);
            const isDurable = !!block?.meta?.["term:durable"];
            if (!isDurable) {
                return null;
            }
            const blockJobStatus = get(this.blockJobStatusAtom);
            if (blockJobStatus?.jobid == null || blockJobStatus?.status == null) {
                return null;
            }
            return blockJobStatus;
        });
        this.viewText = atom(() => "");
        this.endIconButtons = atom((get) => {
            const blockData = get(this.blockAtom);
            const currentPath =
                resolveWorkbenchWorkspacePath(blockData?.meta) === "未记录"
                    ? "~"
                    : resolveWorkbenchWorkspacePath(blockData?.meta);
            const connection = String(blockData?.meta?.connection ?? "").trim() || undefined;
            const buttons: IconButtonDecl[] = [];
            buttons.push(
                {
                    elemtype: "iconbutton",
                    icon: "folder-open",
                    title: WORKBENCH_PICK_DIRECTORY_TITLE,
                    click: () => {
                        requestWorkbenchDispatch(
                            this.blockId,
                            createWorkbenchPickDirectoryIntent({
                                connection,
                            })
                        );
                    },
                },
                {
                    elemtype: "iconbutton",
                    icon: "clock-rotate-left",
                    title: WORKBENCH_RESTORE_HISTORY_TITLE,
                    click: () => {
                        requestWorkbenchDispatch(this.blockId, createWorkbenchRestoreHistoryIntent());
                    },
                },
                {
                    elemtype: "iconbutton",
                    icon: "sliders",
                    title: "切换右栏 (Alt+S)",
                    click: () => {
                        this.toggleDrawer?.();
                    },
                }
            );
            return buttons;
        });
        this.useTermHeader = atom(() => true);
        this.manageConnection = atom(() => true);
        const initialBlockJobStatus = RpcApi.BlockJobStatusCommand(TabRpcClient, blockId);
        initialBlockJobStatus
            .then((status) => {
                this.handleBlockJobStatusUpdate(status);
            })
            .catch((error) => {
                console.log("error getting initial block job status", error);
            });
        this.blockJobStatusUnsubFn = waveEventSubscribeSingle({
            eventType: "block:jobstatus",
            scope: `block:${blockId}`,
            handler: (event) => {
                this.handleBlockJobStatusUpdate(event.data);
            },
        });
    }

    keyDownHandler(waveEvent: WaveKeyboardEvent): boolean {
        if (keyutil.checkKeyPressed(waveEvent, "Alt:c{KeyS}")) {
            this.toggleDrawer?.();
            return true;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Alt:c{BracketLeft}")) {
            this.adjustDrawerWidth?.(-DRAWER_WIDTH_STEP);
            return true;
        }
        if (keyutil.checkKeyPressed(waveEvent, "Alt:c{BracketRight}")) {
            this.adjustDrawerWidth?.(DRAWER_WIDTH_STEP);
            return true;
        }
        if (
            keyutil.checkKeyPressed(waveEvent, "Ctrl:q") ||
            keyutil.checkKeyPressed(waveEvent, "Ctrl:c{KeyQ}") ||
            keyutil.checkKeyPressed(waveEvent, "Alt:q") ||
            keyutil.checkKeyPressed(waveEvent, "Alt:c{KeyQ}") ||
            keyutil.checkKeyPressed(waveEvent, "Cmd:q") ||
            keyutil.checkKeyPressed(waveEvent, "Cmd:c{KeyQ}")
        ) {
            this.nodeModel.toggleMagnify();
            return true;
        }
        return false;
    }

    get viewComponent(): ViewComponent {
        return WorkbenchView;
    }

    private getSelectedWorkbenchText(): string {
        if (typeof window === "undefined" || typeof window.getSelection !== "function") {
            return "";
        }
        return window.getSelection()?.toString()?.trim() ?? "";
    }

    private copyWorkbenchText(text: string) {
        const normalized = text.trim();
        if (isBlank(normalized)) {
            return;
        }
        void navigator.clipboard.writeText(normalized);
    }

    private async addWorkbenchPathToLayoutPreset(
        path: string,
        connection: string | undefined,
        preset: (typeof CLI_LAYOUT_PRESETS)[number],
        openAfterAdd: boolean
    ) {
        await addPathToCliLayoutPreset({
            path,
            connection,
            preset,
            openAfterAdd,
        });
    }

    private buildWorkbenchMenuItems(): ContextMenuItem[] {
        const blockData = globalStore.get(this.blockAtom);
        const selectedText = this.getSelectedWorkbenchText();
        const currentPath =
            resolveWorkbenchWorkspacePath(blockData?.meta) === "未记录"
                ? "~"
                : resolveWorkbenchWorkspacePath(blockData?.meta);
        const connection = String(blockData?.meta?.connection ?? "").trim() || undefined;
        const selectedUrl = (() => {
            if (isBlank(selectedText)) {
                return null;
            }
            try {
                const parsed = new URL(selectedText);
                return parsed.protocol.startsWith("http") ? parsed : null;
            } catch {
                return null;
            }
        })();
        const favoritesModel = FavoritesModel.getInstance();
        const settingsItems = buildSharedTermSettingsMenuItems({
            blockId: this.blockId,
            blockData,
            liveDisplayCwd: currentPath === "~" ? "" : currentPath,
            splitItems: [
                { label: "向右分出新的工作台", click: () => void this.splitWorkbench("horizontal") },
                { label: "向下分出新的工作台", click: () => void this.splitWorkbench("vertical") },
            ],
            includeNewBlockInheritCwd: true,
            includeFileBrowser: true,
            saveItem: makeUnavailableMenuItem("Save Session As...", WORKBENCH_MENU_SAVE_UNAVAILABLE),
            includeFontSize: false,
            fontSizeItem: makeUnavailableMenuItem(i18next.t("term.fontSize"), WORKBENCH_MENU_FONT_SIZE_UNAVAILABLE),
            setTheme: (themeName) => this.setTerminalTheme(themeName),
            advancedItems: [makeUnavailableMenuItem("工作台不适用", WORKBENCH_MENU_ADVANCED_UNAVAILABLE)],
            closeToolbarItem: blockData?.meta?.["term:vdomtoolbarblockid"]
                ? {
                      label: i18next.t("term.closeToolbar"),
                      click: () => {
                          RpcApi.DeleteSubBlockCommand(TabRpcClient, {
                              blockid: blockData.meta["term:vdomtoolbarblockid"],
                          });
                      },
                  }
                : null,
        });
        const clipboardItems: ContextMenuItem[] = [
            isBlank(selectedText)
                ? makeUnavailableMenuItem(i18next.t("term.copySmartParagraph"), WORKBENCH_MENU_SMART_COPY_UNAVAILABLE)
                : {
                      label: i18next.t("term.copySmartParagraph"),
                      click: () => this.copyWorkbenchText(selectedText),
                  },
            {
                label: i18next.t("term.copyPreciseSelection"),
                enabled: !isBlank(selectedText),
                click: () => this.copyWorkbenchText(selectedText),
            },
        ];
        const selectionItems: ContextMenuItem[] = isBlank(selectedText)
            ? []
            : [
                  makeUnavailableMenuItem(i18next.t("term.sendToWaveAI"), WORKBENCH_MENU_SEND_SELECTION_UNAVAILABLE),
                  {
                      label: i18next.t("term.translateSelection"),
                      click: () => {
                          modalsModel.pushModal("CodexTranslateModal", { text: selectedText });
                      },
                  },
                  ...(selectedUrl == null
                      ? []
                      : [
                            { type: "separator" as const },
                            {
                                label: i18next.t("term.openUrl", { host: selectedUrl.hostname }),
                                click: () => {
                                    createBlock({
                                        meta: {
                                            view: "web",
                                            url: selectedUrl.toString(),
                                        },
                                    });
                                },
                            },
                            {
                                label: i18next.t("term.openUrlExternal"),
                                click: () => {
                                    getApi().openExternal(selectedUrl.toString());
                                },
                            },
                        ]),
              ];
        const workspaceItems: ContextMenuItem[] = [
            {
                label: i18next.t("favorites.add"),
                click: () => {
                    favoritesModel.addFavorite(currentPath, undefined, undefined, connection);
                    window.dispatchEvent(new Event("favorites-updated"));
                },
            },
            {
                label: i18next.t("favorites.title"),
                submenu: buildFavoriteLaunchMenuItems({
                    items: favoritesModel.getItems() as FavoriteItem[],
                    onRunFavorite: (favorite, cliCommand) => {
                        if (isFavoriteCategoryPath(String(favorite.path ?? ""))) {
                            return;
                        }
                        const favoritePath = String(favorite.path ?? "").trim();
                        if (isBlank(favoritePath)) {
                            return;
                        }
                        requestWorkbenchDispatch(
                            this.blockId,
                            createWorkbenchLaunchTerminalIntent({
                                path: favoritePath,
                                connection: String(favorite.connection ?? "").trim() || undefined,
                                command: String(cliCommand ?? "").trim(),
                            })
                        );
                    },
                }),
            },
            {
                label: i18next.t("block.addToLayout"),
                submenu: CLI_LAYOUT_PRESETS.map((preset) => ({
                    label: getCliLayoutPresetLabel(preset),
                    submenu: [
                        {
                            label: i18next.t("clilayout.addOnly"),
                            click: () =>
                                fireAndForget(() =>
                                    this.addWorkbenchPathToLayoutPreset(currentPath, connection, preset, false)
                                ),
                        },
                        {
                            label: i18next.t("clilayout.addAndOpen"),
                            click: () =>
                                fireAndForget(() =>
                                    this.addWorkbenchPathToLayoutPreset(currentPath, connection, preset, true)
                                ),
                        },
                    ],
                })),
            },
            {
                label: i18next.t("preview.openWithAi"),
                submenu: buildOpenWithAiMenuItems({
                    currentPath,
                    connection,
                }),
            },
        ];
        const editItems: ContextMenuItem[] = [
            {
                label: i18next.t("ctx.paste"),
                click: () => {
                    getApi().nativePaste();
                },
            },
        ];
        const blockItems: ContextMenuItem[] = [
            makeUnavailableMenuItem(i18next.t("term.reflowHistory"), WORKBENCH_MENU_REFLOW_UNAVAILABLE),
        ];

        return buildSharedTermContextMenuItems({
            clipboardItems,
            selectionItems,
            workspaceItems,
            editItems,
            blockItems,
            settingsItems,
        });
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        return this.buildWorkbenchMenuItems();
    }

    private async splitWorkbench(direction: "horizontal" | "vertical") {
        const blockData = globalStore.get(this.blockAtom);
        const blockDef = makeWorkbenchBlockDef(blockData?.meta);
        if (direction === "horizontal") {
            await createBlockSplitHorizontally(blockDef, this.blockId, "after");
            return;
        }
        await createBlockSplitVertically(blockDef, this.blockId, "after");
    }

    private setTerminalTheme(themeName: string | null) {
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("block", this.blockId),
            meta: { "term:theme": themeName },
        });
    }

    private handleBlockJobStatusUpdate(status: BlockJobStatusData | null) {
        if (status?.versionts == null) {
            return;
        }
        if (status.versionts <= this.blockJobStatusVersionTs) {
            return;
        }
        this.blockJobStatusVersionTs = status.versionts;
        globalStore.set(this.blockJobStatusAtom, status);
    }

    dispose() {
        this.blockJobStatusUnsubFn?.();
    }
}

const WorkbenchView = memo(({ model }: ViewComponentProps<WorkbenchViewModel>) => {
    const block = useAtomValue(model.blockAtom);
    const settings = useAtomValue(atoms.settingsAtom);
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const currentAIMode = useAtomValue(waveAICurrentModeAtom);
    const aiModeConfigs = useAtomValue(atoms.waveaiModeConfigAtom);
    const localHostLabel = useAtomValue(getLocalHostDisplayNameAtom());
    const workbenchTermTheme = useAtomValue(getOverrideConfigAtom(model.blockId, "term:theme")) ?? DefaultTermTheme;
    const workbenchTermTransparency = normalizeTransparency(
        useAtomValue(getOverrideConfigAtom(model.blockId, "term:transparency"))
    );
    const isDevInstance = getApi().getIsDev();
    const [drawerOpen, setDrawerOpen] = useState(() => {
        if (isDevInstance) {
            return false;
        }
        try {
            const collapsedState = localStorage.getItem(DRAWER_COLLAPSED_KEY);
            if (collapsedState == null) {
                return true;
            }
            return collapsedState !== "1";
        } catch {
            return true;
        }
    });
    const [drawerWidth, setDrawerWidth] = useState(() => {
        try {
            const raw = localStorage.getItem(DRAWER_WIDTH_KEY);
            const parsed = raw ? Number(raw) : NaN;
            if (!Number.isFinite(parsed)) {
                return DRAWER_WIDTH_DEFAULT;
            }
            return clampDrawerWidth(parsed);
        } catch {
            return DRAWER_WIDTH_DEFAULT;
        }
    });
    const [drawerSection, setDrawerSection] = useState<DrawerSection>(() => {
        try {
            return normalizeWorkbenchDrawerSection(localStorage.getItem(DRAWER_SECTION_KEY));
        } catch {
            return DEFAULT_WORKBENCH_DRAWER_SECTION;
        }
    });
    const [endpointMode, setEndpointMode] = useState<EndpointMode>("auto");
    const [endpointBaseUrl, setEndpointBaseUrl] = useState("https://api.openai.com/v1");
    const [themeVariant, setThemeVariant] = useState<WorkbenchThemeVariant>(() => {
        try {
            const raw = localStorage.getItem(WORKBENCH_THEME_VARIANT_KEY);
            return isWorkbenchThemeVariant(raw) ? raw : "wave";
        } catch {
            return "wave";
        }
    });
    const [integrationsDraft, setIntegrationsDraft] = useState<WorkbenchIntegrationsConfig | null>(null);
    const [integrationsLoading, setIntegrationsLoading] = useState(false);
    const [integrationsSaving, setIntegrationsSaving] = useState(false);
    const [integrationsDirty, setIntegrationsDirty] = useState(false);
    const [integrationsError, setIntegrationsError] = useState("");
    const [integrationsReloadTick, setIntegrationsReloadTick] = useState(0);
    const [configRefreshTick, setConfigRefreshTick] = useState(0);
    const [codexPreferenceSnapshot, setCodexPreferenceSnapshot] = useState<WorkbenchCodexPreferenceSnapshot | null>(
        null
    );
    const [selectedMcpServerName, setSelectedMcpServerName] = useState("");
    const [discoveredSkillPaths, setDiscoveredSkillPaths] = useState<string[]>([]);
    const mergedAiPresets = (() => {
        const presetKey = block?.meta?.["ai:preset"] ?? settings?.["ai:preset"];
        const selectedPreset = presetKey ? (fullConfig?.presets?.[presetKey] ?? {}) : {};
        let merged = mergeMeta(settings ?? {}, selectedPreset ?? {}, "ai");
        merged = mergeMeta(merged, block?.meta ?? {}, "ai");
        return merged;
    })();
    const currentAIModeState = resolveWorkbenchAIModeState(currentAIMode, aiModeConfigs);
    const currentAIModeConfig = currentAIModeState.currentModeConfig;
    const currentAIModeLabel = currentAIModeState.currentModeLabel;
    const currentAIModeDescription = currentAIModeState.currentModeDescription;
    const speechSettings = resolveSpeechSettings(settings, currentAIModeConfig);
    const presetBaseUrl = String(mergedAiPresets["ai:baseurl"] ?? "").trim();
    const presetApiToken = String(mergedAiPresets["ai:apitoken"] ?? "").trim();
    const modeBaseUrl = String(currentAIModeConfig?.["ai:endpoint"] ?? "").trim();
    const effectiveBaseUrl = endpointMode === "manual" ? endpointBaseUrl.trim() : modeBaseUrl || presetBaseUrl;
    const isCloudRequest = isWorkbenchCloudRequest(
        effectiveBaseUrl,
        String(currentAIModeConfig?.["ai:apitoken"] ?? presetApiToken).trim()
    );
    const staticModelOptionsState = resolveWorkbenchModelOptions(
        endpointMode,
        isCloudRequest,
        mergedAiPresets,
        aiModeConfigs,
        currentAIModeConfig
    );
    const [runtimeModelOptionsState, setRuntimeModelOptionsState] = useState<WorkbenchModelOptionsState | null>(null);
    const modelOptionsState = resolveWorkbenchPreferredModelOptions(runtimeModelOptionsState, staticModelOptionsState);
    const modelOptions = useMemo(
        () => mergeWorkbenchPinnedModelOptions(modelOptionsState.options, [codexPreferenceSnapshot?.model]),
        [codexPreferenceSnapshot?.model, modelOptionsState.options]
    );
    const codexConfiguredModel = normalizeWorkbenchModel(codexPreferenceSnapshot?.model ?? "", modelOptions);
    const hasCodexPreferenceSnapshot = codexPreferenceSnapshot != null;
    const configuredModel = hasCodexPreferenceSnapshot ? codexConfiguredModel : "";
    const codexConfiguredThinkingLevel = normalizeWorkbenchThinkingLevel(
        String(codexPreferenceSnapshot?.modelReasoningEffort ?? "")
    );
    const configuredReasoningLevel = resolveWorkbenchDisplayedThinkingLevel({
        modelReasoningEffort: codexPreferenceSnapshot?.modelReasoningEffort ?? "",
    });
    const [selectedModel, setSelectedModel] = useState<string>(configuredModel);
    const [selectedReasoningLevel, setSelectedReasoningLevel] = useState<WorkbenchDisplayedThinkingLevel>(() =>
        resolveWorkbenchDisplayedThinkingLevel(null)
    );
    const codexAuthReady = useAtomValue(atoms.codexAuthReadyAtom ?? atom(false));
    const [messages, setMessages] = useState(INITIAL);
    const [hasRestorableHistory, setHasRestorableHistory] = useState(false);
    const speechFormalReplyPayloadAtom = useBlockAtom(model.blockId, "speech:formal-reply-payload", () => {
        return atom(null) as PrimitiveAtom<TerminalFormalReplyPayload | null>;
    });
    const [, setSpeechFormalReplyPayload] = useAtom(speechFormalReplyPayloadAtom);
    const [input, setInput] = useState("");
    const composerInput = useCompositionSafeTextarea(input, setInput);
    const [sending, setSending] = useState(false);
    const [messageAutoFollowDetached, setMessageAutoFollowDetached] = useState(false);
    const cancelRef = useRef(false);
    const persistedHistoryRef = useRef<WaveAIPromptMessageType[]>([]);
    const hiddenHistoryRef = useRef<WaveAIPromptMessageType[]>([]);
    const hydratedRef = useRef(false);
    const lastCodexPreferenceSyncKeyRef = useRef<string | null>(null);
    const workbenchShellStateAtom = useBlockAtom(model.blockId, "term:shellstate", () => {
        return atom(null) as PrimitiveAtom<CodexResumeShellState>;
    });
    const workbenchShellState = useAtomValue(workbenchShellStateAtom);
    const workbenchLastOutputTsAtom = useBlockAtom(model.blockId, "term:lastoutputts", () => {
        return atom(0) as PrimitiveAtom<number>;
    });
    const workbenchLastOutputTs = useAtomValue(workbenchLastOutputTsAtom);
    const shellRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLTextAreaElement | null>(null);
    const messageScrollRef = useRef<HTMLDivElement | null>(null);
    const workbenchShellStateRef = useRef<CodexResumeShellState>(workbenchShellState);
    const workbenchLastOutputTsRef = useRef(Number(workbenchLastOutputTs) || 0);
    const manualScrollIntentRef = useRef(false);
    const followLatestOutputRef = useRef(true);
    const manuallyDetachedFromLatestOutputRef = useRef(false);
    const autoFollowResumeControllerRef = useRef<TerminalAutoFollowResumeController | null>(null);
    const [, workbenchThemeBg] = computeTheme(fullConfig, workbenchTermTheme, workbenchTermTransparency);
    const termTheme = fullConfig?.termthemes?.[workbenchTermTheme] ?? fullConfig?.termthemes?.[DefaultTermTheme];
    const workbenchThemeStyle = deriveWorkbenchThemeStyle(termTheme, workbenchThemeBg, themeVariant);
    const traditionalView = getTraditionalView(block?.meta);
    const traditionalViewName = blockViewToName(traditionalView);
    const currentConnection = String(block?.meta?.connection ?? "local").trim() || "local";
    const connStatus = useAtomValue(getConnStatusAtom(currentConnection));
    const currentConnConfig =
        (fullConfig?.connections?.[currentConnection] as Record<
            string,
            string | string[] | number | boolean | undefined
        >) ?? null;
    const currentConnectionInfo = describeWorkbenchConnection(
        currentConnection,
        currentConnConfig,
        connStatus,
        localHostLabel || "本机"
    );
    const workbenchPath = resolveWorkbenchWorkspacePath(block?.meta);
    const [viewportState, setViewportState] = useState(() => resolveWorkbenchViewportState(1280, 820));
    const effectiveDrawerWidth = clampDrawerWidth(
        drawerWidth,
        viewportState.drawerMinWidth,
        viewportState.drawerMaxWidth
    );
    const workbenchShellStyle: WorkbenchThemeStyle = {
        ...workbenchThemeStyle,
        "--wb-composer-max-height": `${viewportState.composerMaxHeight}px`,
        "--wb-composer-textarea-min-height": `${viewportState.composerTextareaMinHeight}px`,
        "--wb-composer-textarea-max-height": `${viewportState.composerTextareaMaxHeight}px`,
    };

    const activeModel = selectedModel || configuredModel;
    const thinkingLevelSupported = supportsWorkbenchThinkingLevel(activeModel);
    const displayedThinkingLevel = thinkingLevelSupported ? selectedReasoningLevel : "";
    const runtimeRequestOverride = modelOptionsState.requestOverride;
    const resolvedBaseUrl =
        runtimeRequestOverride != null
            ? runtimeRequestOverride.baseurl.trim() || undefined
            : !isBlank(effectiveBaseUrl)
              ? effectiveBaseUrl
              : undefined;
    const resolvedApiType =
        runtimeRequestOverride != null
            ? runtimeRequestOverride.apitype.trim() || undefined
            : String(currentAIModeConfig?.["ai:apitype"] ?? mergedAiPresets["ai:apitype"] ?? "").trim() || undefined;
    const resolvedApiToken =
        runtimeRequestOverride != null
            ? runtimeRequestOverride.apitoken.trim()
            : String(currentAIModeConfig?.["ai:apitoken"] ?? presetApiToken).trim();
    const effectiveBaseUrlSource =
        runtimeRequestOverride != null
            ? modelOptionsState.sourceLabel
            : endpointMode === "manual"
              ? "当前窗口手动覆盖"
              : "Wave AI 预设";
    const resolvedAiOpts: WaveAIOptsType = {
        model: activeModel,
        apitype: resolvedApiType,
        apitoken: resolvedApiToken,
        orgid: mergedAiPresets["ai:orgid"] || undefined,
        apiversion:
            String(currentAIModeConfig?.["ai:azureapiversion"] ?? mergedAiPresets["ai:apiversion"] ?? "").trim() ||
            undefined,
        baseurl: resolvedBaseUrl,
        proxyurl: String(mergedAiPresets["ai:proxyurl"] ?? "").trim() || undefined,
        maxtokens: mergedAiPresets["ai:maxtokens"] ?? undefined,
        thinkinglevel: displayedThinkingLevel || undefined,
        timeoutms: mergedAiPresets["ai:timeoutms"] ?? 60000,
    };
    const taskPanelData = deriveWorkbenchTaskPanelData(messages, {
        sending,
        modelLabel: resolvedAiOpts.model || "未配置",
        modeLabel: currentAIModeLabel,
        thinkingLabel: getWorkbenchThinkingLevelSummary(activeModel, resolvedAiOpts.thinkinglevel),
        connectionLabel: currentConnectionInfo.footerLabel,
        connectionStatusLabel: currentConnectionInfo.statusLabel,
    });
    const lspPanelData = deriveWorkbenchLspPanelData({
        connectionInfo: currentConnectionInfo,
        messages,
        model: resolvedAiOpts.model,
        thinkingLabel: getWorkbenchThinkingLevelSummary(activeModel, resolvedAiOpts.thinkinglevel),
        timeoutMs: resolvedAiOpts.timeoutms ?? 60000,
        maxTokens: resolvedAiOpts.maxtokens,
        traditionalViewName,
        workbenchPath,
    });
    const composerPrimaryStatusItems = resolveWorkbenchComposerPrimaryStatusItems({
        sending,
        connectionStatusLabel: currentConnectionInfo.statusLabel,
        agentLabels: createWorkbenchComposerEntry(composerInput.value)?.agentMentions.map((item) => item.label) ?? [],
    });
    const latestUserReplayText = useMemo(() => findLatestWorkbenchReplayText(messages, "user"), [messages]);
    const diagnosticsInsertText = useMemo(
        () => buildWorkbenchDiagnosticsInsertText(lspPanelData.diagnosticsItems),
        [lspPanelData.diagnosticsItems]
    );
    const quickInsertPathText = workbenchPath === "未记录" ? "" : workbenchPath;
    const integrationModelOptions = integrationsDraft
        ? Array.from(new Set([integrationsDraft.codex.model, ...modelOptions].filter((item) => !isBlank(item))))
        : modelOptions;
    const selectedMcpServer =
        integrationsDraft?.mcpServers.find((server) => server.name === selectedMcpServerName) ??
        integrationsDraft?.mcpServers[0] ??
        null;

    useEffect(() => {
        workbenchShellStateRef.current = workbenchShellState;
    }, [workbenchShellState]);

    useEffect(() => {
        const repairPatch = resolveWorkbenchMetaRepairPatch(block?.meta);
        if (repairPatch == null) {
            return;
        }
        void updateWorkbenchBlockMeta(model.blockId, repairPatch).catch(() => {});
    }, [block?.meta, model.blockId]);

    useEffect(() => {
        const ts = Number(workbenchLastOutputTs);
        workbenchLastOutputTsRef.current = Number.isFinite(ts) && ts > 0 ? ts : 0;
    }, [workbenchLastOutputTs]);

    useEffect(() => {
        try {
            localStorage.setItem(DRAWER_WIDTH_KEY, String(drawerWidth));
            localStorage.setItem(DRAWER_COLLAPSED_KEY, drawerOpen ? "0" : "1");
            localStorage.setItem(DRAWER_SECTION_KEY, drawerSection);
            localStorage.setItem(WORKBENCH_THEME_VARIANT_KEY, themeVariant);
        } catch {
            // ignore
        }
    }, [drawerOpen, drawerSection, drawerWidth, themeVariant]);

    useEffect(() => {
        if (hydratedRef.current) {
            return;
        }
        if (!isBlank(mergedAiPresets["ai:baseurl"])) {
            setEndpointBaseUrl(mergedAiPresets["ai:baseurl"]);
        }
        hydratedRef.current = true;
    }, [mergedAiPresets]);

    useEffect(() => {
        if (!hasCodexPreferenceSnapshot) {
            return;
        }
        const nextSyncKey = `${configuredModel}|${configuredReasoningLevel}`;
        if (lastCodexPreferenceSyncKeyRef.current === nextSyncKey) {
            return;
        }
        setSelectedModel(configuredModel);
        setSelectedReasoningLevel(configuredReasoningLevel);
        lastCodexPreferenceSyncKeyRef.current = nextSyncKey;
    }, [configuredModel, configuredReasoningLevel, hasCodexPreferenceSnapshot]);

    useEffect(() => {
        const normalizedSelectedModel = normalizeWorkbenchModel(selectedModel, modelOptions);
        if (!normalizedSelectedModel && configuredModel !== selectedModel) {
            setSelectedModel(configuredModel);
        }
    }, [configuredModel, modelOptions, selectedModel]);

    useEffect(() => {
        if (integrationsDraft == null) {
            return;
        }
        if (
            selectedMcpServerName !== "" &&
            integrationsDraft.mcpServers.some((server) => server.name === selectedMcpServerName)
        ) {
            return;
        }
        setSelectedMcpServerName(integrationsDraft.mcpServers[0]?.name ?? "");
    }, [integrationsDraft, selectedMcpServerName]);

    useEffect(() => {
        if (drawerSection !== "integrations") {
            return;
        }
        if (integrationsDraft != null && integrationsReloadTick === 0) {
            return;
        }
        let disposed = false;
        setIntegrationsLoading(true);
        setIntegrationsError("");
        const loadIntegrations = async () => {
            try {
                const [configText, skillPaths] = await Promise.all([
                    readWorkbenchTextFile(WORKBENCH_CODEX_CONFIG_PATH),
                    discoverWorkbenchSkillDirectories(WORKBENCH_CODEX_SKILLS_PATH),
                ]);
                if (disposed) {
                    return;
                }
                const parsedConfig = parseWorkbenchIntegrationsConfig(configText);
                setIntegrationsDraft(parsedConfig);
                setSelectedMcpServerName(parsedConfig.mcpServers[0]?.name ?? "");
                setDiscoveredSkillPaths(skillPaths);
                setIntegrationsDirty(false);
                setIntegrationsReloadTick(0);
            } catch (error) {
                if (disposed) {
                    return;
                }
                setIntegrationsError(formatWorkbenchError(error, "读取集成配置失败"));
                setIntegrationsDraft(createDefaultWorkbenchIntegrationsConfig());
                setDiscoveredSkillPaths([]);
                setSelectedMcpServerName("");
            } finally {
                if (!disposed) {
                    setIntegrationsLoading(false);
                }
            }
        };
        void loadIntegrations();
        return () => {
            disposed = true;
        };
    }, [drawerSection, integrationsDraft, integrationsReloadTick]);

    useEffect(() => {
        let disposed = false;
        setRuntimeModelOptionsState(null);
        const syncRuntimeModelOptions = async () => {
            const nextState = await discoverWorkbenchRuntimeModelOptions({
                endpointMode,
                manualBaseUrl: endpointBaseUrl,
                fallbackBaseUrl: modeBaseUrl || presetBaseUrl,
                apiToken: String(currentAIModeConfig?.["ai:apitoken"] ?? presetApiToken).trim(),
            });
            if (!disposed) {
                setRuntimeModelOptionsState(nextState);
            }
        };
        void syncRuntimeModelOptions();
        return () => {
            disposed = true;
        };
    }, [
        configRefreshTick,
        currentAIModeConfig,
        endpointBaseUrl,
        endpointMode,
        modeBaseUrl,
        presetApiToken,
        presetBaseUrl,
    ]);

    useEffect(() => {
        let disposed = false;
        const loadCodexPreferenceSnapshot = async () => {
            try {
                const configText = await readWorkbenchTextFile(WORKBENCH_CODEX_CONFIG_PATH);
                if (!disposed) {
                    setCodexPreferenceSnapshot(resolveWorkbenchCodexPreferenceSnapshotFromConfigText(configText));
                }
            } catch (error) {
                if (!disposed) {
                    console.warn("failed to load codex preference snapshot for workbench settings", error);
                    setCodexPreferenceSnapshot(null);
                }
            }
        };
        void loadCodexPreferenceSnapshot();
        return () => {
            disposed = true;
        };
    }, [configRefreshTick]);

    useEffect(() => {
        let disposed = false;
        const loadHistory = async () => {
            const history = await loadAiHistory(model.blockId);
            if (disposed) {
                return;
            }
            const nextState = resolveWorkbenchInitialHistoryState(history);
            hiddenHistoryRef.current = nextState.hiddenHistory;
            persistedHistoryRef.current = nextState.persistedHistory;
            setHasRestorableHistory(nextState.hasRestorableHistory);
            setMessages(nextState.messages);
        };
        void loadHistory();
        return () => {
            disposed = true;
            hiddenHistoryRef.current = [];
            persistedHistoryRef.current = [];
            setHasRestorableHistory(false);
            setSpeechFormalReplyPayload(null);
        };
    }, [model.blockId, setSpeechFormalReplyPayload]);

    const resolveWorkbenchCodexLaunchPath = useCallback(() => {
        if (workbenchPath !== "未记录") {
            return workbenchPath;
        }
        const homeDir = String(getApi().getHomeDir?.() ?? "").trim();
        return isBlank(homeDir) ? "" : homeDir;
    }, [workbenchPath]);

    const getWorkbenchCodexResumeLines = useCallback(async () => {
        try {
            const result = await RpcApi.TermGetScrollbackLinesCommand(
                TabRpcClient,
                { linestart: 0, lineend: 160, lastcommand: false },
                { route: `feblock:${model.blockId}` }
            );
            return result?.lines ?? [];
        } catch {
            return [];
        }
    }, [model.blockId]);

    const waitForWorkbenchCodexInteractive = useCallback(
        async (baselineOutputTs: number) => {
            await waitForCodexResumeToBecomeInteractive({
                getSnapshot: async () => ({
                    shellState: workbenchShellStateRef.current,
                    outputTs: workbenchLastOutputTsRef.current,
                    baselineOutputTs,
                    lines: await getWorkbenchCodexResumeLines(),
                }),
            });
        },
        [getWorkbenchCodexResumeLines]
    );

    const ensureWorkbenchCodexSessionReady = useCallback(async () => {
        if (!codexAuthReady) {
            throw new Error("当前本机 Codex 还未登录或未准备好可用鉴权，不能切到真实会话链。");
        }

        const existingLines = await getWorkbenchCodexResumeLines();
        const launchPath = resolveWorkbenchCodexLaunchPath();
        const hasActiveCodexUi = hasCodexResumeUiCues(existingLines);
        const lastSessionId =
            typeof getApi().codexLastSessionId === "function" && !isBlank(launchPath)
                ? await getApi()
                      .codexLastSessionId(launchPath)
                      .catch(() => null)
                : null;
        const bootstrapMode = resolveWorkbenchCodexBootstrapMode({
            connection: currentConnection,
            returnView: getTraditionalView(block?.meta),
            shellState: workbenchShellStateRef.current,
            hasActiveCodexUi,
            resumeLines: existingLines,
            lastSessionId,
        });

        if (bootstrapMode === "unavailable") {
            throw new Error("当前工作台还不是本地终端宿主，暂时不能切到 Codex 真链。请先在本地终端块内使用工作台。");
        }
        if (bootstrapMode === "busy") {
            if (hasActiveCodexUi) {
                const baselineOutputTs = Number(workbenchLastOutputTsRef.current) || 0;
                await waitForWorkbenchCodexInteractive(baselineOutputTs);
                return;
            }
            throw new Error("当前块正在执行其他终端命令，需等它结束后才能接管到 Codex 真链。");
        }
        if (bootstrapMode === "ready") {
            return;
        }

        const baselineOutputTs = Number(workbenchLastOutputTsRef.current) || 0;
        if (bootstrapMode === "resume") {
            await runCodexResumeSequence((input) => sendWorkbenchTerminalInput(model.blockId, input), {
                waitUntilReadyForFollowup: () => waitForWorkbenchCodexInteractive(baselineOutputTs),
            });
            return;
        }

        await launchWorkbenchTerminalInBlock({
            blockId: model.blockId,
            path: launchPath,
            command: WORKBENCH_LAUNCH_CODEX_COMMAND,
            currentMeta: block?.meta,
            connection: currentConnection,
        });
        await waitForWorkbenchCodexInteractive(baselineOutputTs);
    }, [
        block?.meta,
        codexAuthReady,
        currentConnection,
        getWorkbenchCodexResumeLines,
        model.blockId,
        resolveWorkbenchCodexLaunchPath,
        waitForWorkbenchCodexInteractive,
    ]);

    const restoreWorkbenchCodexSession = useCallback(async () => {
        if (!shouldRestoreWorkbenchCodexSession(block?.meta, workbenchShellStateRef.current)) {
            return false;
        }
        const baselineOutputTs = Number(workbenchLastOutputTsRef.current) || 0;
        await runCodexResumeSequence((input) => sendWorkbenchTerminalInput(model.blockId, input), {
            waitUntilReadyForFollowup: () => waitForWorkbenchCodexInteractive(baselineOutputTs),
        });
        return true;
    }, [block?.meta, model.blockId, waitForWorkbenchCodexInteractive]);

    const restoreHistory = useCallback(async () => {
        const history =
            hiddenHistoryRef.current.length > 0 ? hiddenHistoryRef.current : await loadAiHistory(model.blockId);
        const nextState = restoreWorkbenchHistoryState(history);
        hiddenHistoryRef.current = nextState.hiddenHistory;
        persistedHistoryRef.current = nextState.persistedHistory;
        setHasRestorableHistory(nextState.hasRestorableHistory);
        setMessages(nextState.messages);
        const now = Date.now();
        let restoredCodexSession = false;
        try {
            restoredCodexSession = await restoreWorkbenchCodexSession();
        } catch (error) {
            pushNotification({
                icon: "triangle-exclamation",
                title: "工作台会话恢复失败",
                message: formatWorkbenchError(error, "未能接回最近 Codex 会话"),
                timestamp: new Date(now).toISOString(),
                expiration: now + 3600,
                type: "error",
            });
        }
        if (nextState.persistedHistory.length > 0) {
            pushNotification({
                icon: "clock-rotate-left",
                title: "工作台记录已恢复",
                message: restoredCodexSession
                    ? `已恢复 ${nextState.persistedHistory.length} 条历史记录，并接回最近 Codex 会话`
                    : `已恢复 ${nextState.persistedHistory.length} 条历史记录`,
                timestamp: new Date(now).toISOString(),
                expiration: now + 2400,
                type: "info",
            });
            return;
        }
        if (restoredCodexSession) {
            pushNotification({
                icon: "clock-rotate-left",
                title: "已接回最近 Codex 会话",
                message: "当前工作台已在同一块内恢复到底层会话链",
                timestamp: new Date(now).toISOString(),
                expiration: now + 2400,
                type: "info",
            });
            return;
        }
        pushNotification({
            icon: "clock-rotate-left",
            title: "没有可恢复的工作台记录",
            message: "当前工作台没有可恢复的历史记录",
            timestamp: new Date(now).toISOString(),
            expiration: now + 2400,
            type: "info",
        });
    }, [block?.meta, model.blockId, restoreWorkbenchCodexSession]);

    const handleWorkbenchLocalAction = useCallback(
        async (intent: Extract<WorkbenchDispatchIntent, { kind: "local-action" }>) => {
            if (intent.actionId === "restore-history") {
                await restoreHistory();
                return;
            }
            if (intent.actionId === "launch-terminal") {
                await launchWorkbenchTerminalInBlock({
                    blockId: model.blockId,
                    path: intent.path,
                    command: intent.command,
                    currentMeta: block?.meta,
                    connection: intent.connection,
                });
                return;
            }
            if (intent.actionId === "pick-directory") {
                const pickDirectory = getWorkbenchDirectoryPicker();
                if (typeof pickDirectory !== "function") {
                    console.warn("workbench directory picker unavailable");
                    return;
                }
                const defaultPath = resolveWorkbenchPickDirectoryDefaultPath(block?.meta, getApi().getHomeDir?.());
                const pickResult = await pickDirectory({
                    title: WORKBENCH_PICK_DIRECTORY_TITLE,
                    defaultPath: isBlank(defaultPath) ? undefined : defaultPath,
                });
                const pickedPath = resolveWorkbenchPickedDirectoryPath(pickResult);
                if (isBlank(pickedPath)) {
                    return;
                }
                await retargetWorkbenchBlock(model.blockId, pickedPath, block?.meta, intent.connection);
                const cdCommand = buildWorkbenchChangeDirectoryCommand(pickedPath, intent.connection);
                if (!isBlank(cdCommand)) {
                    await sendWorkbenchTerminalInput(model.blockId, `${cdCommand}\r`);
                }
                return;
            }
            if (intent.actionId === "workbench-command") {
                const route = routeWorkbenchCommand(intent.commandId);
                setDrawerSection(route.drawerSection);
                setDrawerOpen(true);
                const commandLabel = `/${intent.commandId}`;
                const nextInputValue = intent.argumentText;
                setInput(nextInputValue);
                setMessages((prev) => [
                    ...prev,
                    {
                        id: `local-${intent.commandId}-${Date.now()}`,
                        role: "system",
                        title: route.title,
                        content: isBlank(nextInputValue)
                            ? `${route.message}\n\n本地命令 ${commandLabel} 已在工作台内处理，未触发 Codex 对话发送。`
                            : `${route.message}\n\n已保留命令后的输入内容：${nextInputValue}`,
                        timestamp: stamp(),
                    },
                ]);
            }
        },
        [block?.meta, model.blockId, restoreHistory]
    );

    useEffect(() => {
        const handleWorkbenchDispatch = (event: Event) => {
            const customEvent = event as CustomEvent<{ blockId?: string; intent?: WorkbenchDispatchIntent }>;
            if (customEvent.detail?.blockId !== model.blockId) {
                return;
            }
            const intent = customEvent.detail?.intent;
            if (intent == null) {
                return;
            }
            void dispatchWorkbenchIntent(intent, {
                onLocalAction: handleWorkbenchLocalAction,
                onCodexTurn: async () => undefined,
            });
        };
        window.addEventListener(WORKBENCH_DISPATCH_EVENT, handleWorkbenchDispatch);
        return () => {
            window.removeEventListener(WORKBENCH_DISPATCH_EVENT, handleWorkbenchDispatch);
        };
    }, [handleWorkbenchLocalAction, model.blockId]);

    useEffect(() => {
        const payload = resolveWorkbenchSpeechPayload(messages);
        setSpeechFormalReplyPayload(payload);
    }, [messages, setSpeechFormalReplyPayload]);

    useEffect(() => {
        const element = shellRef.current;
        if (element == null) {
            return;
        }

        const syncViewportState = (width: number, height: number) => {
            const nextState = resolveWorkbenchViewportState(width, height);
            setViewportState((prev) => {
                if (
                    prev.width === nextState.width &&
                    prev.height === nextState.height &&
                    prev.density === nextState.density &&
                    prev.drawerMinWidth === nextState.drawerMinWidth &&
                    prev.drawerMaxWidth === nextState.drawerMaxWidth &&
                    prev.composerMaxHeight === nextState.composerMaxHeight &&
                    prev.composerTextareaMinHeight === nextState.composerTextareaMinHeight &&
                    prev.composerTextareaMaxHeight === nextState.composerTextareaMaxHeight
                ) {
                    return prev;
                }
                return nextState;
            });
        };

        syncViewportState(element.clientWidth, element.clientHeight);

        if (typeof ResizeObserver === "undefined") {
            return;
        }

        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry == null) {
                return;
            }
            syncViewportState(entry.contentRect.width, entry.contentRect.height);
        });

        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    const setMessageFollowMode = useCallback((followLatestOutput: boolean, manuallyDetached: boolean) => {
        followLatestOutputRef.current = followLatestOutput;
        manuallyDetachedFromLatestOutputRef.current = manuallyDetached;
        setMessageAutoFollowDetached(manuallyDetached);
    }, []);

    const resumeLatestOutputFollow = useCallback(
        (scrollToBottom: boolean) => {
            const elem = messageScrollRef.current;
            setMessageFollowMode(true, false);
            autoFollowResumeControllerRef.current?.cancel();
            if (scrollToBottom && elem != null) {
                elem.scrollTo({ top: elem.scrollHeight });
            }
        },
        [setMessageFollowMode]
    );

    const detachLatestOutputFollow = useCallback(() => {
        setMessageFollowMode(false, true);
        autoFollowResumeControllerRef.current?.markActivity(true);
    }, [setMessageFollowMode]);

    useEffect(() => {
        autoFollowResumeControllerRef.current = new TerminalAutoFollowResumeController(() => {
            const elem = messageScrollRef.current;
            if (elem == null) {
                return;
            }
            if (
                !canResumeWorkbenchAutoFollowAfterInactivity(
                    elem.scrollHeight,
                    elem.scrollTop,
                    elem.clientHeight,
                    manuallyDetachedFromLatestOutputRef.current
                )
            ) {
                return;
            }
            resumeLatestOutputFollow(true);
        });
        return () => {
            autoFollowResumeControllerRef.current?.cancel();
            autoFollowResumeControllerRef.current = null;
        };
    }, [resumeLatestOutputFollow]);

    const adjustDrawerWidth = useCallback(
        (delta: number) => {
            setDrawerOpen(true);
            setDrawerWidth((value) =>
                clampDrawerWidth(value + delta, viewportState.drawerMinWidth, viewportState.drawerMaxWidth)
            );
        },
        [viewportState.drawerMaxWidth, viewportState.drawerMinWidth]
    );

    const toggleDrawer = useCallback(() => {
        setDrawerOpen((value) => !value);
    }, []);

    const persistWorkbenchAiPreference = useCallback(
        (key: WorkbenchAiPreferenceKey, value: string) => {
            const update = createWorkbenchAiPreferenceUpdate(key, value);
            fireAndForget(() =>
                applyWorkbenchAiPreferenceUpdate(update, {
                    persistConfig: persistWorkbenchAiPreferenceConfig,
                    persistMeta: (meta) =>
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", model.blockId),
                            meta,
                        }),
                    onError: (target, error) => console.warn(`failed to persist workbench ai ${target}`, error),
                })
            );
        },
        [model.blockId]
    );

    const handleModelSelection = useCallback(
        (nextModel: string) => {
            const normalizedModel = normalizeWorkbenchModel(nextModel, modelOptions);
            if (isBlank(normalizedModel)) {
                return;
            }
            setSelectedModel(normalizedModel);
            setCodexPreferenceSnapshot((current) => ({
                model: normalizedModel,
                modelReasoningEffort: current?.modelReasoningEffort ?? configuredReasoningLevel,
                planModeReasoningEffort: current?.planModeReasoningEffort ?? configuredReasoningLevel,
            }));
            persistWorkbenchAiPreference("ai:model", normalizedModel);
        },
        [configuredReasoningLevel, modelOptions, persistWorkbenchAiPreference]
    );

    const handleReasoningLevelSelection = useCallback(
        (nextThinkingLevel: string) => {
            if (nextThinkingLevel === WORKBENCH_THINKING_LEVEL_UNSET_VALUE) {
                return;
            }
            const normalizedThinkingLevel = coerceWorkbenchVisibleThinkingLevel(nextThinkingLevel);
            setSelectedReasoningLevel(normalizedThinkingLevel);
            setCodexPreferenceSnapshot((current) => ({
                model: current?.model ?? configuredModel,
                modelReasoningEffort: normalizedThinkingLevel,
                planModeReasoningEffort: normalizedThinkingLevel,
            }));
            persistWorkbenchAiPreference("ai:thinkinglevel", normalizedThinkingLevel);
        },
        [configuredModel, persistWorkbenchAiPreference]
    );

    const handleAIModeSelection = useCallback(
        (nextMode: string) => {
            if (
                isBlank(nextMode) ||
                nextMode === WORKBENCH_AIMODE_INVALID_SELECT_VALUE ||
                nextMode === WORKBENCH_AIMODE_EMPTY_SELECT_VALUE
            ) {
                return;
            }
            void import("@/app/aipanel/waveai-model").then(({ WaveAIModel }) => {
                WaveAIModel.getInstance().setAIMode(nextMode);
            });
        },
        []
    );

    const updateIntegrationsDraft = useCallback(
        (updater: (current: WorkbenchIntegrationsConfig) => WorkbenchIntegrationsConfig) => {
            setIntegrationsDraft((current) => updater(current ?? createDefaultWorkbenchIntegrationsConfig()));
            setIntegrationsDirty(true);
            setIntegrationsError("");
        },
        []
    );

    const updateCodexIntegrationField = useCallback(
        <K extends keyof WorkbenchIntegrationsConfig["codex"]>(
            key: K,
            value: WorkbenchIntegrationsConfig["codex"][K]
        ) => {
            updateIntegrationsDraft((current) => ({
                ...current,
                codex: {
                    ...current.codex,
                    [key]: value,
                },
                provider:
                    key === "modelProvider"
                        ? {
                              ...current.provider,
                              providerName: String(value),
                          }
                        : current.provider,
            }));
        },
        [updateIntegrationsDraft]
    );

    const updateCodexReasoningIntegrationField = useCallback(
        (value: string) => {
            const normalizedThinkingLevel = coerceWorkbenchVisibleThinkingLevel(value);
            updateIntegrationsDraft((current) => ({
                ...current,
                codex: {
                    ...current.codex,
                    modelReasoningEffort: normalizedThinkingLevel,
                    planModeReasoningEffort: normalizedThinkingLevel,
                },
            }));
        },
        [updateIntegrationsDraft]
    );

    const updateProviderIntegrationField = useCallback(
        <K extends keyof WorkbenchIntegrationsConfig["provider"]>(
            key: K,
            value: WorkbenchIntegrationsConfig["provider"][K]
        ) => {
            updateIntegrationsDraft((current) => ({
                ...current,
                provider: {
                    ...current.provider,
                    [key]: value,
                },
            }));
        },
        [updateIntegrationsDraft]
    );

    const addMcpServer = useCallback(() => {
        const currentServers = integrationsDraft?.mcpServers ?? [];
        const nextServer = createWorkbenchMcpServerDraft(currentServers);
        updateIntegrationsDraft((current) => ({
            ...current,
            mcpServers: [...current.mcpServers, nextServer],
        }));
        setSelectedMcpServerName(nextServer.name);
    }, [integrationsDraft, updateIntegrationsDraft]);

    const updateSelectedMcpServer = useCallback(
        <K extends keyof WorkbenchMcpServerConfig>(key: K, value: WorkbenchMcpServerConfig[K]) => {
            if (selectedMcpServer == null) {
                return;
            }
            const currentName = selectedMcpServer.name;
            updateIntegrationsDraft((current) => ({
                ...current,
                mcpServers: current.mcpServers.map((server) => {
                    if (server.name !== currentName) {
                        return server;
                    }
                    const nextServer = {
                        ...server,
                        [key]: value,
                    };
                    if (key === "type" && value !== "stdio") {
                        nextServer.command = "";
                        nextServer.args = [];
                        nextServer.envVars = [];
                    }
                    if (key === "type" && value === "stdio") {
                        nextServer.url = "";
                        nextServer.bearerTokenEnvVar = "";
                    }
                    return nextServer;
                }),
            }));
            if (key === "name" && typeof value === "string") {
                setSelectedMcpServerName(value);
            }
        },
        [selectedMcpServer, updateIntegrationsDraft]
    );

    const removeSelectedMcpServer = useCallback(() => {
        if (selectedMcpServer == null) {
            return;
        }
        const currentName = selectedMcpServer.name;
        updateIntegrationsDraft((current) => ({
            ...current,
            mcpServers: current.mcpServers.filter((server) => server.name !== currentName),
        }));
        setSelectedMcpServerName("");
    }, [selectedMcpServer, updateIntegrationsDraft]);

    const addSkillConfig = useCallback(() => {
        updateIntegrationsDraft((current) => ({
            ...current,
            skills: {
                ...current.skills,
                configs: [...current.skills.configs, { path: "", enabled: true }],
            },
        }));
    }, [updateIntegrationsDraft]);

    const updateSkillConfig = useCallback(
        (index: number, patch: Partial<WorkbenchIntegrationsConfig["skills"]["configs"][number]>) => {
            updateIntegrationsDraft((current) => ({
                ...current,
                skills: {
                    ...current.skills,
                    configs: current.skills.configs.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, ...patch } : item
                    ),
                },
            }));
        },
        [updateIntegrationsDraft]
    );

    const removeSkillConfig = useCallback(
        (index: number) => {
            updateIntegrationsDraft((current) => ({
                ...current,
                skills: {
                    ...current.skills,
                    configs: current.skills.configs.filter((_, itemIndex) => itemIndex !== index),
                },
            }));
        },
        [updateIntegrationsDraft]
    );

    const reloadIntegrations = useCallback(() => {
        setIntegrationsReloadTick((value) => value + 1);
    }, []);

    const saveIntegrations = useCallback(async () => {
        if (integrationsDraft == null) {
            return;
        }
        const validationError = validateWorkbenchIntegrations(integrationsDraft);
        if (validationError != null) {
            setIntegrationsError(validationError);
            return;
        }
        setIntegrationsSaving(true);
        setIntegrationsError("");
        try {
            const currentContent = await readWorkbenchTextFile(WORKBENCH_CODEX_CONFIG_PATH);
            const nextContent = updateWorkbenchIntegrationsConfigText(currentContent, integrationsDraft);
            await RpcApi.FileWriteCommand(TabRpcClient, {
                info: { path: WORKBENCH_CODEX_CONFIG_PATH },
                data64: encodeWorkbenchConfigText(nextContent),
            });
            const nextThinkingLevel = coerceWorkbenchVisibleThinkingLevel(
                integrationsDraft.codex.modelReasoningEffort || integrationsDraft.codex.planModeReasoningEffort
            );
            setSelectedModel(integrationsDraft.codex.model.trim());
            setSelectedReasoningLevel(nextThinkingLevel);
            const metaSyncResult = await Promise.allSettled([
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", model.blockId),
                    meta: {
                        "ai:model": integrationsDraft.codex.model.trim(),
                        "ai:thinkinglevel": nextThinkingLevel,
                        "ai:planthinkinglevel": nextThinkingLevel,
                    },
                }),
            ]);
            if (metaSyncResult[0]?.status === "rejected") {
                console.warn(
                    "failed to sync current workbench ai meta after saving integrations",
                    metaSyncResult[0].reason
                );
            }
            setCodexPreferenceSnapshot(resolveWorkbenchCodexPreferenceSnapshotFromIntegrations(integrationsDraft));
            setIntegrationsDirty(false);
            setConfigRefreshTick((value) => value + 1);
            setDrawerOpen(false);
        } catch (error) {
            setIntegrationsError(formatWorkbenchError(error, "保存集成配置失败"));
        } finally {
            setIntegrationsSaving(false);
        }
    }, [integrationsDraft, model.blockId]);

    useEffect(() => {
        model.toggleDrawer = () => setDrawerOpen((value) => !value);
        model.adjustDrawerWidth = (delta) => {
            adjustDrawerWidth(delta);
        };
        model.openDrawerPanel = (section) => {
            setDrawerSection(section);
            setDrawerOpen(true);
        };
        return () => {
            cancelRef.current = true;
            model.toggleDrawer = undefined;
            model.adjustDrawerWidth = undefined;
            model.openDrawerPanel = undefined;
        };
    }, [adjustDrawerWidth, model]);

    const startDrawerResize = useCallback(
        (e: React.PointerEvent<HTMLDivElement>) => {
            e.preventDefault();
            e.stopPropagation();
            const startX = e.clientX;
            const startWidth = effectiveDrawerWidth;

            const onMove = (event: PointerEvent) => {
                const delta = startX - event.clientX;
                setDrawerWidth(
                    clampDrawerWidth(startWidth + delta, viewportState.drawerMinWidth, viewportState.drawerMaxWidth)
                );
            };
            const onUp = () => {
                window.removeEventListener("pointermove", onMove);
                window.removeEventListener("pointerup", onUp);
                document.body.style.removeProperty("cursor");
                document.body.style.removeProperty("user-select");
            };

            setDrawerOpen(true);
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
        },
        [effectiveDrawerWidth, viewportState.drawerMaxWidth, viewportState.drawerMinWidth]
    );

    const stopSend = () => {
        cancelRef.current = true;
    };

    const syncMessageFollowState = useCallback(
        (manualActivity: boolean) => {
            const elem = messageScrollRef.current;
            if (elem == null) {
                return;
            }
            const isNearBottom = isWorkbenchViewportNearBottom(elem.scrollHeight, elem.scrollTop, elem.clientHeight);
            if (manualActivity && !isNearBottom) {
                detachLatestOutputFollow();
                return;
            }
            const nextState = resolveWorkbenchFollowLatestState(
                elem.scrollHeight,
                elem.scrollTop,
                elem.clientHeight,
                manuallyDetachedFromLatestOutputRef.current
            );
            setMessageFollowMode(nextState.followLatestOutput, nextState.manuallyDetached);
            if (nextState.manuallyDetached) {
                autoFollowResumeControllerRef.current?.markActivity(manualActivity);
                return;
            }
            autoFollowResumeControllerRef.current?.cancel();
        },
        [detachLatestOutputFollow, setMessageFollowMode]
    );

    const handleMessageWheelCapture = useCallback(
        (e: React.WheelEvent<HTMLDivElement>) => {
            const elem = messageScrollRef.current;
            if (elem == null) {
                return;
            }
            manualScrollIntentRef.current = true;
            const movingAwayFromBottom = e.deltaY < 0;
            if (
                movingAwayFromBottom ||
                manuallyDetachedFromLatestOutputRef.current ||
                !isWorkbenchViewportNearBottom(elem.scrollHeight, elem.scrollTop, elem.clientHeight)
            ) {
                detachLatestOutputFollow();
            }
        },
        [detachLatestOutputFollow]
    );

    const handleMessageScroll = useCallback(() => {
        const manualActivity = manualScrollIntentRef.current;
        manualScrollIntentRef.current = false;
        syncMessageFollowState(manualActivity);
    }, [syncMessageFollowState]);

    const insertWorkbenchComposerText = useCallback((text: string) => {
        if (isBlank(text)) {
            return;
        }
        setInput((prev) => appendWorkbenchComposerText(String(prev ?? ""), text));
        requestAnimationFrame(() => {
            inputRef.current?.focus();
        });
    }, []);

    const handleWorkbenchContextMenu = useCallback(
        (e: React.MouseEvent<HTMLDivElement>) => {
            const target = e.target instanceof Element ? e.target : null;
            if (target?.closest("input, textarea, select, option, button, [contenteditable='true']")) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            ContextMenuModel.showContextMenu(model.getSettingsMenuItems(), e);
        },
        [model]
    );

    const send = async () => {
        const draftText = composerInput.commitDraftValue(inputRef.current?.value);
        const entry = createWorkbenchComposerEntry(draftText);
        if (entry == null || sending) return;
        const intent = resolveWorkbenchDispatchIntent(entry);
        await dispatchWorkbenchIntent(intent, {
            onLocalAction: handleWorkbenchLocalAction,
            onCodexTurn: async ({ entry: codexEntry }) => {
                if (!codexAuthReady) {
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `err-${Date.now()}`,
                            role: "error",
                            title: "Codex 未就绪",
                            content: "当前本机 Codex 还未登录或未准备好可用鉴权。先把 Codex 主链准备好，再回来发送。",
                            timestamp: stamp(),
                        },
                    ]);
                    return;
                }
                const pendingId = `pending-${Date.now()}`;
                const userPrompt: WaveAIPromptMessageType = { role: "user", content: codexEntry.normalizedText };
                setMessages((prev) => [
                    ...prev,
                    { id: `u-${Date.now()}`, role: "user", content: codexEntry.normalizedText, timestamp: stamp() },
                    {
                        id: pendingId,
                        role: "assistant",
                        title: "正在回复",
                        content: "",
                        timestamp: stamp(),
                        isUpdating: true,
                    },
                ]);
                setInput("");
                setSending(true);
                cancelRef.current = false;
                let fullMsg = "";
                const fullHistory = persistedHistoryRef.current;
                try {
                    await ensureWorkbenchCodexSessionReady();
                    const baselineOutputTs = Number(workbenchLastOutputTsRef.current) || 0;
                    const aiGen = streamWorkbenchCodexTerminalGateway({
                        blockId: model.blockId,
                        promptText: codexEntry.normalizedText,
                        baselineOutputTs,
                        getOutputTs: () => Number(workbenchLastOutputTsRef.current) || 0,
                        sendTerminalInput: (input) => sendWorkbenchTerminalInput(model.blockId, input),
                        isAbortRequested: () => cancelRef.current,
                        abortTerminalInput: () => sendWorkbenchTerminalInput(model.blockId, "\u001b"),
                        timeoutMs: Math.max(Number(resolvedAiOpts.timeoutms ?? 0) || 0, 120000),
                    });
                    for await (const msg of aiGen) {
                        if (cancelRef.current) {
                            break;
                        }
                        if (!isBlank(msg.error)) {
                            throw new Error(msg.error);
                        }
                        if (isBlank(msg.text)) {
                            continue;
                        }
                        fullMsg += msg.text ?? "";
                        setMessages((prev) =>
                            prev.map((item) =>
                                item.id === pendingId
                                    ? {
                                          ...item,
                                          content: item.content + (msg.text ?? ""),
                                          isUpdating: true,
                                      }
                                    : item
                            )
                        );
                    }

                    if (isBlank(fullMsg)) {
                        setMessages((prev) => prev.filter((item) => item.id !== pendingId));
                        const nextHistory = buildWorkbenchPersistedHistory(fullHistory, [userPrompt]);
                        hiddenHistoryRef.current = [];
                        persistedHistoryRef.current = nextHistory;
                        setHasRestorableHistory(false);
                        await BlockService.SaveWaveAiData(model.blockId, nextHistory);
                    } else {
                        const responsePrompt: WaveAIPromptMessageType = { role: "assistant", content: fullMsg };
                        setMessages((prev) =>
                            prev.map((item) =>
                                item.id === pendingId
                                    ? {
                                          ...item,
                                          title: undefined,
                                          isUpdating: false,
                                      }
                                    : item
                            )
                        );
                        const nextHistory = buildWorkbenchPersistedHistory(fullHistory, [userPrompt, responsePrompt]);
                        hiddenHistoryRef.current = [];
                        persistedHistoryRef.current = nextHistory;
                        setHasRestorableHistory(false);
                        await BlockService.SaveWaveAiData(model.blockId, nextHistory);
                    }
                } catch (error) {
                    const errMsg = (error as Error)?.message ?? String(error);
                    if (isBlank(fullMsg)) {
                        setMessages((prev) => prev.filter((item) => item.id !== pendingId));
                    } else {
                        setMessages((prev) =>
                            prev.map((item) =>
                                item.id === pendingId
                                    ? {
                                          ...item,
                                          isUpdating: false,
                                          title: undefined,
                                      }
                                    : item
                            )
                        );
                    }
                    setMessages((prev) => [
                        ...prev,
                        {
                            id: `err-${Date.now()}`,
                            role: "error",
                            title: "调用失败",
                            content: errMsg,
                            timestamp: stamp(),
                        },
                    ]);
                    const nextPrompts: WaveAIPromptMessageType[] = [userPrompt];
                    if (!isBlank(fullMsg)) {
                        nextPrompts.push({ role: "assistant", content: fullMsg });
                    }
                    const nextHistory = buildWorkbenchPersistedHistory(fullHistory, nextPrompts);
                    hiddenHistoryRef.current = [];
                    persistedHistoryRef.current = nextHistory;
                    setHasRestorableHistory(false);
                    await BlockService.SaveWaveAiData(model.blockId, nextHistory);
                } finally {
                    setSending(false);
                    cancelRef.current = false;
                }
            },
        });
    };

    useEffect(() => {
        const elem = messageScrollRef.current;
        if (elem == null) {
            return;
        }
        if (!followLatestOutputRef.current || manuallyDetachedFromLatestOutputRef.current) {
            return;
        }
        elem.scrollTo({ top: elem.scrollHeight });
    }, [messages]);

    return (
        <div
            ref={shellRef}
            className="workbench-shell"
            style={workbenchShellStyle}
            data-layout-density={viewportState.density}
            tabIndex={-1}
            onContextMenu={handleWorkbenchContextMenu}
        >
            <div className="workbench-shell__stage">
                <div className="workbench-main">
                    <div
                        ref={messageScrollRef}
                        className="workbench-messageScroll"
                        onPointerDownCapture={() => {
                            manualScrollIntentRef.current = true;
                        }}
                        onScroll={handleMessageScroll}
                        onWheelCapture={handleMessageWheelCapture}
                    >
                        <div className="messageList">
                            {messages.map((msg) => (
                                <Message key={msg.id} message={msg} />
                            ))}
                        </div>
                    </div>

                    <div className="chatInputArea">
                        <div className="chatInputBox">
                            <textarea
                                ref={inputRef}
                                className="chatInputTextarea"
                                value={composerInput.value}
                                onChange={composerInput.handleChange}
                                onCompositionStart={composerInput.handleCompositionStart}
                                onCompositionEnd={composerInput.handleCompositionEnd}
                                onBlur={composerInput.handleBlurWhileComposing}
                                onKeyDown={(e) => {
                                    const isComposing =
                                        composerInput.isComposingRef.current.isComposing ||
                                        e.nativeEvent?.isComposing ||
                                        e.keyCode == 229;
                                    if (e.key === "Enter" && !e.shiftKey && !isComposing) {
                                        e.preventDefault();
                                        void send();
                                    }
                                }}
                                rows={1}
                                placeholder="向 Codex 任意提问，@ 添加文件，/ 调出命令"
                            />

                            <div className="chatInputPrimaryBar">
                                <div className="chatInputPrimaryLeft">
                                    <div className="composerMeta" role="status" aria-live="polite">
                                        {composerPrimaryStatusItems.map((item) => (
                                            <span key={item}>{item}</span>
                                        ))}
                                    </div>
                                </div>

                                <div className="chatInputPrimaryRight">
                                    {sending ? (
                                        <button
                                            type="button"
                                            className="chatInputSendBtn chatInputStopBtn"
                                            onClick={stopSend}
                                        >
                                            停
                                        </button>
                                    ) : (
                                        <button type="button" className="chatInputSendBtn" onClick={send}>
                                            ↑
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="chatInputQuickInsertBar">
                                <div className="chatInputQuickInsertGroup">
                                    <button
                                        type="button"
                                        className="chatInputQuickInsertBtn"
                                        disabled={isBlank(quickInsertPathText)}
                                        onClick={() => insertWorkbenchComposerText(quickInsertPathText)}
                                    >
                                        当前路径
                                    </button>
                                    <button
                                        type="button"
                                        className="chatInputQuickInsertBtn"
                                        disabled={isBlank(diagnosticsInsertText)}
                                        onClick={() => insertWorkbenchComposerText(diagnosticsInsertText)}
                                    >
                                        诊断摘要
                                    </button>
                                    <button
                                        type="button"
                                        className="chatInputQuickInsertBtn"
                                        disabled={isBlank(latestUserReplayText)}
                                        onClick={() => insertWorkbenchComposerText(latestUserReplayText)}
                                    >
                                        最近问题
                                    </button>
                                </div>
                            </div>
                            <div className="chatInputFooterBar">
                                <div className="chatInputFooterLeft">
                                    <div className="composerMeta" role="status" aria-live="polite">
                                        <span>历史 {messages.length} 条</span>
                                        {hasRestorableHistory ? <span>可点右上角恢复上次记录</span> : null}
                                    </div>
                                </div>
                                <div className="chatInputFooterRight">
                                    {messageAutoFollowDetached ? (
                                        <button
                                            type="button"
                                            className="chatInputFollowNotice"
                                            onClick={() => resumeLatestOutputFollow(true)}
                                        >
                                            已暂停自动跟随，回到底部后恢复
                                        </button>
                                    ) : null}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div
                    className={`convSidebarResizeHandle${drawerOpen ? "" : " is-hidden"}`}
                    onPointerDown={startDrawerResize}
                    title={`拖动调整右侧边栏宽度（当前最大 ${Math.round(viewportState.drawerMaxWidth)}px）`}
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="调整右侧边栏宽度"
                />
                <aside
                    id={`workbench-sidebar-${model.blockId}`}
                    className={`convSidebar${drawerOpen ? "" : " is-collapsed"}`}
                    style={drawerOpen ? { width: effectiveDrawerWidth, minWidth: effectiveDrawerWidth } : undefined}
                >
                    <div className="convSidebarHeader">
                        <div className="convSidebarMeta">
                            <span>{drawerOpen ? `右栏 ${Math.round(effectiveDrawerWidth)}px` : "右栏已收起"}</span>
                            <span>{WORKBENCH_DRAWER_CONTROL_HINT}</span>
                        </div>
                        <div className="drawerTabs">
                            {TABS.map((tab) => (
                                <button
                                    type="button"
                                    key={tab.id}
                                    className={`drawerTabs__item${drawerSection === tab.id ? " is-active" : ""}`}
                                    onClick={() => {
                                        setDrawerOpen(true);
                                        setDrawerSection(tab.id);
                                    }}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="convSidebarList">
                        <div className="drawerPanel">
                            {drawerSection === "task" ? (
                                <>
                                    <Card title="当前任务">
                                        <TaskSummary
                                            summary={taskPanelData.currentTask}
                                            emptyText="暂未识别到当前任务"
                                        />
                                    </Card>
                                    <Card title="最近结论">
                                        <TaskSummary
                                            summary={taskPanelData.recentConclusion}
                                            emptyText={sending ? "AI 正在整理本轮结论" : "最近还没有可展示的结论"}
                                        />
                                    </Card>
                                    <Card title="待办 / 行动项">
                                        <TaskTodoList items={taskPanelData.todos} />
                                    </Card>
                                    <Card title="基本工作状态">
                                        <TaskStatus
                                            label={taskPanelData.statusLabel}
                                            detail={taskPanelData.statusDetail}
                                            items={taskPanelData.statusItems}
                                        />
                                    </Card>
                                </>
                            ) : drawerSection === "settings" ? (
                                <>
                                    <Card title="工作模式">
                                        <Row label="当前模式">
                                            <select
                                                value={currentAIModeState.selectValue}
                                                onChange={(e) => handleAIModeSelection(e.target.value)}
                                                disabled={!currentAIModeState.hasAvailableModes}
                                                title={currentAIModeDescription}
                                            >
                                                {currentAIModeState.selectValue ===
                                                WORKBENCH_AIMODE_INVALID_SELECT_VALUE ? (
                                                    <option value={WORKBENCH_AIMODE_INVALID_SELECT_VALUE}>
                                                        {currentAIModeLabel}
                                                    </option>
                                                ) : null}
                                                {currentAIModeState.modeOptions.length > 0 ? (
                                                    currentAIModeState.modeOptions.map((option) => (
                                                        <option key={option.value} value={option.value}>
                                                            {option.label}
                                                        </option>
                                                    ))
                                                ) : (
                                                    <option value={WORKBENCH_AIMODE_EMPTY_SELECT_VALUE}>
                                                        暂无可用模式
                                                    </option>
                                                )}
                                            </select>
                                        </Row>
                                        <Info
                                            items={[
                                                ["当前模式", currentAIModeLabel],
                                                ["模式说明", currentAIModeDescription],
                                                [
                                                    "可用模式",
                                                    currentAIModeState.hasAvailableModes
                                                        ? `${currentAIModeState.modeOptions.length} 个`
                                                        : "暂无可用模式",
                                                ],
                                            ]}
                                        />
                                    </Card>
                                    <Card title="模型与推理">
                                        <Row label="模型">
                                            <select
                                                value={selectedModel || "__unset__"}
                                                onChange={(e) => handleModelSelection(e.target.value)}
                                                disabled={modelOptions.length === 0}
                                                title={modelOptionsState.sourceLabel}
                                            >
                                                {modelOptions.length > 0 ? (
                                                    modelOptions.map((item) => <option key={item}>{item}</option>)
                                                ) : (
                                                    <option value="__unset__">当前配置未提供可信模型列表</option>
                                                )}
                                            </select>
                                        </Row>
                                        <Row label="推理强度">
                                            <select
                                                value={
                                                    thinkingLevelSupported
                                                        ? selectedReasoningLevel || WORKBENCH_THINKING_LEVEL_UNSET_VALUE
                                                        : "__unsupported__"
                                                }
                                                onChange={(e) => handleReasoningLevelSelection(e.target.value)}
                                                disabled={!thinkingLevelSupported}
                                                title={thinkingLevelSupported ? undefined : "当前模型不支持推理强度"}
                                            >
                                                {thinkingLevelSupported ? (
                                                    [
                                                        <option
                                                            key={WORKBENCH_THINKING_LEVEL_UNSET_VALUE}
                                                            value={WORKBENCH_THINKING_LEVEL_UNSET_VALUE}
                                                            disabled
                                                        >
                                                            未配置
                                                        </option>,
                                                        ...THINKING_LEVEL_OPTIONS.map((item) => (
                                                            <option key={item.value} value={item.value}>
                                                                {item.label}
                                                            </option>
                                                        )),
                                                    ]
                                                ) : (
                                                    <option value="__unsupported__">当前模型不支持</option>
                                                )}
                                            </select>
                                        </Row>
                                        <Info
                                            items={[
                                                ["当前模型", codexPreferenceSnapshot?.model.trim() || "未配置"],
                                                [
                                                    "当前推理",
                                                    configuredReasoningLevel
                                                        ? getThinkingLevelLabel(configuredReasoningLevel)
                                                        : "未配置",
                                                ],
                                                ["列表来源", modelOptionsState.sourceLabel],
                                                [
                                                    "写入范围",
                                                    "同时写入 config.toml 的 model_reasoning_effort / plan_mode_reasoning_effort，并同步当前窗口 meta",
                                                ],
                                            ]}
                                        />
                                    </Card>
                                    <Card title="端点覆盖">
                                        <Row label="端点模式">
                                            <Segment
                                                value={endpointMode}
                                                options={[
                                                    { value: "auto", label: "自动" },
                                                    { value: "manual", label: "手动" },
                                                ]}
                                                onChange={(value) => setEndpointMode(value as EndpointMode)}
                                            />
                                        </Row>
                                        <Row label="Base URL">
                                            <input
                                                value={endpointBaseUrl}
                                                onChange={(e) => setEndpointBaseUrl(e.target.value)}
                                            />
                                        </Row>
                                        <Info
                                            items={[
                                                ["当前模型", resolvedAiOpts.model || "未配置"],
                                                [
                                                    "推理强度",
                                                    getWorkbenchThinkingLevelSummary(
                                                        activeModel,
                                                        resolvedAiOpts.thinkinglevel
                                                    ),
                                                ],
                                                [
                                                    "生效 Base URL",
                                                    isBlank(resolvedAiOpts.baseurl) ? "默认" : resolvedAiOpts.baseurl,
                                                ],
                                                ["来源", effectiveBaseUrlSource],
                                            ]}
                                        />
                                    </Card>
                                    <Card title="工作台主题">
                                        <Row label="配色方向">
                                            <Segment
                                                value={themeVariant}
                                                options={WORKBENCH_THEME_OPTIONS}
                                                onChange={(value) => {
                                                    if (isWorkbenchThemeVariant(value)) {
                                                        setThemeVariant(value);
                                                    }
                                                }}
                                            />
                                        </Row>
                                        <Info
                                            items={[
                                                [
                                                    "当前主题",
                                                    WORKBENCH_THEME_OPTIONS.find((item) => item.value === themeVariant)
                                                        ?.label ?? "Wave",
                                                ],
                                                ["主题来源", workbenchTermTheme],
                                                ["背景基线", "沿用渐变 + 光晕，只切换强调色"],
                                            ]}
                                        />
                                    </Card>
                                    <Card title="职责说明">
                                        <ul className="noteList">
                                            {WORKBENCH_DRAWER_CONTROL_NOTES.map((note) => (
                                                <li key={note}>{note}</li>
                                            ))}
                                        </ul>
                                    </Card>
                                </>
                            ) : drawerSection === "integrations" ? (
                                <>
                                    <Card title="Codex 配置">
                                        <div className="integrationToolbar">
                                            <div className="integrationToolbar__meta">
                                                <strong>真实写回 `config.toml`</strong>
                                                <span>{WORKBENCH_CODEX_CONFIG_PATH}</span>
                                            </div>
                                            <div className="integrationToolbar__actions">
                                                <button
                                                    type="button"
                                                    className="integrationButton"
                                                    onClick={reloadIntegrations}
                                                    disabled={integrationsLoading || integrationsSaving}
                                                >
                                                    重新读取
                                                </button>
                                                <button
                                                    type="button"
                                                    className="integrationButton is-primary"
                                                    onClick={() => void saveIntegrations()}
                                                    disabled={
                                                        integrationsLoading ||
                                                        integrationsSaving ||
                                                        integrationsDraft == null
                                                    }
                                                >
                                                    {integrationsSaving ? "保存中..." : "保存并收回"}
                                                </button>
                                            </div>
                                        </div>
                                        <Info
                                            items={[
                                                ["当前 provider", integrationsDraft?.codex.modelProvider || "未配置"],
                                                ["当前模型", integrationsDraft?.codex.model || "未配置"],
                                                ["MCP 数量", `${integrationsDraft?.mcpServers.length ?? 0} 个`],
                                                ["本地技能目录", `${discoveredSkillPaths.length} 个`],
                                            ]}
                                        />
                                        {integrationsError !== "" ? (
                                            <p className="integrationFeedback is-error">{integrationsError}</p>
                                        ) : integrationsDirty ? (
                                            <p className="integrationFeedback">检测到未保存修改。</p>
                                        ) : integrationsLoading ? (
                                            <p className="integrationFeedback">正在读取集成配置...</p>
                                        ) : (
                                            <p className="integrationFeedback">
                                                这里修改的是 Codex 默认配置；保存后右栏会自动收回。
                                            </p>
                                        )}
                                    </Card>
                                    <Card title="Codex 核心">
                                        <Row label="默认模型" wide>
                                            <select
                                                value={integrationsDraft?.codex.model || "__unset__"}
                                                onChange={(e) => updateCodexIntegrationField("model", e.target.value)}
                                                disabled={integrationsDraft == null}
                                            >
                                                {integrationModelOptions.length > 0 ? (
                                                    integrationModelOptions.map((item) => (
                                                        <option key={item} value={item}>
                                                            {item}
                                                        </option>
                                                    ))
                                                ) : (
                                                    <option value="__unset__">当前端点未返回可信模型列表</option>
                                                )}
                                            </select>
                                        </Row>
                                        <Row label="推理强度" wide>
                                            <Segment
                                                value={coerceWorkbenchVisibleThinkingLevel(
                                                    integrationsDraft?.codex.modelReasoningEffort ||
                                                        integrationsDraft?.codex.planModeReasoningEffort ||
                                                        DEFAULT_THINKING_LEVEL
                                                )}
                                                options={THINKING_LEVEL_OPTIONS}
                                                onChange={updateCodexReasoningIntegrationField}
                                            />
                                        </Row>
                                        <Row label="审批策略" wide>
                                            <Segment
                                                value={integrationsDraft?.codex.approvalPolicy || "never"}
                                                options={[...WORKBENCH_APPROVAL_POLICY_OPTIONS]}
                                                onChange={(value) =>
                                                    updateCodexIntegrationField("approvalPolicy", value)
                                                }
                                            />
                                        </Row>
                                        <Row label="沙箱模式" wide>
                                            <Segment
                                                value={integrationsDraft?.codex.sandboxMode || "danger-full-access"}
                                                options={[...WORKBENCH_SANDBOX_MODE_OPTIONS]}
                                                onChange={(value) => updateCodexIntegrationField("sandboxMode", value)}
                                            />
                                        </Row>
                                        <Row label="Provider 名称" wide>
                                            <input
                                                value={integrationsDraft?.codex.modelProvider || ""}
                                                onChange={(e) =>
                                                    updateCodexIntegrationField("modelProvider", e.target.value)
                                                }
                                                placeholder="例如 custom"
                                            />
                                        </Row>
                                        <Row label="关闭响应存储" wide>
                                            <SwitchButton
                                                checked={integrationsDraft?.codex.disableResponseStorage === true}
                                                onChange={(checked) =>
                                                    updateCodexIntegrationField("disableResponseStorage", checked)
                                                }
                                            />
                                        </Row>
                                        <Row label="屏蔽不稳定功能提示" wide>
                                            <SwitchButton
                                                checked={
                                                    integrationsDraft?.codex.suppressUnstableFeaturesWarning === true
                                                }
                                                onChange={(checked) =>
                                                    updateCodexIntegrationField(
                                                        "suppressUnstableFeaturesWarning",
                                                        checked
                                                    )
                                                }
                                            />
                                        </Row>
                                    </Card>
                                    <Card title="Provider 接线">
                                        <Row label="Base URL" wide>
                                            <input
                                                value={integrationsDraft?.provider.baseUrl || ""}
                                                onChange={(e) =>
                                                    updateProviderIntegrationField("baseUrl", e.target.value)
                                                }
                                                placeholder="http://127.0.0.1:8080/v1"
                                            />
                                        </Row>
                                        <Row label="Wire API" wide>
                                            <select
                                                value={integrationsDraft?.provider.wireApi || "responses"}
                                                onChange={(e) =>
                                                    updateProviderIntegrationField("wireApi", e.target.value)
                                                }
                                            >
                                                {WORKBENCH_WIRE_API_OPTIONS.map((item) => (
                                                    <option key={item.value} value={item.value}>
                                                        {item.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </Row>
                                        <Row label="需要 OpenAI Auth" wide>
                                            <SwitchButton
                                                checked={integrationsDraft?.provider.requiresOpenAIAuth === true}
                                                onChange={(checked) =>
                                                    updateProviderIntegrationField("requiresOpenAIAuth", checked)
                                                }
                                            />
                                        </Row>
                                        <Info
                                            items={[
                                                ["当前 provider", integrationsDraft?.provider.providerName || "未配置"],
                                                [
                                                    "运行时 Base URL",
                                                    isBlank(resolvedAiOpts.baseurl)
                                                        ? "默认"
                                                        : resolvedAiOpts.baseurl || "默认",
                                                ],
                                                ["模型列表来源", modelOptionsState.sourceLabel],
                                                ["当前窗口连接", currentConnectionInfo.footerLabel],
                                            ]}
                                        />
                                    </Card>
                                    <Card title="MCP 服务器">
                                        <div className="integrationSectionHeader">
                                            <strong>{integrationsDraft?.mcpServers.length ?? 0} 个已配置服务器</strong>
                                            <div className="integrationSectionHeader__actions">
                                                <button
                                                    type="button"
                                                    className="integrationButton"
                                                    onClick={addMcpServer}
                                                    disabled={integrationsDraft == null}
                                                >
                                                    新增
                                                </button>
                                                <button
                                                    type="button"
                                                    className="integrationButton is-danger"
                                                    onClick={removeSelectedMcpServer}
                                                    disabled={selectedMcpServer == null}
                                                >
                                                    删除
                                                </button>
                                            </div>
                                        </div>
                                        {integrationsDraft != null && integrationsDraft.mcpServers.length > 0 ? (
                                            <>
                                                <div className="integrationList">
                                                    {integrationsDraft.mcpServers.map((server) => (
                                                        <button
                                                            type="button"
                                                            key={server.name}
                                                            className={`integrationListItem${
                                                                selectedMcpServer?.name === server.name
                                                                    ? " is-active"
                                                                    : ""
                                                            }`}
                                                            onClick={() => setSelectedMcpServerName(server.name)}
                                                        >
                                                            <strong>{server.name}</strong>
                                                            <span>
                                                                {server.type === "stdio"
                                                                    ? `${server.type} · ${server.command || "未填 command"}`
                                                                    : `${server.type} · ${server.url || "未填 url"}`}
                                                            </span>
                                                        </button>
                                                    ))}
                                                </div>
                                                {selectedMcpServer != null ? (
                                                    <div className="integrationEditor">
                                                        <Row label="名称" wide>
                                                            <input
                                                                value={selectedMcpServer.name}
                                                                onChange={(e) =>
                                                                    updateSelectedMcpServer("name", e.target.value)
                                                                }
                                                            />
                                                        </Row>
                                                        <Row label="类型" wide>
                                                            <Segment
                                                                value={selectedMcpServer.type}
                                                                options={[
                                                                    { value: "stdio", label: "stdio" },
                                                                    { value: "streamable_http", label: "shttp" },
                                                                    { value: "sse", label: "sse" },
                                                                ]}
                                                                onChange={(value) =>
                                                                    updateSelectedMcpServer(
                                                                        "type",
                                                                        value as WorkbenchMcpServerType
                                                                    )
                                                                }
                                                            />
                                                        </Row>
                                                        {selectedMcpServer.type === "stdio" ? (
                                                            <>
                                                                <Row label="Command" wide>
                                                                    <input
                                                                        value={selectedMcpServer.command}
                                                                        onChange={(e) =>
                                                                            updateSelectedMcpServer(
                                                                                "command",
                                                                                e.target.value
                                                                            )
                                                                        }
                                                                    />
                                                                </Row>
                                                                <Row label="Args" wide>
                                                                    <textarea
                                                                        rows={3}
                                                                        value={selectedMcpServer.args.join("\n")}
                                                                        onChange={(e) =>
                                                                            updateSelectedMcpServer(
                                                                                "args",
                                                                                splitWorkbenchTextLines(e.target.value)
                                                                            )
                                                                        }
                                                                        placeholder="每行一个参数"
                                                                    />
                                                                </Row>
                                                                <Row label="Env Vars" wide>
                                                                    <textarea
                                                                        rows={3}
                                                                        value={selectedMcpServer.envVars.join("\n")}
                                                                        onChange={(e) =>
                                                                            updateSelectedMcpServer(
                                                                                "envVars",
                                                                                splitWorkbenchTextLines(e.target.value)
                                                                            )
                                                                        }
                                                                        placeholder="每行一个环境变量名"
                                                                    />
                                                                </Row>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Row label="URL" wide>
                                                                    <input
                                                                        value={selectedMcpServer.url}
                                                                        onChange={(e) =>
                                                                            updateSelectedMcpServer(
                                                                                "url",
                                                                                e.target.value
                                                                            )
                                                                        }
                                                                    />
                                                                </Row>
                                                                <Row label="Bearer Env" wide>
                                                                    <input
                                                                        value={selectedMcpServer.bearerTokenEnvVar}
                                                                        onChange={(e) =>
                                                                            updateSelectedMcpServer(
                                                                                "bearerTokenEnvVar",
                                                                                e.target.value
                                                                            )
                                                                        }
                                                                        placeholder="例如 CONTEXT7_API_KEY"
                                                                    />
                                                                </Row>
                                                            </>
                                                        )}
                                                        <Row label="启动超时" wide>
                                                            <input
                                                                value={selectedMcpServer.startupTimeoutSec}
                                                                onChange={(e) =>
                                                                    updateSelectedMcpServer(
                                                                        "startupTimeoutSec",
                                                                        e.target.value
                                                                    )
                                                                }
                                                                placeholder="例如 120"
                                                            />
                                                        </Row>
                                                    </div>
                                                ) : null}
                                            </>
                                        ) : (
                                            <p className="integrationEmpty">当前还没有 MCP 服务器配置。</p>
                                        )}
                                    </Card>
                                    <Card title="Skills">
                                        <Row label="Bundled Skills" wide>
                                            <SwitchButton
                                                checked={integrationsDraft?.skills.bundledEnabled === true}
                                                onChange={(checked) =>
                                                    updateIntegrationsDraft((current) => ({
                                                        ...current,
                                                        skills: {
                                                            ...current.skills,
                                                            bundledEnabled: checked,
                                                        },
                                                    }))
                                                }
                                            />
                                        </Row>
                                        <div className="integrationSectionHeader">
                                            <strong>自定义 Skills 路径</strong>
                                            <button
                                                type="button"
                                                className="integrationButton"
                                                onClick={addSkillConfig}
                                                disabled={integrationsDraft == null}
                                            >
                                                新增
                                            </button>
                                        </div>
                                        {integrationsDraft != null && integrationsDraft.skills.configs.length > 0 ? (
                                            <div className="integrationRuleList">
                                                {integrationsDraft.skills.configs.map((item, index) => (
                                                    <div key={`${item.path}-${index}`} className="integrationRuleItem">
                                                        <input
                                                            value={item.path}
                                                            onChange={(e) =>
                                                                updateSkillConfig(index, { path: e.target.value })
                                                            }
                                                            placeholder="输入 skill 目录路径"
                                                        />
                                                        <SwitchButton
                                                            checked={item.enabled}
                                                            onChange={(checked) =>
                                                                updateSkillConfig(index, { enabled: checked })
                                                            }
                                                        />
                                                        <button
                                                            type="button"
                                                            className="integrationIconButton"
                                                            onClick={() => removeSkillConfig(index)}
                                                            aria-label="删除技能路径"
                                                        >
                                                            删除
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="integrationEmpty">当前没有自定义 skill 路径。</p>
                                        )}
                                        <div className="integrationDiscovery">
                                            <strong>本地技能目录</strong>
                                            {discoveredSkillPaths.length > 0 ? (
                                                <div className="integrationDiscovery__list">
                                                    {discoveredSkillPaths.slice(0, 12).map((path) => (
                                                        <span
                                                            key={path}
                                                            className="integrationDiscovery__chip"
                                                            title={path}
                                                        >
                                                            {getWorkbenchSkillPathLabel(path)}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="integrationEmpty">暂未在本地技能目录发现可展示的条目。</p>
                                            )}
                                            <p className="integrationHint">
                                                这里先归拢本地 skills 配置；远程市场能力依赖 Codex
                                                app-server，当前页不做假开关。
                                            </p>
                                        </div>
                                    </Card>
                                </>
                            ) : drawerSection === "lsp" ? (
                                <>
                                    <Card title="LSP 总览">
                                        <Info items={lspPanelData.overviewItems} />
                                    </Card>
                                    <Card title="诊断与接线">
                                        <Info items={lspPanelData.diagnosticsItems} />
                                    </Card>
                                    <Card title="语言能力">
                                        <div className="workbenchLspChipList">
                                            {lspPanelData.capabilityItems.map((item) => (
                                                <div
                                                    key={item.label}
                                                    className={`workbenchLspChip workbenchLspChip--${item.tone}`}
                                                >
                                                    <strong>{item.label}</strong>
                                                    <span>{item.detail}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </Card>
                                    <Card title="Schema 映射">
                                        <div className="workbenchLspSchemaList">
                                            {lspPanelData.schemaItems.map((item) => (
                                                <div
                                                    key={`${item.label}:${item.detail}`}
                                                    className="workbenchLspSchemaRow"
                                                >
                                                    <strong>{item.label}</strong>
                                                    <span>{item.detail}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </Card>
                                </>
                            ) : (
                                <>
                                    <Card title="运行状态">
                                        <Info
                                            items={[
                                                ["块模式", `workbench（可切回${traditionalViewName}）`],
                                                ["发送状态", sending ? "发送中" : "空闲"],
                                                ["当前连接", currentConnectionInfo.footerLabel],
                                                ["当前模式", currentAIModeLabel],
                                                ["当前模型", resolvedAiOpts.model || "未配置"],
                                                [
                                                    "推理强度",
                                                    getWorkbenchThinkingLevelSummary(
                                                        activeModel,
                                                        resolvedAiOpts.thinkinglevel
                                                    ),
                                                ],
                                                ["端点模式", endpointMode === "manual" ? "手动覆盖" : "跟随预设"],
                                                [
                                                    "生效 Base URL",
                                                    isBlank(resolvedAiOpts.baseurl) ? "默认" : resolvedAiOpts.baseurl,
                                                ],
                                                ["最近一条", getLastMessageSummary(messages)],
                                            ]}
                                        />
                                    </Card>
                                    <Card title="当前真实接线">
                                        <Info items={buildConnectionRuntimeItems(currentConnectionInfo)} />
                                    </Card>
                                </>
                            )}
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    );
});

const Card = ({ title, children }: { title: string; children: ReactNode }) => (
    <section className="panelCard">
        <div className="panelCard__header">
            <strong>{title}</strong>
        </div>
        <div className="panelCard__body">{children}</div>
    </section>
);

const Row = ({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) => (
    <div className={`settingRow${wide ? " is-wide" : ""}`}>
        <div className="settingRow__meta">
            <strong>{label}</strong>
        </div>
        <div className="settingRow__control">{children}</div>
    </div>
);

const Segment = ({
    value,
    options,
    onChange,
}: {
    value: string;
    options: Array<{ value: string; label: string }>;
    onChange: (value: string) => void;
}) => (
    <div className="segmentedControl">
        {options.map((option) => (
            <button
                type="button"
                key={option.value}
                className={`segmentedControl__item${value === option.value ? " is-active" : ""}`}
                onClick={() => onChange(option.value)}
            >
                {option.label}
            </button>
        ))}
    </div>
);

const Info = ({ items }: { items: Array<[string, string]> }) => (
    <div className="infoList">
        {items.map(([label, value]) => (
            <div key={label} className="infoList__item">
                <span>{label}</span>
                <strong>{value}</strong>
            </div>
        ))}
    </div>
);

const SwitchButton = ({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) => (
    <button
        type="button"
        className={`switchButton${checked ? " is-active" : ""}`}
        aria-pressed={checked}
        onClick={() => onChange(!checked)}
    >
        <em>{checked ? "开启" : "关闭"}</em>
        <span />
    </button>
);

const TASK_SUMMARY_STYLE: CSSProperties = {
    display: "grid",
    gap: "10px",
};

const TASK_SUMMARY_DETAIL_STYLE: CSSProperties = {
    margin: 0,
    color: "var(--wb-muted)",
    lineHeight: 1.55,
    whiteSpace: "pre-wrap",
};

const TASK_SUMMARY_SOURCE_STYLE: CSSProperties = {
    fontSize: "12px",
    color: "var(--wb-faint)",
};

const TASK_TODO_LIST_STYLE: CSSProperties = {
    display: "grid",
    gap: "8px",
};

const TASK_TODO_ITEM_STYLE: CSSProperties = {
    display: "grid",
    gap: "6px",
    padding: "10px 12px",
    borderRadius: "12px",
    border: "1px solid var(--wb-line)",
    background: "var(--wb-control-subtle)",
};

const TASK_TODO_HEADER_STYLE: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
};

const TASK_TODO_BADGE_STYLE: Record<WorkbenchTaskTodoState, CSSProperties> = {
    pending: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "54px",
        padding: "2px 8px",
        borderRadius: "999px",
        fontSize: "12px",
        fontWeight: 600,
        color: "var(--wb-accent-contrast)",
        background: "var(--wb-accent)",
    },
    done: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "54px",
        padding: "2px 8px",
        borderRadius: "999px",
        fontSize: "12px",
        fontWeight: 600,
        color: "var(--wb-accent-contrast)",
        background: "var(--wb-good)",
    },
};

const TASK_EMPTY_STYLE: CSSProperties = {
    margin: 0,
    color: "var(--wb-muted)",
    lineHeight: 1.55,
};

const TaskSummary = ({ summary, emptyText }: { summary: WorkbenchTaskSummaryCardData; emptyText: string }) => {
    if (summary.empty) {
        return <p style={TASK_EMPTY_STYLE}>{emptyText}</p>;
    }
    return (
        <div style={TASK_SUMMARY_STYLE}>
            <strong style={{ color: summary.tone === "error" ? "var(--wb-danger)" : undefined }}>
                {summary.title}
            </strong>
            <p style={TASK_SUMMARY_DETAIL_STYLE}>{summary.detail}</p>
            <span style={TASK_SUMMARY_SOURCE_STYLE}>{summary.sourceLabel}</span>
        </div>
    );
};

const TaskTodoList = ({ items }: { items: WorkbenchTaskTodoItem[] }) => {
    if (items.length === 0) {
        return <p style={TASK_EMPTY_STYLE}>暂未识别结构化待办</p>;
    }
    return (
        <div style={TASK_TODO_LIST_STYLE}>
            {items.map((item) => (
                <div key={`${item.sourceLabel}-${item.text}`} style={TASK_TODO_ITEM_STYLE}>
                    <div style={TASK_TODO_HEADER_STYLE}>
                        <span style={TASK_TODO_BADGE_STYLE[item.state]}>
                            {item.state === "done" ? "已完成" : "待处理"}
                        </span>
                        <span style={TASK_SUMMARY_SOURCE_STYLE}>{item.sourceLabel}</span>
                    </div>
                    <strong>{item.text}</strong>
                </div>
            ))}
        </div>
    );
};

const TaskStatus = ({ label, detail, items }: { label: string; detail: string; items: Array<[string, string]> }) => (
    <div style={TASK_SUMMARY_STYLE}>
        <strong>{label}</strong>
        <p style={TASK_SUMMARY_DETAIL_STYLE}>{detail}</p>
        <Info items={items} />
    </div>
);

const Message = ({ message }: { message: WorkbenchMessage }) => (
    <div
        className={`flatMessage ${
            message.role === "user"
                ? "flatMsgUser"
                : message.role === "assistant"
                  ? "flatMsgAssistant"
                  : message.role === "error"
                    ? "flatMsgError"
                    : "flatMsgSystem"
        }`}
    >
        <div className="messageRow__bubble">
            {message.title && <div className="messageRow__title">{message.title}</div>}
            {message.role === "assistant" ? (
                message.content ? (
                    <Markdown
                        text={message.content}
                        scrollable={false}
                        className="workbenchMarkdown"
                        contentClassName="workbenchMarkdownContent"
                    />
                ) : (
                    <TypingIndicator className="workbenchTypingIndicator" />
                )
            ) : (
                <div className={message.role === "user" ? "flatUserContent" : "messageRow__content"}>
                    {message.content}
                </div>
            )}
            <div className="messageRow__meta">{message.timestamp}</div>
        </div>
    </div>
);

function stamp(): string {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
}

function isWorkbenchCloudRequest(baseUrl: string, apiToken: string): boolean {
    return isBlank(baseUrl) && isBlank(apiToken);
}

export function resolveWorkbenchPreferredModelOptions(
    runtimeModelOptions: WorkbenchModelOptionsState | null | undefined,
    fallbackModelOptions: WorkbenchModelOptionsState
): WorkbenchModelOptionsState {
    if (runtimeModelOptions != null && runtimeModelOptions.options.length > 0) {
        return runtimeModelOptions;
    }
    if (runtimeModelOptions?.requestOverride != null) {
        return {
            ...fallbackModelOptions,
            requestOverride: runtimeModelOptions.requestOverride,
        };
    }
    return fallbackModelOptions;
}

export function mergeWorkbenchPinnedModelOptions(
    options: readonly string[],
    pinnedModels: readonly (string | null | undefined)[]
): string[] {
    const seen = new Set<string>();
    const merged: string[] = [];
    const pushValue = (value: string) => {
        const normalizedValue = value.trim();
        if (isBlank(normalizedValue) || seen.has(normalizedValue) || !isWorkbenchAllowedModelOption(normalizedValue)) {
            return;
        }
        seen.add(normalizedValue);
        merged.push(normalizedValue);
    };
    pinnedModels.forEach((value) => pushValue(String(value ?? "")));
    options.forEach((value) => pushValue(value));
    return merged;
}

export function resolveWorkbenchModelOptions(
    endpointMode: EndpointMode,
    isCloudRequest: boolean,
    mergedAiPresets: MetaType,
    aiModeConfigs: Record<string, AIModeConfigType> | null | undefined,
    currentAIModeConfig?: AIModeConfigType | null
): WorkbenchModelOptionsState {
    const seen = new Set<string>();
    const options: string[] = [];
    const pushOption = (value: string) => {
        const normalizedValue = value.trim();
        if (isBlank(normalizedValue) || seen.has(normalizedValue) || !isWorkbenchAllowedModelOption(normalizedValue)) {
            return false;
        }
        seen.add(normalizedValue);
        options.push(normalizedValue);
        return true;
    };
    let usedConfiguredModels = false;
    let usedResolvedModeConfigs = false;

    if (pushOption(String(currentAIModeConfig?.["ai:model"] ?? ""))) {
        usedConfiguredModels = true;
    }
    if (pushOption(String(mergedAiPresets["ai:model"] ?? ""))) {
        usedConfiguredModels = true;
    }

    if (isCloudRequest) {
        const cloudConfigs = getWorkbenchCloudModelConfigs(aiModeConfigs);
        for (const [, config] of cloudConfigs) {
            if (pushOption(String(config["ai:model"] ?? ""))) {
                usedResolvedModeConfigs = true;
            }
        }
        return {
            options,
            sourceLabel: usedResolvedModeConfigs
                ? "Wave AI 已加载模式"
                : usedConfiguredModels
                  ? "当前模式 / 预设配置（未探测端点）"
                  : "未发现可信模型列表",
        };
    }

    if (endpointMode !== "manual") {
        const relatedModeConfigs = getWorkbenchRelatedModelConfigs(aiModeConfigs, currentAIModeConfig, mergedAiPresets);
        for (const [, config] of relatedModeConfigs) {
            if (pushOption(String(config["ai:model"] ?? ""))) {
                usedResolvedModeConfigs = true;
            }
        }
    }

    return {
        options,
        sourceLabel: usedResolvedModeConfigs
            ? "当前模式与同源模式配置"
            : endpointMode === "manual"
              ? usedConfiguredModels
                  ? "当前模式 / 预设配置（手动端点未探测）"
                  : "手动端点未提供可信模型列表"
              : usedConfiguredModels
                ? "当前模式 / 预设配置（未探测端点）"
                : "未发现可信模型列表",
    };
}

export async function discoverWorkbenchRuntimeModelOptions(
    input: WorkbenchRuntimeModelDiscoveryInput,
    deps: WorkbenchRuntimeModelDiscoveryDeps = {}
): Promise<WorkbenchModelOptionsState | null> {
    let providerConfig: WorkbenchCodexProviderConfig | null = null;
    try {
        const codexConfigText = await readWorkbenchTextFile(WORKBENCH_CODEX_CONFIG_PATH, deps.readFileText);
        providerConfig = parseWorkbenchCodexProviderConfig(codexConfigText);
    } catch (error) {
        console.warn("failed to read workbench codex provider config for runtime model discovery", error);
    }

    const baseUrl = resolveWorkbenchDiscoveryBaseUrl(input, providerConfig);
    if (isBlank(baseUrl)) {
        return null;
    }

    let apiToken = input.apiToken.trim();
    if (providerConfig?.requiresOpenAIAuth) {
        try {
            const authText = await readWorkbenchTextFile(WORKBENCH_CODEX_AUTH_PATH, deps.readFileText);
            const parsedApiToken = parseWorkbenchOpenAIApiKey(authText);
            if (!isBlank(parsedApiToken) || isBlank(apiToken)) {
                apiToken = parsedApiToken;
            }
        } catch (error) {
            console.warn("failed to read workbench auth token for runtime model discovery", error);
        }
    }

    const usedProviderBaseUrl =
        providerConfig != null && normalizeWorkbenchModelSourceEndpoint(providerConfig.baseUrl) === baseUrl;
    const requestOverride =
        providerConfig != null && usedProviderBaseUrl
            ? {
                  baseurl: providerConfig.baseUrl,
                  apitoken: apiToken,
                  apitype: providerConfig.apiType,
              }
            : undefined;
    try {
        const options = await fetchWorkbenchRuntimeModels(baseUrl, apiToken, deps.fetchImpl);
        if (options.length === 0) {
            return buildWorkbenchRuntimeModelDiscoveryFallbackState({
                endpointMode: input.endpointMode,
                isEmptyResult: true,
                providerConfig,
                requestOverride,
                usedProviderBaseUrl,
            });
        }

        return {
            options,
            requestOverride,
            sourceLabel: usedProviderBaseUrl
                ? `Codex ${providerConfig?.providerName ?? ""} 实时探测`.trim()
                : input.endpointMode === "manual"
                  ? "手动端点实时探测"
                  : "当前端点实时探测",
        };
    } catch (error) {
        console.warn("failed to discover workbench runtime models", error);
        return buildWorkbenchRuntimeModelDiscoveryFallbackState({
            endpointMode: input.endpointMode,
            error,
            providerConfig,
            requestOverride,
            usedProviderBaseUrl,
        });
    }
}

function isWorkbenchAllowedModelOption(model: string): boolean {
    const normalizedModel = model.trim().toLowerCase();
    const gpt5VersionMatch = normalizedModel.match(/^gpt-5\.(\d+)(?:$|[-.])/);
    if (gpt5VersionMatch == null) {
        return true;
    }
    const minorVersion = Number(gpt5VersionMatch[1]);
    return Number.isFinite(minorVersion) && minorVersion >= 2;
}

export function getWorkbenchAIModeDisplayName(config: AIModeConfigType): string {
    return getModeDisplayName(config);
}

function getWorkbenchAIModeDescription(config: AIModeConfigType): string {
    const explicitDescription = String(config["display:description"] ?? "").trim();
    if (!isBlank(explicitDescription)) {
        return explicitDescription;
    }
    const modelLabel = String(config["ai:model"] ?? "").trim();
    if (!isBlank(modelLabel)) {
        return `当前模型：${modelLabel}`;
    }
    return "当前模式未提供额外说明。";
}

export function buildWorkbenchAIModeOptions(
    aiModeConfigs: Record<string, AIModeConfigType> | null | undefined
): WorkbenchAIModeOption[] {
    return Object.entries(aiModeConfigs ?? {})
        .sort(([leftMode, leftConfig], [rightMode, rightConfig]) => {
            const orderDiff = Number(leftConfig["display:order"] ?? 0) - Number(rightConfig["display:order"] ?? 0);
            if (orderDiff !== 0) {
                return orderDiff;
            }
            const labelDiff = getWorkbenchAIModeDisplayName(leftConfig).localeCompare(
                getWorkbenchAIModeDisplayName(rightConfig),
                "zh-CN"
            );
            if (labelDiff !== 0) {
                return labelDiff;
            }
            return leftMode.localeCompare(rightMode, "en");
        })
        .map(([mode, config]) => ({
            value: mode,
            label: getWorkbenchAIModeDisplayName(config),
            description: String(config["display:description"] ?? "").trim(),
        }));
}

export function resolveWorkbenchAIModeState(
    currentMode: string,
    aiModeConfigs: Record<string, AIModeConfigType> | null | undefined
): WorkbenchAIModeState {
    const modeOptions = buildWorkbenchAIModeOptions(aiModeConfigs);
    const currentModeConfig = aiModeConfigs?.[currentMode] ?? null;
    const hasAvailableModes = modeOptions.length > 0;
    const normalizedCurrentMode = currentMode.trim();

    if (currentModeConfig != null) {
        return {
            currentModeConfig,
            currentModeDescription: getWorkbenchAIModeDescription(currentModeConfig),
            currentModeLabel: getWorkbenchAIModeDisplayName(currentModeConfig),
            hasAvailableModes,
            modeOptions,
            modeSyncKey: [
                normalizedCurrentMode,
                String(currentModeConfig["ai:model"] ?? "").trim(),
                String(currentModeConfig["ai:thinkinglevel"] ?? "").trim(),
            ].join("|"),
            selectValue: normalizedCurrentMode,
        };
    }

    if (!hasAvailableModes) {
        return {
            currentModeConfig: null,
            currentModeDescription: "当前未发现可切换的工作模式。",
            currentModeLabel: "暂无可用模式",
            hasAvailableModes: false,
            modeOptions,
            modeSyncKey: `${normalizedCurrentMode}|empty`,
            selectValue: WORKBENCH_AIMODE_EMPTY_SELECT_VALUE,
        };
    }

    const invalidModeLabel = isBlank(normalizedCurrentMode) ? "未设置" : normalizedCurrentMode;
    return {
        currentModeConfig: null,
        currentModeDescription: `已加载 ${modeOptions.length} 个可用工作模式，请重新选择。`,
        currentModeLabel: `当前模式不可用（${invalidModeLabel}）`,
        hasAvailableModes: true,
        modeOptions,
        modeSyncKey: `${normalizedCurrentMode}|invalid|${modeOptions.length}`,
        selectValue: WORKBENCH_AIMODE_INVALID_SELECT_VALUE,
    };
}

export function normalizeWorkbenchDrawerSection(section: string | null | undefined): DrawerSection {
    return TABS.some((tab) => tab.id === section) ? (section as DrawerSection) : DEFAULT_WORKBENCH_DRAWER_SECTION;
}

export function normalizeWorkbenchModel(model: string, allowedModels: readonly string[] = []): string {
    const normalized = model.trim();
    return allowedModels.includes(normalized) ? normalized : "";
}

export function resolveWorkbenchComposerPrimaryStatusItems(options: {
    sending: boolean;
    connectionStatusLabel: string;
    agentLabels?: string[];
}): string[] {
    const normalizedAgentLabels = Array.from(
        new Set((options.agentLabels ?? []).map((item) => String(item ?? "").trim()).filter((item) => !isBlank(item)))
    );
    const agentSummary = normalizedAgentLabels.length > 0 ? `代理：${normalizedAgentLabels.join("、")}` : "";
    return [options.sending ? "AI 正在工作" : "准备发送", options.connectionStatusLabel, agentSummary].filter(
        (item) => !isBlank(item)
    );
}

export function createWorkbenchAiPreferenceUpdate<K extends WorkbenchAiPreferenceKey>(
    key: K,
    value: string
): WorkbenchAiPreferenceUpdate<K> {
    if (key === "ai:model") {
        return {
            configFiles: [{ key: "model", value }],
            meta: { "ai:model": value },
        };
    }
    const normalizedThinkingLevel = coerceWorkbenchVisibleThinkingLevel(value);
    return {
        configFiles: [
            { key: "model_reasoning_effort", value: normalizedThinkingLevel },
            { key: "plan_mode_reasoning_effort", value: normalizedThinkingLevel },
        ],
        meta: {
            "ai:thinkinglevel": normalizedThinkingLevel,
            "ai:planthinkinglevel": normalizedThinkingLevel,
        },
    };
}

export async function applyWorkbenchAiPreferenceUpdate(
    update: WorkbenchAiPreferenceUpdate,
    persistence: WorkbenchAiPreferencePersistence
): Promise<void> {
    const persistConfigBatch = async () => {
        for (const configFile of update.configFiles) {
            await persistence.persistConfig(configFile);
        }
    };
    const [configResult, metaResult] = await Promise.allSettled([
        persistConfigBatch(),
        persistence.persistMeta(update.meta),
    ]);
    if (configResult.status === "rejected") {
        persistence.onError?.("config", configResult.reason);
    }
    if (metaResult.status === "rejected") {
        persistence.onError?.("meta", metaResult.reason);
    }
}

export function updateWorkbenchCodexConfigText(
    content: string,
    configFile: WorkbenchAiPreferenceUpdate["configFiles"][number]
): string {
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    const hasTrailingNewline = content.endsWith("\r\n") || content.endsWith("\n");
    const lines = content.length === 0 ? [] : content.replace(/\r\n/g, "\n").split("\n");
    if (hasTrailingNewline && lines[lines.length - 1] === "") {
        lines.pop();
    }

    const assignmentPattern = new RegExp(`^(\\s*)${escapeRegExp(configFile.key)}\\s*=`);
    const firstSectionIndex = findFirstTopLevelTomlSectionIndex(lines);
    const scanLimit = firstSectionIndex === -1 ? lines.length : firstSectionIndex;
    const nextAssignment = `${configFile.key} = ${quoteTomlBasicString(configFile.value)}`;

    for (let index = 0; index < scanLimit; index++) {
        const match = lines[index]?.match(assignmentPattern);
        if (match) {
            lines[index] = `${match[1] ?? ""}${nextAssignment}`;
            return lines.join(newline) + (hasTrailingNewline ? newline : "");
        }
    }

    let insertAt = scanLimit;
    while (insertAt > 0 && lines[insertAt - 1].trim() === "") {
        insertAt--;
    }
    lines.splice(insertAt, 0, nextAssignment);
    return lines.join(newline) + (hasTrailingNewline ? newline : "");
}

export async function persistWorkbenchAiPreferenceConfig(
    configFile: WorkbenchAiPreferenceUpdate["configFiles"][number]
): Promise<void> {
    const fileData = await RpcApi.FileReadCommand(TabRpcClient, {
        info: { path: WORKBENCH_CODEX_CONFIG_PATH },
    });
    const nextContent = updateWorkbenchCodexConfigText(decodeWorkbenchConfigText(fileData.data64), configFile);
    await RpcApi.FileWriteCommand(TabRpcClient, {
        info: { path: WORKBENCH_CODEX_CONFIG_PATH },
        data64: encodeWorkbenchConfigText(nextContent),
    });
}

async function readWorkbenchTextFile(
    path: string,
    readFileText?: WorkbenchRuntimeModelDiscoveryDeps["readFileText"]
): Promise<string> {
    if (readFileText != null) {
        return readFileText(path);
    }
    const fileData = await RpcApi.FileReadCommand(TabRpcClient, {
        info: { path },
    });
    return decodeWorkbenchConfigText(fileData.data64);
}

function resolveWorkbenchDiscoveryBaseUrl(
    input: WorkbenchRuntimeModelDiscoveryInput,
    providerConfig: WorkbenchCodexProviderConfig | null
): string {
    if (input.endpointMode === "manual") {
        const manualBaseUrl = normalizeWorkbenchModelSourceEndpoint(input.manualBaseUrl);
        if (!isBlank(manualBaseUrl)) {
            return manualBaseUrl;
        }
    }
    const providerBaseUrl = normalizeWorkbenchModelSourceEndpoint(providerConfig?.baseUrl ?? "");
    if (!isBlank(providerBaseUrl)) {
        return providerBaseUrl;
    }
    return normalizeWorkbenchModelSourceEndpoint(input.fallbackBaseUrl);
}

async function fetchWorkbenchRuntimeModels(
    baseUrl: string,
    apiToken: string,
    fetchImpl?: typeof fetch
): Promise<string[]> {
    const headers: Record<string, string> = {};
    headers.Accept = "application/json";
    if (!isBlank(apiToken)) {
        headers.Authorization = `Bearer ${apiToken}`;
    }

    const requestUrl = `${baseUrl}/models`;
    let payload: unknown;
    if (fetchImpl != null) {
        const response = await fetchImpl(requestUrl, {
            headers,
        });
        if (!response.ok) {
            throw new Error(`runtime model discovery failed: ${response.status}`);
        }
        payload = parseWorkbenchRuntimeModelsPayload(
            await response.text(),
            response.headers?.get("content-type") ?? "",
            requestUrl
        );
    } else {
        const httpRequest = getWorkbenchHttpRequestBridge();
        if (httpRequest != null) {
            const response = await httpRequest({
                url: requestUrl,
                method: "GET",
                headers,
            });
            if (response.status < 200 || response.status >= 300) {
                throw new Error(`runtime model discovery failed: ${response.status}`);
            }
            payload = parseWorkbenchRuntimeModelsPayload(
                decodeWorkbenchBase64Text(response.bodyBase64),
                getWorkbenchHeaderValue(response.headers, "content-type"),
                requestUrl
            );
        } else {
            const response = await fetchWithElectronNet(requestUrl, {
                headers,
            });
            if (!response.ok) {
                throw new Error(`runtime model discovery failed: ${response.status}`);
            }
            payload = parseWorkbenchRuntimeModelsPayload(
                await response.text(),
                response.headers?.get("content-type") ?? "",
                requestUrl
            );
        }
    }

    return extractWorkbenchRuntimeModelIds(payload);
}

function buildWorkbenchRuntimeModelDiscoveryFallbackState(
    options: WorkbenchRuntimeModelDiscoveryFallbackOptions
): WorkbenchModelOptionsState {
    const routeLabel = getWorkbenchRuntimeModelDiscoveryRouteLabel(
        options.endpointMode,
        options.providerConfig,
        options.usedProviderBaseUrl
    );
    const failureLabel = getWorkbenchRuntimeModelDiscoveryFailureLabel(options.error, options.isEmptyResult === true);
    return {
        options: [...WORKBENCH_RUNTIME_MODEL_FALLBACK_OPTIONS].filter((model) => isWorkbenchAllowedModelOption(model)),
        requestOverride: options.requestOverride,
        sourceLabel: `${routeLabel}（${failureLabel}，回退到允许模型列表）`,
    };
}

function getWorkbenchRuntimeModelDiscoveryRouteLabel(
    endpointMode: EndpointMode,
    providerConfig: WorkbenchCodexProviderConfig | null,
    usedProviderBaseUrl: boolean
): string {
    if (providerConfig != null && usedProviderBaseUrl) {
        return `Codex ${providerConfig.providerName} 运行时路由`;
    }
    return endpointMode === "manual" ? "手动端点运行时路由" : "当前端点运行时路由";
}

function getWorkbenchRuntimeModelDiscoveryFailureLabel(error: unknown, isEmptyResult: boolean): string {
    if (isEmptyResult) {
        return "/models 空列表";
    }
    const message = formatWorkbenchError(error, "").trim().toLowerCase();
    const statusMatch = message.match(/(?:^|[^\d])([1-5]\d{2})(?:$|[^\d])/);
    if (statusMatch != null) {
        return `/models ${statusMatch[1]}`;
    }
    if (message.includes("expected json") || message.includes("invalid json")) {
        return "/models 响应无效";
    }
    return "/models 探测失败";
}

function getWorkbenchHttpRequestBridge(): ElectronApi["httpRequest"] | null {
    if (typeof window === "undefined") {
        return null;
    }
    const api = (window as any).api as Partial<ElectronApi> | undefined;
    return typeof api?.httpRequest === "function" ? api.httpRequest.bind(api) : null;
}

function getWorkbenchHeaderValue(headers: Record<string, string> | null | undefined, headerName: string): string {
    if (headers == null) {
        return "";
    }
    const normalizedHeaderName = headerName.trim().toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.trim().toLowerCase() === normalizedHeaderName) {
            return String(value ?? "");
        }
    }
    return "";
}

function parseWorkbenchRuntimeModelsPayload(bodyText: string, contentType: string, requestUrl: string): unknown {
    const normalizedContentType = contentType.trim().toLowerCase();
    if (
        normalizedContentType !== "" &&
        !normalizedContentType.includes("/json") &&
        !normalizedContentType.includes("+json")
    ) {
        throw new Error(
            `runtime model discovery expected JSON from ${requestUrl}, received ${normalizedContentType || "unknown"}`
        );
    }
    try {
        return JSON.parse(bodyText);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`runtime model discovery returned invalid JSON from ${requestUrl}: ${message}`);
    }
}

function extractWorkbenchRuntimeModelIds(payload: unknown): string[] {
    const entries = Array.isArray(payload)
        ? payload
        : Array.isArray((payload as { data?: unknown })?.data)
          ? (payload as { data: unknown[] }).data
          : [];
    const seen = new Set<string>();
    const options: string[] = [];
    for (const entry of entries) {
        const candidate = extractWorkbenchRuntimeModelId(entry);
        if (isBlank(candidate) || seen.has(candidate) || !isWorkbenchAllowedModelOption(candidate)) {
            continue;
        }
        seen.add(candidate);
        options.push(candidate);
    }
    return options;
}

function extractWorkbenchRuntimeModelId(entry: unknown): string {
    if (typeof entry === "string") {
        return entry.trim();
    }
    if (entry != null && typeof entry === "object") {
        const modelRecord = entry as Record<string, unknown>;
        return String(modelRecord.id ?? modelRecord.model ?? modelRecord.name ?? "").trim();
    }
    return "";
}

function parseWorkbenchCodexProviderConfig(content: string): WorkbenchCodexProviderConfig | null {
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    let modelProvider = "";
    let currentSection = "";
    let activeProviderName = "";
    let inMultilineString = false;
    const providerConfigs = new Map<string, Partial<WorkbenchCodexProviderConfig>>();

    for (const rawLine of lines) {
        const trimmedLine = rawLine.trim();
        if (trimmedLine.includes('"""')) {
            const markerCount = trimmedLine.match(/"""/g)?.length ?? 0;
            if (markerCount % 2 === 1) {
                inMultilineString = !inMultilineString;
            }
        }
        if (inMultilineString) {
            continue;
        }

        const line = stripWorkbenchTomlComment(rawLine).trim();
        if (isBlank(line)) {
            continue;
        }

        const sectionMatch = line.match(/^\[(.+)\]$/);
        if (sectionMatch) {
            currentSection = sectionMatch[1]?.trim() ?? "";
            activeProviderName = parseWorkbenchModelProviderSectionName(currentSection);
            continue;
        }

        const assignmentMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
        if (assignmentMatch == null) {
            continue;
        }
        const [, key, rawValue] = assignmentMatch;
        if (currentSection === "" && key === "model_provider") {
            modelProvider = parseWorkbenchTomlStringValue(rawValue) ?? "";
            continue;
        }
        if (isBlank(activeProviderName)) {
            continue;
        }
        const providerConfig = providerConfigs.get(activeProviderName) ?? {
            providerName: activeProviderName,
        };
        if (key === "base_url") {
            providerConfig.baseUrl = parseWorkbenchTomlStringValue(rawValue) ?? "";
        } else if (key === "requires_openai_auth") {
            providerConfig.requiresOpenAIAuth = parseWorkbenchTomlBooleanValue(rawValue) ?? false;
        } else if (key === "wire_api") {
            providerConfig.wireApi = parseWorkbenchTomlStringValue(rawValue) ?? "";
        }
        providerConfigs.set(activeProviderName, providerConfig);
    }

    if (isBlank(modelProvider)) {
        return null;
    }
    const providerConfig = providerConfigs.get(modelProvider);
    if (providerConfig == null) {
        return null;
    }
    return {
        providerName: modelProvider,
        baseUrl: String(providerConfig.baseUrl ?? "").trim(),
        requiresOpenAIAuth: providerConfig.requiresOpenAIAuth === true,
        wireApi: String(providerConfig.wireApi ?? "").trim(),
        apiType: mapWorkbenchCodexWireApiToApiType(String(providerConfig.wireApi ?? "")),
    };
}

function mapWorkbenchCodexWireApiToApiType(wireApi: string): string {
    const normalizedWireApi = wireApi.trim().toLowerCase();
    switch (normalizedWireApi) {
        case "responses":
            return "openai-responses";
        case "chat":
        case "chat_completions":
        case "chat-completions":
            return "openai-chat";
        default:
            return "";
    }
}

function parseWorkbenchModelProviderSectionName(sectionName: string): string {
    if (!sectionName.startsWith("model_providers.")) {
        return "";
    }
    const rawProviderName = sectionName.slice("model_providers.".length).trim();
    if (rawProviderName.startsWith('"') && rawProviderName.endsWith('"')) {
        return parseWorkbenchTomlStringValue(rawProviderName) ?? "";
    }
    return rawProviderName;
}

function parseWorkbenchOpenAIApiKey(content: string): string {
    try {
        const parsed = JSON.parse(content) as { OPENAI_API_KEY?: unknown };
        return String(parsed?.OPENAI_API_KEY ?? "").trim();
    } catch {
        return "";
    }
}

function parseWorkbenchTomlStringValue(rawValue: string): string | null {
    const trimmedValue = rawValue.trim();
    if (!trimmedValue.startsWith('"') || !trimmedValue.endsWith('"')) {
        return null;
    }
    try {
        return JSON.parse(trimmedValue) as string;
    } catch {
        return trimmedValue.slice(1, -1);
    }
}

function parseWorkbenchTomlBooleanValue(rawValue: string): boolean | null {
    const trimmedValue = rawValue.trim().toLowerCase();
    if (trimmedValue === "true") {
        return true;
    }
    if (trimmedValue === "false") {
        return false;
    }
    return null;
}

function stripWorkbenchTomlComment(line: string): string {
    let inString = false;
    let escaped = false;
    let result = "";
    for (const char of line) {
        if (escaped) {
            result += char;
            escaped = false;
            continue;
        }
        if (char === "\\" && inString) {
            result += char;
            escaped = true;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            result += char;
            continue;
        }
        if (char === "#" && !inString) {
            break;
        }
        result += char;
    }
    return result;
}

function supportsWorkbenchThinkingLevel(model: string): boolean {
    const normalized = model.trim().toLowerCase();
    return (
        normalized.startsWith("o1") ||
        normalized.startsWith("o3") ||
        normalized.startsWith("o4") ||
        normalized.startsWith("gpt-5")
    );
}

export function normalizeWorkbenchThinkingLevel(level: string): WorkbenchThinkingLevel | "" {
    switch (level.trim().toLowerCase()) {
        case "none":
        case "minimal":
        case "low":
            return "low";
        case "medium":
            return "medium";
        case "high":
            return "high";
        case "xhigh":
            return "xhigh";
        default:
            return "";
    }
}

export function coerceWorkbenchVisibleThinkingLevel(level?: string): WorkbenchVisibleThinkingLevel {
    return normalizeWorkbenchThinkingLevel(level ?? "") === "high" ? "high" : "xhigh";
}

export function resolveWorkbenchDisplayedThinkingLevel(
    snapshot: Pick<WorkbenchCodexPreferenceSnapshot, "modelReasoningEffort"> | null | undefined
): WorkbenchDisplayedThinkingLevel {
    const normalizedLevel = normalizeWorkbenchThinkingLevel(String(snapshot?.modelReasoningEffort ?? ""));
    if (normalizedLevel === "high" || normalizedLevel === "xhigh") {
        return normalizedLevel;
    }
    return "";
}

export function getThinkingLevelLabel(level?: string): string {
    const normalized = normalizeWorkbenchThinkingLevel(level ?? "") || DEFAULT_THINKING_LEVEL;
    return normalized === "xhigh" ? "极高" : normalized;
}

export function resolveWorkbenchCodexPreferenceSnapshotFromIntegrations(
    config: Pick<WorkbenchIntegrationsConfig, "codex"> | null | undefined
): WorkbenchCodexPreferenceSnapshot {
    return {
        model: String(config?.codex.model ?? "").trim(),
        modelReasoningEffort: normalizeWorkbenchThinkingLevel(String(config?.codex.modelReasoningEffort ?? "")) || "",
        planModeReasoningEffort:
            normalizeWorkbenchThinkingLevel(String(config?.codex.planModeReasoningEffort ?? "")) || "",
    };
}

export function resolveWorkbenchCodexPreferenceSnapshotFromConfigText(
    configText: string
): WorkbenchCodexPreferenceSnapshot {
    const snapshot: WorkbenchCodexPreferenceSnapshot = {
        model: "",
        modelReasoningEffort: "",
        planModeReasoningEffort: "",
    };
    const lines = configText.replace(/\r\n/g, "\n").split("\n");
    let currentSection = "";
    let multilineDelimiter: '"""' | "'''" | null = null;
    for (const rawLine of lines) {
        multilineDelimiter = updateWorkbenchTomlMultilineDelimiter(rawLine, multilineDelimiter);
        if (multilineDelimiter != null) {
            continue;
        }
        const line = stripWorkbenchTomlComment(rawLine).trim();
        if (line === "") {
            continue;
        }
        const sectionMatch = line.match(/^\[(.+)\]$/);
        if (sectionMatch) {
            currentSection = sectionMatch[1]?.trim() ?? "";
            continue;
        }
        if (currentSection !== "") {
            continue;
        }
        const assignmentMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
        if (assignmentMatch == null) {
            continue;
        }
        const [, key, rawValue] = assignmentMatch;
        if (key === "model") {
            snapshot.model = parseWorkbenchTomlStringValue(rawValue) ?? snapshot.model;
        } else if (key === "model_reasoning_effort") {
            snapshot.modelReasoningEffort =
                normalizeWorkbenchThinkingLevel(parseWorkbenchTomlStringValue(rawValue) ?? "") || "";
        } else if (key === "plan_mode_reasoning_effort") {
            snapshot.planModeReasoningEffort =
                normalizeWorkbenchThinkingLevel(parseWorkbenchTomlStringValue(rawValue) ?? "") || "";
        }
    }
    return snapshot;
}

function updateWorkbenchTomlMultilineDelimiter(
    rawLine: string,
    currentDelimiter: '"""' | "'''" | null
): '"""' | "'''" | null {
    if (currentDelimiter != null) {
        const markerCount = rawLine.split(currentDelimiter).length - 1;
        return markerCount % 2 === 1 ? null : currentDelimiter;
    }
    for (const delimiter of ['"""', "'''"] as const) {
        const markerCount = rawLine.split(delimiter).length - 1;
        if (markerCount > 0 && markerCount % 2 === 1) {
            return delimiter;
        }
    }
    return null;
}

function getWorkbenchThinkingLevelSummary(model: string, level?: string): string {
    if (!supportsWorkbenchThinkingLevel(model)) {
        return "当前模型不支持";
    }
    return getThinkingLevelLabel(level);
}

function getWorkbenchCloudModelConfigs(
    aiModeConfigs: Record<string, AIModeConfigType> | null | undefined
): Array<[string, AIModeConfigType]> {
    return Object.entries(aiModeConfigs ?? {})
        .filter(([mode, config]) => {
            return mode.startsWith("waveai@") || config["waveai:cloud"] === true || config["ai:provider"] === "wave";
        })
        .sort(compareWorkbenchModeConfigs);
}

function getWorkbenchRelatedModelConfigs(
    aiModeConfigs: Record<string, AIModeConfigType> | null | undefined,
    currentAIModeConfig: AIModeConfigType | null | undefined,
    mergedAiPresets: MetaType
): Array<[string, AIModeConfigType]> {
    const targetSignatures = new Set(
        [
            buildWorkbenchModelSourceSignature(currentAIModeConfig),
            buildWorkbenchModelSourceSignature(mergedAiPresets),
        ].filter((value): value is string => !isBlank(value ?? ""))
    );
    if (targetSignatures.size === 0) {
        return [];
    }
    return Object.entries(aiModeConfigs ?? {})
        .filter(([, config]) => {
            const signature = buildWorkbenchModelSourceSignature(config);
            return signature != null && targetSignatures.has(signature);
        })
        .sort(compareWorkbenchModeConfigs);
}

function compareWorkbenchModeConfigs(
    [leftMode, leftConfig]: [string, AIModeConfigType],
    [rightMode, rightConfig]: [string, AIModeConfigType]
): number {
    const orderDiff = Number(leftConfig["display:order"] ?? 0) - Number(rightConfig["display:order"] ?? 0);
    if (orderDiff !== 0) {
        return orderDiff;
    }
    const labelDiff = getModeDisplayName(leftConfig).localeCompare(getModeDisplayName(rightConfig), "zh-CN");
    if (labelDiff !== 0) {
        return labelDiff;
    }
    return leftMode.localeCompare(rightMode, "en");
}

function buildWorkbenchModelSourceSignature(
    config: Partial<Record<string, unknown>> | null | undefined
): string | null {
    const provider = String(config?.["ai:provider"] ?? "")
        .trim()
        .toLowerCase();
    const apiType = String(config?.["ai:apitype"] ?? "")
        .trim()
        .toLowerCase();
    const endpoint = normalizeWorkbenchModelSourceEndpoint(
        String(config?.["ai:endpoint"] ?? config?.["ai:baseurl"] ?? "").trim()
    );
    const azureResource = String(config?.["ai:azureresourcename"] ?? "")
        .trim()
        .toLowerCase();
    const azureDeployment = String(config?.["ai:azuredeployment"] ?? "")
        .trim()
        .toLowerCase();
    if ([provider, apiType, endpoint, azureResource, azureDeployment].every((value) => isBlank(value))) {
        return null;
    }
    return [provider || "__", apiType || "__", endpoint || "__", azureResource || "__", azureDeployment || "__"].join(
        "|"
    );
}

function normalizeWorkbenchModelSourceEndpoint(value: string): string {
    return value.trim().replace(/\/+$/, "").toLowerCase();
}

export function canResumeWorkbenchAutoFollowAfterInactivity(
    scrollHeight: number,
    scrollTop: number,
    clientHeight: number,
    manuallyDetached: boolean
): boolean {
    if (!manuallyDetached) {
        return true;
    }
    return isWorkbenchViewportNearBottom(scrollHeight, scrollTop, clientHeight);
}

function getLastMessageSummary(messages: WorkbenchMessage[]): string {
    const last = [...messages].reverse().find((item) => item.role !== "system");
    if (!last) {
        return "暂无消息";
    }
    const roleLabel = last.role === "assistant" ? "助手" : last.role === "user" ? "用户" : "错误";
    const content = last.content.replace(/\s+/g, " ").trim();
    if (!content) {
        return `${roleLabel}：空内容`;
    }
    return `${roleLabel}：${content.slice(0, 36)}${content.length > 36 ? "..." : ""}`;
}

export function extractStructuredTodoItems(messages: WorkbenchMessage[]): WorkbenchTaskTodoItem[] {
    const todos: WorkbenchTaskTodoItem[] = [];
    const seen = new Set<string>();

    for (const message of [...messages].reverse()) {
        if (message.role === "system") {
            continue;
        }
        const extracted = extractStructuredTodoItemsFromContent(message.content);
        for (const item of extracted) {
            const key = item.text.trim().toLowerCase();
            if (isBlank(key) || seen.has(key)) {
                continue;
            }
            seen.add(key);
            todos.push({
                text: item.text,
                state: item.state,
                sourceLabel: getWorkbenchTodoSourceLabel(message.role),
            });
            if (todos.length >= 8) {
                return todos;
            }
        }
    }

    return todos;
}

export function deriveWorkbenchTaskPanelData(
    messages: WorkbenchMessage[],
    options: {
        sending: boolean;
        modelLabel: string;
        modeLabel: string;
        thinkingLabel: string;
        connectionLabel: string;
        connectionStatusLabel: string;
    }
): WorkbenchTaskPanelData {
    const todos = extractStructuredTodoItems(messages);
    const currentTaskMessage = findLatestMessageByRole(messages, "user");
    const latestConclusionMessage = findLatestConclusionMessage(messages);
    const latestVisibleMessage = [...messages].reverse().find((message) => message.role !== "system");
    const statusLabel = getWorkbenchTaskStatusLabel(latestVisibleMessage, options.sending);
    const statusDetail = getWorkbenchTaskStatusDetail(latestVisibleMessage, options.sending);

    return {
        currentTask: buildTaskSummary(currentTaskMessage, "最近一条用户消息", [
            "当前任务",
            "任务",
            "目标",
            "需求",
            "请求",
            "问题",
        ]),
        recentConclusion: buildTaskSummary(
            latestConclusionMessage,
            latestConclusionMessage?.role === "error" ? "最近一次错误" : "最近一条助手回复",
            ["当前结论", "最近结论", "结论", "总结", "summary", "conclusion"],
            latestConclusionMessage?.role === "error" ? "error" : "default"
        ),
        todos,
        statusLabel,
        statusDetail,
        statusItems: [
            ["最新消息", getWorkbenchLatestMessageLabel(latestVisibleMessage)],
            ["当前连接", options.connectionLabel],
            ["连接状态", options.connectionStatusLabel],
            ["当前模式", options.modeLabel],
            ["当前模型", options.modelLabel],
            ["推理强度", options.thinkingLabel],
            ["消息历史", `${messages.length} 条`],
            ["结构化待办", todos.length > 0 ? `${todos.length} 条` : "暂未识别结构化待办"],
        ],
    };
}

export function deriveWorkbenchLspPanelData(options: {
    connectionInfo: ReturnType<typeof describeWorkbenchConnection>;
    messages: WorkbenchMessage[];
    model: string;
    thinkingLabel: string;
    timeoutMs: number;
    maxTokens?: number;
    traditionalViewName: string;
    workbenchPath: string;
}): WorkbenchLspPanelData {
    const workspacePath = options.workbenchPath || "未设置";
    const monacoSchemaCount = MonacoSchemaSummary.length;
    const latestAssistantMessage = findLatestCompletedWorkbenchAssistantMessage(options.messages);
    const assistantReplyLabel =
        latestAssistantMessage == null
            ? "尚未拿到正式回复"
            : truncateWorkbenchText(collapseWorkbenchMessageText(latestAssistantMessage.content), 42) || "已生成回复";
    const lspConnectionState =
        options.connectionInfo.kind === "ssh" && options.connectionInfo.wshDisplay !== "已启用"
            ? "远端连接已建立，但 WSH / 语言服务链仍未就绪"
            : options.connectionInfo.kind === "ssh"
              ? "远端连接与 WSH 已就绪，可继续接入真实 LSP 进程"
              : "当前是本机工作区，先使用内置 Monaco 语义与 schema 能力";
    const diagnosticsState =
        options.connectionInfo.kind === "ssh" && options.connectionInfo.wshDisplay !== "已启用"
            ? "远端诊断待接线"
            : "基础诊断可用";
    return {
        overviewItems: [
            ["工作区路径", workspacePath],
            ["连接目标", options.connectionInfo.footerLabel],
            ["连接状态", options.connectionInfo.statusLabel],
            ["WSH 接线", options.connectionInfo.wshDisplay],
            ["返回目标", options.traditionalViewName],
            ["当前模型", options.model || "未配置"],
            ["推理强度", options.thinkingLabel],
            ["消息历史", `${options.messages.length} 条`],
        ],
        diagnosticsItems: [
            ["LSP 总状态", lspConnectionState],
            ["诊断状态", diagnosticsState],
            ["最近正式回复", assistantReplyLabel],
            ["Schema 数量", `${monacoSchemaCount} 组`],
            ["请求超时", `${options.timeoutMs}ms`],
            ["最大 Tokens", options.maxTokens != null ? String(options.maxTokens) : "默认"],
        ],
        capabilityItems: [...WORKBENCH_LSP_CAPABILITIES],
        schemaItems: MonacoSchemaSummary.map((schema) => ({
            label: schema.uri.replace("wave://schema/", ""),
            detail: schema.fileMatch.join(" , "),
        })),
    };
}

function buildTaskSummary(
    message: WorkbenchMessage | undefined,
    sourceLabel: string,
    preferredLabels: string[],
    tone: WorkbenchTaskHighlightTone = "default"
): WorkbenchTaskSummaryCardData {
    if (message == null || isBlank(message.content)) {
        return {
            title: "",
            detail: "",
            sourceLabel,
            tone,
            empty: true,
        };
    }

    const lines = getWorkbenchMeaningfulLines(message.content);
    const labeledSummary = findPreferredSummaryLine(lines, preferredLabels);
    const detailSource =
        lines.find((line) => normalizeStructuredTodoLine(line) == null) ??
        labeledSummary ??
        collapseWorkbenchMessageText(message.content);
    const detail = truncateWorkbenchText(detailSource, 180);
    const title = truncateWorkbenchText(labeledSummary || detailSource, 72);

    return {
        title: title || "未提取到标题",
        detail: detail || "未提取到内容",
        sourceLabel,
        tone,
        empty: false,
    };
}

function findLatestMessageByRole(messages: WorkbenchMessage[], role: MessageRole): WorkbenchMessage | undefined {
    return [...messages].reverse().find((message) => message.role === role && !isBlank(message.content));
}

export function findLatestCompletedWorkbenchAssistantMessage(messages: WorkbenchMessage[]): WorkbenchMessage | null {
    for (let idx = messages.length - 1; idx >= 0; idx--) {
        const message = messages[idx];
        if (message.role !== "assistant") {
            continue;
        }
        if (message.isUpdating || isBlank(message.content)) {
            continue;
        }
        return message;
    }
    return null;
}

function resolveWorkbenchSpeechOutputTs(messageId: string, fallbackTs = Date.now()): number {
    const match = String(messageId ?? "").match(/-(\d{6,})$/);
    const parsed = match?.[1] ? Number(match[1]) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) {
        return Math.floor(parsed);
    }
    return Math.max(1, Math.floor(fallbackTs));
}

export function resolveWorkbenchSpeechPayload(
    messages: WorkbenchMessage[],
    fallbackTs = Date.now()
): TerminalFormalReplyPayload | null {
    const message = findLatestCompletedWorkbenchAssistantMessage(messages);
    if (!message) {
        return null;
    }
    const text = String(message.content ?? "").trim();
    if (isBlank(text)) {
        return null;
    }
    return {
        id: `workbench:${message.id}`,
        text,
        outputTs: resolveWorkbenchSpeechOutputTs(message.id, fallbackTs),
    };
}

function findLatestConclusionMessage(messages: WorkbenchMessage[]): WorkbenchMessage | undefined {
    return [...messages].reverse().find((message) => {
        if (message.role !== "assistant" && message.role !== "error") {
            return false;
        }
        if (message.isUpdating && isBlank(message.content)) {
            return false;
        }
        return !isBlank(message.content);
    });
}

function getWorkbenchTaskStatusLabel(lastMessage: WorkbenchMessage | undefined, sending: boolean): string {
    if (sending || lastMessage?.isUpdating) {
        return "AI 正在处理";
    }
    if (lastMessage == null) {
        return "尚未开始";
    }
    if (lastMessage.role === "error") {
        return "最近一次调用失败";
    }
    if (lastMessage.role === "user") {
        return "等待下一条回复";
    }
    if (lastMessage.role === "assistant") {
        return "最近一轮已有结论";
    }
    return "等待开始";
}

function getWorkbenchTaskStatusDetail(lastMessage: WorkbenchMessage | undefined, sending: boolean): string {
    if (sending || lastMessage?.isUpdating) {
        return "当前消息流里存在进行中的回复，本轮状态仍在更新。";
    }
    if (lastMessage == null) {
        return "当前消息历史里还没有用户或助手内容。";
    }
    if (lastMessage.role === "error") {
        return (
            truncateWorkbenchText(collapseWorkbenchMessageText(lastMessage.content), 120) || "最近一次请求返回错误。"
        );
    }
    if (lastMessage.role === "user") {
        return "最新一条有效消息来自用户，说明这一轮请求还没有新的助手回复。";
    }
    if (lastMessage.role === "assistant") {
        return "最新一条有效消息来自助手，可以直接查看最近结论和行动项。";
    }
    return "当前消息流没有可识别的工作状态。";
}

function getWorkbenchLatestMessageLabel(message: WorkbenchMessage | undefined): string {
    if (message == null) {
        return "暂无消息";
    }
    const roleLabel = message.role === "assistant" ? "助手" : message.role === "user" ? "用户" : "错误";
    const preview = truncateWorkbenchText(collapseWorkbenchMessageText(message.content), 36);
    return preview ? `${roleLabel}：${preview}` : `${roleLabel}：空内容`;
}

function getWorkbenchTodoSourceLabel(role: MessageRole): string {
    if (role === "assistant") {
        return "来自助手回复";
    }
    if (role === "user") {
        return "来自用户消息";
    }
    if (role === "error") {
        return "来自错误消息";
    }
    return "来自系统消息";
}

function extractStructuredTodoItemsFromContent(
    content: string
): Array<{ text: string; state: WorkbenchTaskTodoState }> {
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const items: Array<{ text: string; state: WorkbenchTaskTodoState }> = [];
    let todoSectionActive = false;

    for (const rawLine of lines) {
        const trimmed = rawLine.trim();
        if (isTodoHeadingLine(trimmed)) {
            todoSectionActive = true;
            continue;
        }

        const structuredLine = normalizeStructuredTodoLine(rawLine, todoSectionActive);
        if (structuredLine != null) {
            items.push(structuredLine);
            continue;
        }

        if (todoSectionActive && trimmed !== "") {
            todoSectionActive = false;
        }
    }

    return items;
}

function normalizeStructuredTodoLine(
    rawLine: string,
    todoSectionActive = false
): { text: string; state: WorkbenchTaskTodoState } | null {
    const trimmed = rawLine.trim();
    if (trimmed === "") {
        return null;
    }

    const checkboxMatch = trimmed.match(/^(?:[-*+]|\d+[.)])\s*\[([ xX])\]\s+(.+)$/);
    if (checkboxMatch) {
        return {
            text: cleanupTodoText(checkboxMatch[2] ?? ""),
            state: (checkboxMatch[1] ?? " ").toLowerCase() === "x" ? "done" : "pending",
        };
    }

    const keywordMatch = trimmed.match(
        /^(?:[-*+]|\d+[.)])?\s*(todo|todos|待办(?:事项|项)?|行动项|action item|action|next steps?|next step|next|下一步|后续)\s*[:：-]\s*(.+)$/i
    );
    if (keywordMatch) {
        return {
            text: cleanupTodoText(keywordMatch[2] ?? ""),
            state: "pending",
        };
    }

    if (!todoSectionActive) {
        return null;
    }

    const bulletMatch = trimmed.match(/^(?:[-*+]|\d+[.)])\s+(.+)$/);
    if (bulletMatch) {
        return {
            text: cleanupTodoText(bulletMatch[1] ?? ""),
            state: "pending",
        };
    }
    return null;
}

function isTodoHeadingLine(line: string): boolean {
    return /^(?:#{1,6}\s*)?(?:todo|todos|待办(?:事项|项)?|行动项|next steps?|next step|下一步|后续)\s*[:：]?\s*$/i.test(
        line
    );
}

function cleanupTodoText(text: string): string {
    return truncateWorkbenchText(
        text
            .replace(/\s+/g, " ")
            .replace(/^[>\-*\d.)\s]+/, "")
            .trim(),
        140
    );
}

function getWorkbenchMeaningfulLines(content: string): string[] {
    return content
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((line) => normalizeWorkbenchMessageLine(line))
        .filter((line) => {
            return line !== "" && line !== "---" && line !== "```";
        });
}

function normalizeWorkbenchMessageLine(line: string): string {
    return line
        .replace(/^\s{0,3}#{1,6}\s*/, "")
        .replace(/^\s*>+\s*/, "")
        .replace(/^\s*(?:[-*+]|\d+[.)])\s*/, "")
        .replace(/^\[([ xX])\]\s*/, "")
        .trim();
}

function findPreferredSummaryLine(lines: string[], preferredLabels: string[]): string {
    const loweredLabels = preferredLabels.map((label) => label.toLowerCase());
    for (let index = 0; index < lines.length; index++) {
        const line = lines[index] ?? "";
        const separatorMatch = line.match(/^([^:：-]+)\s*[:：-]\s*(.+)$/);
        if (separatorMatch) {
            const normalizedLabel = separatorMatch[1]?.trim().toLowerCase() ?? "";
            if (loweredLabels.includes(normalizedLabel)) {
                return separatorMatch[2]?.trim() ?? "";
            }
        }
        if (loweredLabels.includes(line.trim().toLowerCase())) {
            const nextLine = lines[index + 1] ?? "";
            if (!isBlank(nextLine)) {
                return nextLine;
            }
        }
    }

    return lines.find((line) => normalizeStructuredTodoLine(line) == null) ?? lines[0] ?? "";
}

function collapseWorkbenchMessageText(content: string): string {
    return getWorkbenchMeaningfulLines(content).join(" ").replace(/\s+/g, " ").trim();
}

function truncateWorkbenchText(text: string, maxLength: number): string {
    const normalized = text.trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function getWorkbenchHeaderSummary(_meta?: MetaType | null): string {
    return "";
}

export function resolveWorkbenchWorkspacePath(meta?: MetaType | null): string {
    const candidates = [
        String(meta?.["term:displaycwd"] ?? "").trim(),
        String(meta?.["display:launchcwd"] ?? "").trim(),
        String(meta?.["cmd:cwd"] ?? "").trim(),
        String(meta?.cwd ?? "").trim(),
    ];
    for (const candidate of candidates) {
        if (!isBlank(candidate)) {
            return candidate;
        }
    }
    return "未记录";
}

function describeWorkbenchConnection(
    connection: string,
    connConfig: Record<string, string | string[] | number | boolean | undefined> | null,
    connStatus: ConnStatus | null | undefined,
    localHostLabel: string
): {
    kind: ConnectionKind;
    kindLabel: string;
    title: string;
    subtitle: string;
    footerLabel: string;
    hostDisplay: string;
    userDisplay: string;
    proxyJumpDisplay: string;
    wshDisplay: string;
    statusLabel: string;
    healthClassName: string;
    badgeClassName: string;
} {
    const normalizedConnection = connection.trim() || "local";
    const kind: ConnectionKind = isLocalConnName(normalizedConnection)
        ? "local"
        : isWslConnName(normalizedConnection)
          ? "wsl"
          : "ssh";
    const kindLabel = kind === "local" ? "本机" : kind === "wsl" ? "WSL" : "SSH";
    const displayName = String(connConfig?.["display:name"] ?? "").trim();
    const sshHost = String(connConfig?.["ssh:hostname"] ?? "").trim();
    const sshUser = String(connConfig?.["ssh:user"] ?? "").trim();
    const proxyJump = Array.isArray(connConfig?.["ssh:proxyjump"])
        ? (connConfig["ssh:proxyjump"] as string[]).join(", ")
        : String(connConfig?.["ssh:proxyjump"] ?? "").trim();
    const title =
        displayName ||
        (kind === "local"
            ? localHostLabel || "本机"
            : kind === "wsl"
              ? normalizedConnection.replace(/^wsl:\/\//, "")
              : normalizedConnection);
    const hostDisplay =
        kind === "local"
            ? localHostLabel || "本机"
            : kind === "wsl"
              ? normalizedConnection.replace(/^wsl:\/\//, "")
              : sshHost || normalizedConnection;
    const userDisplay = kind === "ssh" ? sshUser || "未显式设置" : "跟随当前环境";
    const footerLabel = kind === "ssh" && !isBlank(sshHost) ? `${sshUser ? `${sshUser}@` : ""}${sshHost}` : title;
    const statusText = String(connStatus?.status ?? "")
        .trim()
        .toLowerCase();
    const errorText = String(connStatus?.error ?? "").trim();
    const connected = !!connStatus?.connected || kind === "local";
    const wshDisplay = connected
        ? connStatus?.wshenabled
            ? "已启用"
            : kind === "ssh"
              ? "未启用"
              : "不适用"
        : "未连接";
    let statusLabel = "未连接";
    let healthClassName = "is-warning";
    let badgeClassName = "is-warn";

    if (kind === "local") {
        statusLabel = "本机就绪";
        healthClassName = "is-healthy";
        badgeClassName = "is-good";
    } else if (statusText === "connected" || connected) {
        statusLabel = connStatus?.wshenabled || kind !== "ssh" ? "已连接" : "已连接，WSH未启用";
        healthClassName = connStatus?.wshenabled || kind !== "ssh" ? "is-healthy" : "is-checking";
        badgeClassName = connStatus?.wshenabled || kind !== "ssh" ? "is-good" : "is-warn";
    } else if (statusText === "connecting") {
        statusLabel = "连接中";
        healthClassName = "is-checking";
        badgeClassName = "is-warn";
    } else if (statusText === "error" || !isBlank(errorText)) {
        statusLabel = "连接失败";
        healthClassName = "is-warning";
        badgeClassName = "is-danger";
    }

    const subtitleParts = [kindLabel];
    if (kind === "ssh") {
        subtitleParts.push(`${sshUser ? `${sshUser}@` : ""}${hostDisplay}`);
    } else {
        subtitleParts.push(hostDisplay);
    }
    subtitleParts.push(!isBlank(errorText) ? errorText : statusLabel);

    return {
        kind,
        kindLabel,
        title,
        subtitle: subtitleParts.join(" · "),
        footerLabel,
        hostDisplay,
        userDisplay,
        proxyJumpDisplay: proxyJump,
        wshDisplay,
        statusLabel,
        healthClassName,
        badgeClassName,
    };
}

function buildConnectionRuntimeItems(
    connectionInfo: ReturnType<typeof describeWorkbenchConnection>
): Array<[string, string]> {
    const items: Array<[string, string]> = [
        ["目标", connectionInfo.footerLabel],
        ["状态", connectionInfo.statusLabel],
        ["类型", connectionInfo.kindLabel],
        ["WSH", connectionInfo.wshDisplay],
    ];
    if (!isBlank(connectionInfo.proxyJumpDisplay)) {
        items.push(["跳板链路", connectionInfo.proxyJumpDisplay]);
    }
    return items;
}

function clampDrawerWidth(value: number, min = DRAWER_WIDTH_MIN, max = DRAWER_WIDTH_MAX): number {
    return clampNumber(value, min, max);
}

function clampNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, Math.round(value)));
}

function resolveWorkbenchViewportState(
    width: number,
    height: number
): {
    width: number;
    height: number;
    density: WorkbenchLayoutDensity;
    drawerMinWidth: number;
    drawerMaxWidth: number;
    composerMaxHeight: number;
    composerTextareaMinHeight: number;
    composerTextareaMaxHeight: number;
} {
    const safeWidth = Math.max(0, Math.round(width));
    const safeHeight = Math.max(0, Math.round(height));
    const density = getWorkbenchLayoutDensity(safeWidth, safeHeight);
    const drawerMinWidth = density === "cramped" ? 168 : density === "compact" ? 220 : DRAWER_WIDTH_MIN;
    const drawerRatio = density === "cramped" ? 0.31 : density === "compact" ? 0.36 : 0.42;
    const drawerLimit = density === "cramped" ? 220 : density === "compact" ? 320 : DRAWER_WIDTH_MAX;
    const drawerMaxWidth = Math.max(drawerMinWidth, Math.min(drawerLimit, Math.floor(safeWidth * drawerRatio)));
    const composerMaxHeight =
        density === "cramped"
            ? Math.max(118, Math.floor(safeHeight * 0.3))
            : density === "compact"
              ? Math.max(146, Math.floor(safeHeight * 0.34))
              : Math.max(188, Math.floor(safeHeight * 0.42));
    const composerTextareaMinHeight = density === "cramped" ? 48 : density === "compact" ? 64 : 88;
    const textareaSoftLimit = density === "cramped" ? 102 : density === "compact" ? 136 : 200;
    const composerTextareaMaxHeight = Math.max(
        composerTextareaMinHeight + 24,
        Math.min(textareaSoftLimit, composerMaxHeight - (density === "cramped" ? 54 : density === "compact" ? 66 : 78))
    );

    return {
        width: safeWidth,
        height: safeHeight,
        density,
        drawerMinWidth,
        drawerMaxWidth,
        composerMaxHeight,
        composerTextareaMinHeight,
        composerTextareaMaxHeight,
    };
}

function getWorkbenchLayoutDensity(width: number, height: number): WorkbenchLayoutDensity {
    if (width <= 760 || height <= 430) {
        return "cramped";
    }
    if (width <= 1040 || height <= 620) {
        return "compact";
    }
    return "default";
}

function normalizeTransparency(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }
    return Math.min(1, Math.max(0, numeric));
}

function decodeWorkbenchBase64Text(data64?: string): string {
    if (isBlank(data64 ?? "")) {
        return "";
    }
    const binary = atob(data64 ?? "");
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

function decodeWorkbenchConfigText(data64?: string): string {
    return decodeWorkbenchBase64Text(data64);
}

function encodeWorkbenchConfigText(content: string): string {
    const bytes = new TextEncoder().encode(content);
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

function formatWorkbenchError(error: unknown, fallback: string): string {
    if (error instanceof Error && !isBlank(error.message)) {
        return error.message;
    }
    if (typeof error === "string" && !isBlank(error)) {
        return error;
    }
    return fallback;
}

function splitWorkbenchTextLines(value: string): string[] {
    return value
        .replace(/\r\n/g, "\n")
        .split("\n")
        .map((item) => item.trim())
        .filter((item) => item !== "");
}

function getWorkbenchSkillPathLabel(path: string): string {
    const normalized = path.replace(/\\/g, "/");
    const relativePath = normalized.startsWith(WORKBENCH_CODEX_SKILLS_PATH.replace(/\\/g, "/"))
        ? normalized.slice(WORKBENCH_CODEX_SKILLS_PATH.length).replace(/^[/\\]+/, "")
        : normalized;
    if (isBlank(relativePath)) {
        return "skills 根目录";
    }
    return relativePath;
}

function createWorkbenchMcpServerDraft(existingServers: WorkbenchMcpServerConfig[]): WorkbenchMcpServerConfig {
    const existingNames = new Set(existingServers.map((server) => server.name.trim().toLowerCase()));
    let index = existingServers.length + 1;
    let nextName = `mcp-server-${index}`;
    while (existingNames.has(nextName.toLowerCase())) {
        index++;
        nextName = `mcp-server-${index}`;
    }
    return {
        name: nextName,
        type: "stdio",
        command: "",
        args: [],
        url: "",
        bearerTokenEnvVar: "",
        envVars: [],
        startupTimeoutSec: "",
    };
}

function validateWorkbenchIntegrations(config: WorkbenchIntegrationsConfig): string | null {
    if (isBlank(config.codex.modelProvider)) {
        return "Provider 名称不能为空。";
    }
    if (isBlank(config.codex.model)) {
        return "默认模型不能为空。";
    }
    const seenServerNames = new Set<string>();
    for (const server of config.mcpServers) {
        const normalizedName = server.name.trim().toLowerCase();
        if (normalizedName === "") {
            return "MCP 服务器名称不能为空。";
        }
        if (seenServerNames.has(normalizedName)) {
            return `MCP 服务器名称重复：${server.name}`;
        }
        seenServerNames.add(normalizedName);
        if (server.type === "stdio" && isBlank(server.command)) {
            return `MCP 服务器 ${server.name} 还没有填写 command。`;
        }
        if (server.type !== "stdio" && isBlank(server.url)) {
            return `MCP 服务器 ${server.name} 还没有填写 URL。`;
        }
        if (!isBlank(server.startupTimeoutSec) && !/^-?\d+(?:\.\d+)?$/.test(server.startupTimeoutSec.trim())) {
            return `MCP 服务器 ${server.name} 的启动超时不是合法数字。`;
        }
    }
    for (const item of config.skills.configs) {
        if (isBlank(item.path)) {
            return "自定义 skill 路径不能为空。";
        }
    }
    return null;
}

async function discoverWorkbenchSkillDirectories(rootPath: string): Promise<string[]> {
    const rootEntries = await RpcApi.FileListCommand(TabRpcClient, {
        path: rootPath,
        opts: { limit: 256 },
    });
    const directSkillPaths = new Set<string>();
    const nestedDirectories: FileInfo[] = [];

    for (const entry of rootEntries ?? []) {
        if (entry == null || entry.notfound) {
            continue;
        }
        const name = String(entry.name ?? "").trim();
        if (name === "" || name.startsWith(".")) {
            continue;
        }
        if (entry.isdir && name === "scripts") {
            continue;
        }
        if (entry.isdir) {
            nestedDirectories.push(entry);
        }
        if (!entry.isdir && name.toUpperCase() === "SKILL.MD") {
            directSkillPaths.add(String(entry.dir ?? rootPath));
        }
    }

    const nestedResults = await Promise.all(
        nestedDirectories.map(async (entry) => {
            const dirPath = String(entry.path ?? "").trim();
            if (dirPath === "") {
                return [] as string[];
            }
            const childEntries = await RpcApi.FileListCommand(TabRpcClient, {
                path: dirPath,
                opts: { limit: 256 },
            });
            const matches: string[] = [];
            for (const child of childEntries ?? []) {
                if (child == null || child.notfound) {
                    continue;
                }
                const childName = String(child.name ?? "").trim();
                if (!child.isdir && childName.toUpperCase() === "SKILL.MD") {
                    matches.push(String(child.dir ?? dirPath));
                    continue;
                }
                if (child.isdir && !childName.startsWith(".")) {
                    const grandChildren = await RpcApi.FileListCommand(TabRpcClient, {
                        path: String(child.path ?? "").trim(),
                        opts: { limit: 128 },
                    });
                    if (
                        (grandChildren ?? []).some(
                            (grandChild) =>
                                grandChild != null &&
                                grandChild.notfound !== true &&
                                grandChild.isdir !== true &&
                                String(grandChild.name ?? "")
                                    .trim()
                                    .toUpperCase() === "SKILL.MD"
                        )
                    ) {
                        matches.push(String(child.path ?? "").trim());
                    }
                }
            }
            return matches;
        })
    );

    for (const group of nestedResults) {
        for (const path of group) {
            if (!isBlank(path)) {
                directSkillPaths.add(path);
            }
        }
    }

    return Array.from(directSkillPaths).sort((left, right) => left.localeCompare(right, "zh-CN"));
}

function quoteTomlBasicString(value: string): string {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function findFirstTopLevelTomlSectionIndex(lines: string[]): number {
    let multilineStringDelimiter: '"""' | "'''" | null = null;

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index] ?? "";
        if (multilineStringDelimiter == null && /^\s*\[/.test(line)) {
            return index;
        }
        multilineStringDelimiter = updateTomlMultilineStringDelimiter(line, multilineStringDelimiter);
    }

    return -1;
}

function updateTomlMultilineStringDelimiter(
    line: string,
    currentDelimiter: '"""' | "'''" | null
): '"""' | "'''" | null {
    if (currentDelimiter != null) {
        return countTomlTripleDelimiterOccurrences(line, currentDelimiter) % 2 === 1 ? null : currentDelimiter;
    }

    const doubleQuoteIndex = findTomlTripleDelimiterIndex(line, '"""');
    const singleQuoteIndex = findTomlTripleDelimiterIndex(line, "'''");
    const nextDelimiter =
        doubleQuoteIndex === -1
            ? singleQuoteIndex === -1
                ? null
                : "'''"
            : singleQuoteIndex === -1 || doubleQuoteIndex < singleQuoteIndex
              ? '"""'
              : "'''";
    if (nextDelimiter == null) {
        return null;
    }
    return countTomlTripleDelimiterOccurrences(line, nextDelimiter) % 2 === 1 ? nextDelimiter : null;
}

function findTomlTripleDelimiterIndex(line: string, delimiter: '"""' | "'''"): number {
    for (let index = 0; index <= line.length - delimiter.length; index++) {
        if (!line.startsWith(delimiter, index)) {
            continue;
        }
        if (delimiter === '"""' && index > 0 && line[index - 1] === "\\") {
            continue;
        }
        return index;
    }
    return -1;
}

function countTomlTripleDelimiterOccurrences(line: string, delimiter: '"""' | "'''"): number {
    let count = 0;
    for (let index = 0; index <= line.length - delimiter.length; index++) {
        if (!line.startsWith(delimiter, index)) {
            continue;
        }
        if (delimiter === '"""' && index > 0 && line[index - 1] === "\\") {
            continue;
        }
        count++;
        index += delimiter.length - 1;
    }
    return count;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isValidColor(value?: string): value is string {
    return value != null && value.trim() !== "" && colord(value).isValid();
}

function pickThemeColor(candidates: Array<string | undefined>, fallback: string): string {
    for (const candidate of candidates) {
        if (isValidColor(candidate)) {
            return colord(candidate).toHex();
        }
    }
    return fallback;
}

function mixColors(sourceColor: string, targetColor: string, weight: number): string {
    const source = colord(sourceColor).toRgb();
    const target = colord(targetColor).toRgb();
    const mixChannel = (sourceChannel: number, targetChannel: number) => {
        return Math.round(sourceChannel + (targetChannel - sourceChannel) * weight);
    };

    return colord({
        r: mixChannel(source.r, target.r),
        g: mixChannel(source.g, target.g),
        b: mixChannel(source.b, target.b),
    }).toHex();
}

function withAlpha(color: string, alpha: number): string {
    return colord(color).alpha(alpha).toRgbString();
}

function getRelativeLuminance(color: string): number {
    const { r, g, b } = colord(color).toRgb();
    const normalizeChannel = (channel: number) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    };

    const red = normalizeChannel(r);
    const green = normalizeChannel(g);
    const blue = normalizeChannel(b);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function deriveWorkbenchThemeStyle(
    theme: TermThemeType | undefined,
    themedBackground: string | undefined,
    variant: WorkbenchThemeVariant
): WorkbenchThemeStyle {
    const background = pickThemeColor([themedBackground, theme?.background], "#06080c");
    const foreground = pickThemeColor([theme?.foreground, theme?.brightWhite, theme?.white], "#f3f7ff");
    const mutedBase = pickThemeColor([theme?.gray, theme?.brightBlack, theme?.white], foreground);
    const accentCandidates =
        variant === "sea"
            ? [theme?.brightCyan, theme?.cyan, theme?.green, theme?.brightBlue, theme?.blue]
            : variant === "ember"
              ? [theme?.brightYellow, theme?.yellow, theme?.brightRed, theme?.red, theme?.magenta]
              : [theme?.cursor, theme?.brightBlue, theme?.blue, theme?.magenta, theme?.cyan];
    const accentAltCandidates =
        variant === "sea"
            ? [theme?.green, theme?.brightGreen, theme?.brightBlue, theme?.blue, theme?.cyan]
            : variant === "ember"
              ? [theme?.brightRed, theme?.red, theme?.magenta, theme?.brightMagenta, theme?.yellow]
              : [theme?.cyan, theme?.brightCyan, theme?.magenta, theme?.brightMagenta];
    const accent = pickThemeColor(accentCandidates, "#69b9ff");
    const accentAlt = pickThemeColor(accentAltCandidates, accent);
    const good = pickThemeColor([theme?.green, theme?.brightGreen], "#52d5a7");
    const warn = pickThemeColor([theme?.yellow, theme?.brightYellow], "#f1b45f");
    const danger = pickThemeColor([theme?.red, theme?.brightRed], "#f47a87");
    const scheme = getRelativeLuminance(background) < 0.36 ? "dark" : "light";
    const surfaceAnchor = scheme === "dark" ? "#000000" : "#ffffff";
    const textAnchor = scheme === "dark" ? "#ffffff" : "#0d1520";
    const bg = mixColors(background, surfaceAnchor, scheme === "dark" ? 0.22 : 0.02);
    const bgTop = mixColors(
        background,
        accent,
        variant === "ember"
            ? scheme === "dark"
                ? 0.24
                : 0.09
            : variant === "sea"
              ? scheme === "dark"
                  ? 0.18
                  : 0.07
              : scheme === "dark"
                ? 0.2
                : 0.06
    );
    const bgBottom = mixColors(background, surfaceAnchor, scheme === "dark" ? 0.44 : 0.08);
    const panel = withAlpha(
        mixColors(background, surfaceAnchor, scheme === "dark" ? 0.28 : 0.03),
        scheme === "dark" ? 0.92 : 0.88
    );
    const panel2 = withAlpha(
        mixColors(background, surfaceAnchor, scheme === "dark" ? 0.42 : 0.08),
        scheme === "dark" ? 0.94 : 0.92
    );
    const control = withAlpha(
        mixColors(background, surfaceAnchor, scheme === "dark" ? 0.36 : 0.04),
        scheme === "dark" ? 0.97 : 0.95
    );
    const controlHover = withAlpha(
        mixColors(background, accent, scheme === "dark" ? 0.24 : 0.1),
        scheme === "dark" ? 0.96 : 0.94
    );
    const controlSubtle = withAlpha(
        mixColors(background, accentAlt, scheme === "dark" ? 0.14 : 0.06),
        scheme === "dark" ? 0.82 : 0.8
    );
    const line = withAlpha(
        mixColors(mutedBase, background, scheme === "dark" ? 0.52 : 0.74),
        scheme === "dark" ? 0.34 : 0.22
    );
    const lineStrong = withAlpha(mixColors(accent, mutedBase, 0.36), scheme === "dark" ? 0.6 : 0.34);
    const text = withAlpha(mixColors(foreground, textAnchor, scheme === "dark" ? 0.08 : 0.02), 0.98);
    const muted = withAlpha(
        mixColors(mutedBase, background, scheme === "dark" ? 0.14 : 0.28),
        scheme === "dark" ? 0.8 : 0.78
    );
    const faint = withAlpha(
        mixColors(mutedBase, background, scheme === "dark" ? 0.24 : 0.42),
        scheme === "dark" ? 0.56 : 0.62
    );
    const accentSoft = withAlpha(
        mixColors(accent, background, scheme === "dark" ? 0.36 : 0.58),
        scheme === "dark" ? 0.22 : 0.18
    );
    const accentStrong = withAlpha(mixColors(accent, "#ffffff", scheme === "dark" ? 0.12 : 0.04), 0.96);
    const accentRing = withAlpha(accent, scheme === "dark" ? 0.22 : 0.14);
    const optionBg = withAlpha(mixColors(background, surfaceAnchor, scheme === "dark" ? 0.44 : 0.02), 1);
    const optionFg = withAlpha(mixColors(foreground, textAnchor, scheme === "dark" ? 0.06 : 0.02), 0.98);
    const knob = withAlpha(mixColors(foreground, textAnchor, scheme === "dark" ? 0.14 : 0.06), 0.98);
    const accentContrast = getRelativeLuminance(accent) < 0.42 ? "#ffffff" : "#04111d";
    const dangerContrast = getRelativeLuminance(danger) < 0.42 ? "#ffffff" : "#21060a";

    return {
        colorScheme: scheme,
        "--wb-bg": bg,
        "--wb-bg-top": bgTop,
        "--wb-bg-bottom": bgBottom,
        "--wb-panel": panel,
        "--wb-panel-2": panel2,
        "--wb-control": control,
        "--wb-control-hover": controlHover,
        "--wb-control-subtle": controlSubtle,
        "--wb-line": line,
        "--wb-line-strong": lineStrong,
        "--wb-text": text,
        "--wb-muted": muted,
        "--wb-faint": faint,
        "--wb-accent": accent,
        "--wb-accent-soft": accentSoft,
        "--wb-accent-strong": accentStrong,
        "--wb-accent-ring": accentRing,
        "--wb-accent-contrast": accentContrast,
        "--wb-good": good,
        "--wb-warn": warn,
        "--wb-danger": danger,
        "--wb-danger-contrast": dangerContrast,
        "--wb-glow-a": withAlpha(
            accent,
            variant === "ember" ? (scheme === "dark" ? 0.3 : 0.14) : scheme === "dark" ? 0.24 : 0.12
        ),
        "--wb-glow-b": withAlpha(
            accentAlt,
            variant === "sea" ? (scheme === "dark" ? 0.2 : 0.1) : scheme === "dark" ? 0.16 : 0.08
        ),
        "--wb-option-bg": optionBg,
        "--wb-option-fg": optionFg,
        "--wb-knob": knob,
        "--wb-shadow": scheme === "dark" ? "0 22px 40px rgba(0, 0, 0, 0.34)" : "0 18px 36px rgba(15, 23, 42, 0.14)",
    };
}

function isWorkbenchThemeVariant(value: string | null | undefined): value is WorkbenchThemeVariant {
    return value === "wave" || value === "sea" || value === "ember";
}

function promptToWorkbenchMessage(prompt: WaveAIPromptMessageType): WorkbenchMessage {
    return {
        id: crypto.randomUUID(),
        role: normalizePromptRole(prompt.role),
        content: prompt.content ?? "",
        timestamp: stamp(),
    };
}

function normalizePromptRole(role: string): MessageRole {
    if (role === "user") return "user";
    if (role === "assistant") return "assistant";
    if (role === "error") return "error";
    return "system";
}

async function loadAiHistory(blockId: string): Promise<WaveAIPromptMessageType[]> {
    const { data } = await fetchWaveFile(blockId, "aidata");
    if (!data) {
        return [];
    }
    const history = JSON.parse(new TextDecoder().decode(data)) as WaveAIPromptMessageType[];
    return history;
}

export function sanitizeWorkbenchPromptHistory(history: WaveAIPromptMessageType[]): WaveAIPromptMessageType[] {
    if (!Array.isArray(history)) {
        return [];
    }
    return history.flatMap((prompt) => {
        const role = String(prompt?.role ?? "").trim();
        const content = typeof prompt?.content === "string" ? prompt.content : "";
        if (!WORKBENCH_ALLOWED_PROMPT_ROLES.has(role) || isBlank(content)) {
            return [];
        }
        return [{ ...prompt, role, content }];
    });
}

export function buildWorkbenchSendPrompt(
    history: WaveAIPromptMessageType[],
    userPrompt: WaveAIPromptMessageType,
    windowSize = CHAT_CONTEXT_WINDOW
): WaveAIPromptMessageType[] {
    return [
        ...limitWorkbenchPromptHistory(sanitizeWorkbenchPromptHistory(history), windowSize),
        ...sanitizeWorkbenchPromptHistory([userPrompt]),
    ];
}

export function buildWorkbenchPersistedHistory(
    history: WaveAIPromptMessageType[],
    nextPrompts: WaveAIPromptMessageType[]
): WaveAIPromptMessageType[] {
    return [...sanitizeWorkbenchPromptHistory(history), ...sanitizeWorkbenchPromptHistory(nextPrompts)];
}

export function limitWorkbenchPromptHistory(
    history: WaveAIPromptMessageType[],
    windowSize = CHAT_CONTEXT_WINDOW
): WaveAIPromptMessageType[] {
    const normalizedHistory = Array.isArray(history) ? history : [];
    const normalizedWindowSize = Number.isFinite(windowSize) ? Math.max(0, Math.floor(windowSize)) : 0;
    if (normalizedWindowSize === 0) {
        return normalizedHistory;
    }
    return normalizedHistory.slice(Math.max(normalizedHistory.length - normalizedWindowSize, 0));
}

export { WorkbenchViewModel };

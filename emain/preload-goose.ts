// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { contextBridge, ipcRenderer, webUtils } from "electron";
import { EventEmitter } from "node:events";

type GooseMessageBoxResponse = {
    response: number;
    checkboxChecked?: boolean;
};

type GooseSaveDialogResponse = {
    canceled: boolean;
    filePath?: string;
};

type GooseFileResponse = {
    file: string;
    filePath: string;
    error: string | null;
    found: boolean;
};

const appConfigState: Record<string, unknown> = { ...(ipcRenderer.sendSync("goose:get-app-config") ?? {}) };
const eventBus = new EventEmitter();
const callbackMap = new Map<string, Map<Function, Function>>();
const GooseUiZoomFactorKey = "uiZoomFactor";
const PersistedGooseSettingKeys = new Set<string>([
    "theme",
    "useSystemTheme",
    "responseStyle",
    "showPricing",
    "sessionSharing",
    "seenAnnouncementIds",
    "navigationExpanded",
    "navigationMode",
    "navigationStyle",
    "navigationPosition",
    "navigationPreferences",
    "navigationChatExpanded",
    "navExpandedWidth",
    "spellcheckEnabled",
    "uiAccentPreset",
    "uiBackgroundStyle",
]);
const settings = new Map<string, unknown>([
    ["theme", "light"],
    ["useSystemTheme", true],
    ["responseStyle", "concise"],
    ["showPricing", true],
    ["sessionSharing", { enabled: false, baseUrl: "" }],
    ["seenAnnouncementIds", []],
    ["navigationExpanded", true],
    ["navigationMode", "push"],
    ["navigationStyle", "condensed"],
    ["navigationPosition", "right"],
    [
        "navigationPreferences",
        {
            itemOrder: ["home", "chat", "recipes", "apps", "scheduler", "extensions", "settings"],
            enabledItems: ["home", "chat", "recipes", "apps", "scheduler", "extensions", "settings"],
        },
    ],
    ["navigationChatExpanded", true],
    ["navExpandedWidth", null],
    ["externalGoosed", { enabled: false, url: "", secret: "" }],
    ["spellcheckEnabled", true],
    ["uiAccentPreset", "goose"],
    ["uiBackgroundStyle", "neutral"],
    [GooseUiZoomFactorKey, 1],
]);

void ipcRenderer
    .invoke("goose:get-goosed-base-url")
    .then((baseUrl) => {
        appConfigState.GOOSE_API_HOST = baseUrl;
    })
    .catch((error) => {
        console.warn("[goose-bridge] failed to hydrate GOOSE_API_HOST", error);
    });

function registerCallback(channel: string, callback: Function, wrapped: Function) {
    let channelCallbacks = callbackMap.get(channel);
    if (channelCallbacks == null) {
        channelCallbacks = new Map();
        callbackMap.set(channel, channelCallbacks);
    }
    channelCallbacks.set(callback, wrapped);
}

function unregisterCallback(channel: string, callback: Function) {
    const channelCallbacks = callbackMap.get(channel);
    const wrapped = channelCallbacks?.get(callback);
    if (wrapped == null) {
        return null;
    }
    channelCallbacks.delete(callback);
    if (channelCallbacks.size === 0) {
        callbackMap.delete(channel);
    }
    return wrapped;
}

function onChannel(channel: string, callback: (event: unknown, ...args: unknown[]) => void) {
    const wrapped = (...args: unknown[]) => callback({ sender: "wave-goose-bridge" }, ...args);
    registerCallback(channel, callback, wrapped);
    eventBus.on(channel, wrapped);
}

function offChannel(channel: string, callback: (event: unknown, ...args: unknown[]) => void) {
    const wrapped = unregisterCallback(channel, callback);
    if (wrapped == null) {
        return;
    }
    eventBus.off(channel, wrapped as (...args: unknown[]) => void);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value != null && !Array.isArray(value);
}

function applyThemeDataToSettings(themeData: unknown): void {
    if (!isRecord(themeData)) {
        return;
    }
    if (themeData.theme === "light" || themeData.theme === "dark") {
        settings.set("theme", themeData.theme);
    }
    if (typeof themeData.useSystemTheme === "boolean") {
        settings.set("useSystemTheme", themeData.useSystemTheme);
    }
    if (
        themeData.uiAccentPreset === "goose" ||
        themeData.uiAccentPreset === "ocean" ||
        themeData.uiAccentPreset === "forest" ||
        themeData.uiAccentPreset === "sunset"
    ) {
        settings.set("uiAccentPreset", themeData.uiAccentPreset);
    }
    if (
        themeData.uiBackgroundStyle === "neutral" ||
        themeData.uiBackgroundStyle === "soft" ||
        themeData.uiBackgroundStyle === "vivid"
    ) {
        settings.set("uiBackgroundStyle", themeData.uiBackgroundStyle);
    }
}

for (const key of PersistedGooseSettingKeys) {
    void ipcRenderer
        .invoke("goose:get-setting", key)
        .then((value) => {
            if (value !== undefined) {
                settings.set(key, value);
            }
        })
        .catch((error) => {
            console.warn(`[goose-bridge] failed to hydrate ${key}`, error);
        });
}

void ipcRenderer
    .invoke("goose:get-ui-zoom-factor")
    .then((zoomFactor) => {
        settings.set(GooseUiZoomFactorKey, zoomFactor);
    })
    .catch((error) => {
        console.warn("[goose-bridge] failed to hydrate uiZoomFactor", error);
    });

ipcRenderer.on("goose:theme-changed", (_event, themeData: unknown) => {
    applyThemeDataToSettings(themeData);
    eventBus.emit("theme-changed", themeData);
});

const electronApi = {
    platform: process.platform,
    reactReady: () => ipcRenderer.send("fe-log", "[goose-bridge] react-ready"),
    getConfig: () => ({ ...appConfigState }),
    hideWindow: () => null,
    directoryChooser: async () => ({ canceled: true, filePaths: [] }),
    createChatWindow: () => null,
    logInfo: (txt: string) => ipcRenderer.send("fe-log", `[goose] ${txt}`),
    showNotification: () => null,
    showMessageBox: async (): Promise<GooseMessageBoxResponse> => ({ response: 0, checkboxChecked: false }),
    showSaveDialog: async (): Promise<GooseSaveDialogResponse> => ({ canceled: true }),
    openInChrome: (url: string) => ipcRenderer.send("open-external", url),
    fetchMetadata: async () => "",
    reloadApp: () => window.location.reload(),
    checkForOllama: async () => false,
    selectFileOrDirectory: async () => null,
    getBinaryPath: async () => "",
    readFile: async (filePath: string): Promise<GooseFileResponse> => ({
        file: "",
        filePath,
        error: "unsupported in Wave Goose bridge",
        found: false,
    }),
    writeFile: async () => false,
    ensureDirectory: async () => false,
    listFiles: async () => [],
    getAllowedExtensions: async () => [],
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    setMenuBarIcon: async () => false,
    getMenuBarIconState: async () => false,
    setDockIcon: async () => false,
    getDockIconState: async () => false,
    getSetting: async (key: string) => {
        if (key === GooseUiZoomFactorKey) {
            const nextValue = await ipcRenderer.invoke("goose:get-ui-zoom-factor");
            settings.set(key, nextValue);
            return nextValue;
        }
        if (PersistedGooseSettingKeys.has(key)) {
            const nextValue = await ipcRenderer.invoke("goose:get-setting", key);
            if (nextValue !== undefined) {
                settings.set(key, nextValue);
                return nextValue;
            }
        }
        return settings.get(key);
    },
    setSetting: async (key: string, value: unknown) => {
        if (key === GooseUiZoomFactorKey) {
            const nextValue = await ipcRenderer.invoke("goose:set-ui-zoom-factor", value);
            settings.set(key, nextValue);
            return nextValue;
        }
        if (PersistedGooseSettingKeys.has(key)) {
            const nextValue = await ipcRenderer.invoke("goose:set-setting", key, value);
            settings.set(key, nextValue ?? value);
            return nextValue;
        }
        settings.set(key, value);
    },
    getSecretKey: () => ipcRenderer.invoke("goose:get-secret-key"),
    getGoosedHostPort: () => ipcRenderer.invoke("goose:get-goosed-base-url"),
    optimizePromptInput: (request: { prompt: string; provider: string; model: string }) =>
        ipcRenderer.invoke("goose:optimize-prompt-input", request),
    setWakelock: async () => false,
    getWakelockState: async () => false,
    setSpellcheck: async () => false,
    getSpellcheckState: async () => false,
    openNotificationsSettings: async () => false,
    onMouseBackButtonClicked: (callback: () => void) => onChannel("mouse-back-button-clicked", () => callback()),
    offMouseBackButtonClicked: (callback: () => void) => offChannel("mouse-back-button-clicked", callback as any),
    on: (channel: string, callback: (event: unknown, ...args: unknown[]) => void) => onChannel(channel, callback),
    off: (channel: string, callback: (event: unknown, ...args: unknown[]) => void) => offChannel(channel, callback),
    emit: (channel: string, ...args: unknown[]) => eventBus.emit(channel, ...args),
    broadcastThemeChange: (themeData: unknown) => {
        applyThemeDataToSettings(themeData);
        eventBus.emit("theme-changed", themeData);
        void ipcRenderer.invoke("goose:broadcast-theme-change", themeData).catch((error) => {
            console.warn("[goose-bridge] failed to broadcast theme change", error);
        });
    },
    openExternal: async (url: string) => {
        ipcRenderer.send("open-external", url);
    },
    getVersion: () => String(appConfigState.GOOSE_VERSION ?? ""),
    checkForUpdates: async () => ({ updateInfo: null, error: null }),
    downloadUpdate: async () => ({ success: false, error: null }),
    installUpdate: () => null,
    restartApp: () => window.location.reload(),
    onUpdaterEvent: (callback: (event: unknown) => void) => onChannel("updater-event", (_event, data) => callback(data)),
    getUpdateState: async () => null,
    isUsingGitHubFallback: async () => false,
    closeWindow: () => null,
    hasAcceptedRecipeBefore: async () => false,
    recordRecipeHash: async () => true,
    openDirectoryInExplorer: async (directoryPath: string) => {
        ipcRenderer.send("open-native-path", directoryPath);
        return true;
    },
    launchApp: async () => null,
    refreshApp: async () => null,
    closeApp: async () => null,
    addRecentDir: async () => true,
};

const appConfigApi = {
    get: (key: string) => appConfigState[key],
    getAll: () => ({ ...appConfigState }),
};

contextBridge.exposeInMainWorld("electron", electronApi);
contextBridge.exposeInMainWorld("appConfig", appConfigApi);

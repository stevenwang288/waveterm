import i18next from "@/app/i18n";
import { FavoriteItem, FavoritesModel } from "@/app/store/favorites-model";
import {
    atoms,
    createBlock,
    getApi,
    getBlockMetaKeyAtom,
    getSettingsKeyAtom,
    globalStore,
    WOS,
} from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { openCliLayoutInNewTab } from "@/util/clilayout";
import { resolveTerminalActionCwd } from "@/util/launchcwd";
import { isWindows } from "@/util/platformutil";
import { base64ToString, isBlank, stringToBase64 } from "@/util/util";

const BUILTIN_TERM_THEME_DISPLAY_NAME_TO_I18N_KEY: Record<string, string> = {
    "Default Dark": "term.themeNames.defaultDark",
    "One Dark Pro": "term.themeNames.oneDarkPro",
    Dracula: "term.themeNames.dracula",
    Monokai: "term.themeNames.monokai",
    Campbell: "term.themeNames.campbell",
    "Warm Yellow": "term.themeNames.warmYellow",
    "Rose Pine": "term.themeNames.rosePine",
};

function translateBuiltinTermThemeDisplayName(displayName: string): string {
    const key = BUILTIN_TERM_THEME_DISPLAY_NAME_TO_I18N_KEY[displayName];
    if (!key) {
        return displayName;
    }
    const translated = i18next.t(key);
    return translated === key ? displayName : translated;
}

function getTermThemeMenuLabel(themeName: string, theme: Record<string, any> | undefined): string {
    const displayName = theme?.["display:name"] ?? themeName;
    return translateBuiltinTermThemeDisplayName(displayName);
}

type SharedTermSettingsMenuOptions = {
    blockId: string;
    blockData?: Block | null;
    liveDisplayCwd?: string | null;
    splitItems?: ContextMenuItem[];
    includeNewBlockInheritCwd?: boolean;
    includeFileBrowser?: boolean;
    saveItem?: ContextMenuItem | null;
    includeFontSize?: boolean;
    fontSizeItem?: ContextMenuItem | null;
    setTheme: (themeName: string | null) => void;
    advancedItems?: ContextMenuItem[];
    closeToolbarItem?: ContextMenuItem | null;
};

type SharedTermContextMenuOptions = {
    clipboardItems?: ContextMenuItem[];
    selectionItems?: ContextMenuItem[];
    workspaceItems?: ContextMenuItem[];
    editItems?: ContextMenuItem[];
    blockItems?: ContextMenuItem[];
    settingsItems?: ContextMenuItem[];
};

type CliLayoutPresetState = {
    rows: number;
    cols: number;
    paths: string[];
    commands?: string[];
    connection?: string;
    updatedTs: number;
    name?: string;
};

type CliLayoutConfigFile = {
    version: number;
    lastPresetKey?: string;
    presets: Record<string, CliLayoutPresetState>;
    savedLayouts?: Record<string, CliLayoutPresetState>;
};

export type CliLayoutPreset = {
    key: string;
    label: string;
    rows: number;
    cols: number;
};

export const AI_LAUNCH_COMMANDS: Array<{ label: string; command: string }> = [
    { label: "Codex", command: isWindows() ? "codex.cmd" : "codex" },
    { label: "Claude", command: "claude" },
    { label: "Gemini", command: "gemini" },
    { label: "OpenCode", command: "opencode" },
];

export const CLI_LAYOUT_PRESETS: CliLayoutPreset[] = [
    { key: "2", label: "两分屏", rows: 1, cols: 2 },
    { key: "3", label: "三分屏", rows: 1, cols: 3 },
    { key: "4", label: "四分屏", rows: 2, cols: 2 },
    { key: "6", label: "六分屏", rows: 2, cols: 3 },
    { key: "6-2col", label: "六分屏（2列）", rows: 3, cols: 2 },
    { key: "8", label: "八分屏", rows: 2, cols: 4 },
    { key: "8-2col", label: "八分屏（2列）", rows: 4, cols: 2 },
    { key: "9", label: "九分屏", rows: 3, cols: 3 },
];

function normalizeConnectionName(connection?: string): string {
    const cleaned = connection?.trim();
    return cleaned ? cleaned : "";
}

function normalizePath(path: string): string {
    if (isBlank(path)) {
        return "";
    }
    const trimmed = path.trim();
    if (trimmed === "~" || trimmed === "/" || trimmed === "\\") {
        return trimmed;
    }
    const driveRoot = trimmed.match(/^([A-Za-z]:)[\\/]*$/);
    if (driveRoot) {
        return `${driveRoot[1]}\\`;
    }
    return trimmed.replace(/[\\/]+$/, "");
}

function isCategoryPath(path: string): boolean {
    return path.endsWith("/__category__") || path.endsWith("\\__category__");
}

function flattenContextMenuSections(sections: ContextMenuItem[][]): ContextMenuItem[] {
    const nonEmptySections = sections.filter((section) => section.length > 0);
    return nonEmptySections.flatMap((section, index) => {
        if (index === 0) {
            return section;
        }
        return [{ type: "separator" }, ...section];
    });
}

async function readCliLayoutConfig(cliLayoutConfigPath: string): Promise<CliLayoutConfigFile> {
    const defaultConfig: CliLayoutConfigFile = {
        version: 1,
        presets: {},
        savedLayouts: {},
    };
    try {
        const response = await RpcApi.FileReadCommand(TabRpcClient, {
            info: { path: cliLayoutConfigPath },
        });
        const content = response?.data64 ? base64ToString(response.data64) : "";
        if (isBlank(content)) {
            return defaultConfig;
        }
        const parsed = JSON.parse(content) as Partial<CliLayoutConfigFile>;
        if (parsed == null || typeof parsed !== "object") {
            return defaultConfig;
        }
        return {
            version: 1,
            lastPresetKey: typeof parsed.lastPresetKey === "string" ? parsed.lastPresetKey : undefined,
            presets: typeof parsed.presets === "object" && parsed.presets != null ? (parsed.presets as any) : {},
            savedLayouts:
                typeof parsed.savedLayouts === "object" && parsed.savedLayouts != null ? (parsed.savedLayouts as any) : {},
        };
    } catch {
        return defaultConfig;
    }
}

async function writeCliLayoutConfig(cliLayoutConfigPath: string, config: CliLayoutConfigFile): Promise<void> {
    await RpcApi.FileWriteCommand(TabRpcClient, {
        info: { path: cliLayoutConfigPath },
        data64: stringToBase64(JSON.stringify(config, null, 2)),
    });
}

export function buildSharedTermContextMenuItems({
    clipboardItems = [],
    selectionItems = [],
    workspaceItems = [],
    editItems = [],
    blockItems = [],
    settingsItems = [],
}: SharedTermContextMenuOptions): ContextMenuItem[] {
    return flattenContextMenuSections([
        clipboardItems,
        selectionItems,
        workspaceItems,
        editItems,
        blockItems,
        settingsItems,
    ]);
}

export function makeUnavailableMenuItem(label: string, sublabel: string): ContextMenuItem {
    return {
        label,
        sublabel,
        enabled: false,
    };
}

export function getCliLayoutPresetLabel(preset: CliLayoutPreset): string {
    const key = `clilayout.presets.${preset.key}`;
    const translated = i18next.t(key);
    return translated === key ? preset.label : translated;
}

export async function addPathToCliLayoutPreset({
    path,
    connection,
    preset,
    openAfterAdd,
}: {
    path: string;
    connection?: string;
    preset: CliLayoutPreset;
    openAfterAdd: boolean;
}): Promise<void> {
    const currentPath = normalizePath(path) || "~";
    const currentConn = normalizeConnectionName(connection);
    const cliLayoutConfigPath = `${getApi().getConfigDir()}/cli-layout-presets.json`;
    const config = await readCliLayoutConfig(cliLayoutConfigPath);
    const existingState = config.presets?.[preset.key];
    const totalSlots = Math.max(1, preset.rows * preset.cols);

    const paths = Array.from({ length: totalSlots }, (_, index) => {
        return normalizePath(existingState?.paths?.[index] ?? "");
    });
    const commands = Array.from({ length: totalSlots }, (_, index) => {
        const cmd = existingState?.commands?.[index];
        return typeof cmd === "string" ? cmd.trim() : "";
    });

    const emptyIndex = paths.findIndex((candidate) => isBlank(candidate));
    if (emptyIndex >= 0) {
        paths[emptyIndex] = currentPath;
    } else {
        paths.shift();
        paths.push(currentPath);
    }

    const preservedConn =
        existingState != null && !isBlank(existingState.connection) ? existingState.connection : currentConn;
    const nextConnection = isBlank(preservedConn) ? undefined : preservedConn;
    const nextState: CliLayoutPresetState = {
        rows: preset.rows,
        cols: preset.cols,
        paths,
        commands,
        connection: nextConnection,
        updatedTs: Date.now(),
        name: typeof existingState?.name === "string" ? existingState.name : undefined,
    };

    config.version = 1;
    config.lastPresetKey = preset.key;
    config.presets = config.presets ?? {};
    config.presets[preset.key] = nextState;

    await writeCliLayoutConfig(cliLayoutConfigPath, config);
    window.dispatchEvent(new Event("cli-layout-presets-updated"));

    if (!openAfterAdd) {
        return;
    }

    const openPaths = nextState.paths.map((candidate) => (isBlank(candidate) ? currentPath : normalizePath(candidate) || currentPath));
    const openCommands = nextState.commands?.map((cmd) => (typeof cmd === "string" ? cmd.trim() : "")) ?? [];
    await openCliLayoutInNewTab(
        {
            rows: preset.rows,
            cols: preset.cols,
            paths: openPaths,
            commands: openCommands,
            connection: nextState.connection,
            updatedTs: Date.now(),
        },
        getCliLayoutPresetLabel(preset),
        preset.key
    );
}

export function buildOpenWithAiMenuItems({
    currentPath,
    connection,
}: {
    currentPath: string;
    connection?: string;
}): ContextMenuItem[] {
    return AI_LAUNCH_COMMANDS.map((item) => ({
        label: i18next.t("preview.openAiHere", { ai: item.label }),
        click: () => {
            const meta: Record<string, any> = {
                controller: "shell",
                view: "term",
                "cmd:cwd": currentPath,
                "cmd:initscript": `${item.command}\n`,
            };
            if (connection) {
                meta.connection = connection;
            }
            createBlock({ meta });
        },
    }));
}

export function buildFavoriteLaunchMenuItems({
    items,
    onRunFavorite,
}: {
    items: FavoriteItem[];
    onRunFavorite: (favorite: FavoriteItem, cliCommand?: string) => void;
}): ContextMenuItem[] {
    if (!items?.length) {
        return [
            {
                label: i18next.t("favorites.empty"),
                enabled: false,
            },
        ];
    }

    const favoritesModel = FavoritesModel.getInstance();

    const buildCommandMenuItems = (favorite: FavoriteItem): ContextMenuItem[] => {
        const defaultCmd = typeof favorite.autoCmd === "string" ? favorite.autoCmd.trim() : "";
        const defaultMarker = i18next.t("favorites.defaultMarker");
        return [
            ...(isBlank(defaultCmd)
                ? []
                : [
                      {
                          label: i18next.t("favorites.openDefault"),
                          sublabel: defaultCmd,
                          click: () => onRunFavorite(favorite, defaultCmd),
                      },
                      {
                          label: i18next.t("favorites.clearDefaultCommand"),
                          click: () => {
                              favoritesModel.updateFavoriteAutoCmd(favorite.id, undefined);
                              window.dispatchEvent(new Event("favorites-updated"));
                          },
                      },
                      { type: "separator" as const },
                  ]),
            {
                label: i18next.t("favorites.cdHere"),
                click: () => onRunFavorite(favorite),
            },
            { type: "separator" as const },
            ...AI_LAUNCH_COMMANDS.map((item) => ({
                label: !isBlank(defaultCmd) && item.command === defaultCmd ? `${item.label}${defaultMarker}` : item.label,
                click: () => {
                    onRunFavorite(favorite, item.command);
                    favoritesModel.updateFavoriteAutoCmd(favorite.id, item.command);
                    window.dispatchEvent(new Event("favorites-updated"));
                },
            })),
        ];
    };

    const buildPathMenuItems = (favoriteItems: FavoriteItem[]): ContextMenuItem[] => {
        return favoriteItems.map((favorite) => {
            const hasChildren = (favorite.children?.length ?? 0) > 0;
            const isCategory = isCategoryPath(favorite.path);
            const favoriteConnection = normalizeConnectionName(favorite.connection);
            const sublabelParts: string[] = [];
            if (!isBlank(favoriteConnection)) {
                sublabelParts.push(favoriteConnection);
            }
            if (!isBlank(favorite.path) && !isCategory) {
                sublabelParts.push(favorite.path);
            }
            const sublabel = sublabelParts.length > 0 ? sublabelParts.join(" · ") : undefined;

            if (hasChildren || isCategory) {
                const submenu = buildPathMenuItems(favorite.children ?? []);
                return {
                    label: favorite.label || favorite.path,
                    sublabel,
                    enabled: submenu.length > 0,
                    submenu,
                };
            }

            return {
                label: favorite.label || favorite.path,
                sublabel,
                submenu: buildCommandMenuItems(favorite),
            };
        });
    };

    return buildPathMenuItems(items);
}

export function buildSharedTermSettingsMenuItems({
    blockId,
    blockData,
    liveDisplayCwd = null,
    splitItems = [],
    includeNewBlockInheritCwd = false,
    includeFileBrowser = false,
    saveItem = null,
    includeFontSize = true,
    fontSizeItem = null,
    setTheme,
    advancedItems = [],
    closeToolbarItem = null,
}: SharedTermSettingsMenuOptions): ContextMenuItem[] {
    const fullConfig = globalStore.get(atoms.fullConfigAtom);
    const termThemes = fullConfig?.termthemes ?? {};
    const termThemeKeys = Object.keys(termThemes);
    const curThemeName = globalStore.get(getBlockMetaKeyAtom(blockId, "term:theme"));
    const defaultFontSize = globalStore.get(getSettingsKeyAtom("term:fontsize")) ?? 12;
    const transparencyMeta = globalStore.get(getBlockMetaKeyAtom(blockId, "term:transparency"));
    const blockMeta = blockData?.meta;
    const overrideFontSize = blockMeta?.["term:fontsize"];

    termThemeKeys.sort((a, b) => {
        return (termThemes[a]?.["display:order"] ?? 0) - (termThemes[b]?.["display:order"] ?? 0);
    });

    const defaultTermBlockDef: BlockDef = {
        meta: {
            view: "term",
            controller: "shell",
        },
    };
    const cwd = resolveTerminalActionCwd(blockMeta, liveDisplayCwd);
    const canInheritCwd = !isBlank(cwd);
    const actionItems: ContextMenuItem[] = [...splitItems];
    if (includeNewBlockInheritCwd) {
        actionItems.push({
            label: i18next.t("term.newBlockInheritCwd"),
            enabled: canInheritCwd,
            click: () => {
                const connection = blockMeta?.connection;
                const meta: Record<string, any> = {
                    ...defaultTermBlockDef.meta,
                    "cmd:cwd": cwd,
                };
                if (connection) {
                    meta.connection = connection;
                }
                createBlock({ meta });
            },
        });
    }

    const fileBrowserItems: ContextMenuItem[] = [];
    if (includeFileBrowser && canInheritCwd) {
        fileBrowserItems.push({
            label: i18next.t("term.fileBrowser"),
            click: () => {
                const connection = blockMeta?.connection;
                const meta: Record<string, any> = {
                    view: "preview",
                    file: cwd,
                };
                if (connection) {
                    meta.connection = connection;
                }
                createBlock({ meta });
            },
        });
    }

    const themeSubmenu: ContextMenuItem[] = termThemeKeys.map((themeName) => {
        const theme = termThemes[themeName];
        return {
            label: getTermThemeMenuLabel(themeName, theme),
            type: "checkbox",
            checked: curThemeName == themeName,
            click: () => setTheme(themeName),
        };
    });
    themeSubmenu.unshift({
        label: i18next.t("common.default"),
        type: "checkbox",
        checked: curThemeName == null,
        click: () => setTheme(null),
    });

    const appearanceItems: ContextMenuItem[] = [
        {
            label: i18next.t("term.themes"),
            submenu: themeSubmenu,
        },
    ];

    if (fontSizeItem != null) {
        appearanceItems.push(fontSizeItem);
    } else if (includeFontSize) {
        const fontSizeSubMenu: ContextMenuItem[] = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map(
            (fontSize: number) => {
                return {
                    label: `${fontSize}px`,
                    type: "checkbox",
                    checked: overrideFontSize == fontSize,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", blockId),
                            meta: { "term:fontsize": fontSize },
                        });
                    },
                };
            }
        );
        fontSizeSubMenu.unshift({
            label: i18next.t("common.defaultWithValue", { value: `${defaultFontSize}px` }),
            type: "checkbox",
            checked: overrideFontSize == null,
            click: () => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                    meta: { "term:fontsize": null },
                });
            },
        });
        appearanceItems.push({
            label: i18next.t("term.fontSize"),
            submenu: fontSizeSubMenu,
        });
    }

    const transparencySubMenu: ContextMenuItem[] = [
        {
            label: i18next.t("common.default"),
            type: "checkbox",
            checked: transparencyMeta == null,
            click: () => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                    meta: { "term:transparency": null },
                });
            },
        },
        {
            label: i18next.t("term.transparentBackground"),
            type: "checkbox",
            checked: transparencyMeta == 0.5,
            click: () => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                    meta: { "term:transparency": 0.5 },
                });
            },
        },
        {
            label: i18next.t("term.noTransparency"),
            type: "checkbox",
            checked: transparencyMeta == 0,
            click: () => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", blockId),
                    meta: { "term:transparency": 0 },
                });
            },
        },
    ];
    appearanceItems.push({
        label: i18next.t("term.transparency"),
        submenu: transparencySubMenu,
    });

    const advancedSection: ContextMenuItem[] =
        advancedItems.length > 0
            ? [
                  {
                      label: i18next.t("term.advanced"),
                      submenu: advancedItems,
                  },
              ]
            : [];
    const closeToolbarSection = closeToolbarItem ? [closeToolbarItem] : [];
    const saveSection = saveItem ? [saveItem] : [];

    return flattenContextMenuSections([
        actionItems,
        fileBrowserItems,
        saveSection,
        appearanceItems,
        advancedSection,
        closeToolbarSection,
    ]);
}

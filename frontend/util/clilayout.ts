// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getLayoutModelForStaticTab } from "@/layout/index";
import {
    atoms,
    createBlockSplitHorizontally,
    createBlockSplitVertically,
    getApi,
    getFocusedBlockId,
    globalStore,
    pushFlashError,
    pushNotification,
    replaceBlock,
    WOS,
} from "@/store/global";
import { ObjectService, WorkspaceService } from "@/store/services";
import { getEnv } from "@/util/getenv";
import { fireAndForget, isBlank } from "@/util/util";
import { modalsModel } from "@/store/modalmodel";

export type CliLayoutSlot = {
    type?: "term" | "web" | "block";
    path?: string;
    command?: string;
    connection?: string;
    url?: string;
    hideNav?: boolean;
    zoom?: number;
    title?: string;
    partition?: string;
    meta?: Record<string, any>;
};

export type CliLayoutState = {
    rows: number;
    cols: number;
    paths: string[];
    commands?: string[];
    connection?: string;
    updatedTs?: number;
    name?: string;
    slots?: CliLayoutSlot[];
};

type PendingCliLayout = {
    version: 1;
    tabName?: string;
    presetKey?: string;
    state: CliLayoutState;
};

const PENDING_KEY_PREFIX = "waveterm:pending-cli-layout:";
const PENDING_VERSION = 1 as const;

const DEFAULT_PVE_TAB_NAME = "PVE";
const DEFAULT_PVE_ORIGIN = "https://192.168.1.250:8006";
const DEFAULT_PVE_URL = "https://192.168.1.250:8006/#v1:0:=node%2FVUModule:4:::::8::";
const DEFAULT_PVE_WEB_PARTITION = "persist:pve-wall";
const DEFAULT_PVE_LANG = "zh_CN";

const DEFAULT_WALL_TAB_NAME = "墙";
const DEFAULT_WALL_URL = "";
const DEFAULT_WALL_WEB_PARTITION = "persist:screen-wall";

const WAVETERM_PVE_TAB_NAME_ENV = "WAVETERM_PVE_TAB_NAME";
const WAVETERM_PVE_ORIGIN_ENV = "WAVETERM_PVE_ORIGIN";
const WAVETERM_PVE_URL_ENV = "WAVETERM_PVE_URL";
const WAVETERM_PVE_WEB_PARTITION_ENV = "WAVETERM_PVE_WEB_PARTITION";
const WAVETERM_PVE_LANG_ENV = "WAVETERM_PVE_LANG";

const WAVETERM_WALL_TAB_NAME_ENV = "WAVETERM_WALL_TAB_NAME";
const WAVETERM_WALL_URL_ENV = "WAVETERM_WALL_URL";
const WAVETERM_WALL_WEB_PARTITION_ENV = "WAVETERM_WALL_WEB_PARTITION";

const WALL_TAB_NAME_SETTING_KEY = "wall:tabname";
const WALL_URL_SETTING_KEY = "wall:url";
const WALL_WEB_PARTITION_SETTING_KEY = "wall:webpartition";

let openPveInNewTabInFlight: Promise<void> | null = null;
let openPveUiInNewTabInFlight: Promise<void> | null = null;
let openWallInNewTabInFlight: Promise<void> | null = null;

function normalizeUrlOrigin(value: string): string {
    const trimmed = String(value ?? "").trim();
    if (isBlank(trimmed)) {
        return "";
    }
    try {
        const u = new URL(trimmed);
        return `${u.protocol}//${u.host}`;
    } catch {
        return "";
    }
}

function normalizeUrl(value: string): string {
    const trimmed = String(value ?? "").trim();
    if (isBlank(trimmed)) {
        return "";
    }
    try {
        const u = new URL(trimmed);
        return u.toString();
    } catch {
        return "";
    }
}

function getConfigSettingString(settingKey: string): string {
    const fullConfig = globalStore.get(atoms.fullConfigAtom);
    const raw = (fullConfig?.settings as any)?.[settingKey];
    if (typeof raw !== "string") {
        return "";
    }
    return raw.trim();
}

function getPveTabName(): string {
    const v = String(getEnv(WAVETERM_PVE_TAB_NAME_ENV) ?? "").trim();
    return isBlank(v) ? DEFAULT_PVE_TAB_NAME : v;
}

function getPveUrl(): string {
    const raw = String(getEnv(WAVETERM_PVE_URL_ENV) ?? "").trim();
    const normalized = normalizeUrl(raw);
    return isBlank(normalized) ? DEFAULT_PVE_URL : normalized;
}

function getPveOrigin(pveUrl?: string): string {
    const rawOrigin = String(getEnv(WAVETERM_PVE_ORIGIN_ENV) ?? "").trim();
    const normalizedOrigin = normalizeUrlOrigin(rawOrigin);
    if (!isBlank(normalizedOrigin)) {
        return normalizedOrigin;
    }
    const normalizedFromUrl = normalizeUrlOrigin(pveUrl ?? "");
    return isBlank(normalizedFromUrl) ? DEFAULT_PVE_ORIGIN : normalizedFromUrl;
}

function getPveWebPartition(): string {
    const v = String(getEnv(WAVETERM_PVE_WEB_PARTITION_ENV) ?? "").trim();
    return isBlank(v) ? DEFAULT_PVE_WEB_PARTITION : v;
}

function getPveLang(): string {
    const v = String(getEnv(WAVETERM_PVE_LANG_ENV) ?? "").trim();
    return isBlank(v) ? DEFAULT_PVE_LANG : v;
}

async function promptForPveCredentials(opts: {
    host: string;
    origin: string;
    partition: string;
    lang: string;
    initialError?: string;
}): Promise<boolean> {
    if (modalsModel.isModalOpen("PveCredentialsModal")) {
        return false;
    }
    return await new Promise<boolean>((resolve) => {
        modalsModel.pushModal("PveCredentialsModal", {
            host: opts.host,
            origin: opts.origin,
            partition: opts.partition,
            lang: opts.lang,
            initialError: opts.initialError,
            onSuccess: () => resolve(true),
            onCancel: () => resolve(false),
        });
    });
}

function getWallTabName(): string {
    const fromSettings = getConfigSettingString(WALL_TAB_NAME_SETTING_KEY);
    if (!isBlank(fromSettings)) {
        return fromSettings;
    }
    const v = String(getEnv(WAVETERM_WALL_TAB_NAME_ENV) ?? "").trim();
    return isBlank(v) ? DEFAULT_WALL_TAB_NAME : v;
}

function getWallUrl(): string {
    const fromSettings = normalizeUrl(getConfigSettingString(WALL_URL_SETTING_KEY));
    if (!isBlank(fromSettings)) {
        return fromSettings;
    }
    const raw = String(getEnv(WAVETERM_WALL_URL_ENV) ?? "").trim();
    const normalized = normalizeUrl(raw);
    return isBlank(normalized) ? DEFAULT_WALL_URL : normalized;
}

function getWallWebPartition(): string {
    const fromSettings = getConfigSettingString(WALL_WEB_PARTITION_SETTING_KEY);
    if (!isBlank(fromSettings)) {
        return fromSettings;
    }
    const v = String(getEnv(WAVETERM_WALL_WEB_PARTITION_ENV) ?? "").trim();
    return isBlank(v) ? DEFAULT_WALL_WEB_PARTITION : v;
}

function makePendingKey(tabId: string): string {
    return `${PENDING_KEY_PREFIX}${tabId}`;
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

function normalizeConnectionName(connection?: string): string {
    if (typeof connection !== "string") {
        return "";
    }
    return connection.trim();
}

function normalizeZoom(zoom: unknown): number | undefined {
    const next = Number(zoom);
    if (!Number.isFinite(next)) {
        return undefined;
    }
    return Math.max(0.25, Math.min(3, next));
}

type ResolvedLayoutSlot =
    | {
          type: "web";
          url: string;
          hideNav: boolean;
          zoom?: number;
          title?: string;
          partition?: string;
      }
    | {
          type: "block";
          meta: Record<string, any>;
      }
    | {
          type: "term";
          path: string;
          command: string;
          connection?: string;
      };

async function applyCliLayoutStateToCurrentTab(state: CliLayoutState, tabName?: string): Promise<void> {
    if (state == null) {
        return;
    }
    const rows = Number(state.rows);
    const cols = Number(state.cols);
    if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows <= 0 || cols <= 0) {
        return;
    }

    const layoutModel = getLayoutModelForStaticTab();
    if (!layoutModel) {
        return;
    }

    const staticTabId = globalStore.get(atoms.staticTabId);
    if (!isBlank(tabName) && !isBlank(staticTabId)) {
        fireAndForget(() => ObjectService.UpdateTabName(staticTabId, tabName));
    }

    const totalSlots = rows * cols;

    let targetBlockId = getFocusedBlockId();
    if (isBlank(targetBlockId)) {
        targetBlockId = layoutModel.getFirstBlockId();
    }
    if (isBlank(targetBlockId)) {
        return;
    }

    const targetBlockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", targetBlockId));
    const targetBlock = globalStore.get(targetBlockAtom);
    const fallbackPath = normalizePath(String(targetBlock?.meta?.["cmd:cwd"] ?? "~")) || "~";
    const fallbackConn = typeof targetBlock?.meta?.connection === "string" ? targetBlock.meta.connection : "";

    const resolvedPaths = Array.from({ length: totalSlots }, (_, index) => {
        const v = normalizePath(state.paths?.[index] ?? "");
        return isBlank(v) ? fallbackPath : v;
    });
    const resolvedCommands = Array.from({ length: totalSlots }, (_, index) => {
        const cmd = state.commands?.[index];
        return typeof cmd === "string" ? cmd.trim() : "";
    });
    const effectiveConnection = !isBlank(state.connection) ? normalizeConnectionName(state.connection) : fallbackConn;
    const resolvedSlots: ResolvedLayoutSlot[] = Array.from({ length: totalSlots }, (_, index) => {
        const rawSlot = state.slots?.[index];
        const url = typeof rawSlot?.url === "string" ? rawSlot.url.trim() : "";
        const rawType = rawSlot?.type;
        const hasExplicitType = typeof rawType === "string" && !isBlank(rawType);
        const normalizedType =
            rawType === "web" || (!hasExplicitType && !isBlank(url))
                ? "web"
                : rawType === "block"
                  ? "block"
                  : "term";
        if (normalizedType === "web" && !isBlank(url)) {
            const hideNav = rawSlot?.hideNav !== false;
            const zoom = normalizeZoom(rawSlot?.zoom);
            const title = typeof rawSlot?.title === "string" ? rawSlot.title.trim() : "";
            const partition = typeof rawSlot?.partition === "string" ? rawSlot.partition.trim() : "";
            return {
                type: "web",
                url,
                hideNav,
                zoom,
                title: isBlank(title) ? undefined : title,
                partition: isBlank(partition) ? undefined : partition,
            };
        }
        if (normalizedType === "block") {
            const meta =
                rawSlot?.meta != null && typeof rawSlot.meta === "object" && !Array.isArray(rawSlot.meta)
                    ? (rawSlot.meta as Record<string, any>)
                    : {};
            return { type: "block", meta };
        }

        const slotPath = normalizePath(rawSlot?.path ?? resolvedPaths[index]);
        const slotCommand = typeof rawSlot?.command === "string" ? rawSlot.command.trim() : resolvedCommands[index];
        const slotConnection = !isBlank(rawSlot?.connection)
            ? normalizeConnectionName(rawSlot.connection)
            : effectiveConnection;
        return {
            type: "term",
            path: isBlank(slotPath) ? fallbackPath : slotPath,
            command: slotCommand,
            connection: isBlank(slotConnection) ? undefined : slotConnection,
        };
    });

    const leafOrder = globalStore.get(layoutModel.leafOrder) ?? [];
    const otherBlockIds = leafOrder
        .map((leaf) => leaf.blockid)
        .filter((blockId) => !isBlank(blockId) && blockId !== targetBlockId);
    for (const blockId of otherBlockIds) {
        const node = layoutModel.getNodeByBlockId(blockId);
        if (node) {
            await layoutModel.closeNode(node.id);
        }
    }

    const makeBlockDef = (index: number): BlockDef => {
        const slot = resolvedSlots[index];
        if (slot?.type === "web") {
            const meta: Record<string, any> = {
                view: "web",
                url: slot.url,
            };
            if (slot.hideNav) {
                meta["web:hidenav"] = true;
            }
            if (slot.zoom != null && Number.isFinite(slot.zoom) && slot.zoom !== 1) {
                meta["web:zoom"] = slot.zoom;
            }
            if (!isBlank(slot.title)) {
                meta["display:name"] = slot.title;
            }
            if (!isBlank(slot.partition)) {
                meta["web:partition"] = slot.partition;
            }
            return { meta };
        }
        if (slot?.type === "block") {
            const meta =
                slot.meta != null && typeof slot.meta === "object" && !Array.isArray(slot.meta)
                    ? (slot.meta as Record<string, any>)
                    : {};
            return { meta };
        }

        const meta: Record<string, any> = {
            controller: "shell",
            view: "term",
        };
        const cwd = slot?.type === "term" ? slot.path : resolvedPaths[index];
        if (!isBlank(cwd)) {
            meta["cmd:cwd"] = cwd;
        }
        const connection = slot?.type === "term" ? slot.connection : effectiveConnection;
        if (!isBlank(connection)) {
            meta.connection = connection;
        }
        const command = slot?.type === "term" ? slot.command : resolvedCommands[index];
        if (!isBlank(command)) {
            meta["term:autoCmd"] = command;
            meta["cmd:initscript"] = `${command}\n`;
        }
        return { meta };
    };

    const firstBlockId = await replaceBlock(targetBlockId, makeBlockDef(0), true);
    const rowRootBlockIds: string[] = [firstBlockId];
    const createdBlockIds: string[] = [firstBlockId];

    for (let rowIndex = 1; rowIndex < rows; rowIndex++) {
        const pathIndex = rowIndex * cols;
        const newRowRootId = await createBlockSplitVertically(makeBlockDef(pathIndex), rowRootBlockIds[rowIndex - 1], "after");
        rowRootBlockIds.push(newRowRootId);
        createdBlockIds.push(newRowRootId);
    }

    for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
        let rowAnchorBlockId = rowRootBlockIds[rowIndex];
        for (let colIndex = 1; colIndex < cols; colIndex++) {
            const pathIndex = rowIndex * cols + colIndex;
            rowAnchorBlockId = await createBlockSplitHorizontally(makeBlockDef(pathIndex), rowAnchorBlockId, "after");
            createdBlockIds.push(rowAnchorBlockId);
        }
    }

    if (createdBlockIds.length > 0) {
        const targetNode = layoutModel.getNodeByBlockId(createdBlockIds[0]);
        if (targetNode != null) {
            layoutModel.focusNode(targetNode.id);
        }
    }
}

function readPendingCliLayout(tabId: string): PendingCliLayout | null {
    if (isBlank(tabId)) {
        return null;
    }
    try {
        const raw = localStorage.getItem(makePendingKey(tabId));
        if (isBlank(raw)) {
            return null;
        }
        const parsed = JSON.parse(raw) as PendingCliLayout;
        if (parsed?.version !== PENDING_VERSION || !parsed?.state) {
            clearPendingCliLayout(tabId);
            return null;
        }
        return parsed;
    } catch (e) {
        console.error("Failed to read pending cli layout:", e);
        clearPendingCliLayout(tabId);
        return null;
    }
}

function clearPendingCliLayout(tabId: string): void {
    if (isBlank(tabId)) {
        return;
    }
    try {
        localStorage.removeItem(makePendingKey(tabId));
    } catch {
        // ignore
    }
}

export async function openCliLayoutInNewTab(state: CliLayoutState, tabName: string, presetKey?: string): Promise<void> {
    const ws = globalStore.get(atoms.workspace);
    if (ws == null) {
        return;
    }
    const newTabId = await WorkspaceService.CreateTab(ws.oid, tabName ?? "", false);
    const payload: PendingCliLayout = {
        version: PENDING_VERSION,
        tabName,
        presetKey,
        state: {
            ...state,
            rows: Number(state?.rows) || 1,
            cols: Number(state?.cols) || 1,
            paths: Array.isArray(state?.paths) ? state.paths : [],
            commands: Array.isArray(state?.commands) ? state.commands : [],
            slots: Array.isArray(state?.slots)
                ? state.slots.map((slot) => {
                  if (slot == null || typeof slot !== "object") {
                      return {};
                  }
                  const nextSlot: CliLayoutSlot = {
                          type: slot.type === "web" ? "web" : slot.type === "block" ? "block" : "term",
                  };
                  if (typeof slot.path === "string") {
                      nextSlot.path = slot.path;
                  }
                  if (typeof slot.command === "string") {
                      nextSlot.command = slot.command;
                  }
                  if (typeof slot.connection === "string") {
                      nextSlot.connection = slot.connection;
                  }
                  if (typeof slot.url === "string") {
                      nextSlot.url = slot.url;
                  }
                  if (typeof slot.hideNav === "boolean") {
                      nextSlot.hideNav = slot.hideNav;
                  }
                  if (slot.zoom != null) {
                      nextSlot.zoom = normalizeZoom(slot.zoom);
                  }
                  if (typeof slot.title === "string") {
                      nextSlot.title = slot.title;
                  }
                  if (typeof slot.partition === "string") {
                      nextSlot.partition = slot.partition;
                  }
                  if (slot.meta != null && typeof slot.meta === "object" && !Array.isArray(slot.meta)) {
                      nextSlot.meta = slot.meta as Record<string, any>;
                  }
                  return nextSlot;
              })
            : [],
        },
    };
    try {
        localStorage.setItem(makePendingKey(newTabId), JSON.stringify(payload));
    } catch (e) {
        console.error("Failed to persist pending cli layout:", e);
        return;
    }
    getApi().setActiveTab(newTabId);
}

export async function openPveInNewTab(): Promise<void> {
    if (openPveInNewTabInFlight) {
        return openPveInNewTabInFlight;
    }
    openPveInNewTabInFlight = (async () => {
        const ws = globalStore.get(atoms.workspace);
        if (ws?.tabids?.length) {
            for (const tabId of ws.tabids) {
                // Avoid creating duplicate PVE tabs while a pending PVE layout is still applying.
                const pending = readPendingCliLayout(tabId);
                const hasPendingPveWall =
                    pending?.presetKey === "pve" ||
                    (pending?.state?.slots || []).some((slot) => (slot as any)?.meta?.view === "pvescreenwall");
                if (hasPendingPveWall) {
                    getApi().setActiveTab(tabId);
                    return;
                }

                const tab = WOS.getObjectValue<Tab>(WOS.makeORef("tab", tabId));
                if (!tab?.blockids?.length) {
                    continue;
                }
                for (const blockId of tab.blockids) {
                    const block = WOS.getObjectValue<Block>(WOS.makeORef("block", blockId));
                    if (block?.meta?.view === "pvescreenwall") {
                        getApi().setActiveTab(tabId);
                        return;
                    }
                }
            }
        }

        const tabName = getPveTabName();
        const slots: CliLayoutSlot[] = [
            {
                type: "block",
                meta: {
                    view: "pvescreenwall",
                },
            },
        ];
        await openCliLayoutInNewTab(
            {
                rows: 1,
                cols: 1,
                paths: [],
                commands: [],
                slots,
                updatedTs: Date.now(),
            },
            tabName,
            "pve"
        );
    })();
    try {
        await openPveInNewTabInFlight;
    } finally {
        openPveInNewTabInFlight = null;
    }
}

export async function openPveUiInNewTab(): Promise<void> {
    if (openPveUiInNewTabInFlight) {
        return openPveUiInNewTabInFlight;
    }
    openPveUiInNewTabInFlight = (async () => {
        const tabName = `${getPveTabName()} 管理`;
        const url = getPveUrl();
        const origin = getPveOrigin(url);
        const partition = getPveWebPartition();
        const lang = getPveLang();

        let ensureRes: { ok: boolean; cached?: boolean; skipped?: boolean; error?: string } | null = null;
        try {
            ensureRes = await getApi().pveEnsureAuth({
                partition,
                origin,
                lang,
            });
        } catch {
            ensureRes = null;
        }
        if (ensureRes?.ok && ensureRes?.skipped && ensureRes?.error === "missing credentials") {
            let host = "";
            try {
                host = new URL(origin).host;
            } catch {
                host = "";
            }
            if (!isBlank(host)) {
                await promptForPveCredentials({ host, origin, partition, lang });
            }
        }

        const slots: CliLayoutSlot[] = [
            {
                type: "web",
                title: tabName,
                url,
                hideNav: true,
                zoom: 0.9,
                partition,
            },
        ];
        await openCliLayoutInNewTab(
            {
                rows: 1,
                cols: 1,
                paths: [],
                commands: [],
                slots,
                updatedTs: Date.now(),
            },
            tabName,
            "pve-ui"
        );
    })();
    try {
        await openPveUiInNewTabInFlight;
    } finally {
        openPveUiInNewTabInFlight = null;
    }
}

export async function openWallInNewTab(): Promise<void> {
    if (openWallInNewTabInFlight) {
        return openWallInNewTabInFlight;
    }
    openWallInNewTabInFlight = (async () => {
        const tabName = getWallTabName();

        const ws = globalStore.get(atoms.workspace);
        if (ws?.tabids?.length) {
            for (const tabId of ws.tabids) {
                // Avoid creating duplicate Wall tabs while a pending layout is still applying.
                const pending = readPendingCliLayout(tabId);
                const hasPendingWall =
                    pending?.presetKey === "wall" ||
                    (pending?.state?.slots || []).some((slot) => (slot as any)?.meta?.view === "pvescreenwall");
                if (hasPendingWall) {
                    getApi().setActiveTab(tabId);
                    return;
                }

                const tab = WOS.getObjectValue<Tab>(WOS.makeORef("tab", tabId));
                if (!tab?.blockids?.length) {
                    continue;
                }
                for (const blockId of tab.blockids) {
                    const block = WOS.getObjectValue<Block>(WOS.makeORef("block", blockId));
                    if (block?.meta?.view === "pvescreenwall") {
                        getApi().setActiveTab(tabId);
                        return;
                    }
                }
            }
        }

        const slots: CliLayoutSlot[] = [
            {
                type: "block",
                meta: {
                    view: "pvescreenwall",
                },
            },
        ];
        await openCliLayoutInNewTab(
            {
                rows: 1,
                cols: 1,
                paths: [],
                commands: [],
                slots,
                updatedTs: Date.now(),
            },
            tabName,
            "wall"
        );
    })();
    try {
        await openWallInNewTabInFlight;
    } finally {
        openWallInNewTabInFlight = null;
    }
}

export function maybeApplyPendingCliLayout(tabId: string): void {
    const pending = readPendingCliLayout(tabId);
    if (pending == null) {
        return;
    }

    fireAndForget(async () => {
        let applied = false;
        for (let attempt = 0; attempt < 200; attempt++) {
            const layoutModel = getLayoutModelForStaticTab();
            const leafOrder = layoutModel ? globalStore.get(layoutModel.leafOrder) ?? [] : [];
            if (leafOrder.length > 0) {
                await applyCliLayoutStateToCurrentTab(pending.state, pending.tabName);
                applied = true;
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (applied) {
            clearPendingCliLayout(tabId);
        }
    });
}

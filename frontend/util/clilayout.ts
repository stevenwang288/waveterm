// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getLayoutModelForStaticTab } from "@/layout/index";
import { atoms, createBlockSplitHorizontally, createBlockSplitVertically, getApi, getFocusedBlockId, globalStore, replaceBlock, WOS } from "@/store/global";
import { ObjectService, WorkspaceService } from "@/store/services";
import { fireAndForget, isBlank } from "@/util/util";

export type CliLayoutSlot = {
    type?: "term" | "web";
    path?: string;
    command?: string;
    connection?: string;
    url?: string;
    hideNav?: boolean;
    zoom?: number;
    title?: string;
    partition?: string;
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
        const normalizedType = rawType === "web" || (!hasExplicitType && !isBlank(url)) ? "web" : "term";
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
                          type: slot.type === "web" ? "web" : "term",
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
    try {
        await getApi().pveEnsureAuth({
            partition: DEFAULT_PVE_WEB_PARTITION,
            origin: DEFAULT_PVE_ORIGIN,
            lang: "zh_CN",
        });
    } catch {
        // ignore auth prime errors, fall back to normal login page
    }

    const slots: CliLayoutSlot[] = [
        {
        type: "web",
        title: DEFAULT_PVE_TAB_NAME,
        url: DEFAULT_PVE_URL,
        hideNav: true,
        zoom: 0.9,
        partition: DEFAULT_PVE_WEB_PARTITION,
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
        DEFAULT_PVE_TAB_NAME,
        "pve"
    );
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

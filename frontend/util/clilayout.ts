// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getLayoutModelForStaticTab } from "@/layout/index";
import { atoms, createBlockSplitHorizontally, createBlockSplitVertically, getApi, getFocusedBlockId, globalStore, replaceBlock, WOS } from "@/store/global";
import { ObjectService, WorkspaceService } from "@/store/services";
import { fireAndForget, isBlank } from "@/util/util";

export type CliLayoutState = {
    rows: number;
    cols: number;
    paths: string[];
    commands?: string[];
    connection?: string;
    updatedTs?: number;
    name?: string;
};

type PendingCliLayout = {
    version: 1;
    tabName?: string;
    presetKey?: string;
    state: CliLayoutState;
};

const PENDING_KEY_PREFIX = "waveterm:pending-cli-layout:";
const PENDING_VERSION = 1 as const;

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
    const effectiveConnection = !isBlank(state.connection) ? state.connection : fallbackConn;

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

    const makeTermBlockDef = (index: number): BlockDef => {
        const meta: Record<string, any> = {
            controller: "shell",
            view: "term",
        };
        const cwd = resolvedPaths[index];
        if (!isBlank(cwd)) {
            meta["cmd:cwd"] = cwd;
        }
        if (!isBlank(effectiveConnection)) {
            meta.connection = effectiveConnection;
        }
        const command = resolvedCommands[index];
        if (!isBlank(command)) {
            meta["term:autoCmd"] = command;
            meta["cmd:initscript"] = `${command}\n`;
        }
        return { meta };
    };

    const firstBlockId = await replaceBlock(targetBlockId, makeTermBlockDef(0), true);
    const rowRootBlockIds: string[] = [firstBlockId];
    const createdBlockIds: string[] = [firstBlockId];

    for (let rowIndex = 1; rowIndex < rows; rowIndex++) {
        const pathIndex = rowIndex * cols;
        const newRowRootId = await createBlockSplitVertically(makeTermBlockDef(pathIndex), rowRootBlockIds[rowIndex - 1], "after");
        rowRootBlockIds.push(newRowRootId);
        createdBlockIds.push(newRowRootId);
    }

    for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
        let rowAnchorBlockId = rowRootBlockIds[rowIndex];
        for (let colIndex = 1; colIndex < cols; colIndex++) {
            const pathIndex = rowIndex * cols + colIndex;
            rowAnchorBlockId = await createBlockSplitHorizontally(makeTermBlockDef(pathIndex), rowAnchorBlockId, "after");
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

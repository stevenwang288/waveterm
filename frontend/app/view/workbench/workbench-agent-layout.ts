// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { createBlock, createBlockSplitHorizontally, WOS } from "@/app/store/global";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getWorkbenchSourceMetaPatch } from "@/app/workspace/workbench-source";
import { isBlank, stringToBase64 } from "@/util/util";
import { buildWorkbenchBlockMeta, launchWorkbenchTerminalInBlock, resolveWorkbenchWorkspacePath } from "./workbench";
import { getWorkbenchAgentSpec, type WorkbenchAgentPreset } from "./workbench-agent-spec";

function resolveAgentWorkspacePath(meta: MetaType): string {
    const path = resolveWorkbenchWorkspacePath(meta);
    return path === "未记录" ? "~" : path;
}

function buildAgentWorkbenchMeta(sourceMeta?: MetaType | null, preset?: WorkbenchAgentPreset): MetaType {
    const spec = getWorkbenchAgentSpec(preset ?? "codex");
    return {
        ...buildWorkbenchBlockMeta(sourceMeta),
        "display:name": spec.displayName,
    };
}

function buildAgentTerminalMeta(sourceMeta?: MetaType | null, preset?: WorkbenchAgentPreset): MetaType {
    const spec = getWorkbenchAgentSpec(preset ?? "cloud");
    return {
        view: "term",
        controller: "shell",
        connection: String(sourceMeta?.connection ?? "").trim() || "local",
        "display:name": spec.displayName,
        "term:mode": "term",
        ...getWorkbenchSourceMetaPatch(sourceMeta),
    };
}

function isRetryableTerminalBootstrapError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? "");
    return /no controller found/i.test(message) || /no shell input chan/i.test(message);
}

async function sendTerminalInput(blockId: string, input: string): Promise<void> {
    await RpcApi.ControllerInputCommand(TabRpcClient, {
        blockid: blockId,
        inputdata64: stringToBase64(input),
    });
}

async function updateBlockDisplayName(blockId: string, displayName: string): Promise<void> {
    if (isBlank(displayName)) {
        return;
    }
    await RpcApi.SetMetaCommand(TabRpcClient, {
        oref: WOS.makeORef("block", blockId),
        meta: {
            "display:name": displayName,
        },
    });
}

async function replaceBlockMeta(blockId: string, meta: MetaType): Promise<void> {
    await RpcApi.SetMetaCommand(TabRpcClient, {
        oref: WOS.makeORef("block", blockId),
        meta,
    });
}

async function bootstrapWorkbenchAgentBlock(
    blockId: string,
    meta: MetaType,
    preset: WorkbenchAgentPreset
): Promise<void> {
    const spec = getWorkbenchAgentSpec(preset);
    const connection = String(meta.connection ?? "").trim() || undefined;
    const path = resolveAgentWorkspacePath(meta);
    await launchWorkbenchTerminalInBlock({
        blockId,
        path,
        command: spec.launchCommand,
        currentMeta: meta,
        connection,
    });
    await updateBlockDisplayName(blockId, spec.displayName).catch(() => {});
}

async function bootstrapTerminalAgentBlock(
    blockId: string,
    displayName: string | null | undefined,
    preset: WorkbenchAgentPreset
): Promise<void> {
    const spec = getWorkbenchAgentSpec(preset);
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 6; attempt++) {
        if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
        }
        try {
            await sendTerminalInput(blockId, `${spec.launchCommand}\r`);
            if (!isBlank(String(displayName ?? "").trim())) {
                await updateBlockDisplayName(blockId, String(displayName)).catch(() => {});
            }
            return;
        } catch (error) {
            lastError = error;
            if (!isRetryableTerminalBootstrapError(error)) {
                throw error;
            }
        }
    }
    throw lastError instanceof Error ? lastError : new Error("terminal agent bootstrap did not become ready");
}

export async function createWorkbenchAgentBlock(
    sourceMeta: MetaType | null | undefined,
    preset: WorkbenchAgentPreset
): Promise<string> {
    const meta = buildAgentWorkbenchMeta(sourceMeta, preset);
    const blockId = await createBlock({ meta });
    await bootstrapWorkbenchAgentBlock(blockId, meta, preset);
    return blockId;
}

export async function createCloudCodeTerminalBlock(sourceMeta?: MetaType | null): Promise<string> {
    const meta = buildAgentTerminalMeta(sourceMeta, "cloud");
    const blockId = await createBlock({ meta });
    await bootstrapTerminalAgentBlock(blockId, String(meta["display:name"] ?? "Claude"), "cloud");
    return blockId;
}

export async function openWorkbenchAgentInCurrentBlock(
    blockId: string,
    sourceMeta: MetaType | null | undefined,
    preset: WorkbenchAgentPreset
): Promise<void> {
    const meta = buildAgentWorkbenchMeta(sourceMeta, preset);
    await replaceBlockMeta(blockId, meta);
    await bootstrapWorkbenchAgentBlock(blockId, meta, preset);
}

export async function openCloudCodeTerminalInCurrentBlock(
    blockId: string,
    sourceMeta?: MetaType | null
): Promise<void> {
    const meta = buildAgentTerminalMeta(sourceMeta, "cloud");
    await replaceBlockMeta(blockId, meta);
    await bootstrapTerminalAgentBlock(blockId, String(meta["display:name"] ?? "Claude"), "cloud");
}

export async function launchAgentCommandInCurrentTerminalBlock(
    blockId: string,
    preset: WorkbenchAgentPreset
): Promise<void> {
    await bootstrapTerminalAgentBlock(blockId, null, preset);
}

export async function createWorkbenchAgentSplitLayout(
    sourceMeta?: MetaType | null
): Promise<{ leftBlockId: string; rightBlockId: string }> {
    const codexMeta = buildAgentWorkbenchMeta(sourceMeta, "codex");
    const leftBlockId = await createBlock({ meta: codexMeta });
    const cloudMeta = buildAgentTerminalMeta(sourceMeta, "cloud");
    const rightBlockId = await createBlockSplitHorizontally({ meta: cloudMeta }, leftBlockId, "after");
    await Promise.all([
        bootstrapWorkbenchAgentBlock(leftBlockId, codexMeta, "codex"),
        bootstrapTerminalAgentBlock(rightBlockId, String(cloudMeta["display:name"] ?? "Claude"), "cloud"),
    ]);
    return { leftBlockId, rightBlockId };
}

export function getWorkbenchAgentWidgetLabel(preset: WorkbenchAgentPreset): string {
    const label = getWorkbenchAgentSpec(preset).label;
    return isBlank(label) ? "Agent" : label;
}

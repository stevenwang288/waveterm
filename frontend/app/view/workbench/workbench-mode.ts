// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atom } from "jotai";
import { globalStore, useBlockAtom, WOS } from "@/app/store/global";
import { isBlank } from "@/util/util";
import { getTerminalDisplayCwd } from "@/util/launchcwd";
import { getWorkbenchSourceMetaPatch } from "@/app/workspace/workbench-source";
import * as services from "@/app/store/services";

function readWorkbenchMetaScalarText(value: unknown): string {
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

function getBlockMeta(blockId: string): MetaType {
    const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
    const blockData = globalStore.get(blockAtom);
    return { ...(blockData?.meta ?? {}) };
}

function getLiveTerminalDisplayCwd(blockId: string): string {
    const displayCwdAtom = useBlockAtom(blockId, "term:displaycwd", () => atom(""));
    const displayCwd = String(globalStore.get(displayCwdAtom) ?? "").trim();
    return displayCwd;
}

export function getTraditionalView(meta: MetaType | null | undefined): string {
    const returnView = readWorkbenchMetaScalarText(meta?.["workbench:returnview"]);
    if (returnView) {
        return returnView;
    }
    const currentView = readWorkbenchMetaScalarText(meta?.view);
    if (currentView && currentView !== "workbench") {
        return currentView;
    }
    return "term";
}

export async function setWorkbenchMode(blockId: string, enabled: boolean): Promise<void> {
    const meta = getBlockMeta(blockId);
    if (enabled) {
        const liveDisplayCwd = getLiveTerminalDisplayCwd(blockId);
        const stableDisplayCwd = !isBlank(liveDisplayCwd) ? liveDisplayCwd : getTerminalDisplayCwd(meta);
        Object.assign(meta, getWorkbenchSourceMetaPatch(meta, stableDisplayCwd));
        meta["workbench:returnview"] = getTraditionalView(meta);
        meta.view = "workbench";
    } else {
        meta.view = getTraditionalView(meta);
        meta["workbench:returnview"] = null;
    }
    await services.ObjectService.UpdateObjectMeta(WOS.makeORef("block", blockId), meta);
}

export async function toggleWorkbenchMode(blockId: string): Promise<void> {
    const meta = getBlockMeta(blockId);
    const nextEnabled = String(meta.view ?? "").trim() !== "workbench";
    await setWorkbenchMode(blockId, nextEnabled);
}

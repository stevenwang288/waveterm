// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import i18next from "@/app/i18n";
import { atoms, getFocusedBlockId, globalStore, WOS } from "@/app/store/global";
import type { TabModel } from "@/app/store/tab-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { WebView, WebViewModel } from "@/app/view/webview/webview";
import { atom } from "jotai";

const defaultClawxUrl = "http://127.0.0.1:5173";
const defaultClawxScope = "__tab__";

class ClawXViewModel extends WebViewModel {
    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        super(blockId, nodeModel, tabModel);
        this.viewType = "clawx";
        this.viewIcon = atom("rocket");
        this.viewName = atom(i18next.t("block.viewName.clawx"));
        this.hideNav = atom(true);
        this.partitionOverride = atom((get) => {
            const blockData = get(this.blockAtom);
            const scopeRaw = String(blockData?.meta?.["clawx:pathscope"] ?? "").trim();
            const scope = scopeRaw || defaultClawxScope;
            return `persist:clawx:${this.makeScopePartitionKey(scope)}`;
        });

        this.homepageUrl = atom((get) => {
            const blockData = get(this.blockAtom);
            const pinnedUrl = blockData?.meta?.pinnedurl;
            const scopeRaw = String(blockData?.meta?.["clawx:pathscope"] ?? "").trim();
            const scopeValue = scopeRaw || defaultClawxScope;
            const allSettings = get(atoms.settingsAtom) as Record<string, any> | null;
            const configuredUrl = allSettings?.["clawx:defaulturl"];
            const baseUrl = pinnedUrl ?? configuredUrl ?? defaultClawxUrl;
            return this.appendScopeToUrl(baseUrl, scopeValue);
        });

        setTimeout(() => this.ensurePathScopeMeta(), 0);
    }

    get viewComponent(): ViewComponent {
        return ClawXView;
    }

    private makeScopePartitionKey(scopeValue: string): string {
        const normalizedScope = String(scopeValue ?? "").trim() || defaultClawxScope;
        const safePrefix = normalizedScope
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 30);
        const hashSuffix = this.hashScope(normalizedScope);
        if (safePrefix) {
            return `${safePrefix}-${hashSuffix}`;
        }
        return `scope-${hashSuffix}`;
    }

    private hashScope(scopeValue: string): string {
        let hashValue = 2166136261;
        for (const scopeChar of scopeValue) {
            hashValue ^= scopeChar.charCodeAt(0);
            hashValue = Math.imul(hashValue, 16777619);
        }
        return (hashValue >>> 0).toString(36);
    }

    private appendScopeToUrl(baseUrl: string, scopeValue: string): string {
        if (!baseUrl) {
            return baseUrl;
        }
        try {
            const parsedUrl = new URL(baseUrl);
            parsedUrl.searchParams.set("wave_scope", scopeValue);
            parsedUrl.searchParams.set("wave_source", "waveterm");
            return parsedUrl.toString();
        } catch {
            return baseUrl;
        }
    }

    private normalizePathForScope(pathValue: string): string {
        const raw = typeof pathValue === "string" ? pathValue.trim() : "";
        if (!raw) {
            return "";
        }
        let normalizedPath = raw;
        if (normalizedPath.length > 1) {
            normalizedPath = normalizedPath.replace(/[\\/]+$/, "");
        }
        if (/^[A-Za-z]:$/.test(normalizedPath)) {
            normalizedPath = `${normalizedPath}\\`;
        }
        normalizedPath = normalizedPath.replace(/\\/g, "/");
        const isUncPath = normalizedPath.startsWith("//");
        if (isUncPath) {
            normalizedPath = `//${normalizedPath.slice(2).replace(/\/{2,}/g, "/")}`;
        } else {
            normalizedPath = normalizedPath.replace(/\/{2,}/g, "/");
        }
        if (/^[A-Za-z]:\//.test(normalizedPath)) {
            normalizedPath = `${normalizedPath[0].toLowerCase()}${normalizedPath.slice(1)}`;
        }
        return normalizedPath;
    }

    private getScopeFromTermBlock(blockData: Block | null | undefined): string {
        if (blockData?.meta?.view !== "term") {
            return "";
        }
        const normalizedPath = this.normalizePathForScope(String(blockData?.meta?.["cmd:cwd"] ?? ""));
        if (!normalizedPath) {
            return "";
        }
        const connectionName = String(blockData?.meta?.connection ?? "local").trim() || "local";
        return `${connectionName}::${normalizedPath}`;
    }

    private resolvePathScope(): string {
        const focusedBlockId = getFocusedBlockId();
        if (focusedBlockId) {
            const focusedBlockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", focusedBlockId));
            const focusedBlockData = globalStore.get(focusedBlockAtom);
            const focusedScope = this.getScopeFromTermBlock(focusedBlockData);
            if (focusedScope) {
                return focusedScope;
            }
        }

        const tabAtom = WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", this.tabModel.tabId));
        const tabData = globalStore.get(tabAtom);
        const blockIds: string[] = tabData?.blockids ?? [];
        for (const blockId of blockIds) {
            const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
            const blockData = globalStore.get(blockAtom);
            const scopeValue = this.getScopeFromTermBlock(blockData);
            if (scopeValue) {
                return scopeValue;
            }
        }

        return defaultClawxScope;
    }

    private ensurePathScopeMeta(): void {
        const blockData = globalStore.get(this.blockAtom);
        const existingScope = String(blockData?.meta?.["clawx:pathscope"] ?? "").trim();
        if (existingScope) {
            return;
        }
        const resolvedScope = this.resolvePathScope();
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("block", this.blockId),
            meta: {
                "clawx:pathscope": resolvedScope,
            } as any,
        }).catch((error) => {
            console.warn("Failed to persist clawx:pathscope", error);
        });
    }
}

function ClawXView(props: ViewComponentProps<ClawXViewModel>) {
    return (
        <div className="w-full h-full">
            <WebView {...props} />
        </div>
    );
}

export { ClawXViewModel };

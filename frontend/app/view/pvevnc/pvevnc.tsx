// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import i18next from "@/app/i18n";
import type { BlockNodeModel } from "@/app/block/blocktypes";
import type { TabModel } from "@/app/store/tab-model";
import { getApi, WOS } from "@/store/global";
import * as jotai from "jotai";
import React from "react";

type PveConsoleMeta = {
    origin: string;
    node: string;
    vmid: number;
    type: "qemu" | "lxc";
    name: string;
};

function readConsoleMeta(blockData: Block | null | undefined): PveConsoleMeta | null {
    const origin = String(blockData?.meta?.["pvevnc:origin"] ?? "").trim();
    const node = String(blockData?.meta?.["pvevnc:node"] ?? "").trim();
    const vmid = Number(blockData?.meta?.["pvevnc:vmid"] ?? 0);
    const type = String(blockData?.meta?.["pvevnc:type"] ?? "qemu").trim().toLowerCase() === "lxc" ? "lxc" : "qemu";
    const name = String(blockData?.meta?.["pvevnc:name"] ?? "").trim() || `${type}-${vmid}`;
    if (!origin || !node || !Number.isFinite(vmid) || vmid <= 0) {
        return null;
    }
    return { origin, node, vmid, type, name };
}

export class PveVncViewModel implements ViewModel {
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    viewType = "pvevnc";
    blockAtom: jotai.Atom<Block>;
    viewIcon: jotai.Atom<string>;
    viewName: jotai.Atom<string>;
    viewText: jotai.Atom<string>;
    noHeader: jotai.Atom<boolean>;
    focusConsole: (() => boolean) | null = null;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.viewIcon = jotai.atom("display");
        this.viewName = jotai.atom(i18next.t("term.vncDesktopTitle"));
        this.viewText = jotai.atom((get) => String(get(this.blockAtom)?.meta?.["display:name"] ?? "").trim());
        this.noHeader = jotai.atom(true);
    }

    get viewComponent(): ViewComponent {
        return PveVncView;
    }

    giveFocus(): boolean {
        return this.focusConsole?.() ?? false;
    }
}

function PveVncView({ model }: ViewComponentProps<PveVncViewModel>) {
    const blockData = jotai.useAtomValue(model.blockAtom);
    const meta = React.useMemo(() => readConsoleMeta(blockData), [blockData]);
    const containerRef = React.useRef<HTMLDivElement>(null);
    const rfbRef = React.useRef<any>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState("");
    const [reloadNonce, setReloadNonce] = React.useState(0);

    React.useEffect(() => {
        model.focusConsole = () => {
            const rfb = rfbRef.current;
            if (rfb?.focus) {
                rfb.focus({ preventScroll: true });
                return true;
            }
            if (containerRef.current != null) {
                containerRef.current.focus({ preventScroll: true });
                return true;
            }
            return false;
        };
        return () => {
            model.focusConsole = null;
        };
    }, [model]);

    React.useEffect(() => {
        let cancelled = false;

        const cleanup = () => {
            const rfb = rfbRef.current;
            rfbRef.current = null;
            if (rfb != null) {
                try {
                    rfb.disconnect();
                } catch {
                    // ignore
                }
            }
        };

        async function initConsole() {
            cleanup();
            if (meta == null || containerRef.current == null) {
                setLoading(false);
                setError(i18next.t("term.remoteGuiUnavailableMessage"));
                return;
            }
            setLoading(true);
            setError("");
            try {
                const novncModule = await import("@novnc/novnc/core/rfb");
                const RFB = novncModule.default;
                const session = await getApi().pveCreateConsoleSession({
                    origin: meta.origin,
                    node: meta.node,
                    vmid: meta.vmid,
                    type: meta.type,
                    name: meta.name,
                    timeoutMs: 12000,
                });
                if (cancelled) {
                    return;
                }
                if (!session?.ok || !session.websocketUrl) {
                    throw new Error(session?.error || i18next.t("term.remoteGuiUnavailableMessage"));
                }

                const rfb = new RFB(containerRef.current, session.websocketUrl, {
                    credentials: { password: session.password || "" },
                    shared: true,
                    repeaterID: "",
                });
                rfb.scaleViewport = true;
                rfb.resizeSession = false;
                rfb.clipViewport = true;
                rfb.dragViewport = false;
                rfb.background = "#000000";
                rfb.qualityLevel = 6;
                rfb.compressionLevel = 2;
                rfb.addEventListener("connect", () => {
                    if (cancelled) {
                        return;
                    }
                    setLoading(false);
                    setError("");
                    window.setTimeout(() => {
                        if (containerRef.current != null) {
                            containerRef.current.dispatchEvent(new Event("resize", { bubbles: true }));
                        }
                        window.dispatchEvent(new Event("resize"));
                    }, 200);
                });
                rfb.addEventListener("disconnect", (event: any) => {
                    if (cancelled) {
                        return;
                    }
                    setLoading(false);
                    setError(String(event?.detail?.reason ?? i18next.t("term.remoteGuiUnavailableMessage")));
                });
                rfb.addEventListener("securityfailure", (event: any) => {
                    if (cancelled) {
                        return;
                    }
                    setLoading(false);
                    setError(
                        i18next.t("term.vncSecurityFailure", {
                            reason: String(event?.detail?.reason ?? "unknown"),
                        })
                    );
                });
                rfb.addEventListener("credentialsrequired", () => {
                    if (cancelled) {
                        return;
                    }
                    setLoading(false);
                    setError(i18next.t("term.vncPasswordRejected"));
                });
                rfbRef.current = rfb;
            } catch (e: any) {
                if (cancelled) {
                    return;
                }
                setLoading(false);
                setError(e?.message || String(e));
            }
        }

        void initConsole();
        return () => {
            cancelled = true;
            cleanup();
        };
    }, [meta?.origin, meta?.node, meta?.vmid, meta?.type, meta?.name, reloadNonce]);

    return (
        <div data-testid="pvevnc-root" className="relative flex h-full w-full bg-black text-white">
            <div ref={containerRef} data-testid="pvevnc-session" className="h-full w-full outline-none" tabIndex={0} />
            <div data-testid="pvevnc-title" className="hidden">
                {meta?.name || String(blockData?.meta?.["display:name"] ?? "").trim() || i18next.t("term.vncDesktopTitle")}
            </div>
            <div data-testid="pvevnc-reconnect" className="hidden">
                {i18next.t("connStatus.reconnect")}
            </div>
            {(loading || error) && (
                <div
                    data-testid="pvevnc-overlay"
                    className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black px-6 text-center"
                >
                    {loading && (
                        <div data-testid="pvevnc-loading" className="text-sm text-white/80">
                            {i18next.t("term.vncConnectingMessage")}
                        </div>
                    )}
                    {!loading && error && (
                        <div data-testid="pvevnc-error" className="max-w-xl text-sm text-red-300">
                            {error}
                        </div>
                    )}
                    {!loading && error && (
                        <button
                            data-testid="pvevnc-retry"
                            className="rounded border border-white/20 px-3 py-1.5 text-sm text-white hover:bg-white/10"
                            onClick={() => setReloadNonce((value) => value + 1)}
                        >
                            {i18next.t("common.retry")}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

export default PveVncView;

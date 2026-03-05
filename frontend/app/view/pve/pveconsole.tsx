// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import i18next from "@/app/i18n";
import { getBlockMetaKeyAtom } from "@/app/store/global";
import type { TabModel } from "@/app/store/tab-model";
import { getWSServerEndpoint } from "@/util/endpoints";
import { isBlank } from "@/util/util";
import { waveFetchJson } from "@/util/wavefetch";
import RFB from "@novnc/novnc/core/rfb";
import { atom, useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

type ConsoleSessionResponse = {
    sessionId: string;
    password: string;
};

function buildConsoleWsUrl(sessionId: string): string {
    return `${getWSServerEndpoint()}/pve/console/${encodeURIComponent(sessionId)}`;
}

const PveConsoleView = memo((props: ViewComponentProps<PveConsoleViewModel>) => {
    const { blockId } = props;
    const containerRef = useRef<HTMLDivElement | null>(null);
    const rfbRef = useRef<any>(null);
    const [phase, setPhase] = useState<"idle" | "connecting" | "connected" | "error">("idle");
    const [errorText, setErrorText] = useState<string>("");
    const [attempt, setAttempt] = useState(0);

    const nodeFromMeta = useAtomValue(useMemo(() => getBlockMetaKeyAtom(blockId, "pve:node" as any), [blockId])) as unknown;
    const vmidRaw = useAtomValue(useMemo(() => getBlockMetaKeyAtom(blockId, "pve:vmid" as any), [blockId])) as unknown;

    const vmid = useMemo(() => {
        const n = Number(vmidRaw);
        return Number.isFinite(n) ? Math.floor(n) : NaN;
    }, [vmidRaw]);

    const effectiveNode = useMemo(() => {
        return typeof nodeFromMeta === "string" ? nodeFromMeta.trim() : "";
    }, [nodeFromMeta]);

    const connect = useCallback(async () => {
        const container = containerRef.current;
        if (!container) {
            return;
        }
        if (isBlank(effectiveNode) || !Number.isFinite(vmid)) {
            setPhase("error");
            setErrorText("缺少 PVE 节点/VMID");
            return;
        }

        setPhase("connecting");
        setErrorText("");

        try {
            const session = await waveFetchJson<ConsoleSessionResponse>("/wave/pve/console-session", {
                method: "POST",
                body: JSON.stringify({ node: effectiveNode, vmid }),
            });
            if (!session?.sessionId) {
                throw new Error("missing session id");
            }
            const wsUrl = buildConsoleWsUrl(session.sessionId);

            const rfb = new (RFB as any)(container, wsUrl, {
                credentials: { password: String(session.password ?? "") },
            });
            rfbRef.current = rfb;

            try {
                rfb.scaleViewport = true;
                rfb.resizeSession = true;
                rfb.showDotCursor = true;
            } catch {
                // ignore
            }

            rfb.addEventListener("connect", () => {
                setPhase("connected");
            });
            rfb.addEventListener("disconnect", (evt: any) => {
                const reason = evt?.detail?.clean ? "" : String(evt?.detail?.reason ?? "");
                setErrorText(reason || "已断开");
                setPhase("error");
            });
            rfb.addEventListener("securityfailure", (evt: any) => {
                setErrorText(String(evt?.detail?.reason ?? "security failure"));
                setPhase("error");
            });
        } catch (e) {
            setErrorText(e instanceof Error ? e.message : String(e));
            setPhase("error");
        }
    }, [effectiveNode, vmid]);

    useEffect(() => {
        try {
            rfbRef.current?.disconnect?.();
        } catch {
            // ignore
        }
        rfbRef.current = null;

        const container = containerRef.current;
        if (container) {
            container.innerHTML = "";
        }
        void connect();

        return () => {
            try {
                rfbRef.current?.disconnect?.();
            } catch {
                // ignore
            }
            rfbRef.current = null;
        };
    }, [attempt, connect]);

    const retry = useCallback(() => {
        setAttempt((v) => v + 1);
    }, []);

    const statusText = useMemo(() => {
        if (phase === "connecting") {
            return i18next.t("common.loading");
        }
        if (phase === "connected") {
            return "";
        }
        return errorText || "已断开";
    }, [errorText, phase]);

    return (
        <div className="w-full h-full flex flex-col bg-black">
            <div className="relative flex-1 bg-black">
                <div ref={containerRef} className="w-full h-full" />
                {phase !== "connected" && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-slate-100">
                        <div className="text-xs whitespace-pre-wrap text-center px-4">{statusText}</div>
                        {phase === "error" && (
                            <button
                                className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700"
                                onClick={retry}
                            >
                                {i18next.t("common.retry")}
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
});
PveConsoleView.displayName = "PveConsoleView";

class PveConsoleViewModel implements ViewModel {
    viewType: string;
    viewIcon: any;
    viewName: any;
    noPadding: any;
    noHeader: any;

    constructor(_blockId: string, _nodeModel: BlockNodeModel, _tabModel: TabModel) {
        this.viewType = "pveconsole";
        this.viewIcon = atom("desktop");
        this.viewName = atom("PVE GUI");
        this.noPadding = atom(true);
        this.noHeader = atom(false);
    }

    get viewComponent(): ViewComponent {
        return PveConsoleView as any;
    }
}

export { PveConsoleViewModel };

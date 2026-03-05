// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { SubBlock } from "@/app/block/block";
import type { BlockNodeModel } from "@/app/block/blocktypes";
import i18next from "@/app/i18n";
import { Modal } from "@/app/modals/modal";
import { pushFlashError, pushNotification } from "@/app/store/global";
import type { TabModel } from "@/app/store/tab-model";
import { RpcApi } from "@/app/store/wshclientapi";
import { splitORef } from "@/app/store/wos";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { openCliLayoutInNewTab, openPveUiInNewTab, type CliLayoutSlot } from "@/util/clilayout";
import { getWSServerEndpoint } from "@/util/endpoints";
import { fireAndForget, isBlank, stringToBase64 } from "@/util/util";
import { waveFetchJson } from "@/util/wavefetch";
import RFB from "@novnc/novnc/core/rfb";
import clsx from "clsx";
import { atom } from "jotai";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

type PveVmInfo = {
    vmid: number;
    node: string;
    name: string;
    status: string;
    type: string;
    template?: boolean;
    screenwallEnabled?: boolean;
    ipAddress?: string;
    hasGui?: boolean;
    id?: string;
};

type ConsoleSessionResponse = {
    sessionId: string;
    password: string;
};

type SetScreenwallEnabledResponse = {
    vmid: number;
    screenwallEnabled: boolean;
};

function buildConsoleWsUrl(sessionId: string): string {
    return `${getWSServerEndpoint()}/pve/console/${encodeURIComponent(sessionId)}`;
}

function parseGridPreset(preset: string): { rows: number; cols: number } {
    const raw = String(preset ?? "").trim().toLowerCase();
    const m = raw.match(/^(\d+)x(\d+)$/);
    if (!m) {
        return { rows: 3, cols: 3 };
    }
    const rows = Math.max(1, Math.min(12, Number(m[1]) || 3));
    const cols = Math.max(1, Math.min(12, Number(m[2]) || 3));
    return { rows, cols };
}

function areNumberArraysEqual(a: number[], b: number[]): boolean {
    if (a === b) {
        return true;
    }
    if (!a || !b) {
        return false;
    }
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

const STORAGE_KEY = "pve_screenwall_layout_v1";
const MAX_VMS = 500;
const WALL_GAP_PX = 10;

type WallLayout = {
    gridPreset?: string;
    onlyRunning?: boolean;
    orderVmids?: number[];
};

// Global limiter (module scope) to avoid bursts of concurrent VNC session creations.
const MAX_INFLIGHT = 3;
let inflight = 0;
const inflightQueue: Array<() => void> = [];
function acquireSlot(): Promise<() => void> {
    return new Promise((resolve) => {
        const tryAcquire = () => {
            if (inflight < MAX_INFLIGHT) {
                inflight += 1;
                let released = false;
                resolve(() => {
                    if (released) {
                        return;
                    }
                    released = true;
                    inflight = Math.max(0, inflight - 1);
                    const next = inflightQueue.shift();
                    if (next) {
                        next();
                    }
                });
                return;
            }
            inflightQueue.push(tryAcquire);
        };
        tryAcquire();
    });
}

function isPermanentError(msg: string): boolean {
    const m = String(msg || "").toLowerCase();
    return m.includes("vga=none") || m.includes("no virtual display") || m.includes("cannot use novnc");
}

function PveNovncTile({
    vm,
    active,
    selected,
    allowInput,
}: {
    vm: PveVmInfo;
    active: boolean;
    selected: boolean;
    allowInput: boolean;
}) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const rfbRef = useRef<any>(null);
    const guiCapable = vm?.hasGui !== false;

    const attemptIdRef = useRef(0);
    const initInFlightRef = useRef(false);
    const releaseSlotRef = useRef<(() => void) | null>(null);
    const selectedRef = useRef(false);
    const restoreInputRafRef = useRef<number | null>(null);
    const connectTimeoutRef = useRef<number | null>(null);
    const startTimerRef = useRef<number | null>(null);
    const autoRetryTimerRef = useRef<number | null>(null);
    const autoRetryCountRef = useRef(0);

    const [loading, setLoading] = useState(false);
    const [errorText, setErrorText] = useState("");

    const applySelectionMode = useCallback(
        (sel: boolean) => {
            const rfb = rfbRef.current;
            if (!rfb) {
                return;
            }
            const interactive = allowInput && sel;
            try {
                rfb.viewOnly = !interactive;
            } catch {
                // ignore
            }
            try {
                rfb.focusOnClick = allowInput;
            } catch {
                // ignore
            }
        },
        [allowInput]
    );

    const primeInputOnPointerDownCapture = useCallback(() => {
        if (!allowInput) {
            return;
        }
        const rfb = rfbRef.current;
        if (!rfb) {
            return;
        }
        try {
            rfb.viewOnly = false;
        } catch {
            // ignore
        }
        try {
            rfb.focusOnClick = true;
        } catch {
            // ignore
        }
        if (restoreInputRafRef.current != null) {
            window.cancelAnimationFrame(restoreInputRafRef.current);
        }
        restoreInputRafRef.current = window.requestAnimationFrame(() => {
            restoreInputRafRef.current = null;
            applySelectionMode(selectedRef.current);
        });
    }, [allowInput, applySelectionMode]);

    const cleanup = useCallback(({ resetRetry }: { resetRetry?: boolean } = {}) => {
        if (restoreInputRafRef.current != null) {
            window.cancelAnimationFrame(restoreInputRafRef.current);
            restoreInputRafRef.current = null;
        }
        if (startTimerRef.current != null) {
            window.clearTimeout(startTimerRef.current);
            startTimerRef.current = null;
        }
        if (connectTimeoutRef.current != null) {
            window.clearTimeout(connectTimeoutRef.current);
            connectTimeoutRef.current = null;
        }
        if (autoRetryTimerRef.current != null) {
            window.clearTimeout(autoRetryTimerRef.current);
            autoRetryTimerRef.current = null;
        }
        if (resetRetry) {
            autoRetryCountRef.current = 0;
        }

        initInFlightRef.current = false;
        setLoading(false);

        if (releaseSlotRef.current) {
            try {
                releaseSlotRef.current();
            } catch {
                // ignore
            }
            releaseSlotRef.current = null;
        }

        const rfb = rfbRef.current;
        if (rfb) {
            try {
                rfb.disconnect();
            } catch {
                // ignore
            }
        }
        rfbRef.current = null;

        const container = containerRef.current;
        if (container) {
            container.innerHTML = "";
        }
    }, []);

    const scheduleAutoRetry = useCallback(
        (reason: string) => {
            if (!active) {
                return;
            }
            if (!guiCapable) {
                return;
            }
            if (!vm?.vmid) {
                return;
            }
            if (isPermanentError(reason)) {
                return;
            }
            if (autoRetryCountRef.current >= 3) {
                return;
            }
            if (autoRetryTimerRef.current != null) {
                return;
            }
            const base = 1200;
            const ms = Math.min(15_000, base * Math.pow(2, autoRetryCountRef.current));
            autoRetryCountRef.current += 1;
            autoRetryTimerRef.current = window.setTimeout(() => {
                autoRetryTimerRef.current = null;
                void init();
            }, ms);
        },
        [active, guiCapable, vm?.vmid]
    );

    const init = useCallback(async () => {
        if (!active || !guiCapable || !vm?.vmid || !vm?.node) {
            cleanup({ resetRetry: true });
            return;
        }
        if (initInFlightRef.current) {
            return;
        }

        cleanup();
        initInFlightRef.current = true;
        const attemptId = attemptIdRef.current + 1;
        attemptIdRef.current = attemptId;

        setLoading(true);
        setErrorText("");

        const CONNECT_TIMEOUT_MS = 12_000;
        connectTimeoutRef.current = window.setTimeout(() => {
            if (attemptIdRef.current !== attemptId) {
                return;
            }
            attemptIdRef.current = attemptId + 1;
            setLoading(false);
            setErrorText("连接超时");
            initInFlightRef.current = false;
            cleanup();
            scheduleAutoRetry("timeout");
        }, CONNECT_TIMEOUT_MS);

        try {
            const release = await acquireSlot();
            if (attemptIdRef.current !== attemptId) {
                try {
                    release();
                } catch {
                    // ignore
                }
                return;
            }
            releaseSlotRef.current = release;

            const session = await waveFetchJson<ConsoleSessionResponse>("/wave/pve/console-session", {
                method: "POST",
                body: JSON.stringify({ node: vm.node, vmid: vm.vmid }),
            });
            if (attemptIdRef.current !== attemptId) {
                return;
            }
            if (!session?.sessionId) {
                throw new Error("未获取到控制台会话信息");
            }

            const container = containerRef.current;
            if (!container) {
                throw new Error("noVNC 容器未就绪");
            }
            const wsUrl = buildConsoleWsUrl(session.sessionId);
            const rfb = new (RFB as any)(container, wsUrl, {
                credentials: { password: String(session.password ?? "") },
                shared: true,
            });
            rfbRef.current = rfb;

            try {
                rfb.scaleViewport = true;
                rfb.clipViewport = true;
                rfb.resizeSession = true;
                rfb.dragViewport = false;
            } catch {
                // ignore
            }

            applySelectionMode(selectedRef.current);

            rfb.addEventListener("connect", () => {
                if (attemptIdRef.current !== attemptId) {
                    return;
                }
                setLoading(false);
                setErrorText("");
                autoRetryCountRef.current = 0;
                initInFlightRef.current = false;
                if (connectTimeoutRef.current != null) {
                    window.clearTimeout(connectTimeoutRef.current);
                    connectTimeoutRef.current = null;
                }
                if (releaseSlotRef.current) {
                    try {
                        releaseSlotRef.current();
                    } catch {
                        // ignore
                    }
                    releaseSlotRef.current = null;
                }
                applySelectionMode(selectedRef.current);
                if (selectedRef.current) {
                    try {
                        rfb.focus?.({ preventScroll: true });
                    } catch {
                        // ignore
                    }
                }
            });

            rfb.addEventListener("disconnect", (e: any) => {
                if (attemptIdRef.current !== attemptId) {
                    return;
                }
                setLoading(false);
                const reason =
                    e?.detail?.clean === false && e?.detail?.reason ? String(e.detail.reason) : "连接已断开";
                setErrorText(reason);
                initInFlightRef.current = false;
                if (connectTimeoutRef.current != null) {
                    window.clearTimeout(connectTimeoutRef.current);
                    connectTimeoutRef.current = null;
                }
                if (releaseSlotRef.current) {
                    try {
                        releaseSlotRef.current();
                    } catch {
                        // ignore
                    }
                    releaseSlotRef.current = null;
                }
                scheduleAutoRetry(reason);
            });

            rfb.addEventListener("securityfailure", (e: any) => {
                if (attemptIdRef.current !== attemptId) {
                    return;
                }
                setLoading(false);
                const reason = String(e?.detail?.reason ?? "未知错误");
                const msg = `安全验证失败: ${reason}`;
                setErrorText(msg);
                initInFlightRef.current = false;
                if (connectTimeoutRef.current != null) {
                    window.clearTimeout(connectTimeoutRef.current);
                    connectTimeoutRef.current = null;
                }
                if (releaseSlotRef.current) {
                    try {
                        releaseSlotRef.current();
                    } catch {
                        // ignore
                    }
                    releaseSlotRef.current = null;
                }
                scheduleAutoRetry(msg);
            });
        } catch (e) {
            if (attemptIdRef.current !== attemptId) {
                return;
            }
            setLoading(false);
            const msg = e instanceof Error ? e.message : String(e);
            setErrorText(msg);
            initInFlightRef.current = false;
            if (connectTimeoutRef.current != null) {
                window.clearTimeout(connectTimeoutRef.current);
                connectTimeoutRef.current = null;
            }
            if (releaseSlotRef.current) {
                try {
                    releaseSlotRef.current();
                } catch {
                    // ignore
                }
                releaseSlotRef.current = null;
            }
            scheduleAutoRetry(msg);
        }
    }, [active, applySelectionMode, cleanup, guiCapable, scheduleAutoRetry, vm?.node, vm?.vmid]);

    const scheduleStart = useCallback(() => {
        if (!active || !guiCapable) {
            cleanup({ resetRetry: true });
            return;
        }
        if (!vm?.vmid) {
            return;
        }
        if (startTimerRef.current != null) {
            return;
        }
        setLoading(true);
        setErrorText("");

        const id = Number(vm.vmid) || 0;
        const ms = Math.min(1500, (id % 17) * 90);
        startTimerRef.current = window.setTimeout(() => {
            startTimerRef.current = null;
            void init();
        }, ms);
    }, [active, cleanup, guiCapable, init, vm?.vmid]);

    useEffect(() => {
        scheduleStart();
        return () => cleanup({ resetRetry: true });
    }, [cleanup, scheduleStart]);

    useLayoutEffect(() => {
        selectedRef.current = selected;
        applySelectionMode(selected);
    }, [applySelectionMode, selected]);

    if (!active) {
        return (
            <div className="w-full h-full flex items-center justify-center text-[12px] text-slate-200 bg-black/40">
                未运行
            </div>
        );
    }
    if (!guiCapable) {
        return (
            <div className="w-full h-full flex items-center justify-center text-[12px] text-slate-200 bg-black/40">
                无虚拟显示
            </div>
        );
    }

    return (
        <div className="w-full h-full relative bg-black" onPointerDownCapture={primeInputOnPointerDownCapture}>
            <div ref={containerRef} className="w-full h-full" />
            {(loading || !!errorText) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-slate-100">
                    <div className="text-xs whitespace-pre-wrap text-center px-3">
                        {loading ? i18next.t("common.loading") : errorText}
                    </div>
                    {!loading && !!errorText && !isPermanentError(errorText) && (
                        <button
                            className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700"
                            onClick={() => {
                                autoRetryCountRef.current = 0;
                                void init();
                            }}
                        >
                            {i18next.t("common.retry")}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

const PveScreenwallView = memo(({ blockId, contentRef }: ViewComponentProps<PveScreenwallViewModel>) => {
    const [allVms, setAllVms] = useState<PveVmInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [errorText, setErrorText] = useState<string>("");

    const [gridPreset, setGridPreset] = useState("3x3");
    const [onlyRunning, setOnlyRunning] = useState(true);
    const [search, setSearch] = useState("");
    const [pageNo, setPageNo] = useState(1);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [zoomedVmid, setZoomedVmid] = useState<number | null>(null);

    const [settingsOpen, setSettingsOpen] = useState(false);
    const [savingVmids, setSavingVmids] = useState<Set<number>>(new Set());
    const [editMode, setEditMode] = useState(false);
    const [orderVmids, setOrderVmids] = useState<number[]>([]);

    const lastRemovedRef = useRef<{ at: number; prevOrder: number[]; vmid: number } | null>(null);
    const dragFromVmidRef = useRef<number | null>(null);
    const didDevCaptureRef = useRef(false);
    const didDevOpenSettingsRef = useRef(false);

    const [sshOpenVmid, setSshOpenVmid] = useState<number | null>(null);
    const [sshTermBlockId, setSshTermBlockId] = useState<string>("");
    const sshTogglePendingRef = useRef(false);
    const sshTermBlockIdRef = useRef<string>("");

    useEffect(() => {
        sshTermBlockIdRef.current = sshTermBlockId;
    }, [sshTermBlockId]);

    useEffect(() => {
        return () => {
            const id = sshTermBlockIdRef.current;
            if (!isBlank(id)) {
                fireAndForget(() => RpcApi.DeleteSubBlockCommand(TabRpcClient, { blockid: id }));
            }
        };
    }, []);

    const sshNodeModel: BlockNodeModel | null = useMemo(() => {
        if (isBlank(sshTermBlockId)) {
            return null;
        }
        return {
            blockId: sshTermBlockId,
            isFocused: atom(false),
            isMagnified: atom(false),
            focusNode: () => {},
            toggleMagnify: () => {},
            onClose: () => {
                const id = sshTermBlockId;
                setSshOpenVmid(null);
                setSshTermBlockId("");
                if (!isBlank(id)) {
                    fireAndForget(() => RpcApi.DeleteSubBlockCommand(TabRpcClient, { blockid: id }));
                }
            },
        };
    }, [sshTermBlockId]);

    const { rows, cols } = useMemo(() => parseGridPreset(gridPreset), [gridPreset]);
    const pageSize = rows * cols;


    const persistLayout = useCallback(
        (next?: Partial<WallLayout>) => {
            const data: WallLayout = {
                gridPreset,
                onlyRunning,
                orderVmids,
                ...(next ?? {}),
            };
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
            } catch {
                // ignore
            }
        },
        [gridPreset, onlyRunning, orderVmids]
    );

    const loadLayout = useCallback(() => {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) {
                return;
            }
            const data = JSON.parse(raw) as WallLayout;
            if (data?.gridPreset) {
                setGridPreset(String(data.gridPreset));
            }
            if (typeof data?.onlyRunning === "boolean") {
                setOnlyRunning(data.onlyRunning);
            }
            if (Array.isArray(data?.orderVmids)) {
                const next = data.orderVmids
                    .map((x) => Number(x))
                    .filter((x) => Number.isFinite(x) && x > 0)
                    .map((x) => Math.trunc(x));
                setOrderVmids(next);
            }
        } catch {
            // ignore
        }
    }, []);

    const reload = useCallback(async () => {
        setLoading(true);
        setErrorText("");
        try {
            const usp = new URLSearchParams();
            usp.set("runningOnly", "0");
            usp.set("max", String(MAX_VMS));
            const vms = await waveFetchJson<PveVmInfo[]>(`/wave/pve/vms?${usp.toString()}`);
            setAllVms(Array.isArray(vms) ? vms : []);
        } catch (e) {
            setAllVms([]);
            setErrorText(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadLayout();
        void reload();
    }, [loadLayout, reload]);

    useEffect(() => {
        const api = (window as any)?.api;
        if (!api?.getIsDev?.()) {
            return;
        }
        const raw = api?.getEnv?.("WAVETERM_DEV_PVE_OPEN_SETTINGS");
        const enabled = String(raw ?? "")
            .trim()
            .toLowerCase();
        if (!enabled || (enabled !== "1" && enabled !== "true" && enabled !== "yes" && enabled !== "on")) {
            return;
        }
        if (didDevOpenSettingsRef.current) {
            return;
        }
        if (loading) {
            return;
        }
        didDevOpenSettingsRef.current = true;
        setTimeout(() => setSettingsOpen(true), 4500);
    }, [loading]);

    useEffect(() => {
        persistLayout();
    }, [persistLayout]);

    const screenwallVms = useMemo(() => {
        return (allVms || []).filter(
            (vm) => String(vm?.type ?? "").trim().toLowerCase() !== "lxc" && vm?.template !== true
        );
    }, [allVms]);

    const wallData = useMemo(() => {
        const needle = search.trim().toLowerCase();
        const configured = (screenwallVms || []).filter((vm) => !!vm?.screenwallEnabled);
        const usingFallback = configured.length === 0;
        const sourceVms = usingFallback ? (screenwallVms || []) : configured;
        const filtered = sourceVms.filter((vm) => {
            if (onlyRunning && String(vm.status || "") !== "running") {
                return false;
            }
            if (!needle) {
                return true;
            }
            const name = String(vm.name || "").toLowerCase();
            const vmid = String(vm.vmid || "");
            const ip = String(vm.ipAddress || "").toLowerCase();
            const node = String(vm.node || "").toLowerCase();
            return (
                name.includes(needle) ||
                vmid.includes(needle) ||
                ip.includes(needle) ||
                node.includes(needle)
            );
        });

        const byId = new Map<number, PveVmInfo>();
        for (const vm of filtered) {
            const id = Number(vm?.vmid) || 0;
            if (id > 0) {
                byId.set(id, vm);
            }
        }

        const nextOrder: number[] = [];
        const ordered: PveVmInfo[] = [];
        for (const vmid of orderVmids) {
            const hit = byId.get(vmid);
            if (hit) {
                ordered.push(hit);
                nextOrder.push(vmid);
            }
        }
        for (const vm of filtered) {
            const id = Number(vm?.vmid) || 0;
            if (id <= 0) {
                continue;
            }
            if (!byId.has(id)) {
                continue;
            }
            if (nextOrder.includes(id)) {
                continue;
            }
            ordered.push(vm);
            nextOrder.push(id);
        }
        return { wallMembers: ordered, nextOrder, usingFallback, configuredCount: configured.length, totalCount: sourceVms.length };
    }, [onlyRunning, orderVmids, screenwallVms, search]);

    const wallMembers = wallData.wallMembers;
    const usingFallback = wallData.usingFallback;

    useEffect(() => {
        if (!areNumberArraysEqual(wallData.nextOrder, orderVmids)) {
            setOrderVmids(wallData.nextOrder);
        }
    }, [orderVmids, wallData.nextOrder]);

    const totalPages = useMemo(() => {
        if (pageSize <= 0) {
            return 1;
        }
        return Math.max(1, Math.ceil(wallMembers.length / pageSize));
    }, [pageSize, wallMembers.length]);

    useEffect(() => {
        setPageNo((prev) => {
            const next = Math.min(Math.max(1, prev), totalPages);
            return next;
        });
    }, [totalPages]);

    const pageVms = useMemo(() => {
        if (pageSize <= 0) {
            return wallMembers;
        }
        const start = (Math.max(1, pageNo) - 1) * pageSize;
        return wallMembers.slice(start, start + pageSize);
    }, [pageNo, pageSize, wallMembers]);

    const zoomedVm = useMemo(() => {
        if (!zoomedVmid) {
            return null;
        }
        return wallMembers.find((vm) => Number(vm.vmid) === Number(zoomedVmid)) ?? null;
    }, [wallMembers, zoomedVmid]);

    const isZoomed = !!zoomedVm;
    const displayVms = isZoomed && zoomedVm ? [zoomedVm] : pageVms;
    const placeholderCount = !isZoomed ? Math.max(0, pageSize - displayVms.length) : 0;

    useEffect(() => {
        if (selectedIndex >= displayVms.length) {
            setSelectedIndex(0);
        }
    }, [displayVms.length, selectedIndex]);

    const selectedVm = useMemo(() => {
        return displayVms[selectedIndex] ?? null;
    }, [displayVms, selectedIndex]);

    const cycleSelected = useCallback(() => {
        setSelectedIndex((prev) => {
            const n = displayVms.length;
            if (n <= 0) {
                return 0;
            }
            return (prev + 1) % n;
        });
    }, [displayVms.length]);

    const nextPage = useCallback(() => {
        if (totalPages <= 1) {
            return;
        }
        setSelectedIndex(0);
        setZoomedVmid(null);
        setPageNo((prev) => (prev >= totalPages ? 1 : prev + 1));
    }, [totalPages]);

    const openPopup = useCallback(async (vm: PveVmInfo) => {
        if (!vm) {
            return;
        }
        const slots: CliLayoutSlot[] = [
            {
                type: "block",
                meta: {
                    view: "pveconsole",
                    "pve:node": vm.node,
                    "pve:vmid": vm.vmid,
                    "frame:title": `${vm.name || "GUI"}  #${vm.vmid}`,
                },
            },
        ];
        const tabName = `${vm.name || "PVE"}  #${vm.vmid}`;
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
            `pve-console-${vm.vmid}`
        );
    }, []);

    const toggleZoom = useCallback((vm: PveVmInfo | null) => {
        if (!vm) {
            return;
        }
        setZoomedVmid((prev) => {
            const id = Number(vm.vmid) || 0;
            if (!id) {
                return null;
            }
            if (prev && Number(prev) === id) {
                return null;
            }
            return id;
        });
    }, []);

    const copySshCmd = useCallback(async (vm: PveVmInfo | null) => {
        if (!vm) {
            return;
        }
        const host = String(vm.ipAddress || "").trim();
        if (isBlank(host)) {
            pushFlashError({
                id: "",
                icon: "triangle-exclamation",
                title: "SSH",
                message: "缺少 IP，无法生成 SSH 命令（请先在 pve-ui 里同步/补全 IP）",
                expiration: Date.now() + 7000,
            } as any);
            return;
        }
        const cmd = `ssh root@${host}`;
        try {
            await navigator.clipboard.writeText(cmd);
            pushNotification({
                icon: "clipboard",
                title: "SSH",
                message: `已复制: ${cmd}`,
                timestamp: new Date().toLocaleString(),
                type: "info",
                expiration: Date.now() + 5000,
            });
        } catch {
            pushNotification({
                icon: "clipboard",
                title: "SSH",
                message: cmd,
                timestamp: new Date().toLocaleString(),
                type: "info",
                expiration: Date.now() + 7000,
            });
        }
    }, []);

    const closeEmbeddedSsh = useCallback(async () => {
        const id = sshTermBlockId;
        setSshOpenVmid(null);
        setSshTermBlockId("");
        if (!isBlank(id)) {
            try {
                await RpcApi.DeleteSubBlockCommand(TabRpcClient, { blockid: id });
            } catch {
                // ignore
            }
        }
    }, [sshTermBlockId]);

    useEffect(() => {
        if (!sshOpenVmid || isBlank(sshTermBlockId)) {
            return;
        }
        const visible = displayVms.some((vm) => Number(vm.vmid) === Number(sshOpenVmid));
        if (!visible) {
            fireAndForget(() => closeEmbeddedSsh());
        }
    }, [closeEmbeddedSsh, displayVms, sshOpenVmid, sshTermBlockId]);

    const toggleEmbeddedSsh = useCallback(
        (vm: PveVmInfo | null) => {
            if (!vm) {
                return;
            }
            if (sshTogglePendingRef.current) {
                return;
            }
            fireAndForget(async () => {
                sshTogglePendingRef.current = true;
                try {
                    const vmid = Number(vm.vmid);
                    const host = String(vm.ipAddress || "").trim();
                    if (isBlank(host) || !Number.isFinite(vmid) || vmid <= 0) {
                        pushFlashError({
                            id: "",
                            icon: "triangle-exclamation",
                            title: "SSH",
                            message: "缺少 IP，无法打开 SSH 终端（请先在 pve-ui 里同步/补全 IP）",
                            expiration: Date.now() + 7000,
                        } as any);
                        return;
                    }

                    // Toggle off if already open for this VM.
                    if (sshOpenVmid === vmid && !isBlank(sshTermBlockId)) {
                        await closeEmbeddedSsh();
                        return;
                    }

                    // Ensure only one embedded terminal is open at a time.
                    if (!isBlank(sshTermBlockId)) {
                        await closeEmbeddedSsh();
                    }

                    const oref = await RpcApi.CreateSubBlockCommand(TabRpcClient, {
                        parentblockid: blockId,
                        blockdef: {
                            meta: {
                                view: "term",
                                controller: "shell",
                                "frame:title": `SSH  #${vmid}`,
                            },
                        },
                    });
                    const [_type, newBlockId] = splitORef(oref);
                    setSshOpenVmid(vmid);
                    setSshTermBlockId(newBlockId);

                    const cmd = `ssh root@${host}\n`;
                    const inputdata64 = stringToBase64(cmd);
                    for (let i = 0; i < 8; i++) {
                        try {
                            await RpcApi.ControllerInputCommand(TabRpcClient, {
                                blockid: newBlockId,
                                inputdata64,
                            });
                            break;
                        } catch {
                            await new Promise((r) => setTimeout(r, 120));
                        }
                    }
                } catch {
                    // Fallback: copy the ssh command to clipboard.
                    await copySshCmd(vm);
                } finally {
                    sshTogglePendingRef.current = false;
                }
            });
        },
        [blockId, closeEmbeddedSsh, copySshCmd, sshOpenVmid, sshTermBlockId]
    );

    useEffect(() => {
        const api = (window as any)?.api;
        if (!api?.getIsDev?.()) {
            return;
        }
        const raw = api?.getEnv?.("WAVETERM_DEV_CAPTURE_PVE");
        const enabled = String(raw ?? "")
            .trim()
            .toLowerCase();
        if (!enabled || (enabled !== "1" && enabled !== "true" && enabled !== "yes" && enabled !== "on")) {
            return;
        }
        if (didDevCaptureRef.current) {
            return;
        }
        if (loading) {
            return;
        }
        if (!errorText && wallMembers.length === 0) {
            return;
        }
        didDevCaptureRef.current = true;

        const rawAutoSsh = api?.getEnv?.("WAVETERM_DEV_PVE_AUTO_SSH");
        const autoSshEnabled = String(rawAutoSsh ?? "")
            .trim()
            .toLowerCase();
        const shouldAutoSsh =
            !!autoSshEnabled && (autoSshEnabled === "1" || autoSshEnabled === "true" || autoSshEnabled === "yes" || autoSshEnabled === "on");

        const pickVmForSsh = (): PveVmInfo | null => {
            if (selectedVm && !isBlank(String(selectedVm.ipAddress || "").trim())) {
                return selectedVm;
            }
            const hit = displayVms.find((vm) => !isBlank(String(vm?.ipAddress || "").trim()));
            if (hit) {
                return hit;
            }
            const hit2 = wallMembers.find((vm) => !isBlank(String(vm?.ipAddress || "").trim()));
            return hit2 ?? null;
        };

        fireAndForget(async () => {
            if (shouldAutoSsh && !errorText) {
                const vm = pickVmForSsh();
                if (vm) {
                    toggleEmbeddedSsh(vm);
                    await new Promise((r) => setTimeout(r, 2200));
                }
            }
            setTimeout(() => {
                api?.devCapturePageToFile?.(shouldAutoSsh ? "pve-screenwall-ssh" : "pve-screenwall").catch(() => {});
            }, 1200);
            setTimeout(() => {
                api?.devCapturePageToFile?.(shouldAutoSsh ? "pve-screenwall-ssh-late" : "pve-screenwall-late").catch(() => {});
            }, 8000);
        });
    }, [displayVms, errorText, loading, selectedVm, toggleEmbeddedSsh, wallMembers]);

    const setScreenwallEnabled = useCallback(async (vmid: number, enabled: boolean) => {
        const id = Number(vmid) || 0;
        if (!id) {
            return;
        }
        setSavingVmids((prev) => {
            const next = new Set(Array.from(prev));
            next.add(id);
            return next;
        });
        try {
            await waveFetchJson<SetScreenwallEnabledResponse>("/wave/pve/screenwall-enabled", {
                method: "POST",
                body: JSON.stringify({ vmid: id, enabled: !!enabled }),
            });
            setAllVms((prev) =>
                (prev || []).map((vm) => (Number(vm.vmid) === id ? { ...vm, screenwallEnabled: !!enabled } : vm))
            );
            setOrderVmids((prev) => {
                const next = (prev || []).slice();
                const idx = next.indexOf(id);
                if (enabled) {
                    if (idx === -1) {
                        next.push(id);
                    }
                    return next;
                }
                if (idx !== -1) {
                    next.splice(idx, 1);
                }
                return next;
            });
        } catch (e) {
            pushFlashError({
                id: "",
                icon: "triangle-exclamation",
                title: "屏幕墙",
                message: e instanceof Error ? e.message : String(e),
                expiration: Date.now() + 8000,
            } as any);
        } finally {
            setSavingVmids((prev) => {
                const next = new Set(Array.from(prev));
                next.delete(id);
                return next;
            });
        }
    }, []);

    const removeFromWall = useCallback(
        (vm: PveVmInfo) => {
            if (!vm) {
                return;
            }
            const id = Number(vm.vmid) || 0;
            if (!id) {
                return;
            }
            lastRemovedRef.current = { at: Date.now(), prevOrder: orderVmids.slice(), vmid: id };
            void setScreenwallEnabled(id, false);
            if (Number(zoomedVmid) === id) {
                setZoomedVmid(null);
            }
            setSelectedIndex(0);
            if (sshOpenVmid === id) {
                fireAndForget(() => closeEmbeddedSsh());
            }
        },
        [closeEmbeddedSsh, orderVmids, setScreenwallEnabled, sshOpenVmid, zoomedVmid]
    );

    const undoRemove = useCallback(() => {
        const lr = lastRemovedRef.current;
        if (!lr) {
            return;
        }
        if (Date.now() - lr.at > 15_000) {
            lastRemovedRef.current = null;
            return;
        }
        lastRemovedRef.current = null;
        setOrderVmids(lr.prevOrder);
        void setScreenwallEnabled(lr.vmid, true);
        pushNotification({
            icon: "rotate-left",
            title: "屏幕墙",
            message: "已撤销",
            timestamp: new Date().toLocaleString(),
            type: "info",
            expiration: Date.now() + 4000,
        });
    }, [setScreenwallEnabled]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            const root = contentRef?.current;
            const target = e.target as Node | null;
            if (!root || !target || !root.contains(target)) {
                return;
            }
            const key = String(e?.key || "").toLowerCase();
            const isCtrlS = !!e?.ctrlKey && !e?.altKey && !e?.metaKey && key === "s";

            const el = e.target as HTMLElement | null;
            const inTerminal =
                !!el &&
                typeof (el as any).closest === "function" &&
                (!!(el as any).closest(".xterm") || !!(el as any).closest(".termwrap") || !!(el as any).closest(".term-container"));

            const tag = String((e?.target as any)?.tagName || "").toLowerCase();
            if ((tag === "input" || tag === "textarea") && !isCtrlS) {
                return;
            }
            if (settingsOpen) {
                return;
            }
            if (inTerminal && !isCtrlS) {
                return;
            }

            if (key === "escape") {
                if (isZoomed) {
                    e.preventDefault();
                    setZoomedVmid(null);
                }
                return;
            }
            if (key === "tab" && !e.shiftKey) {
                e.preventDefault();
                try {
                    e.stopPropagation();
                    (e as any).stopImmediatePropagation?.();
                } catch {
                    // ignore
                }
                cycleSelected();
                return;
            }
            if (e.ctrlKey && key === "z") {
                e.preventDefault();
                undoRemove();
                return;
            }
            if (e.ctrlKey && key === "q") {
                e.preventDefault();
                toggleZoom(selectedVm);
                return;
            }
            if (isCtrlS) {
                e.preventDefault();
                try {
                    e.stopPropagation();
                    (e as any).stopImmediatePropagation?.();
                } catch {
                    // ignore
                }
                toggleEmbeddedSsh(selectedVm);
                return;
            }
            if (e.ctrlKey && key === "w") {
                e.preventDefault();
                if (selectedVm) {
                    void openPopup(selectedVm).catch(() => {});
                }
            }
        };
        window.addEventListener("keydown", onKeyDown, { capture: true });
        return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
    }, [contentRef, cycleSelected, isZoomed, openPopup, selectedVm, settingsOpen, toggleEmbeddedSsh, toggleZoom, undoRemove]);

    const statusText = useMemo(() => {
        if (loading) {
            return i18next.t("common.loading");
        }
        if (errorText) {
            return errorText;
        }
        return `显示 ${wallMembers.length} 台`;
    }, [errorText, loading, wallMembers.length]);

    const openSettings = useCallback(() => setSettingsOpen(true), []);
    const closeSettings = useCallback(() => setSettingsOpen(false), []);

    const onDragStart = useCallback(
        (vm: PveVmInfo, e: React.DragEvent) => {
            if (!editMode || isZoomed) {
                return;
            }
            const id = Number(vm?.vmid) || 0;
            if (!id) {
                return;
            }
            dragFromVmidRef.current = id;
            try {
                e.dataTransfer.setData("text/plain", String(id));
                e.dataTransfer.effectAllowed = "move";
            } catch {
                // ignore
            }
        },
        [editMode, isZoomed]
    );

    const onDrop = useCallback(
        (vm: PveVmInfo, e: React.DragEvent) => {
            if (!editMode || isZoomed) {
                return;
            }
            e.preventDefault();
            const toId = Number(vm?.vmid) || 0;
            let fromId = dragFromVmidRef.current ?? 0;
            try {
                const raw = e.dataTransfer.getData("text/plain");
                if (raw) {
                    fromId = Number(raw) || fromId;
                }
            } catch {
                // ignore
            }
            if (!fromId || !toId || fromId === toId) {
                return;
            }
            setOrderVmids((prev) => {
                const list = (prev || []).slice();
                const fromIdx = list.indexOf(fromId);
                const toIdx = list.indexOf(toId);
                if (fromIdx === -1 || toIdx === -1) {
                    return list;
                }
                list.splice(fromIdx, 1);
                list.splice(toIdx, 0, fromId);
                return list;
            });
        },
        [editMode, isZoomed]
    );

    return (
        <div ref={contentRef} tabIndex={-1} className="w-full h-full flex flex-col bg-black relative">
            <div className="flex items-center justify-between px-3 py-2 bg-slate-900 text-slate-100 border-b border-slate-800">
                <div className="flex items-center gap-2 min-w-0">
                    <div className="text-sm font-semibold shrink-0">PVE</div>
                    <div className="px-2 py-1 text-xs rounded bg-slate-800">屏幕墙</div>
                    {usingFallback ? (
                        <div
                            className="px-2 py-1 text-xs rounded bg-amber-800/60 text-amber-100"
                            title="未勾选屏幕墙成员，临时展示全部虚拟机"
                        >
                            自动
                        </div>
                    ) : null}
                    <button
                        className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700"
                        onClick={() => void openPveUiInNewTab()}
                        title="打开 PVE 管理界面"
                    >
                        管理
                    </button>
                    <button
                        className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700"
                        onClick={openSettings}
                        title="屏幕墙设置"
                    >
                        <i className="fa fa-gear mr-1" />
                        设置
                    </button>
                    <div className="text-xs text-slate-400 truncate">{statusText}</div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        className={clsx(
                            "px-2 py-1 text-xs rounded",
                            editMode ? "bg-emerald-700 hover:bg-emerald-600" : "bg-slate-800 hover:bg-slate-700"
                        )}
                        onClick={() => setEditMode((v) => !v)}
                        title="拖动排序"
                    >
                        拖动排序: {editMode ? "开" : "关"}
                    </button>
                    <button
                        className={clsx(
                            "px-2 py-1 text-xs rounded",
                            onlyRunning ? "bg-emerald-700 hover:bg-emerald-600" : "bg-slate-800 hover:bg-slate-700"
                        )}
                        onClick={() => setOnlyRunning((v) => !v)}
                        title="仅显示运行中"
                    >
                        仅运行
                    </button>
                    <select
                        className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700"
                        value={gridPreset}
                        onChange={(e) => setGridPreset(String(e.target.value || "3x3"))}
                        title="网格"
                    >
                        <option value="2x2">2 x 2</option>
                        <option value="2x3">2 x 3</option>
                        <option value="2x4">2 x 4</option>
                        <option value="3x3">3 x 3</option>
                        <option value="3x4">3 x 4</option>
                        <option value="4x4">4 x 4</option>
                        <option value="4x3">4 x 3</option>
                        <option value="5x5">5 x 5</option>
                        <option value="6x6">6 x 6</option>
                    </select>
                    <button
                        className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-50"
                        onClick={nextPage}
                        disabled={totalPages <= 1}
                        title="切换到下一屏"
                    >
                        第 {pageNo} / {totalPages} 屏
                    </button>
                    <input
                        className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 w-[220px]"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="过滤: 名称 / VMID / IP"
                        title="过滤"
                    />
                    <button
                        className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700"
                        onClick={() => void reload()}
                        title="刷新"
                    >
                        刷新
                    </button>
                </div>
            </div>

            <div className="flex-1 min-h-0 bg-black">
                {errorText ? (
                    <div className="p-3 text-sm text-red-300 whitespace-pre-wrap">{errorText}</div>
                ) : (
                    <div
                        className={clsx("grid w-full h-full", isZoomed && "absolute inset-0 z-[2000] bg-black")}
                        style={{
                            gridTemplateColumns: `repeat(${isZoomed ? 1 : cols}, minmax(0, 1fr))`,
                            gridTemplateRows: `repeat(${isZoomed ? 1 : rows}, minmax(0, 1fr))`,
                            gap: isZoomed ? "0px" : `${WALL_GAP_PX}px`,
                            padding: isZoomed ? "0px" : `${WALL_GAP_PX}px`,
                        }}
                    >
                        {displayVms.map((vm, idx) => {
                            const isSelected = idx === selectedIndex;
                            const isRunning = String(vm.status || "") === "running";
                            const sshOpen = sshOpenVmid === vm.vmid && sshNodeModel != null && !isBlank(sshTermBlockId);
                            return (
                                <div
                                    key={`${vm.node}:${vm.vmid}`}
                                    className={clsx(
                                        "group relative rounded-lg overflow-hidden bg-black border-2",
                                        isSelected ? "border-emerald-400" : "border-white/10",
                                        editMode && !isZoomed && "cursor-move"
                                    )}
                                    onMouseDownCapture={() => {
                                        setSelectedIndex(idx);
                                        contentRef.current?.focus();
                                    }}
                                    onClick={() => setSelectedIndex(idx)}
                                    draggable={editMode && !isZoomed}
                                    onDragStart={(e) => onDragStart(vm, e)}
                                    onDragOver={(e) => {
                                        if (!editMode || isZoomed) return;
                                        try {
                                            e.preventDefault();
                                            e.dataTransfer.dropEffect = "move";
                                        } catch {
                                            // ignore
                                        }
                                    }}
                                    onDrop={(e) => onDrop(vm, e)}
                                >
                                    <div className="flex flex-col w-full h-full">
                                        <div className="px-2 py-1 text-[12px] text-slate-200 bg-slate-900 flex items-center justify-between">
                                            <div
                                                className="truncate"
                                                title={`${vm.name || ""}  #${vm.vmid}  @${vm.node}`}
                                            >
                                                {vm.name || "(no name)"}{" "}
                                                <span className="text-slate-400">#{vm.vmid}</span>
                                            </div>
                                            <div className="ml-2 shrink-0 text-[11px] text-slate-400">{vm.status}</div>
                                        </div>

                                        <div className="relative flex-1 min-h-0">
                                            <div
                                                className={clsx(
                                                    "absolute top-2 right-2 z-20 flex gap-1 opacity-0 transition-opacity",
                                                    isSelected || isZoomed ? "opacity-100" : "group-hover:opacity-100"
                                                )}
                                            >
                                                <button
                                                    className="px-2 py-1 text-[11px] rounded bg-slate-900/80 hover:bg-slate-800 border border-white/10"
                                                    title="从屏幕墙移除（Ctrl+Z 可撤销）"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        removeFromWall(vm);
                                                    }}
                                                >
                                                    <i className="fa fa-eye-slash" />
                                                </button>
                                                <button
                                                    className={clsx(
                                                        "px-2 py-1 text-[11px] rounded border border-white/10",
                                                        sshOpen
                                                            ? "bg-emerald-700/80 hover:bg-emerald-600/80"
                                                            : "bg-slate-900/80 hover:bg-slate-800"
                                                    )}
                                                    title="打开/关闭 SSH 终端（Ctrl+S）"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        toggleEmbeddedSsh(vm);
                                                    }}
                                                >
                                                    <i className="fa fa-terminal" />
                                                </button>
                                                <button
                                                    className="px-2 py-1 text-[11px] rounded bg-slate-900/80 hover:bg-slate-800 border border-white/10"
                                                    title="弹出（Ctrl+W）"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        void openPopup(vm).catch(() => {});
                                                    }}
                                                >
                                                    <i className="fa fa-up-right-from-square" />
                                                </button>
                                                <button
                                                    className="px-2 py-1 text-[11px] rounded bg-slate-900/80 hover:bg-slate-800 border border-white/10"
                                                    title="放大/还原（Ctrl+Q）"
                                                    onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        toggleZoom(vm);
                                                    }}
                                                >
                                                    <i className={clsx("fa", isZoomed ? "fa-compress" : "fa-expand")} />
                                                </button>
                                                {isZoomed && (
                                                    <button
                                                        className="px-2 py-1 text-[11px] rounded bg-slate-900/80 hover:bg-slate-800 border border-white/10"
                                                        title="还原（ESC）"
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            setZoomedVmid(null);
                                                        }}
                                                    >
                                                        <i className="fa fa-xmark" />
                                                    </button>
                                                )}
                                            </div>

                                            <div className="w-full h-full flex">
                                                {sshOpen && sshNodeModel && (
                                                    <div className="w-[42%] max-w-[70%] min-w-[260px] flex flex-col min-h-0 border-r border-white/10 bg-black">
                                                        <SubBlock key={sshTermBlockId} nodeModel={sshNodeModel} />
                                                    </div>
                                                )}
                                                <div className="flex-1 min-w-0">
                                                    <PveNovncTile
                                                        vm={vm}
                                                        active={isRunning}
                                                        selected={isSelected || isZoomed}
                                                        allowInput={!editMode}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        {Array.from({ length: placeholderCount }).map((_, idx) => (
                            <div
                                key={`ph-${pageNo}-${idx}`}
                                className="rounded-lg overflow-hidden bg-slate-950 border border-slate-900/60"
                            />
                        ))}

                        {!loading && displayVms.length === 0 && (
                            <div className="col-span-full row-span-full flex items-center justify-center text-sm text-slate-300">
                                没有可显示的虚拟机（先去“设置”勾选屏幕墙成员）
                            </div>
                        )}
                    </div>
                )}
            </div>

            {settingsOpen && (
                <Modal className="pt-6 pb-4 px-5 max-w-[860px]" onClose={closeSettings} onCancel={closeSettings}>
                    <div className="font-bold text-primary mx-4 pb-2.5">屏幕墙设置</div>
                    <div className="mx-4 text-xs text-secondary pb-3">
                        勾选要出现在屏幕墙里的虚拟机（来自 pve-ui 的 <code>screenwall_enabled</code>）。
                    </div>

                    <div className="mx-4 mb-4 max-h-[520px] overflow-auto border border-border rounded-md">
                        <div className="grid grid-cols-[72px_84px_1fr_160px_160px] gap-0 text-[11px] text-secondary bg-panel px-3 py-2 border-b border-border">
                            <div>屏幕墙</div>
                            <div>状态</div>
                            <div>名称</div>
                            <div>节点</div>
                            <div>IP</div>
                        </div>
                        {(screenwallVms || [])
                            .slice()
                            .sort((a, b) => Number(a.vmid) - Number(b.vmid))
                            .map((vm) => {
                                const id = Number(vm.vmid) || 0;
                                const saving = savingVmids.has(id);
                                const running = String(vm.status || "") === "running";
                                return (
                                    <div
                                        key={`vm-${vm.node}-${vm.vmid}`}
                                        className="grid grid-cols-[72px_84px_1fr_160px_160px] gap-0 px-3 py-2 text-sm text-primary border-b border-border/70 hover:bg-hover"
                                    >
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                className="accent-accent cursor-pointer"
                                                checked={!!vm.screenwallEnabled}
                                                disabled={saving}
                                                onChange={(e) => void setScreenwallEnabled(id, e.target.checked)}
                                            />
                                            {saving && <span className="text-[10px] text-secondary">保存中</span>}
                                        </div>
                                        <div className={clsx("text-xs", running ? "text-green-400" : "text-secondary")}>
                                            {vm.status || ""}
                                        </div>
                                        <div className="truncate" title={String(vm.name || "")}>
                                            {vm.name || "(no name)"}{" "}
                                            <span className="text-secondary/70">#{vm.vmid}</span>
                                        </div>
                                        <div className="truncate text-secondary/80">{vm.node || ""}</div>
                                        <div className="truncate text-secondary/80">{vm.ipAddress || ""}</div>
                                    </div>
                                );
                            })}
                    </div>
                    <div className="mx-4 text-xs text-secondary">
                        快捷键：Tab 切换选中格，Ctrl+Q 放大/还原，Ctrl+W 弹出，Ctrl+S 打开/关闭 SSH 终端，Ctrl+Z 撤销隐藏，ESC 退出放大。
                    </div>
                </Modal>
            )}
        </div>
    );
});

PveScreenwallView.displayName = "PveScreenwallView";

class PveScreenwallViewModel implements ViewModel {
    viewType: string;
    viewIcon: any;
    viewName: any;
    noPadding: any;
    noHeader: any;

    constructor(_blockId: string, _nodeModel: BlockNodeModel, _tabModel: TabModel) {
        this.viewType = "pvescreenwall";
        this.viewIcon = atom("server");
        this.viewName = atom("PVE 屏幕墙");
        this.noPadding = atom(true);
        this.noHeader = atom(true);
    }

    get viewComponent(): ViewComponent {
        return PveScreenwallView as any;
    }
}

export { PveScreenwallViewModel };

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { Modal } from "@/app/modals/modal";
import { ContextMenuModel } from "@/app/store/contextmenu";
import {
    atoms,
    createBlock,
    createBlockSplitHorizontally,
    getFocusedBlockId,
    getLocalHostDisplayNameAtom,
    pushFlashError,
    pushNotification,
} from "@/store/global";
import { modalsModel } from "@/store/modalmodel";
import { getEnv } from "@/util/getenv";
import { fireAndForget, isBlank } from "@/util/util";
import { waveFetchJson } from "@/util/wavefetch";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

type RemoteSource = "managed" | "discovered";

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

type ConnCheckResponse = {
    online: boolean;
    latencyMs?: number;
    error?: string;
};

type ServerEntry = {
    connection?: string;
    label: string;
    source: "local" | RemoteSource;
    displayOrder?: number;
    ssh?: {
        hostname?: string;
        user?: string;
        port?: string;
    } | null;
    pve?: {
        vmid: number;
        node: string;
        name: string;
        status: string;
        type: string;
        screenwallEnabled?: boolean;
        hasGui?: boolean;
        ipAddress?: string;
        sortIndex: number;
    } | null;
};

type ConnectionFormMode = "add" | "edit" | "adopt";

const DEFAULT_PVE_ORIGIN = "https://192.168.1.250:8006";
const DEFAULT_PVE_WEB_PARTITION = "persist:pve-wall";
const DEFAULT_PVE_LANG = "zh_CN";
const SHOW_DISCOVERED_OTHER_SERVERS_KEY = "wave.serverspanel.showDiscoveredOtherServers";

function normalizePveOrigin(raw: string): string {
    const s = String(raw ?? "").trim();
    if (s === "") {
        return "";
    }
    if (s.startsWith("http://") || s.startsWith("https://")) {
        return s;
    }
    return `https://${s}`;
}

function parseTruthy(raw: string): boolean {
    const s = String(raw ?? "")
        .trim()
        .toLowerCase();
    return s === "1" || s === "true" || s === "yes" || s === "on";
}

function parseDisplayOrder(raw: unknown): number {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
}

function normalizePort(rawPort: string): string {
    const port = rawPort.trim();
    if (port === "" || port === "22") {
        return "";
    }
    return port;
}

function parseConnectionName(connection: string): { host: string; user: string; port: string } {
    const trimmed = connection.trim();
    let user = "";
    let hostAndPort = trimmed;
    const atIndex = trimmed.indexOf("@");
    if (atIndex > 0) {
        user = trimmed.slice(0, atIndex);
        hostAndPort = trimmed.slice(atIndex + 1);
    }

    let host = hostAndPort;
    let port = "";
    if (hostAndPort.startsWith("[")) {
        const closing = hostAndPort.indexOf("]");
        if (closing > 0) {
            host = hostAndPort.slice(1, closing);
            const after = hostAndPort.slice(closing + 1);
            if (after.startsWith(":")) {
                port = after.slice(1);
            }
        }
    } else {
        const lastColon = hostAndPort.lastIndexOf(":");
        if (lastColon > -1) {
            const maybePort = hostAndPort.slice(lastColon + 1);
            if (/^\d+$/.test(maybePort)) {
                host = hostAndPort.slice(0, lastColon);
                port = maybePort;
            }
        }
    }
    return {
        host: host.trim(),
        user: user.trim(),
        port: port.trim(),
    };
}

function buildConnectionName(host: string, user: string, port: string): string {
    let normalizedHost = host.trim();
    const normalizedUser = user.trim();
    const normalizedPort = normalizePort(port);

    if (normalizedHost.includes(":") && !normalizedHost.startsWith("[") && !normalizedHost.endsWith("]")) {
        normalizedHost = `[${normalizedHost}]`;
    }

    const userPrefix = normalizedUser === "" ? "" : `${normalizedUser}@`;
    const portSuffix = normalizedPort === "" ? "" : `:${normalizedPort}`;
    return `${userPrefix}${normalizedHost}${portSuffix}`;
}

function normalize(value: unknown): string {
    return String(value ?? "").trim().toLowerCase();
}

function parseIpv4(value: string): string | null {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) {
        return null;
    }
    const ipMatch = trimmed.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
    if (!ipMatch) {
        return null;
    }
    return ipMatch[1];
}

function parsePossibleVmid(value: string): number | null {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) {
        return null;
    }
    if (/^\d+$/.test(trimmed)) {
        const n = Number(trimmed);
        return Number.isFinite(n) ? Math.floor(n) : null;
    }
    const ipMatch = trimmed.match(/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/);
    if (ipMatch) {
        const last = Number(ipMatch[4]);
        return Number.isFinite(last) ? Math.floor(last) : null;
    }
    const hashMatch = trimmed.match(/#(\d+)\b/);
    if (hashMatch) {
        const n = Number(hashMatch[1]);
        return Number.isFinite(n) ? Math.floor(n) : null;
    }
    const tailMatch = trimmed.match(/(\d+)\b/);
    if (tailMatch) {
        const n = Number(tailMatch[1]);
        return Number.isFinite(n) ? Math.floor(n) : null;
    }
    return null;
}

function resolveVmFromList(vms: PveVmInfo[], connName: string, sshHostName?: string): PveVmInfo | null {
    const parsed = parseConnectionName(connName);
    const connNorm = normalize(connName);
    const connHostNorm = normalize(parsed.host);
    const hostNorm = normalize(sshHostName);

    const needles = Array.from(
        new Set([hostNorm, connHostNorm, connNorm].map((item) => normalize(item)).filter((item) => !isBlank(item)))
    );

    for (const needle of needles) {
        const candidateIp = parseIpv4(needle);
        if (!candidateIp) {
            continue;
        }
        const hit = vms.find((vm) => normalize(vm?.ipAddress) === candidateIp);
        if (hit) {
            return hit;
        }
    }

    for (const needle of needles) {
        const candidateVmid = parsePossibleVmid(needle);
        if (candidateVmid == null) {
            continue;
        }
        const hit = vms.find((vm) => Number(vm?.vmid) === candidateVmid);
        if (hit) {
            return hit;
        }
    }

    for (const needle of needles) {
        const exact = vms.find((vm) => normalize(vm?.name) === needle);
        if (exact) {
            return exact;
        }
    }

    const candidates = vms.filter((vm) => {
        const nameNorm = normalize(vm?.name);
        if (isBlank(nameNorm)) {
            return false;
        }
        for (const needle of needles) {
            if (nameNorm.includes(needle) || needle.includes(nameNorm)) {
                return true;
            }
        }
        return false;
    });
    if (candidates.length === 0) {
        return null;
    }
    candidates.sort((a, b) => normalize(a?.name).length - normalize(b?.name).length);
    return candidates[0];
}

const ServersPanel = memo(() => {
    const { t } = useTranslation();
    const localHostLabel = useAtomValue(getLocalHostDisplayNameAtom());
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const [connections, setConnections] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [pveVms, setPveVms] = useState<PveVmInfo[] | null>(null);
    const [showAddModal, setShowAddModal] = useState(false);
    const [newHost, setNewHost] = useState("");
    const [newUser, setNewUser] = useState("");
    const [newPort, setNewPort] = useState("");
    const [connectNow, setConnectNow] = useState(true);
    const [formMode, setFormMode] = useState<ConnectionFormMode>("add");
    const [editTargetConnection, setEditTargetConnection] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [addError, setAddError] = useState<string | null>(null);
    const [showPveSettingsModal, setShowPveSettingsModal] = useState(false);
    const [pveOrigin, setPveOrigin] = useState("");
    const [pveTokenId, setPveTokenId] = useState("");
    const [pveTokenSecret, setPveTokenSecret] = useState("");
    const [pveVerifySSL, setPveVerifySSL] = useState(false);
    const [pveTokenSecretExists, setPveTokenSecretExists] = useState(false);
    const [pveSettingsLoading, setPveSettingsLoading] = useState(false);
    const [pveSettingsSaving, setPveSettingsSaving] = useState(false);
    const [pveSettingsError, setPveSettingsError] = useState<string | null>(null);
    const didDevCaptureRef = useRef(false);
    const [initPendingConnections, setInitPendingConnections] = useState<Set<string>>(() => new Set());
    const [initAllPending, setInitAllPending] = useState(false);
    const [remoteConnChecks, setRemoteConnChecks] = useState<Map<string, ConnCheckResponse>>(() => new Map());
    const remoteConnCheckInFlightRef = useRef(false);
    const [showDiscoveredOtherServers, setShowDiscoveredOtherServers] = useState<boolean>(() => {
        try {
            return localStorage.getItem(SHOW_DISCOVERED_OTHER_SERVERS_KEY) === "1";
        } catch {
            return false;
        }
    });

    const wallUrl = useMemo(() => {
        const fromSettings = String((fullConfig?.settings as any)?.["wall:url"] ?? "").trim();
        if (!isBlank(fromSettings)) {
            return fromSettings;
        }
        const fromEnv = String(getEnv("WAVETERM_WALL_URL") ?? "").trim();
        return fromEnv;
    }, [fullConfig]);

    const wallWebPartition = useMemo(() => {
        const fromSettings = String((fullConfig?.settings as any)?.["wall:webpartition"] ?? "").trim();
        return isBlank(fromSettings) ? "persist:screen-wall" : fromSettings;
    }, [fullConfig]);

    const loadConnections = useCallback(async () => {
        setLoading(true);
        try {
            const list = await RpcApi.ConnListCommand(TabRpcClient, { timeout: 2000 });
            setConnections(Array.isArray(list) ? list : []);
        } catch {
            setConnections([]);
        } finally {
            setLoading(false);
        }
    }, []);

    const loadPveVms = useCallback(async () => {
        try {
            const usp = new URLSearchParams();
            usp.set("runningOnly", "0");
            usp.set("max", "500");
            const list = await waveFetchJson<PveVmInfo[]>(`/wave/pve/vms?${usp.toString()}`);
            setPveVms(Array.isArray(list) ? list : []);
        } catch (e) {
            console.warn("pve vms unavailable", e);
            setPveVms(null);
        }
    }, []);

    const refreshConnections = useCallback(() => {
        fireAndForget(loadConnections());
        fireAndForget(loadPveVms());
    }, [loadConnections, loadPveVms]);

    const managedConnectionSet = useMemo(() => {
        const set = new Set<string>();
        const configConnections = fullConfig?.connections ?? {};
        for (const connName of Object.keys(configConnections)) {
            if (isBlank(connName) || connName === "local" || connName.startsWith("wsl://")) {
                continue;
            }
            set.add(connName);
        }
        return set;
    }, [fullConfig]);

    const openAddModal = useCallback(() => {
        setFormMode("add");
        setEditTargetConnection(null);
        setShowAddModal(true);
        setNewHost("");
        setNewUser("");
        setNewPort("");
        setConnectNow(true);
        setAddError(null);
    }, []);

    useEffect(() => {
        refreshConnections();
    }, [refreshConnections]);

    useEffect(() => {
        try {
            localStorage.setItem(SHOW_DISCOVERED_OTHER_SERVERS_KEY, showDiscoveredOtherServers ? "1" : "0");
        } catch {
            // ignore
        }
    }, [showDiscoveredOtherServers]);

    useEffect(() => {
        const id = setInterval(() => {
            refreshConnections();
        }, 10 * 60 * 1000);
        return () => clearInterval(id);
    }, [refreshConnections]);

    const openPveSettings = useCallback(() => {
        setShowPveSettingsModal(true);
    }, []);

    const closePveSettings = useCallback(() => {
        if (pveSettingsSaving) {
            return;
        }
        setShowPveSettingsModal(false);
        setPveSettingsError(null);
        setPveTokenSecret("");
    }, [pveSettingsSaving]);

    useEffect(() => {
        if (!showPveSettingsModal) {
            return;
        }
        let cancelled = false;
        setPveSettingsError(null);
        setPveSettingsLoading(true);
        fireAndForget(async () => {
            try {
                const secrets = await RpcApi.GetSecretsCommand(TabRpcClient, ["PVE_ORIGIN", "PVE_TOKEN_ID", "PVE_VERIFY_SSL"], {
                    timeout: 5000,
                });
                const secretNames = await RpcApi.GetSecretsNamesCommand(TabRpcClient, { timeout: 5000 });
                if (cancelled) {
                    return;
                }
                const originRaw = String(secrets?.["PVE_ORIGIN"] ?? "").trim();
                setPveOrigin(isBlank(originRaw) ? DEFAULT_PVE_ORIGIN : originRaw);
                setPveTokenId(String(secrets?.["PVE_TOKEN_ID"] ?? "").trim());
                setPveVerifySSL(parseTruthy(String(secrets?.["PVE_VERIFY_SSL"] ?? "")));
                setPveTokenSecretExists(Array.isArray(secretNames) && secretNames.includes("PVE_TOKEN_SECRET"));
            } catch (e: any) {
                const msg = typeof e?.message === "string" ? e.message : String(e);
                if (!cancelled) {
                    setPveSettingsError(msg);
                }
            } finally {
                if (!cancelled) {
                    setPveSettingsLoading(false);
                }
            }
        });
        return () => {
            cancelled = true;
        };
    }, [showPveSettingsModal]);

    const openPveWebCredentials = useCallback(() => {
        const origin = normalizePveOrigin(pveOrigin) || DEFAULT_PVE_ORIGIN;
        let host = "";
        try {
            host = new URL(origin).host;
        } catch {
            host = "";
        }
        if (isBlank(host)) {
            pushFlashError({
                id: "",
                icon: "triangle-exclamation",
                title: "PVE",
                message: t("connection.pveSettingsInvalidOrigin"),
                expiration: Date.now() + 6000,
            } as any);
            return;
        }

        const partitionRaw = String(getEnv("WAVETERM_PVE_WEB_PARTITION") ?? "").trim();
        const langRaw = String(getEnv("WAVETERM_PVE_LANG") ?? "").trim();
        const partition = isBlank(partitionRaw) ? DEFAULT_PVE_WEB_PARTITION : partitionRaw;
        const lang = isBlank(langRaw) ? DEFAULT_PVE_LANG : langRaw;

        if (modalsModel.isModalOpen("PveCredentialsModal")) {
            return;
        }
        modalsModel.pushModal("PveCredentialsModal", {
            host,
            origin,
            partition,
            lang,
        });
    }, [pveOrigin, t]);

    const savePveSettings = useCallback(() => {
        const origin = normalizePveOrigin(pveOrigin);
        const tokenId = String(pveTokenId ?? "").trim();
        const tokenSecret = String(pveTokenSecret ?? "").trim();
        if (isBlank(origin)) {
            setPveSettingsError(t("connection.pveSettingsOriginRequired"));
            return;
        }
        if (isBlank(tokenId)) {
            setPveSettingsError(t("connection.pveSettingsTokenIdRequired"));
            return;
        }
        if (isBlank(tokenSecret) && !pveTokenSecretExists) {
            setPveSettingsError(t("connection.pveSettingsTokenSecretRequired"));
            return;
        }

        setPveSettingsError(null);
        setPveSettingsSaving(true);
        fireAndForget(async () => {
            try {
                const updates: Record<string, any> = {
                    PVE_ORIGIN: origin,
                    PVE_TOKEN_ID: tokenId,
                    PVE_VERIFY_SSL: pveVerifySSL ? "true" : "false",
                };
                if (!isBlank(tokenSecret)) {
                    updates.PVE_TOKEN_SECRET = tokenSecret;
                }
                await RpcApi.SetSecretsCommand(TabRpcClient, updates, { timeout: 15000 });

                pushNotification({
                    icon: "pen",
                    title: "PVE",
                    message: t("connection.pveSettingsSaved"),
                    timestamp: new Date().toLocaleString(),
                    type: "info",
                    expiration: Date.now() + 4000,
                });

                setPveTokenSecret("");
                setShowPveSettingsModal(false);
                fireAndForget(loadPveVms());
            } catch (e: any) {
                const msg = typeof e?.message === "string" ? e.message : String(e);
                setPveSettingsError(msg);
            } finally {
                setPveSettingsSaving(false);
            }
        });
    }, [loadPveVms, pveOrigin, pveTokenId, pveTokenSecret, pveTokenSecretExists, pveVerifySSL, t]);

    const localEntries = useMemo<ServerEntry[]>(() => [{ label: localHostLabel, source: "local" }], [localHostLabel]);

    const connectionEntries = useMemo<ServerEntry[]>(() => {
        const vms = Array.isArray(pveVms) ? pveVms.filter((vm) => vm?.template !== true) : [];
        const pveIndexByVmid = new Map<number, number>();
        for (let idx = 0; idx < vms.length; idx++) {
            const vmid = Number(vms[idx]?.vmid);
            if (Number.isFinite(vmid)) {
                pveIndexByVmid.set(vmid, idx);
            }
        }
        const configConnections = fullConfig?.connections ?? {};
        const entries: ServerEntry[] = connections
            .filter((item) => !isBlank(item) && item !== "local")
            .map((connection) => {
                const meta = (configConnections as any)?.[connection];
                const sshHostName =
                    (meta && (meta["ssh:hostname"] ?? meta["ssh:host"] ?? meta.hostname ?? meta.host)) ?? undefined;
                const sshUserName = (meta && (meta["ssh:user"] ?? meta.user ?? meta.username)) ?? undefined;
                const sshPort = (meta && (meta["ssh:port"] ?? meta.port)) ?? undefined;
                const displayOrder = parseDisplayOrder(meta && (meta["display:order"] ?? meta.displayOrder));
                let vm: PveVmInfo | null = null;
                if (vms.length) {
                    const explicitVmidRaw = meta && (meta["pve:vmid"] ?? meta.vmid);
                    const explicitNodeRaw = meta && (meta["pve:node"] ?? meta.node);
                    const explicitVmid = Number(explicitVmidRaw);
                    const explicitNodeNorm = normalize(explicitNodeRaw);
                    if (Number.isFinite(explicitVmid)) {
                        const explicitVmidInt = Math.floor(explicitVmid);
                        vm =
                            vms.find(
                                (candidate) =>
                                    Number(candidate?.vmid) === explicitVmidInt &&
                                    (isBlank(explicitNodeNorm) || normalize(candidate?.node) === explicitNodeNorm)
                            ) ?? vms.find((candidate) => Number(candidate?.vmid) === explicitVmidInt);
                    }
                    if (!vm) {
                        vm = resolveVmFromList(vms, connection, sshHostName);
                    }
                }
                const sortIndex = vm ? pveIndexByVmid.get(vm.vmid) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
                return {
                    connection,
                    label: connection,
                    source: managedConnectionSet.has(connection) ? "managed" : "discovered",
                    displayOrder,
                    ssh: {
                        hostname: sshHostName != null ? String(sshHostName).trim() : undefined,
                        user: sshUserName != null ? String(sshUserName).trim() : undefined,
                        port: sshPort != null ? String(sshPort).trim() : undefined,
                    },
                    pve: vm
                        ? {
                              vmid: vm.vmid,
                              node: vm.node,
                              name: vm.name,
                              status: vm.status,
                              type: vm.type,
                              screenwallEnabled: vm.screenwallEnabled,
                              ipAddress: vm.ipAddress,
                              hasGui: vm.hasGui,
                              sortIndex,
                          }
                        : null,
                };
            });
        entries.sort((a, b) => {
            const aIdx = a.pve?.sortIndex ?? Number.MAX_SAFE_INTEGER;
            const bIdx = b.pve?.sortIndex ?? Number.MAX_SAFE_INTEGER;
            if (aIdx !== bIdx) {
                return aIdx - bIdx;
            }
            const aOrder = a.displayOrder ?? 0;
            const bOrder = b.displayOrder ?? 0;
            if (aOrder !== bOrder) {
                return aOrder - bOrder;
            }
            return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });
        });
        return entries;
    }, [connections, fullConfig, managedConnectionSet, pveVms]);

    const pveRemoteEntries = useMemo<ServerEntry[]>(() => {
        const vms = Array.isArray(pveVms) ? pveVms.filter((vm) => vm?.template !== true) : [];
        if (vms.length === 0) {
            return [];
        }
        const pveIndexByVmid = new Map<number, number>();
        for (let idx = 0; idx < vms.length; idx++) {
            const vmid = Number(vms[idx]?.vmid);
            if (Number.isFinite(vmid)) {
                pveIndexByVmid.set(vmid, idx);
            }
        }
        const bestConnByVmid = new Map<number, ServerEntry>();
        for (const entry of connectionEntries) {
            const pve = entry.pve;
            if (!pve) {
                continue;
            }
            const vmid = Number(pve.vmid);
            if (!Number.isFinite(vmid)) {
                continue;
            }
            const existing = bestConnByVmid.get(vmid);
            if (!existing) {
                bestConnByVmid.set(vmid, entry);
                continue;
            }
            if (existing.source !== "managed" && entry.source === "managed") {
                bestConnByVmid.set(vmid, entry);
                continue;
            }
            if (isBlank(existing.ssh?.user ?? "") && !isBlank(entry.ssh?.user ?? "")) {
                bestConnByVmid.set(vmid, entry);
            }
        }
        return vms.map((vm) => {
            const vmid = Number(vm?.vmid) || 0;
            const connEntry = vmid > 0 ? bestConnByVmid.get(vmid) : undefined;
            const sortIndex = vmid > 0 ? pveIndexByVmid.get(vmid) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
            return {
                connection: connEntry?.connection,
                label: String(vm?.id || `pve:${vm?.node ?? ""}:${vmid}`),
                source: connEntry?.source ?? "discovered",
                ssh: connEntry?.ssh,
                pve: {
                    vmid,
                    node: vm.node,
                    name: vm.name,
                    status: vm.status,
                    type: vm.type,
                    screenwallEnabled: vm.screenwallEnabled,
                    ipAddress: vm.ipAddress,
                    hasGui: vm.hasGui,
                    sortIndex,
                },
            };
        });
    }, [connectionEntries, pveVms]);

    const managedOtherRemoteEntries = useMemo(
        () => connectionEntries.filter((entry) => entry.pve == null && entry.source === "managed"),
        [connectionEntries]
    );
    const discoveredOtherRemoteEntries = useMemo(
        () => connectionEntries.filter((entry) => entry.pve == null && entry.source === "discovered"),
        [connectionEntries]
    );
    const otherRemoteEntries = useMemo(() => {
        if (showDiscoveredOtherServers) {
            return [...managedOtherRemoteEntries, ...discoveredOtherRemoteEntries];
        }
        return managedOtherRemoteEntries;
    }, [discoveredOtherRemoteEntries, managedOtherRemoteEntries, showDiscoveredOtherServers]);

    const loadRemoteConnChecks = useCallback(async () => {
        if (remoteConnCheckInFlightRef.current) {
            return;
        }
        remoteConnCheckInFlightRef.current = true;
        try {
            const targets = otherRemoteEntries
                .map((entry) => {
                    const connName = String(entry.connection ?? "").trim();
                    if (isBlank(connName)) {
                        return null;
                    }
                    const parsed = parseConnectionName(connName);
                    const host = String(entry.ssh?.hostname ?? parsed.host ?? "").trim();
                    const port = String(entry.ssh?.port ?? parsed.port ?? "").trim();
                    if (isBlank(host)) {
                        return null;
                    }
                    return { connName, host, port };
                })
                .filter((item): item is { connName: string; host: string; port: string } => item != null);

            const activeConnNames = new Set(targets.map((t) => t.connName));
            if (targets.length === 0) {
                setRemoteConnChecks((prev) => {
                    if (prev.size === 0) {
                        return prev;
                    }
                    return new Map();
                });
                return;
            }

            const timeoutMs = 900;
            const batchSize = 8;
            const results = new Map<string, ConnCheckResponse>();
            for (let idx = 0; idx < targets.length; idx += batchSize) {
                const batch = targets.slice(idx, idx + batchSize);
                const batchResults = await Promise.all(
                    batch.map(async (target) => {
                        try {
                            const usp = new URLSearchParams();
                            usp.set("host", target.host);
                            if (!isBlank(target.port)) {
                                usp.set("port", target.port);
                            }
                            usp.set("timeoutMs", String(timeoutMs));
                            const res = await waveFetchJson<ConnCheckResponse>(`/wave/conn/check?${usp.toString()}`);
                            return [target.connName, res] as const;
                        } catch (e) {
                            console.warn("remote conn check failed", target.connName, e);
                            return [target.connName, { online: false, error: `${e}` }] as const;
                        }
                    })
                );
                for (const [connName, res] of batchResults) {
                    results.set(connName, res);
                }
            }

            setRemoteConnChecks((prev) => {
                const next = new Map(prev);
                for (const key of Array.from(next.keys())) {
                    if (!activeConnNames.has(key)) {
                        next.delete(key);
                    }
                }
                for (const [key, value] of results) {
                    next.set(key, value);
                }
                return next;
            });
        } finally {
            remoteConnCheckInFlightRef.current = false;
        }
    }, [otherRemoteEntries]);

    useEffect(() => {
        fireAndForget(loadRemoteConnChecks());
        const id = setInterval(() => {
            fireAndForget(loadRemoteConnChecks());
        }, 10 * 60 * 1000);
        return () => clearInterval(id);
    }, [loadRemoteConnChecks]);

    const remoteEntryCount = pveRemoteEntries.length + otherRemoteEntries.length;

    const stoppedPveEntries = useMemo(() => pveRemoteEntries.filter((entry) => entry.pve?.status !== "running"), [pveRemoteEntries]);
    const stoppedPveCount = stoppedPveEntries.length;

    const powerOnAllStoppedPve = useCallback(() => {
        if (stoppedPveEntries.length === 0) {
            pushNotification({
                icon: "power-off",
                title: "PVE",
                message: t("connection.powerOnAllStoppedPveNone"),
                timestamp: new Date().toLocaleString(),
                type: "info",
                expiration: Date.now() + 3000,
            });
            return;
        }
        const confirmed = window.confirm(t("connection.powerOnAllStoppedPveConfirm", { count: stoppedPveEntries.length }));
        if (!confirmed) {
            return;
        }
        fireAndForget(async () => {
            let okCount = 0;
            for (const entry of stoppedPveEntries) {
                const pve = entry.pve;
                if (!pve) {
                    continue;
                }
                try {
                    await waveFetchJson<{ upid?: string }>("/wave/pve/vm-action", {
                        method: "POST",
                        body: JSON.stringify({ node: pve.node, vmid: pve.vmid, action: "start", type: pve.type }),
                    });
                    okCount++;
                } catch (e) {
                    pushFlashError({
                        id: "",
                        icon: "triangle-exclamation",
                        title: "PVE",
                        message: `${pve.name} (#${pve.vmid}): ${e}`,
                        expiration: Date.now() + 8000,
                    } as any);
                }
                await new Promise((r) => setTimeout(r, 350));
            }
            pushNotification({
                icon: "power-off",
                title: "PVE",
                message: `${t("connection.powerOn")} ${okCount}/${stoppedPveEntries.length}`,
                timestamp: new Date().toLocaleString(),
                type: "info",
                expiration: Date.now() + 5000,
            });
            fireAndForget(loadPveVms());
            setTimeout(() => fireAndForget(loadPveVms()), 1500);
        });
    }, [loadPveVms, stoppedPveEntries, t]);

    useEffect(() => {
        if (didDevCaptureRef.current) {
            return;
        }
        const api = (window as any)?.api;
        const raw = api?.getEnv?.("WAVETERM_DEV_CAPTURE_SERVERS");
        const enabled = String(raw ?? "")
            .trim()
            .toLowerCase();
        if (!enabled || (enabled !== "1" && enabled !== "true" && enabled !== "yes" && enabled !== "on")) {
            return;
        }
        if (loading || remoteEntryCount === 0) {
            return;
        }
        didDevCaptureRef.current = true;
        setTimeout(() => {
            api?.devCapturePageToFile?.("servers-panel").catch(() => {});
        }, 2500);
        setTimeout(() => {
            api?.devCapturePageToFile?.("servers-panel-late").catch(() => {});
        }, 7000);
    }, [loading, remoteEntryCount]);

    const openServer = useCallback((entry: ServerEntry) => {
        const meta: Record<string, any> = {
            controller: "shell",
            view: "term",
        };
        if (!isBlank(entry.connection)) {
            meta.connection = entry.connection;
        }
        fireAndForget(async () => {
            await createBlock({ meta });
        });
    }, []);

    const openPveConsole = useCallback((entry: ServerEntry) => {
        const pve = entry.pve;
        if (!pve) {
            return;
        }
        const vmid = Number(pve.vmid) || 0;
        if (!vmid) {
            return;
        }
        const targetBlockId = getFocusedBlockId();
        fireAndForget(async () => {
            const meta: Record<string, any> = {
                view: "pveconsole",
                "pve:node": pve.node,
                "pve:vmid": vmid,
                "frame:title": `${pve.name || "GUI"}  #${vmid}`,
            };
            if (!isBlank(targetBlockId)) {
                try {
                    await createBlockSplitHorizontally({ meta }, targetBlockId, "after");
                    return;
                } catch (e) {
                    console.warn("failed to split-open pveconsole", { vmid, targetBlockId }, e);
                }
            }
            await createBlock({ meta });
        });
    }, []);

    const openWallUrlInSplit = useCallback(
        (url: string, title: string) => {
            const normalizedUrl = String(url ?? "").trim();
            if (isBlank(normalizedUrl)) {
                return;
            }
            const targetBlockId = getFocusedBlockId();
            fireAndForget(async () => {
                const meta: Record<string, any> = {
                    view: "web",
                    url: normalizedUrl,
                    "web:hidenav": true,
                    "web:partition": wallWebPartition,
                    "frame:title": title,
                };
                if (!isBlank(targetBlockId)) {
                    try {
                        await createBlockSplitHorizontally({ meta }, targetBlockId, "after");
                        return;
                    } catch (e) {
                        console.warn("failed to split-open wall url", { targetBlockId, url: normalizedUrl }, e);
                    }
                }
                await createBlock({ meta });
            });
        },
        [wallWebPartition]
    );

    const openRemoteWallForProtocol = useCallback(
        (entry: ServerEntry, protocol: "ssh" | "vnc" | "rdp", displayName: string) => {
            const connName = String(entry.connection ?? "").trim();
            if (isBlank(connName)) {
                return;
            }

            const connMeta = (fullConfig?.connections as any)?.[connName] as Record<string, any> | undefined;
            const key = protocol === "ssh" ? "wall:sshurl" : protocol === "vnc" ? "wall:vncurl" : "wall:rdpurl";
            const explicitUrl = typeof connMeta?.[key] === "string" ? String(connMeta[key]).trim() : "";
            if (!isBlank(explicitUrl)) {
                openWallUrlInSplit(explicitUrl, `${displayName} ${protocol.toUpperCase()}`);
                return;
            }

            if (isBlank(wallUrl)) {
                pushFlashError({
                    id: "",
                    icon: "triangle-exclamation",
                    title: "Wall",
                    message: t("connection.remoteWallNotConfigured"),
                    expiration: Date.now() + 8000,
                } as any);
                return;
            }

            openWallUrlInSplit(wallUrl, "Wall");
            pushNotification({
                icon: "table-cells",
                title: "Wall",
                message: t("connection.remoteWallOpenedHint", { server: displayName, protocol: protocol.toUpperCase() }),
                timestamp: new Date().toLocaleString(),
                type: "info",
                expiration: Date.now() + 7000,
            });
        },
        [fullConfig, openWallUrlInSplit, t, wallUrl]
    );

    const setInitPending = useCallback((connName: string, pending: boolean) => {
        setInitPendingConnections((prev) => {
            const next = new Set(Array.from(prev ?? []));
            if (pending) {
                next.add(connName);
            } else {
                next.delete(connName);
            }
            return next;
        });
    }, []);

    const initializeServer = useCallback(
        async (entry: ServerEntry): Promise<boolean> => {
            const connName = String(entry.connection ?? "").trim();
            if (isBlank(connName)) {
                return false;
            }
            if (initPendingConnections.has(connName)) {
                return false;
            }

            const configConnections = (fullConfig?.connections as any) ?? {};
            const existingMeta =
                configConnections?.[connName] != null && typeof configConnections[connName] === "object"
                    ? (configConnections[connName] as Record<string, any>)
                    : {};
            const nextMeta: Record<string, any> = { ...existingMeta };

            const parsed = parseConnectionName(connName);
            const resolvedHost = String(entry.ssh?.hostname ?? parsed.host ?? "").trim();
            const resolvedPort = String(entry.ssh?.port ?? parsed.port ?? "").trim();
            const resolvedUser = String(entry.ssh?.user ?? parsed.user ?? "").trim();
            if (isBlank(String(nextMeta["ssh:hostname"] ?? "").trim()) && !isBlank(resolvedHost)) {
                nextMeta["ssh:hostname"] = resolvedHost;
            }
            if (isBlank(String(nextMeta["ssh:user"] ?? "").trim()) && !isBlank(resolvedUser)) {
                nextMeta["ssh:user"] = resolvedUser;
            }
            if (isBlank(String(nextMeta["ssh:port"] ?? "").trim()) && !isBlank(resolvedPort)) {
                nextMeta["ssh:port"] = resolvedPort;
            }

            setInitPending(connName, true);
            try {
                if (entry.pve) {
                    nextMeta["pve:vmid"] = entry.pve.vmid;
                    nextMeta["pve:node"] = entry.pve.node;
                    nextMeta["remote:hasgui"] = entry.pve.hasGui !== false;
                } else {
                    await RpcApi.ConnEnsureCommand(TabRpcClient, { connname: connName }, { timeout: 60000 });
                    const info = await RpcApi.RemoteGetInfoCommand(TabRpcClient, {
                        timeout: 5000,
                        route: `conn:${connName}`,
                    });
                    if (info) {
                        nextMeta["remote:clientos"] = String(info.clientos ?? "").trim();
                        nextMeta["remote:clientarch"] = String(info.clientarch ?? "").trim();
                        nextMeta["remote:homedir"] = String(info.homedir ?? "").trim();
                        const osLower = String(info.clientos ?? "").trim().toLowerCase();
                        if (!isBlank(osLower)) {
                            nextMeta["remote:hasgui"] = osLower.includes("windows") || osLower.includes("darwin");
                        }
                    }
                }
                nextMeta["remote:initts"] = Date.now();

                await RpcApi.SetConnectionsConfigCommand(TabRpcClient, { host: connName, metamaptype: nextMeta }, { timeout: 60000 });

                pushNotification({
                    icon: "wand-magic-sparkles",
                    title: t("connection.initialize"),
                    message: connName,
                    timestamp: new Date().toLocaleString(),
                    type: "info",
                    expiration: Date.now() + 4000,
                });
                fireAndForget(loadPveVms());
                return true;
            } catch (e) {
                pushFlashError({
                    id: "",
                    icon: "triangle-exclamation",
                    title: t("connection.initialize"),
                    message: `${connName}: ${e}`,
                    expiration: Date.now() + 8000,
                } as any);
                return false;
            } finally {
                setInitPending(connName, false);
            }
        },
        [fullConfig, initPendingConnections, loadPveVms, setInitPending, t]
    );

    const initializeAllServers = useCallback(() => {
        if (initAllPending) {
            return;
        }
        const seen = new Set<string>();
        const targets: ServerEntry[] = [];
        const candidates: ServerEntry[] = [];
        candidates.push(...pveRemoteEntries, ...otherRemoteEntries);
        for (const entry of candidates) {
            const connName = String(entry.connection ?? "").trim();
            if (isBlank(connName) || seen.has(connName)) {
                continue;
            }
            seen.add(connName);
            const isPveVm = entry.pve != null;
            const online = isPveVm ? entry.pve?.status === "running" : remoteConnChecks.get(connName)?.online === true;
            if (!online) {
                continue;
            }
            targets.push(entry);
        }
        if (targets.length === 0) {
            pushNotification({
                icon: "wand-magic-sparkles",
                title: t("connection.initialize"),
                message: t("connection.initializeAllNone"),
                timestamp: new Date().toLocaleString(),
                type: "info",
                expiration: Date.now() + 4000,
            });
            return;
        }
        const confirmed = window.confirm(t("connection.initializeAllConfirm", { count: targets.length }));
        if (!confirmed) {
            return;
        }
        setInitAllPending(true);
        fireAndForget(async () => {
            let okCount = 0;
            let failCount = 0;
            try {
                for (const entry of targets) {
                    const ok = await initializeServer(entry);
                    if (ok) {
                        okCount++;
                    } else {
                        failCount++;
                    }
                    await new Promise((r) => setTimeout(r, 250));
                }
            } finally {
                setInitAllPending(false);
            }
            pushNotification({
                icon: "wand-magic-sparkles",
                title: t("connection.initializeAll"),
                message: t("connection.initializeAllDone", { ok: okCount, failed: failCount }),
                timestamp: new Date().toLocaleString(),
                type: "info",
                expiration: Date.now() + 6000,
            });
        });
    }, [initAllPending, initializeServer, otherRemoteEntries, pveRemoteEntries, remoteConnChecks, t]);

    const closeAddModal = useCallback(() => {
        if (adding) {
            return;
        }
        setShowAddModal(false);
        setFormMode("add");
        setEditTargetConnection(null);
        setNewHost("");
        setNewUser("");
        setNewPort("");
        setConnectNow(true);
        setAddError(null);
    }, [adding]);

    const openConnectionsEditor = useCallback(() => {
        fireAndForget(async () => {
            const meta: Record<string, any> = {
                view: "waveconfig",
                file: "connections.json",
            };
            await createBlock({ meta });
        });
    }, []);

    const showPanelContextMenu = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const menu: ContextMenuItem[] = [
                {
                    label: t("connection.addServer"),
                    click: openAddModal,
                },
                {
                    label: t("connection.editConnections"),
                    click: openConnectionsEditor,
                },
                {
                    label: t("connection.editPveSettings"),
                    click: openPveSettings,
                },
                {
                    type: "separator",
                },
                {
                    label: t("connection.powerOnAllStoppedPve"),
                    click: powerOnAllStoppedPve,
                    enabled: stoppedPveCount > 0,
                },
                {
                    label: t("common.retry"),
                    click: refreshConnections,
                },
                {
                    type: "separator",
                },
                {
                    label: t("connection.showDiscoveredOtherServers"),
                    type: "checkbox",
                    checked: showDiscoveredOtherServers,
                    click: () => setShowDiscoveredOtherServers((prev) => !prev),
                },
            ];
            ContextMenuModel.showContextMenu(menu, e);
        },
        [
            openAddModal,
            openConnectionsEditor,
            openPveSettings,
            powerOnAllStoppedPve,
            refreshConnections,
            showDiscoveredOtherServers,
            stoppedPveCount,
            t,
        ]
    );

    const showPveGroupContextMenu = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const menu: ContextMenuItem[] = [
                {
                    label: t("connection.editPveSettings"),
                    click: openPveSettings,
                },
                {
                    type: "separator",
                },
                {
                    label: t("connection.powerOnAllStoppedPve"),
                    click: powerOnAllStoppedPve,
                    enabled: stoppedPveCount > 0,
                },
                {
                    label: t("common.retry"),
                    click: refreshConnections,
                },
            ];
            ContextMenuModel.showContextMenu(menu, e);
        },
        [openPveSettings, powerOnAllStoppedPve, refreshConnections, stoppedPveCount, t]
    );

    const openEditModal = useCallback((entry: ServerEntry) => {
        if (isBlank(entry.connection)) {
            return;
        }
        const parsed = parseConnectionName(entry.connection);
        setFormMode("edit");
        setEditTargetConnection(entry.connection);
        setShowAddModal(true);
        setNewHost(parsed.host);
        setNewUser(parsed.user);
        setNewPort(parsed.port);
        setConnectNow(false);
        setAddError(null);
    }, []);

    const openAdoptModal = useCallback((entry: ServerEntry) => {
        if (isBlank(entry.connection)) {
            return;
        }
        const parsed = parseConnectionName(entry.connection);
        setFormMode("adopt");
        setEditTargetConnection(null);
        setShowAddModal(true);
        setNewHost(parsed.host);
        setNewUser(parsed.user);
        setNewPort(parsed.port);
        setConnectNow(false);
        setAddError(null);
    }, []);

    const handleDeleteServer = useCallback(
        (entry: ServerEntry) => {
            if (isBlank(entry.connection)) {
                return;
            }
            const confirmed = window.confirm(t("connection.removeServerConfirm", { server: entry.connection }));
            if (!confirmed) {
                return;
            }
            fireAndForget(async () => {
                try {
                    await RpcApi.SetConnectionsConfigCommand(
                        TabRpcClient,
                        { host: entry.connection, metamaptype: null as any },
                        { timeout: 60000 }
                    );
                    await loadConnections();
                } catch (e) {
                    console.warn("error deleting server", entry.connection, e);
                }
            });
        },
        [loadConnections, t]
    );

    const runPveVmAction = useCallback(
        (entry: ServerEntry, action: "start" | "shutdown" | "stop") => {
            const pve = entry.pve;
            if (!pve) {
                return;
            }
            fireAndForget(async () => {
                try {
                    await waveFetchJson<{ upid?: string }>("/wave/pve/vm-action", {
                        method: "POST",
                        body: JSON.stringify({ node: pve.node, vmid: pve.vmid, action, type: pve.type }),
                    });
                    pushNotification({
                        icon: "power-off",
                        title: "PVE",
                        message: `${pve.name} (#${pve.vmid}): ${action}`,
                        timestamp: new Date().toLocaleString(),
                        type: "info",
                        expiration: Date.now() + 5000,
                    });
                    fireAndForget(loadPveVms());
                    setTimeout(() => fireAndForget(loadPveVms()), 1500);
                } catch (e) {
                    pushFlashError({
                        id: "",
                        icon: "triangle-exclamation",
                        title: "PVE",
                        message: `${pve.name} (#${pve.vmid}): ${e}`,
                        expiration: Date.now() + 8000,
                    } as any);
                }
            });
        },
        [loadPveVms]
    );

    const disconnectServer = useCallback((entry: ServerEntry) => {
        if (isBlank(entry.connection)) {
            return;
        }
        fireAndForget(async () => {
            try {
                await RpcApi.ConnDisconnectCommand(TabRpcClient, entry.connection, { timeout: 60000 });
            } catch (e) {
                pushFlashError({
                    id: "",
                    icon: "triangle-exclamation",
                    title: "SSH",
                    message: `${entry.connection}: ${e}`,
                    expiration: Date.now() + 8000,
                } as any);
            }
        });
    }, []);

    const showEntryContextMenu = useCallback(
        (e: React.MouseEvent, entry: ServerEntry) => {
            e.preventDefault();
            e.stopPropagation();
            if (entry.source === "local") {
                return;
            }

            const isRunning = entry.pve?.status === "running";
            const isPve = entry.pve != null;
            const connName = String(entry.connection ?? "").trim();
            const hasConn = !isBlank(connName);
            const parsed = entry.connection ? parseConnectionName(entry.connection) : { host: "", user: "", port: "" };
            const resolvedHost = String(entry.ssh?.hostname ?? parsed.host ?? "").trim();
            const resolvedPort = String(entry.ssh?.port ?? parsed.port ?? "").trim();
            const resolvedUser = String(entry.ssh?.user ?? parsed.user ?? "").trim();
            const hostWithPort = isBlank(resolvedPort) ? resolvedHost : `${resolvedHost}:${resolvedPort}`;
            const displayName = entry.pve ? `${entry.pve.name} #${entry.pve.vmid}` : hostWithPort || entry.label;
            const connMeta =
                hasConn && fullConfig?.connections ? ((fullConfig.connections as any)[connName] as Record<string, any> | undefined) : undefined;
            const explicitVncUrl = typeof connMeta?.["wall:vncurl"] === "string" ? String(connMeta["wall:vncurl"]).trim() : "";
            const explicitRdpUrl = typeof connMeta?.["wall:rdpurl"] === "string" ? String(connMeta["wall:rdpurl"]).trim() : "";
            const hasWall = !isBlank(wallUrl);
            const pveGuiCapable = entry.pve?.hasGui !== false;
            const remoteGuiCapable =
                !isPve && (connMeta?.["remote:hasgui"] === true || !isBlank(explicitVncUrl) || !isBlank(explicitRdpUrl));
            const guiCapable = isPve ? pveGuiCapable : remoteGuiCapable;
            const remoteOnline = !isPve && hasConn ? remoteConnChecks.get(connName)?.online : undefined;
            const initOnline = isPve ? isRunning : remoteOnline === true;
            const initEnabled = hasConn && (isPve ? isRunning : remoteOnline === true);
            const sshEnabled = hasConn && (isPve ? isRunning : remoteOnline === true);
            const isQemu = !isPve || String(entry.pve?.type ?? "").trim().toLowerCase() === "qemu";
            const vncEnabled = isPve
                ? isQemu && isRunning && pveGuiCapable
                : hasConn && guiCapable && remoteOnline === true && (hasWall || !isBlank(explicitVncUrl));
            const rdpEnabled = isPve
                ? isRunning && pveGuiCapable && !isBlank(explicitRdpUrl)
                : hasConn && guiCapable && remoteOnline === true && (hasWall || !isBlank(explicitRdpUrl));
            const menu: ContextMenuItem[] = [
                {
                    label: t("connection.openSsh"),
                    click: () => openServer(entry),
                    enabled: sshEnabled,
                },
                {
                    label: t("connection.initialize"),
                    click: () => fireAndForget(initializeServer(entry)),
                    enabled: initEnabled,
                },
                {
                    label: t("connection.openVnc"),
                    click: () => {
                        if (isPve) {
                            openPveConsole(entry);
                            return;
                        }
                        openRemoteWallForProtocol(entry, "vnc", displayName);
                    },
                    enabled: vncEnabled,
                },
                {
                    label: t("connection.openRdp"),
                    click: () => openRemoteWallForProtocol(entry, "rdp", displayName),
                    enabled: rdpEnabled,
                },
                {
                    label: t("connection.disconnectMenu"),
                    click: () => disconnectServer(entry),
                    enabled: hasConn,
                },
            ];

            if (isPve) {
                menu.push({ type: "separator" });
                menu.push({
                    label: t("connection.powerOn"),
                    click: () => runPveVmAction(entry, "start"),
                    enabled: !isRunning,
                });
                menu.push({
                    label: t("connection.powerOff"),
                    click: () => runPveVmAction(entry, "shutdown"),
                    enabled: isRunning,
                });
                menu.push({
                    label: t("connection.forceStop"),
                    click: () => runPveVmAction(entry, "stop"),
                    enabled: isRunning,
                });
            }

            if (entry.source === "managed" && hasConn) {
                menu.push({ type: "separator" });
                menu.push({
                    label: t("connection.editServer"),
                    click: () => openEditModal(entry),
                    enabled: !isBlank(entry.connection),
                });
                menu.push({
                    label: t("common.delete"),
                    click: () => handleDeleteServer(entry),
                    enabled: !isBlank(entry.connection),
                });
            } else if (entry.source === "discovered" && hasConn) {
                menu.push({ type: "separator" });
                menu.push({
                    label: t("connection.addToManagedList"),
                    click: () => openAdoptModal(entry),
                    enabled: !isBlank(entry.connection),
                });
            }

            ContextMenuModel.showContextMenu(menu, e);
        },
        [
            disconnectServer,
            fullConfig,
            handleDeleteServer,
            initializeServer,
            openAdoptModal,
            openEditModal,
            openPveConsole,
            openRemoteWallForProtocol,
            openServer,
            remoteConnChecks,
            runPveVmAction,
            t,
            wallUrl,
        ]
    );

    const handleAddServer = useCallback(() => {
        const host = newHost.trim();
        const user = newUser.trim();
        const port = newPort.trim();
        const connectionName = buildConnectionName(host, user, port);
        if (isBlank(host)) {
            setAddError(t("connection.connectTo"));
            return;
        }
        if (isBlank(connectionName)) {
            setAddError(t("connection.connectTo"));
            return;
        }

        setAdding(true);
        setAddError(null);
        fireAndForget(async () => {
            try {
                const meta: Record<string, any> = {
                    "ssh:hostname": host,
                };
                if (!isBlank(user)) {
                    meta["ssh:user"] = user;
                }
                if (!isBlank(port)) {
                    meta["ssh:port"] = port;
                }
                await RpcApi.SetConnectionsConfigCommand(
                    TabRpcClient,
                    { host: connectionName, metamaptype: meta },
                    { timeout: 60000 }
                );
                if (formMode === "edit" && !isBlank(editTargetConnection) && editTargetConnection !== connectionName) {
                    await RpcApi.SetConnectionsConfigCommand(
                        TabRpcClient,
                        { host: editTargetConnection, metamaptype: null as any },
                        { timeout: 60000 }
                    );
                }
                await loadConnections();
                setShowAddModal(false);

                if (connectNow) {
                    try {
                        await RpcApi.ConnEnsureCommand(TabRpcClient, { connname: connectionName }, { timeout: 60000 });
                    } catch (e) {
                        console.warn("error ensuring connection", connectionName, e);
                    }
                }
            } catch (e) {
                setAddError(`${e}`);
            } finally {
                setAdding(false);
            }
        });
    }, [connectNow, editTargetConnection, formMode, loadConnections, newHost, newPort, newUser, t]);

    const renderRemoteEntry = useCallback(
        (entry: ServerEntry) => {
            const connName = String(entry.connection ?? "").trim();
            const isPveVm = entry.pve != null;
            const isRunning = entry.pve?.status === "running";
            const isQemu = !isPveVm || String(entry.pve?.type ?? "").trim().toLowerCase() === "qemu";
            const pveGuiCapable = entry.pve?.hasGui !== false;
            const initPending = !isBlank(connName) && initPendingConnections.has(connName);

            const parsed = entry.connection ? parseConnectionName(entry.connection) : { host: "", user: "", port: "" };
            const resolvedHost = String(entry.ssh?.hostname ?? parsed.host ?? "").trim();
            const resolvedPort = String(entry.ssh?.port ?? parsed.port ?? "").trim();
            const resolvedUser = String(entry.ssh?.user ?? parsed.user ?? "").trim();
            const hostWithPort = isBlank(resolvedPort) ? resolvedHost : `${resolvedHost}:${resolvedPort}`;
            const displayName = entry.pve ? `${entry.pve.name} #${entry.pve.vmid}` : hostWithPort || entry.label;

            const connMeta = !isBlank(connName)
                ? (((fullConfig?.connections as any) ?? {})[connName] as Record<string, any> | undefined)
                : undefined;
            const explicitVncUrl = typeof connMeta?.["wall:vncurl"] === "string" ? String(connMeta["wall:vncurl"]).trim() : "";
            const explicitRdpUrl = typeof connMeta?.["wall:rdpurl"] === "string" ? String(connMeta["wall:rdpurl"]).trim() : "";
            const hasWall = !isBlank(wallUrl);
            const remoteGuiCapable =
                !isPveVm && (connMeta?.["remote:hasgui"] === true || !isBlank(explicitVncUrl) || !isBlank(explicitRdpUrl));
            const guiCapable = isPveVm ? pveGuiCapable : remoteGuiCapable;

            const hasConn = !isBlank(connName);
            const remoteOnline = !isPveVm && hasConn ? remoteConnChecks.get(connName)?.online : undefined;
            const initOnline = isPveVm ? isRunning : remoteOnline === true;
            const initEnabled = hasConn && !initPending && (isPveVm ? isRunning : remoteOnline === true);
            const sshEnabled = hasConn && (isPveVm ? isRunning : remoteOnline === true);
            const vncEnabled = isPveVm
                ? isQemu && isRunning && pveGuiCapable
                : hasConn && guiCapable && remoteOnline === true && (hasWall || !isBlank(explicitVncUrl));
            const rdpEnabled = isPveVm
                ? isRunning && pveGuiCapable && !isBlank(explicitRdpUrl)
                : hasConn && guiCapable && remoteOnline === true && (hasWall || !isBlank(explicitRdpUrl));

            const btnBase =
                "inline-flex items-center justify-center w-[18px] h-[18px] rounded text-secondary hover:text-primary hover:bg-hover disabled:opacity-30 disabled:hover:text-secondary disabled:hover:bg-transparent";

            const titleParts: string[] = [];
            if (entry.pve) {
                titleParts.push(`${entry.pve.name} (#${entry.pve.vmid})`);
                if (!isBlank(hostWithPort)) {
                    titleParts.push(hostWithPort);
                }
                titleParts.push(entry.pve.status);
            } else if (!isBlank(entry.connection)) {
                titleParts.push(entry.connection);
            } else {
                titleParts.push(entry.label);
            }
            const title = titleParts.filter(Boolean).join(" · ");

            const statusTitle = isPveVm
                ? String(entry.pve?.status ?? "")
                : remoteOnline === true
                  ? "online"
                  : remoteOnline === false
                    ? "offline"
                    : "";
            const statusText = isPveVm
                ? isRunning
                    ? t("connection.statusRunning")
                    : t("connection.statusStopped")
                : remoteOnline === true
                  ? t("connection.statusOnline")
                  : remoteOnline === false
                    ? t("connection.statusOffline")
                    : "";
            const statusClass = isPveVm
                ? isRunning
                    ? "text-green-400"
                    : "text-secondary/60"
                : remoteOnline === true
                  ? "text-green-400"
                  : remoteOnline === false
                    ? "text-secondary/60"
                    : "text-secondary/40";

            return (
                <div
                    key={`remote-${entry.connection ?? entry.label}`}
                    className="group grid grid-cols-[88px_minmax(0,1fr)_56px_72px_96px_44px] items-center gap-0 px-2 py-1.5 text-sm hover:bg-hover rounded cursor-default"
                    onContextMenu={(e) => showEntryContextMenu(e, entry)}
                    title={title}
                >
                    <div className="flex items-center gap-1 flex-shrink-0 pr-2">
                        <button
                            className={clsx(btnBase, { "text-sky-400": initOnline })}
                            disabled={!initEnabled}
                            onClick={(e) => {
                                e.stopPropagation();
                                fireAndForget(initializeServer(entry));
                            }}
                            title={t("connection.initialize")}
                        >
                            <i className={initPending ? "fa fa-spinner fa-spin text-[12px]" : "fa fa-wand-magic-sparkles text-[12px]"} />
                        </button>
                        <button
                            className={btnBase}
                            disabled={!sshEnabled}
                            onClick={(e) => {
                                e.stopPropagation();
                                openServer(entry);
                            }}
                            title={t("connection.openSsh")}
                        >
                            <i className="fa fa-terminal text-[12px]" />
                        </button>
                        {guiCapable ? (
                            <button
                                className={clsx(btnBase, "text-sky-400")}
                                disabled={!vncEnabled}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (isPveVm) {
                                        openPveConsole(entry);
                                        return;
                                    }
                                    openRemoteWallForProtocol(entry, "vnc", displayName);
                                }}
                                title={t("connection.openVnc")}
                            >
                                <i className="fa fa-desktop text-[12px]" />
                            </button>
                        ) : (
                            <span className="inline-flex w-[18px] h-[18px]" />
                        )}
                        {guiCapable ? (
                            <button
                                className={btnBase}
                                disabled={!rdpEnabled}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    openRemoteWallForProtocol(entry, "rdp", displayName);
                                }}
                                title={t("connection.openRdp")}
                            >
                                <i className="fa fa-window-maximize text-[12px]" />
                            </button>
                        ) : (
                            <span className="inline-flex w-[18px] h-[18px]" />
                        )}
                    </div>
                    <div className="truncate min-w-0 pr-2">{displayName}</div>
                    <div className={clsx("text-[10px] text-right truncate pr-2", statusClass)} title={statusTitle}>
                        {statusText}
                    </div>
                    <div
                        className="text-[10px] text-secondary/70 text-right truncate pr-2"
                        title={entry.source === "discovered" ? t("connection.discoveredTag") : ""}
                    >
                        {entry.source === "discovered" ? t("connection.discoveredTag") : ""}
                    </div>
                    <div className="text-[11px] text-secondary/80 text-right truncate w-full pr-2" title={resolvedUser}>
                        {resolvedUser}
                    </div>
                    <div className="flex items-center justify-end gap-2">
                        {!isBlank(entry.connection) &&
                            (entry.source === "managed" ? (
                                <>
                                    <button
                                        className="text-[11px] text-secondary hover:text-primary opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            openEditModal(entry);
                                        }}
                                        title={t("connection.editServer")}
                                    >
                                        <i className="fa fa-pen" />
                                    </button>
                                    <button
                                        className="text-[11px] text-secondary hover:text-red-400 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteServer(entry);
                                        }}
                                        title={t("common.delete")}
                                    >
                                        <i className="fa fa-trash" />
                                    </button>
                                </>
                            ) : (
                                <button
                                    className="text-[11px] text-secondary hover:text-accent opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        openAdoptModal(entry);
                                    }}
                                    title={t("connection.addToManagedList")}
                                >
                                    <i className="fa fa-plus" />
                                </button>
                            ))}
                    </div>
                </div>
            );
        },
        [
            fullConfig,
            handleDeleteServer,
            initPendingConnections,
            initializeServer,
            openAdoptModal,
            openEditModal,
            openPveConsole,
            openRemoteWallForProtocol,
            openServer,
            remoteConnChecks,
            showEntryContextMenu,
            t,
            wallUrl,
        ]
    );

    const modalTitle = useMemo(() => {
        if (formMode === "edit") {
            return t("connection.editServer");
        }
        if (formMode === "adopt") {
            return t("connection.addDiscoveredServer");
        }
        return t("connection.addServer");
    }, [formMode, t]);

    return (
        <div className="flex flex-col h-full bg-zinc-950 border-r border-zinc-800 overflow-hidden" onContextMenu={showPanelContextMenu}>
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 flex-shrink-0">
                <div className="flex items-center gap-2">
                    <i className="fas fa-laptop text-accent" />
                    <span className="text-sm font-semibold">{t("workspace.servers")}</span>
                </div>
                <div className="flex items-center gap-3">
                    <div
                        className="text-xs text-secondary hover:text-primary cursor-pointer"
                        onClick={openConnectionsEditor}
                        title={t("connection.editConnections")}
                    >
                        <i className="fa fa-gear" />
                    </div>
                    <div
                        className={clsx("text-xs text-secondary hover:text-primary cursor-pointer", {
                            "opacity-30 cursor-default hover:text-secondary": stoppedPveCount === 0,
                        })}
                        onClick={() => {
                            if (stoppedPveCount === 0) {
                                return;
                            }
                            powerOnAllStoppedPve();
                        }}
                        title={
                            stoppedPveCount === 0
                                ? t("connection.powerOnAllStoppedPveNone")
                                : `${t("connection.powerOnAllStoppedPve")} (${stoppedPveCount})`
                        }
                    >
                        <i className="fa fa-power-off" />
                    </div>
                    <div
                        className={clsx("text-xs text-secondary hover:text-primary cursor-pointer", {
                            "opacity-30 cursor-default hover:text-secondary": initAllPending,
                        })}
                        onClick={() => {
                            if (initAllPending) {
                                return;
                            }
                            initializeAllServers();
                        }}
                        title={t("connection.initializeAll")}
                    >
                        <i className={initAllPending ? "fa fa-spinner fa-spin" : "fa fa-wand-magic-sparkles"} />
                    </div>
                    <div
                        className="text-xs text-secondary hover:text-primary cursor-pointer"
                        onClick={openAddModal}
                        title={t("connection.addServer")}
                    >
                        <i className="fa fa-plus" />
                    </div>
                    <div
                        className="text-xs text-secondary hover:text-primary cursor-pointer"
                        onClick={refreshConnections}
                        title={t("common.retry")}
                    >
                        <i className="fa fa-rotate-right" />
                    </div>
                </div>
            </div>

            <div className="px-3 pt-2 pb-1 text-xs text-secondary/80 uppercase tracking-wide">{t("connection.local")}</div>
            <div className="px-2 pb-2">
                {localEntries.map((entry) => (
                    <div
                        key={entry.label}
                        className="flex items-center px-2 py-1.5 text-sm hover:bg-hover rounded cursor-pointer"
                        onClick={() => openServer(entry)}
                    >
                        <i className="fa fa-desktop mr-2 text-secondary" />
                        <span className="truncate">{entry.label}</span>
                    </div>
                ))}
            </div>

            <div className="px-3 pt-2 pb-1 text-xs text-secondary/80 uppercase tracking-wide">{t("connection.remotes")}</div>
            <div className="flex-1 overflow-y-auto px-2 pb-2">
                {loading ? (
                    <div className="text-xs text-secondary px-2 py-2">{t("common.loading")}</div>
                ) : remoteEntryCount === 0 ? (
                    <div className="text-xs text-secondary px-2 py-2">{t("connection.noRemoteConnections")}</div>
                ) : (
                    <>
                        {pveRemoteEntries.length > 0 && (
                            <>
                                <div
                                    className="px-2 pt-1 pb-1 text-[10px] text-secondary/80 uppercase tracking-wide flex items-center gap-2"
                                    onContextMenu={showPveGroupContextMenu}
                                >
                                    <span>{t("connection.pveGroup")}</span>
                                    <button
                                        className="text-[10px] text-secondary hover:text-primary"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            openPveSettings();
                                        }}
                                        title={t("connection.editPveSettings")}
                                    >
                                        <i className="fa fa-pen" />
                                    </button>
                                </div>
                                {pveRemoteEntries.map(renderRemoteEntry)}
                            </>
                        )}
                        {otherRemoteEntries.length > 0 && (
                            <>
                                <div
                                    className={clsx("px-2 pb-1 text-[10px] text-secondary/80 uppercase tracking-wide", {
                                        "pt-3": pveRemoteEntries.length > 0,
                                        "pt-1": pveRemoteEntries.length === 0,
                                    })}
                                >
                                    {t("connection.otherServersGroup")}
                                </div>
                                {otherRemoteEntries.map(renderRemoteEntry)}
                            </>
                        )}
                    </>
                )}
            </div>

            {showPveSettingsModal && (
                <Modal
                    className="pt-6 pb-4 px-5"
                    okLabel={t("common.save")}
                    cancelLabel={t("common.cancel")}
                    onOk={savePveSettings}
                    onCancel={closePveSettings}
                    onClose={closePveSettings}
                    okDisabled={pveSettingsSaving || pveSettingsLoading}
                    cancelDisabled={pveSettingsSaving}
                >
                    <div className="font-bold text-primary mx-4 pb-2.5">{t("connection.pveSettingsTitle")}</div>
                    <div className="flex flex-col gap-3 mx-4 mb-4 max-w-[560px] text-primary">
                        {pveSettingsLoading ? (
                            <div className="text-xs text-secondary px-1 py-2">{t("common.loading")}</div>
                        ) : (
                            <>
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-xs text-secondary">{t("connection.pveSettingsOriginLabel")}</label>
                                    <input
                                        type="text"
                                        value={pveOrigin}
                                        onChange={(e) => {
                                            setPveOrigin(e.target.value);
                                            setPveSettingsError(null);
                                        }}
                                        placeholder={DEFAULT_PVE_ORIGIN}
                                        className="px-3 py-2 bg-panel border border-border rounded focus:outline-none focus:border-accent"
                                        spellCheck={false}
                                        disabled={pveSettingsSaving}
                                    />
                                </div>

                                <div className="flex flex-col gap-1.5">
                                    <label className="text-xs text-secondary">{t("connection.pveSettingsTokenIdLabel")}</label>
                                    <input
                                        type="text"
                                        value={pveTokenId}
                                        onChange={(e) => {
                                            setPveTokenId(e.target.value);
                                            setPveSettingsError(null);
                                        }}
                                        placeholder="root@pam!wave"
                                        className="px-3 py-2 bg-panel border border-border rounded focus:outline-none focus:border-accent"
                                        spellCheck={false}
                                        disabled={pveSettingsSaving}
                                    />
                                </div>

                                <div className="flex flex-col gap-1.5">
                                    <label className="text-xs text-secondary">
                                        {t("connection.pveSettingsTokenSecretLabel")}
                                    </label>
                                    <input
                                        type="password"
                                        value={pveTokenSecret}
                                        onChange={(e) => {
                                            setPveTokenSecret(e.target.value);
                                            setPveSettingsError(null);
                                        }}
                                        placeholder={
                                            pveTokenSecretExists
                                                ? t("connection.pveSettingsTokenSecretPlaceholderStored")
                                                : t("connection.pveSettingsTokenSecretPlaceholder")
                                        }
                                        className="px-3 py-2 bg-panel border border-border rounded focus:outline-none focus:border-accent"
                                        spellCheck={false}
                                        disabled={pveSettingsSaving}
                                    />
                                    {pveTokenSecretExists && isBlank(pveTokenSecret) && (
                                        <div className="text-[11px] text-secondary/80">
                                            {t("connection.pveSettingsTokenSecretStored")}
                                        </div>
                                    )}
                                </div>

                                <label className="flex items-center gap-2 text-xs text-secondary select-none">
                                    <input
                                        type="checkbox"
                                        checked={pveVerifySSL}
                                        onChange={(e) => {
                                            setPveVerifySSL(Boolean(e.target.checked));
                                            setPveSettingsError(null);
                                        }}
                                        disabled={pveSettingsSaving}
                                    />
                                    {t("connection.pveSettingsVerifySsl")}
                                </label>

                                <div className="pt-2 mt-1 border-t border-border flex items-center justify-between">
                                    <div className="text-xs text-secondary">{t("connection.pveSettingsWebCredentials")}</div>
                                    <button
                                        className="text-xs text-secondary hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            openPveWebCredentials();
                                        }}
                                        disabled={pveSettingsSaving}
                                        title={t("connection.pveSettingsEditWebCredentials")}
                                    >
                                        <i className="fa fa-pen mr-1" />
                                        {t("connection.pveSettingsEditWebCredentials")}
                                    </button>
                                </div>
                            </>
                        )}

                        {pveSettingsError && (
                            <div className="text-xs text-error whitespace-pre-wrap break-words">{pveSettingsError}</div>
                        )}
                    </div>
                </Modal>
            )}

            {showAddModal && (
                <Modal
                    className="pt-6 pb-4 px-5"
                    okLabel={formMode === "edit" ? t("common.save") : t("common.ok")}
                    cancelLabel={t("common.cancel")}
                    onOk={handleAddServer}
                    onCancel={closeAddModal}
                    onClose={closeAddModal}
                    okDisabled={adding || isBlank(newHost.trim())}
                    cancelDisabled={adding}
                >
                    <div className="font-bold text-primary mx-4 pb-2.5">{modalTitle}</div>
                    <div className="flex flex-col gap-3 mx-4 mb-4 max-w-[520px] text-primary">
                        <div className="flex flex-col gap-1.5">
                            <div className="text-xs text-secondary">{t("connection.serverHost")}</div>
                            <input
                                type="text"
                                value={newHost}
                                onChange={(e) => setNewHost(e.target.value)}
                                className="resize-none bg-panel rounded-md border border-border py-1.5 pl-4 min-h-[30px] text-inherit cursor-text focus:ring-2 focus:ring-accent focus:outline-none"
                                placeholder="192.168.1.250"
                                autoFocus
                                onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === "Enter") {
                                        handleAddServer();
                                    } else if (e.key === "Escape") {
                                        closeAddModal();
                                    }
                                }}
                            />
                        </div>
                        <div className="flex gap-2">
                            <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                                <div className="text-xs text-secondary">{t("connection.sshUser")}</div>
                                <input
                                    type="text"
                                    value={newUser}
                                    onChange={(e) => setNewUser(e.target.value)}
                                    className="resize-none bg-panel rounded-md border border-border py-1.5 pl-4 min-h-[30px] text-inherit cursor-text focus:ring-2 focus:ring-accent focus:outline-none"
                                    placeholder="root"
                                    onKeyDown={(e) => {
                                        e.stopPropagation();
                                        if (e.key === "Escape") {
                                            closeAddModal();
                                        }
                                    }}
                                />
                            </div>
                            <div className="flex flex-col gap-1.5 w-[140px]">
                                <div className="text-xs text-secondary">{t("connection.sshPort")}</div>
                                <input
                                    type="text"
                                    value={newPort}
                                    onChange={(e) => setNewPort(e.target.value)}
                                    className="resize-none bg-panel rounded-md border border-border py-1.5 pl-4 min-h-[30px] text-inherit cursor-text focus:ring-2 focus:ring-accent focus:outline-none"
                                    placeholder="22"
                                    onKeyDown={(e) => {
                                        e.stopPropagation();
                                        if (e.key === "Escape") {
                                            closeAddModal();
                                        }
                                    }}
                                />
                            </div>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-secondary">
                            <input
                                type="checkbox"
                                checked={connectNow}
                                onChange={(e) => setConnectNow(e.target.checked)}
                                className="accent-accent cursor-pointer"
                            />
                            <span>{t("connection.connectNow")}</span>
                        </div>
                        {addError != null && <div className="text-xs text-red-400">{addError}</div>}
                    </div>
                </Modal>
            )}
        </div>
    );
});

ServersPanel.displayName = "ServersPanel";

export { ServersPanel };

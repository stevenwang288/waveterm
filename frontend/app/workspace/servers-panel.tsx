// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { computeConnColorNum } from "@/app/block/blockutil";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { Modal } from "@/app/modals/modal";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { atoms, createBlock, getApi, getConnStatusAtom, getLocalHostDisplayNameAtom, pushNotification } from "@/store/global";
import { fireAndForget, isBlank } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type RemoteSource = "managed" | "discovered";

type ServerEntry = {
    connection?: string;
    label: string;
    sublabel?: string;
    source: "local" | RemoteSource;
    pveVmid?: number;
    pveMachine?: PveMachineInfoLocal;
};

type PveMachineInfoLocal = {
    vmid: number;
    node: string;
    type: "qemu" | "lxc";
    name: string;
    status?: string;
    sshHost?: string;
    ipHints?: string[];
};

type ConnectionFormMode = "add" | "edit" | "adopt";
const DEFAULT_PVE_ORIGIN = "https://192.168.1.250:8006";

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

function normalizeHostForMatch(host: string): string {
    return host.trim().replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

function uniqNonBlank(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const normalized = String(value ?? "").trim();
        if (normalized === "" || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}

function extractIpv4Hints(value: string): string[] {
    const matches = String(value ?? "").match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
    return uniqNonBlank(matches.map((item) => normalizeHostForMatch(item)));
}

function getManagedConnectionHost(connection: string, connConfig?: ConnKeywords): string {
    const explicitHost = String(connConfig?.["ssh:hostname"] ?? "").trim();
    if (explicitHost !== "") {
        return normalizeHostForMatch(explicitHost);
    }
    return normalizeHostForMatch(parseConnectionName(connection).host);
}

function getConnectionVmid(connConfig?: ConnKeywords): number {
    const vmid = Number((connConfig as any)?.["pve:vmid"] ?? 0);
    return Number.isFinite(vmid) && vmid > 0 ? vmid : 0;
}

function getConnectionHostCandidates(connection: string, connConfig?: ConnKeywords): string[] {
    const parsed = parseConnectionName(connection);
    return uniqNonBlank([
        normalizeHostForMatch(String(connConfig?.["ssh:hostname"] ?? "")),
        normalizeHostForMatch(parsed.host),
        ...extractIpv4Hints(connection),
        ...extractIpv4Hints(String(connConfig?.["ssh:hostname"] ?? "")),
    ]);
}

function getMachineHostCandidates(machine: PveMachineInfoLocal): string[] {
    return uniqNonBlank([
        normalizeHostForMatch(machine.sshHost ?? ""),
        ...(Array.isArray(machine.ipHints) ? machine.ipHints : []).map((ip) => normalizeHostForMatch(ip)),
    ]);
}

function doesConnectionMatchMachine(connection: string, connConfig: ConnKeywords | undefined, machine: PveMachineInfoLocal): boolean {
    if (getConnectionVmid(connConfig) === machine.vmid) {
        return true;
    }
    const connHosts = new Set(getConnectionHostCandidates(connection, connConfig));
    const machineHosts = getMachineHostCandidates(machine);
    return machineHosts.some((host) => connHosts.has(host));
}

function scorePveEntry(entry: ServerEntry, connConfig: ConnKeywords | undefined, machine: PveMachineInfoLocal): number {
    let score = 0;
    const displayName = String((connConfig as any)?.["display:name"] ?? "").trim();
    const host = getManagedConnectionHost(entry.connection ?? "", connConfig);
    const sshHost = normalizeHostForMatch(machine.sshHost ?? "");
    const ipHints = new Set((Array.isArray(machine.ipHints) ? machine.ipHints : []).map((ip) => normalizeHostForMatch(ip)));
    const connectionName = String(entry.connection ?? "");

    if (displayName === machine.name) {
        score += 100;
    }
    if (host !== "" && (host === sshHost || ipHints.has(host))) {
        score += 40;
    }
    if (!/\s/.test(connectionName)) {
        score += 15;
    }
    if (connectionName.includes(" codex")) {
        score -= 30;
    }
    if (String((connConfig as any)?.["cmd:initscript.sh"] ?? "").trim() !== "") {
        score -= 10;
    }
    if (String((connConfig as any)?.["cmd:initscript.pwsh"] ?? "").trim() !== "") {
        score -= 10;
    }
    score -= connectionName.length / 1000;
    return score;
}

function scoreConnectionCandidate(
    connection: string,
    connConfig: ConnKeywords | undefined,
    source: RemoteSource,
    machine: PveMachineInfoLocal
): number {
    const entry: ServerEntry = {
        connection,
        label: connection,
        source,
        pveVmid: getConnectionVmid(connConfig) || undefined,
    };
    let score = scorePveEntry(entry, connConfig, machine);
    if (source === "managed") {
        score += 25;
    }
    if (!isBlank(parseConnectionName(connection).user) || !isBlank(String(connConfig?.["ssh:user"] ?? ""))) {
        score += 5;
    }
    return score;
}

function decorateEntryWithMachine(
    entry: ServerEntry,
    fullConfig: FullConfigType | null,
    pveMachines: PveMachineInfoLocal[] | null
): ServerEntry {
    if (pveMachines == null || isBlank(entry.connection)) {
        return entry;
    }
    const connConfig = fullConfig?.connections?.[entry.connection ?? ""] as ConnKeywords | undefined;
    const matchedMachine = pveMachines.find((machine) => doesConnectionMatchMachine(entry.connection ?? "", connConfig, machine));
    if (matchedMachine == null) {
        return entry;
    }
    const label = matchedMachine.name || entry.label;
    const sublabel = label !== (entry.connection ?? "") ? entry.connection : entry.sublabel;
    return {
        ...entry,
        label,
        sublabel,
        pveVmid: matchedMachine.vmid,
        pveMachine: matchedMachine,
    };
}

const ServerRow = memo(
    ({
        entry,
        iconClassName,
        tag,
        onOpen,
        onEdit,
        onDelete,
        onAdopt,
    }: {
        entry: ServerEntry;
        iconClassName: string;
        tag?: string;
        onOpen: (entry: ServerEntry) => void;
        onEdit?: (entry: ServerEntry) => void;
        onDelete?: (entry: ServerEntry) => void;
        onAdopt?: (entry: ServerEntry) => void;
    }) => {
        const connStatus = useAtomValue(getConnStatusAtom(entry.connection ?? ""));
        const connColorNum = computeConnColorNum(connStatus);
        const machineStatus = String(entry.pveMachine?.status ?? "").trim().toLowerCase();
        let statusBadge: React.ReactNode = null;

        if (!isBlank(entry.connection) && connStatus?.status === "connected") {
            statusBadge = (
                <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: `var(--conn-icon-color-${connColorNum})` }}
                    title="connected"
                />
            );
        } else if (!isBlank(entry.connection) && (connStatus?.status === "error" || !isBlank(connStatus?.error))) {
            statusBadge = (
                <span className="text-[10px] text-red-400" title={connStatus?.error || connStatus?.status}>
                    <i className="fa fa-triangle-exclamation" />
                </span>
            );
        } else if (machineStatus !== "" && machineStatus !== "running") {
            statusBadge = (
                <span className="text-[10px] text-amber-400" title={machineStatus}>
                    {machineStatus}
                </span>
            );
        }

        return (
            <div
                className="group flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-hover rounded cursor-pointer"
                onClick={() => onOpen(entry)}
                title={entry.label}
            >
                <i className={`${iconClassName} text-secondary`} />
                <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="truncate">{entry.label}</div>
                    {entry.sublabel && <div className="truncate text-[10px] text-secondary/70">{entry.sublabel}</div>}
                </div>
                {statusBadge}
                {tag && <span className="text-[10px] text-secondary/70">{tag}</span>}
                {onAdopt && (
                    <button
                        className="text-[11px] text-secondary hover:text-accent opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                            e.stopPropagation();
                            onAdopt(entry);
                        }}
                        title="adopt"
                    >
                        <i className="fa fa-plus" />
                    </button>
                )}
                {onEdit && (
                    <button
                        className="text-[11px] text-secondary hover:text-primary opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                            e.stopPropagation();
                            onEdit(entry);
                        }}
                        title="edit"
                    >
                        <i className="fa fa-pen" />
                    </button>
                )}
                {onDelete && (
                    <button
                        className="text-[11px] text-secondary hover:text-red-400 opacity-0 group-hover:opacity-100"
                        onClick={(e) => {
                            e.stopPropagation();
                            onDelete(entry);
                        }}
                        title="delete"
                    >
                        <i className="fa fa-trash" />
                    </button>
                )}
            </div>
        );
    }
);
ServerRow.displayName = "ServerRow";

const ServersPanel = memo(() => {
    const { t } = useTranslation();
    const localHostLabel = useAtomValue(getLocalHostDisplayNameAtom());
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const [connections, setConnections] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [newHost, setNewHost] = useState("");
    const [newUser, setNewUser] = useState("");
    const [newPort, setNewPort] = useState("");
    const [connectNow, setConnectNow] = useState(true);
    const [formMode, setFormMode] = useState<ConnectionFormMode>("add");
    const [editTargetConnection, setEditTargetConnection] = useState<string | null>(null);
    const [adding, setAdding] = useState(false);
    const [addError, setAddError] = useState<string | null>(null);
    const [pveRefreshing, setPveRefreshing] = useState(false);
    const [pveMachines, setPveMachines] = useState<PveMachineInfoLocal[] | null>(null);

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

    const refreshConnections = useCallback(() => {
        fireAndForget(loadConnections());
    }, [loadConnections]);

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
        fireAndForget(async () => {
            try {
                const result = await getApi().pveListMachines({ origin: DEFAULT_PVE_ORIGIN, timeoutMs: 12000 });
                if (result?.ok && Array.isArray(result.machines)) {
                    setPveMachines(result.machines as PveMachineInfoLocal[]);
                }
            } catch {
                // ignore silent bootstrap failures
            }
        });
    }, []);

    const localEntries = useMemo<ServerEntry[]>(() => [{ label: localHostLabel, source: "local" }], [localHostLabel]);

    const remoteEntries = useMemo<ServerEntry[]>(() => {
        const allConnectionNames = uniqNonBlank(connections)
            .filter((item) => !isBlank(item) && item !== "local" && !item.startsWith("wsl://"))
            .sort((a, b) => a.localeCompare(b));
        return allConnectionNames
            .filter((connection) => {
                const connConfig = fullConfig?.connections?.[connection] as ConnKeywords | undefined;
                return !Boolean((connConfig as any)?.["display:hidden"]);
            })
            .map((connection) => {
                const connConfig = fullConfig?.connections?.[connection] as ConnKeywords | undefined;
                const displayName = String((connConfig as any)?.["display:name"] ?? "").trim();
                return {
                    connection,
                    label: displayName || connection,
                    sublabel: displayName && displayName !== connection ? connection : undefined,
                    source: managedConnectionSet.has(connection) ? "managed" : "discovered",
                    pveVmid: getConnectionVmid(connConfig) || undefined,
                };
            });
    }, [connections, fullConfig, managedConnectionSet]);

    const managedEntries = useMemo(() => {
        const baseEntries = remoteEntries.filter((entry) => entry.source === "managed");
        if (pveMachines == null) {
            return baseEntries;
        }

        const bestByVmid = new Map<number, { entry: ServerEntry; score: number }>();
        for (const entry of baseEntries) {
            const connConfig = fullConfig?.connections?.[entry.connection ?? ""] as ConnKeywords | undefined;
            for (const machine of pveMachines) {
                if (!doesConnectionMatchMachine(entry.connection ?? "", connConfig, machine)) {
                    continue;
                }
                const score = scorePveEntry(entry, connConfig, machine);
                const prev = bestByVmid.get(machine.vmid);
                if (prev == null || score > prev.score) {
                    bestByVmid.set(machine.vmid, { entry, score });
                }
            }
        }

        const usedConnections = new Set<string>();
        const pveEntries = pveMachines
            .map((machine) => {
                const matched = bestByVmid.get(machine.vmid)?.entry;
                if (matched == null) {
                    return null;
                }
                usedConnections.add(matched.connection ?? "");
                return decorateEntryWithMachine(matched, fullConfig, pveMachines);
            })
            .filter((entry): entry is ServerEntry => entry != null);

        const unmatchedManaged = baseEntries
            .filter((entry) => !usedConnections.has(entry.connection ?? ""))
            .map((entry) => decorateEntryWithMachine(entry, fullConfig, pveMachines))
            .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }));

        return [...pveEntries, ...unmatchedManaged];
    }, [fullConfig, pveMachines, remoteEntries]);
    const discoveredEntries = useMemo(() => {
        if (pveMachines == null) {
            return [];
        }
        const baseDiscovered = remoteEntries.filter((entry) => entry.source === "discovered");
        const managedHosts = new Set<string>();
        const managedVmids = new Set<number>();

        for (const entry of managedEntries) {
            if (!isBlank(entry.connection)) {
                const connConfig = fullConfig?.connections?.[entry.connection ?? ""] as ConnKeywords | undefined;
                for (const host of getConnectionHostCandidates(entry.connection ?? "", connConfig)) {
                    managedHosts.add(host);
                }
            }
            if (entry.pveVmid) {
                managedVmids.add(entry.pveVmid);
            }
        }

        const filteredDiscovered = baseDiscovered
            .map((entry) => decorateEntryWithMachine(entry, fullConfig, pveMachines))
            .filter((entry) => {
                if (entry.pveMachine == null) {
                    return false;
                }
                const connConfig = fullConfig?.connections?.[entry.connection ?? ""] as ConnKeywords | undefined;
                const hosts = getConnectionHostCandidates(entry.connection ?? "", connConfig);
                if (hosts.some((host) => managedHosts.has(host))) {
                    return false;
                }
                if (entry.pveVmid && managedVmids.has(entry.pveVmid)) {
                    return false;
                }
                return true;
            });

        const bestByVmid = new Map<number, { entry: ServerEntry; score: number }>();
        for (const entry of filteredDiscovered) {
            if (!entry.pveMachine || !entry.pveVmid) {
                continue;
            }
            const connConfig = fullConfig?.connections?.[entry.connection ?? ""] as ConnKeywords | undefined;
            const score = scoreConnectionCandidate(entry.connection ?? "", connConfig, "discovered", entry.pveMachine);
            const prev = bestByVmid.get(entry.pveVmid);
            if (prev == null || score > prev.score) {
                bestByVmid.set(entry.pveVmid, { entry, score });
            }
        }

        return Array.from(bestByVmid.values())
            .map((item) => item.entry)
            .sort((a, b) => a.label.localeCompare(b.label));
    }, [fullConfig, managedEntries, pveMachines, remoteEntries]);

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

    const refreshFromPve = useCallback(() => {
        if (pveRefreshing) {
            return;
        }
        setPveRefreshing(true);
        fireAndForget(async () => {
            try {
                const result = await getApi().pveListMachines({ origin: DEFAULT_PVE_ORIGIN, timeoutMs: 12000 });
                if (!result?.ok) {
                    throw new Error(result?.error || t("common.error"));
                }
                const machines = Array.isArray(result.machines) ? result.machines : [];
                setPveMachines(machines as PveMachineInfoLocal[]);
                const existingConfigs = fullConfig?.connections ?? {};
                const existingByHost = new Map<string, string>();
                for (const [connName, connConfig] of Object.entries(existingConfigs)) {
                    if (isBlank(connName) || connName === "local" || connName.startsWith("wsl://")) {
                        continue;
                    }
                    const hostKey = getManagedConnectionHost(connName, connConfig as ConnKeywords);
                    if (hostKey !== "" && !existingByHost.has(hostKey)) {
                        existingByHost.set(hostKey, connName);
                    }
                }

                const connectionCandidates = uniqNonBlank([...Array.from(managedConnectionSet), ...connections])
                    .filter((connName) => !isBlank(connName) && connName !== "local" && !connName.startsWith("wsl://"))
                    .map((connName) => ({
                        connection: connName,
                        connConfig: existingConfigs[connName] as ConnKeywords | undefined,
                        source: managedConnectionSet.has(connName) ? ("managed" as const) : ("discovered" as const),
                    }));

                let updatedCount = 0;
                let createdCount = 0;
                let skippedCount = 0;

                for (const machine of machines) {
                    const ipHints = Array.isArray(machine.ipHints) ? machine.ipHints : [];
                    const sshHost = String(machine.sshHost ?? ipHints[0] ?? "").trim();
                    const matchedConnNameFromConfig = ipHints
                        .map((ipHint) => existingByHost.get(normalizeHostForMatch(ipHint)))
                        .find((value) => !isBlank(value));
                    const scoredCandidates = connectionCandidates
                        .filter((candidate) => doesConnectionMatchMachine(candidate.connection, candidate.connConfig, machine))
                        .map((candidate) => ({
                            connection: candidate.connection,
                            score: scoreConnectionCandidate(candidate.connection, candidate.connConfig, candidate.source, machine),
                        }))
                        .sort((a, b) => b.score - a.score);
                    const matchedConnName = scoredCandidates[0]?.connection ?? matchedConnNameFromConfig;
                    const connectionName = matchedConnName || sshHost;
                    if (isBlank(connectionName)) {
                        skippedCount += 1;
                        continue;
                    }
                    const nextMeta: Record<string, any> = {
                        "display:hidden": false,
                        "display:name": machine.name,
                        "pve:vmid": machine.vmid,
                        "pve:node": machine.node,
                        "pve:type": machine.type,
                    };
                    if (!isBlank(sshHost)) {
                        nextMeta["ssh:hostname"] = sshHost;
                    }
                    await RpcApi.SetConnectionsConfigCommand(
                        TabRpcClient,
                        { host: connectionName, metamaptype: nextMeta },
                        { timeout: 60000 }
                    );
                    if (matchedConnName) {
                        updatedCount += 1;
                    } else {
                        createdCount += 1;
                    }
                }

                await loadConnections();
                const now = Date.now();
                pushNotification({
                    icon: "server",
                    title: t("connection.pveRefreshDoneTitle"),
                    message: t("connection.pveRefreshDoneMessage", {
                        updated: updatedCount,
                        created: createdCount,
                        skipped: skippedCount,
                    }),
                    timestamp: new Date(now).toISOString(),
                    expiration: now + 2600,
                    type: "info",
                });
            } catch (e) {
                const now = Date.now();
                pushNotification({
                    icon: "triangle-exclamation",
                    title: t("connection.pveRefreshFailedTitle"),
                    message: `${e}`,
                    timestamp: new Date(now).toISOString(),
                    expiration: now + 3200,
                    type: "error",
                });
            } finally {
                setPveRefreshing(false);
            }
        });
    }, [connections, fullConfig, loadConnections, managedConnectionSet, pveRefreshing, t]);

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
                    label: t("connection.refreshFromPve"),
                    click: refreshFromPve,
                },
                {
                    type: "separator",
                },
                {
                    label: t("common.retry"),
                    click: refreshConnections,
                },
            ];
            ContextMenuModel.showContextMenu(menu, e);
        },
        [openAddModal, openConnectionsEditor, refreshConnections, refreshFromPve, t]
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
                        className="text-xs text-secondary hover:text-primary cursor-pointer"
                        onClick={openAddModal}
                        title={t("connection.addServer")}
                    >
                        <i className="fa fa-plus" />
                    </div>
                    <div
                        className="text-xs text-secondary hover:text-primary cursor-pointer"
                        onClick={refreshFromPve}
                        title={t("connection.refreshFromPve")}
                    >
                        <i className={pveRefreshing ? "fa fa-spinner fa-spin" : "fa fa-network-wired"} />
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
                ) : remoteEntries.length === 0 ? (
                    <div className="text-xs text-secondary px-2 py-2">{t("connection.noRemoteConnections")}</div>
                ) : (
                    <>
                        <div className="px-1 pt-1 pb-1 text-[10px] text-secondary/80 uppercase tracking-wide">
                            {t("connection.managedRemotes")}
                        </div>
                        {managedEntries.length === 0 ? (
                            <div className="text-xs text-secondary px-2 py-2">{t("connection.noManagedConnections")}</div>
                        ) : (
                            managedEntries.map((entry) => (
                                <ServerRow
                                    key={`managed-${entry.connection ?? entry.label}`}
                                    entry={entry}
                                    iconClassName="fa fa-server"
                                    onOpen={openServer}
                                    onEdit={openEditModal}
                                    onDelete={handleDeleteServer}
                                />
                            ))
                        )}

                        <div className="px-1 pt-3 pb-1 text-[10px] text-secondary/80 uppercase tracking-wide">
                            {t("connection.discoveredRemotes")}
                        </div>
                        {discoveredEntries.length === 0 ? (
                            <div className="text-xs text-secondary px-2 py-2">{t("connection.noDiscoveredConnections")}</div>
                        ) : (
                            discoveredEntries.map((entry) => (
                                <ServerRow
                                    key={`discovered-${entry.connection ?? entry.label}`}
                                    entry={entry}
                                    iconClassName="fa fa-magnifying-glass"
                                    tag={t("connection.discoveredTag")}
                                    onOpen={openServer}
                                    onAdopt={openAdoptModal}
                                />
                            ))
                        )}
                    </>
                )}
            </div>

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

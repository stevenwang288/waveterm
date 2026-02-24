// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { Modal } from "@/app/modals/modal";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { atoms, createBlock, getLocalHostDisplayNameAtom } from "@/store/global";
import { fireAndForget, isBlank } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type RemoteSource = "managed" | "discovered";

type ServerEntry = {
    connection?: string;
    label: string;
    source: "local" | RemoteSource;
};

type ConnectionFormMode = "add" | "edit" | "adopt";

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

    const localEntries = useMemo<ServerEntry[]>(() => [{ label: localHostLabel, source: "local" }], [localHostLabel]);

    const remoteEntries = useMemo<ServerEntry[]>(() => {
        return connections
            .filter((item) => !isBlank(item) && item !== "local")
            .sort((a, b) => a.localeCompare(b))
            .map((connection) => ({
                connection,
                label: connection,
                source: managedConnectionSet.has(connection) ? "managed" : "discovered",
            }));
    }, [connections, managedConnectionSet]);

    const managedEntries = useMemo(() => remoteEntries.filter((entry) => entry.source === "managed"), [remoteEntries]);
    const discoveredEntries = useMemo(
        () => remoteEntries.filter((entry) => entry.source === "discovered"),
        [remoteEntries]
    );

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
                    type: "separator",
                },
                {
                    label: t("common.retry"),
                    click: refreshConnections,
                },
            ];
            ContextMenuModel.showContextMenu(menu, e);
        },
        [openAddModal, openConnectionsEditor, refreshConnections, t]
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
                                <div
                                    key={`managed-${entry.label}`}
                                    className="group flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-hover rounded cursor-pointer"
                                    onClick={() => openServer(entry)}
                                    title={entry.label}
                                >
                                    <i className="fa fa-server text-secondary" />
                                    <span className="truncate flex-1 min-w-0">{entry.label}</span>
                                    <button
                                        className="text-[11px] text-secondary hover:text-primary opacity-0 group-hover:opacity-100"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            openEditModal(entry);
                                        }}
                                        title={t("connection.editServer")}
                                    >
                                        <i className="fa fa-pen" />
                                    </button>
                                    <button
                                        className="text-[11px] text-secondary hover:text-red-400 opacity-0 group-hover:opacity-100"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteServer(entry);
                                        }}
                                        title={t("common.delete")}
                                    >
                                        <i className="fa fa-trash" />
                                    </button>
                                </div>
                            ))
                        )}

                        <div className="px-1 pt-3 pb-1 text-[10px] text-secondary/80 uppercase tracking-wide">
                            {t("connection.discoveredRemotes")}
                        </div>
                        {discoveredEntries.length === 0 ? (
                            <div className="text-xs text-secondary px-2 py-2">{t("connection.noDiscoveredConnections")}</div>
                        ) : (
                            discoveredEntries.map((entry) => (
                                <div
                                    key={`discovered-${entry.label}`}
                                    className="group flex items-center gap-2 px-2 py-1.5 text-sm hover:bg-hover rounded cursor-pointer"
                                    onClick={() => openServer(entry)}
                                    title={entry.label}
                                >
                                    <i className="fa fa-magnifying-glass text-secondary" />
                                    <span className="truncate flex-1 min-w-0">{entry.label}</span>
                                    <span className="text-[10px] text-secondary/70">{t("connection.discoveredTag")}</span>
                                    <button
                                        className="text-[11px] text-secondary hover:text-accent opacity-0 group-hover:opacity-100"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            openAdoptModal(entry);
                                        }}
                                        title={t("connection.addToManagedList")}
                                    >
                                        <i className="fa fa-plus" />
                                    </button>
                                </div>
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

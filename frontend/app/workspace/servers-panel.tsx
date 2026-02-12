// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { Modal } from "@/app/modals/modal";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { createBlock, getLocalHostDisplayNameAtom } from "@/store/global";
import { fireAndForget, isBlank } from "@/util/util";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type ServerEntry = {
    connection?: string;
    label: string;
};

const ServersPanel = memo(() => {
    const { t } = useTranslation();
    const localHostLabel = useAtomValue(getLocalHostDisplayNameAtom());
    const [connections, setConnections] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [newHost, setNewHost] = useState("");
    const [newUser, setNewUser] = useState("");
    const [newPort, setNewPort] = useState("");
    const [connectNow, setConnectNow] = useState(true);
    const [adding, setAdding] = useState(false);
    const [addError, setAddError] = useState<string | null>(null);

    const refreshConnections = useCallback(() => {
        setLoading(true);
        fireAndForget(async () => {
            try {
                const list = await RpcApi.ConnListCommand(TabRpcClient, { timeout: 2000 });
                setConnections(Array.isArray(list) ? list : []);
            } catch {
                setConnections([]);
            } finally {
                setLoading(false);
            }
        });
    }, []);

    useEffect(() => {
        refreshConnections();
    }, [refreshConnections]);

    const localEntries = useMemo<ServerEntry[]>(() => [{ label: localHostLabel }], [localHostLabel]);

    const remoteEntries = useMemo<ServerEntry[]>(() => {
        return connections
            .filter((item) => !isBlank(item) && item !== "local")
            .sort((a, b) => a.localeCompare(b))
            .map((connection) => ({ connection, label: connection }));
    }, [connections]);

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
                    click: () => setShowAddModal(true),
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
        [openConnectionsEditor, refreshConnections, t]
    );

    const handleAddServer = useCallback(() => {
        const host = newHost.trim();
        const user = newUser.trim();
        const port = newPort.trim();
        if (isBlank(host)) {
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
                await RpcApi.SetConnectionsConfigCommand(TabRpcClient, { host, metamaptype: meta }, { timeout: 60000 });
                refreshConnections();
                setShowAddModal(false);

                if (connectNow) {
                    try {
                        await RpcApi.ConnEnsureCommand(TabRpcClient, { connname: host }, { timeout: 60000 });
                    } catch (e) {
                        console.warn("error ensuring connection", host, e);
                    }
                }
            } catch (e) {
                setAddError(`${e}`);
            } finally {
                setAdding(false);
            }
        });
    }, [connectNow, newHost, newPort, newUser, refreshConnections, t]);

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
                        onClick={() => setShowAddModal(true)}
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
                    remoteEntries.map((entry) => (
                        <div
                            key={entry.label}
                            className="flex items-center px-2 py-1.5 text-sm hover:bg-hover rounded cursor-pointer"
                            onClick={() => openServer(entry)}
                            title={entry.label}
                        >
                            <i className="fa fa-server mr-2 text-secondary" />
                            <span className="truncate">{entry.label}</span>
                        </div>
                    ))
                )}
            </div>

            {showAddModal && (
                <Modal
                    className="pt-6 pb-4 px-5"
                    okLabel={t("common.ok")}
                    cancelLabel={t("common.cancel")}
                    onOk={handleAddServer}
                    onCancel={closeAddModal}
                    onClose={closeAddModal}
                    okDisabled={adding || isBlank(newHost.trim())}
                    cancelDisabled={adding}
                >
                    <div className="font-bold text-primary mx-4 pb-2.5">{t("connection.addServer")}</div>
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

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
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

    return (
        <div className="flex flex-col h-full bg-zinc-950 border-r border-zinc-800 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 flex-shrink-0">
                <div className="flex items-center gap-2">
                    <i className="fas fa-laptop text-accent" />
                    <span className="text-sm font-semibold">{t("workspace.servers")}</span>
                </div>
                <div
                    className="text-xs text-secondary hover:text-primary cursor-pointer"
                    onClick={refreshConnections}
                    title={t("common.retry")}
                >
                    <i className="fa fa-rotate-right" />
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
        </div>
    );
});

ServersPanel.displayName = "ServersPanel";

export { ServersPanel };

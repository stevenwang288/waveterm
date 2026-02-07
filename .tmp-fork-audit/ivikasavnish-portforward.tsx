// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Button } from "@/app/element/button";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn, fireAndForget } from "@/util/util";
import * as React from "react";
import { Modal } from "./modal";

import "./portforward.scss";

interface PortForwardModalProps {
    connName: string;
    onClose: () => void;
}

interface PortForwardFormData {
    type: string;
    localHost: string;
    localPort: string;
    remoteHost: string;
    remotePort: string;
    description: string;
    autoStart: boolean;
    persistent: boolean;
}

export function PortForwardModal({ connName, onClose }: PortForwardModalProps) {
    const [forwards, setForwards] = React.useState<PortForwardStatus[]>([]);
    const [isLoading, setIsLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [showAddForm, setShowAddForm] = React.useState(false);
    const [formData, setFormData] = React.useState<PortForwardFormData>({
        type: "local",
        localHost: "localhost",
        localPort: "",
        remoteHost: "localhost",
        remotePort: "",
        description: "",
        autoStart: false,
        persistent: false,
    });

    const getErrorMessage = (err: unknown): string => {
        if (err instanceof Error) {
            return err.message;
        }
        if (typeof err === "string") {
            return err;
        }
        return String(err);
    };

    const loadForwards = React.useCallback(async () => {
        try {
            setIsLoading(true);
            setError(null);
            const result = await RpcApi.PortForwardListCommand(TabRpcClient, { connname: connName });
            setForwards(result || []);
        } catch (err) {
            setError(getErrorMessage(err) || "Failed to load port forwards");
        } finally {
            setIsLoading(false);
        }
    }, [connName]);

    React.useEffect(() => {
        loadForwards();
    }, [loadForwards]);

    const handleAddForward = async () => {
        try {
            setError(null);
            const localPort = parseInt(formData.localPort, 10);
            const remotePort = parseInt(formData.remotePort, 10);

            if (isNaN(localPort) || localPort <= 0) {
                setError("Local port must be a positive number");
                return;
            }
            if (formData.type !== "dynamic" && (isNaN(remotePort) || remotePort <= 0)) {
                setError("Remote port must be a positive number");
                return;
            }

            await RpcApi.PortForwardStartCommand(TabRpcClient, {
                connname: connName,
                type: formData.type,
                localhost: formData.localHost || "localhost",
                localport: localPort,
                remotehost: formData.remoteHost || "localhost",
                remoteport: remotePort || 0,
                description: formData.description,
                autostart: formData.autoStart,
                persistent: formData.persistent,
            });

            setShowAddForm(false);
            setFormData({
                type: "local",
                localHost: "localhost",
                localPort: "",
                remoteHost: "localhost",
                remotePort: "",
                description: "",
                autoStart: false,
                persistent: false,
            });
            await loadForwards();
        } catch (err) {
            setError(getErrorMessage(err) || "Failed to add port forward");
        }
    };

    const handleStopForward = async (forwardId: string) => {
        try {
            setError(null);
            await RpcApi.PortForwardStopCommand(TabRpcClient, {
                connname: connName,
                forwardid: forwardId,
            });
            await loadForwards();
        } catch (err) {
            setError(getErrorMessage(err) || "Failed to stop port forward");
        }
    };

    const formatBytes = (bytes: number): string => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const getStatusColor = (status: string): string => {
        switch (status) {
            case "active":
                return "text-success";
            case "connecting":
                return "text-warning";
            case "error":
                return "text-error";
            default:
                return "text-muted";
        }
    };

    const getForwardDescription = (fwd: PortForwardStatus): string => {
        if (fwd.type === "local") {
            return `${fwd.localhost || "localhost"}:${fwd.localport} → ${fwd.remotehost || "localhost"}:${fwd.remoteport}`;
        } else if (fwd.type === "remote") {
            return `${fwd.remotehost || "localhost"}:${fwd.remoteport} ← ${fwd.localhost || "localhost"}:${fwd.localport}`;
        } else {
            return `SOCKS5 on ${fwd.localhost || "localhost"}:${fwd.localport}`;
        }
    };

    return (
        <Modal className="port-forward-modal" onClose={onClose} onClickBackdrop={onClose}>
            <div className="port-forward-modal-content">
                <h2 className="modal-title">Port Forwarding</h2>
                <p className="modal-subtitle">Connection: {connName}</p>

                {error && <div className="error-message">{error}</div>}

                {!showAddForm && (
                    <div className="actions-row">
                        <Button onClick={() => setShowAddForm(true)}>
                            <i className="fa-sharp fa-solid fa-plus"></i> Add Forward
                        </Button>
                        <Button className="grey ghost" onClick={loadForwards} disabled={isLoading}>
                            <i className={cn("fa-sharp fa-solid fa-refresh", isLoading && "fa-spin")}></i>
                        </Button>
                    </div>
                )}

                {showAddForm && (
                    <div className="add-form">
                        <h3>New Port Forward</h3>
                        <div className="form-row">
                            <label>Type</label>
                            <select
                                value={formData.type}
                                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                            >
                                <option value="local">Local (L → R)</option>
                                <option value="remote">Remote (R → L)</option>
                                <option value="dynamic">Dynamic (SOCKS5)</option>
                            </select>
                        </div>

                        <div className="form-row">
                            <label>Local Host</label>
                            <input
                                type="text"
                                value={formData.localHost}
                                onChange={(e) => setFormData({ ...formData, localHost: e.target.value })}
                                placeholder="localhost"
                            />
                        </div>

                        <div className="form-row">
                            <label>Local Port</label>
                            <input
                                type="number"
                                value={formData.localPort}
                                onChange={(e) => setFormData({ ...formData, localPort: e.target.value })}
                                placeholder="8080"
                                min="1"
                                max="65535"
                            />
                        </div>

                        {formData.type !== "dynamic" && (
                            <>
                                <div className="form-row">
                                    <label>Remote Host</label>
                                    <input
                                        type="text"
                                        value={formData.remoteHost}
                                        onChange={(e) => setFormData({ ...formData, remoteHost: e.target.value })}
                                        placeholder="localhost"
                                    />
                                </div>

                                <div className="form-row">
                                    <label>Remote Port</label>
                                    <input
                                        type="number"
                                        value={formData.remotePort}
                                        onChange={(e) => setFormData({ ...formData, remotePort: e.target.value })}
                                        placeholder="80"
                                        min="1"
                                        max="65535"
                                    />
                                </div>
                            </>
                        )}

                        <div className="form-row">
                            <label>Description</label>
                            <input
                                type="text"
                                value={formData.description}
                                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                                placeholder="Optional description"
                            />
                        </div>

                        <div className="form-row checkbox">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={formData.autoStart}
                                    onChange={(e) => setFormData({ ...formData, autoStart: e.target.checked })}
                                />
                                Auto-start on connection
                            </label>
                        </div>

                        <div className="form-row checkbox">
                            <label>
                                <input
                                    type="checkbox"
                                    checked={formData.persistent}
                                    onChange={(e) => setFormData({ ...formData, persistent: e.target.checked })}
                                />
                                Persist across sessions
                            </label>
                        </div>

                        <div className="form-actions">
                            <Button className="grey ghost" onClick={() => setShowAddForm(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleAddForward}>Add Forward</Button>
                        </div>
                    </div>
                )}

                {!showAddForm && (
                    <div className="forwards-list">
                        {isLoading && forwards.length === 0 && (
                            <div className="loading">Loading...</div>
                        )}
                        {!isLoading && forwards.length === 0 && (
                            <div className="empty-state">No port forwards configured</div>
                        )}
                        {forwards.map((fwd) => (
                            <div key={fwd.id} className="forward-item">
                                <div className="forward-info">
                                    <div className="forward-description">
                                        <span className={cn("status-indicator", getStatusColor(fwd.status))}>●</span>
                                        <span className="forward-type">[{fwd.type}]</span>
                                        <span className="forward-mapping">{getForwardDescription(fwd)}</span>
                                    </div>
                                    {fwd.description && (
                                        <div className="forward-note">{fwd.description}</div>
                                    )}
                                    <div className="forward-stats">
                                        <span>↑ {formatBytes(fwd.bytessent)}</span>
                                        <span>↓ {formatBytes(fwd.bytesrecv)}</span>
                                        <span>{fwd.connections} connections</span>
                                    </div>
                                </div>
                                <div className="forward-actions">
                                    <Button
                                        className="ghost danger small"
                                        onClick={() => handleStopForward(fwd.id)}
                                        title="Stop forward"
                                    >
                                        <i className="fa-sharp fa-solid fa-stop"></i>
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </Modal>
    );
}

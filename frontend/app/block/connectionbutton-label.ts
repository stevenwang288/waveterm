// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export function getTerminalConnectionLabelPresentation(isLocal: boolean): {
    align: "left" | "right";
    className: string;
} {
    if (isLocal) {
        return {
            align: "right",
            className: "text-muted group-hover:text-secondary",
        };
    }
    return {
        align: "left",
        className: "text-green-500 group-hover:text-green-400",
    };
}

export function getTerminalConnectionDisplayLabel({
    isLocal,
    connection,
    connectionDisplayName,
    terminalLabel,
}: {
    isLocal: boolean;
    connection: string;
    connectionDisplayName?: string;
    terminalLabel?: string;
}): string {
    const pathLabel = String(terminalLabel ?? "").trim();
    if (isLocal) {
        return pathLabel;
    }
    const baseLabel = String(connectionDisplayName ?? "").trim() || String(connection ?? "").trim();
    return pathLabel || baseLabel;
}

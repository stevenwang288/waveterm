// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as util from "@/util/util";

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
    const baseLabel = String(connectionDisplayName ?? "").trim() || String(connection ?? "").trim();
    const pathLabel = String(terminalLabel ?? "").trim();
    if (isLocal) {
        return pathLabel || baseLabel;
    }
    if (util.isBlank(baseLabel)) {
        return pathLabel;
    }
    if (util.isBlank(pathLabel) || pathLabel === baseLabel) {
        return baseLabel;
    }
    return `${baseLabel} · ${pathLabel}`;
}

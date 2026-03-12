// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isBlank } from "@/util/util";

export const DEFAULT_PVE_ORIGIN = "https://192.168.1.250:8006";

export type TermModeType = "term" | "vdom" | "web" | "websplit";
export type RemoteGuiSplitPane = "term" | "gui";
export type RemoteGuiModeTransitionStrategy = "noop" | "switch-immediately" | "prepare-first";

type RemoteGuiConnConfig = Record<string, unknown> | null | undefined;

function normalizeConnectionName(connName: string): string {
    return String(connName ?? "").trim();
}

function normalizeHostCandidate(value: string): string {
    return String(value ?? "").trim().toLowerCase();
}

export function getConnectionHostGuess(connName: string, connConfig?: RemoteGuiConnConfig): string {
    const explicitHost = normalizeHostCandidate(String(connConfig?.["ssh:hostname"] ?? ""));
    if (explicitHost) {
        return explicitHost;
    }
    const normalizedConn = normalizeConnectionName(connName);
    if (!normalizedConn) {
        return "";
    }
    const sshUriMatch = normalizedConn.match(/^ssh:\/\/([^@/]+@)?([^:/?#]+)(?::\d+)?/i);
    if (sshUriMatch?.[2]) {
        return normalizeHostCandidate(sshUriMatch[2]);
    }
    const atIdx = normalizedConn.lastIndexOf("@");
    if (atIdx >= 0 && atIdx < normalizedConn.length - 1) {
        return normalizeHostCandidate(normalizedConn.slice(atIdx + 1));
    }
    return normalizeHostCandidate(normalizedConn);
}

function looksLikePrivateHost(host: string): boolean {
    const normalized = normalizeHostCandidate(host);
    if (!normalized) {
        return false;
    }
    if (normalized === "localhost" || normalized.endsWith(".local")) {
        return false;
    }
    if (/^10\.\d+\.\d+\.\d+$/.test(normalized)) {
        return true;
    }
    if (/^192\.168\.\d+\.\d+$/.test(normalized)) {
        return true;
    }
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(normalized)) {
        return true;
    }
    return false;
}

export function shouldShowRemoteGuiButton(connName: string): boolean {
    const normalized = normalizeConnectionName(connName);
    return normalized !== "" && normalized !== "local" && !normalized.startsWith("wsl://");
}

export function hasConfiguredRemoteGuiTarget(connConfig?: RemoteGuiConnConfig): boolean {
    if (Number(connConfig?.["pve:vmid"] ?? 0) > 0) {
        return true;
    }
    const configuredUrl = String(connConfig?.["conn:guiurl"] ?? "").trim();
    return !isBlank(configuredUrl) && !configuredUrl.startsWith(DEFAULT_PVE_ORIGIN);
}

export function shouldAttemptPveDiscovery(connName: string, connConfig?: RemoteGuiConnConfig): boolean {
    if (!shouldShowRemoteGuiButton(connName) || hasConfiguredRemoteGuiTarget(connConfig)) {
        return false;
    }
    const hostGuess = getConnectionHostGuess(connName, connConfig);
    return looksLikePrivateHost(hostGuess);
}

export function getNextRemoteGuiMode(termMode: TermModeType): TermModeType {
    if (termMode === "web") {
        return "websplit";
    }
    if (termMode === "websplit") {
        return "term";
    }
    return "web";
}

export function getRemoteGuiModeTransitionStrategy(params: {
    currentMode: TermModeType;
    targetMode: Extract<TermModeType, "web" | "websplit">;
    guiBlockId: string | null | undefined;
}): RemoteGuiModeTransitionStrategy {
    if (params.currentMode === params.targetMode) {
        return "noop";
    }
    if (!isBlank(String(params.guiBlockId ?? "").trim())) {
        return "switch-immediately";
    }
    return "prepare-first";
}

export function clampRemoteGuiSplitPct(value: number | null | undefined): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 0.5;
    }
    return Math.min(0.8, Math.max(0.2, numeric));
}

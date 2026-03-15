// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isBlank } from "@/util/util";

export type RemoteSource = "managed" | "discovered";

export type PveMachineInfoLocal = {
    vmid: number;
    node: string;
    type: "qemu" | "lxc";
    name: string;
    status?: string;
    sshHost?: string;
    ipHints?: string[];
};

type ReconcilePveConnectionsParams = {
    machines: PveMachineInfoLocal[];
    fullConfig: FullConfigType | null;
    managedConnectionSet: Set<string>;
    connections: string[];
    setConnectionConfig: (host: string, metamaptype: Record<string, any>) => Promise<void>;
};

type ReconcilePveConnectionsResult = {
    updatedCount: number;
    createdCount: number;
    skippedCount: number;
};

function normalizePort(rawPort: string): string {
    const port = rawPort.trim();
    if (port === "" || port === "22") {
        return "";
    }
    return port;
}

export function parseConnectionName(connection: string): { host: string; user: string; port: string } {
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

export function buildConnectionName(host: string, user: string, port: string): string {
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

export function normalizeHostForMatch(host: string): string {
    return host.trim().replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

export function uniqNonBlank(values: string[]): string[] {
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

export function compareServerLabels(left: string, right: string): number {
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

export function compareServerEntries(
    left: { label: string; connection?: string },
    right: { label: string; connection?: string }
): number {
    const labelResult = compareServerLabels(left.label, right.label);
    if (labelResult !== 0) {
        return labelResult;
    }
    return compareServerLabels(String(left.connection ?? ""), String(right.connection ?? ""));
}

function extractIpv4Hints(value: string): string[] {
    const matches = String(value ?? "").match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
    return uniqNonBlank(matches.map((item) => normalizeHostForMatch(item)));
}

export function getManagedConnectionHost(connection: string, connConfig?: ConnKeywords): string {
    const explicitHost = String(connConfig?.["ssh:hostname"] ?? "").trim();
    if (explicitHost !== "") {
        return normalizeHostForMatch(explicitHost);
    }
    return normalizeHostForMatch(parseConnectionName(connection).host);
}

export function getConnectionVmid(connConfig?: ConnKeywords): number {
    const vmid = Number((connConfig as any)?.["pve:vmid"] ?? 0);
    return Number.isFinite(vmid) && vmid > 0 ? vmid : 0;
}

export function getConnectionHostCandidates(connection: string, connConfig?: ConnKeywords): string[] {
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

export function doesConnectionMatchMachine(
    connection: string,
    connConfig: ConnKeywords | undefined,
    machine: PveMachineInfoLocal
): boolean {
    if (getConnectionVmid(connConfig) === machine.vmid) {
        return true;
    }
    const connHosts = new Set(getConnectionHostCandidates(connection, connConfig));
    const machineHosts = getMachineHostCandidates(machine);
    return machineHosts.some((host) => connHosts.has(host));
}

function scorePveEntry(
    connection: string,
    connConfig: ConnKeywords | undefined,
    displayName: string,
    machine: PveMachineInfoLocal
): number {
    let score = 0;
    const configDisplayName = String((connConfig as any)?.["display:name"] ?? "").trim();
    const host = getManagedConnectionHost(connection, connConfig);
    const sshHost = normalizeHostForMatch(machine.sshHost ?? "");
    const ipHints = new Set((Array.isArray(machine.ipHints) ? machine.ipHints : []).map((ip) => normalizeHostForMatch(ip)));

    if (configDisplayName === machine.name || displayName === machine.name) {
        score += 100;
    }
    if (host !== "" && (host === sshHost || ipHints.has(host))) {
        score += 40;
    }
    if (!/\s/.test(connection)) {
        score += 15;
    }
    if (connection.includes(" codex")) {
        score -= 30;
    }
    if (String((connConfig as any)?.["cmd:initscript.sh"] ?? "").trim() !== "") {
        score -= 10;
    }
    if (String((connConfig as any)?.["cmd:initscript.pwsh"] ?? "").trim() !== "") {
        score -= 10;
    }
    score -= connection.length / 1000;
    return score;
}

function scoreConnectionCandidate(
    connection: string,
    connConfig: ConnKeywords | undefined,
    source: RemoteSource,
    machine: PveMachineInfoLocal
): number {
    let score = scorePveEntry(connection, connConfig, connection, machine);
    if (source === "managed") {
        score += 25;
    }
    if (!isBlank(parseConnectionName(connection).user) || !isBlank(String(connConfig?.["ssh:user"] ?? ""))) {
        score += 5;
    }
    return score;
}

export async function reconcilePveConnections({
    machines,
    fullConfig,
    managedConnectionSet,
    connections,
    setConnectionConfig,
}: ReconcilePveConnectionsParams): Promise<ReconcilePveConnectionsResult> {
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
            "pve:name": machine.name,
            "pve:vmid": machine.vmid,
            "pve:node": machine.node,
            "pve:type": machine.type,
        };
        if (!isBlank(sshHost)) {
            nextMeta["ssh:hostname"] = sshHost;
        }
        await setConnectionConfig(connectionName, nextMeta);
        if (matchedConnName) {
            updatedCount += 1;
        } else {
            createdCount += 1;
        }
    }

    return { updatedCount, createdCount, skippedCount };
}

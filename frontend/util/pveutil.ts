// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isBlank } from "@/util/util";
import { waveFetchJson } from "@/util/wavefetch";

export type PveVmInfo = {
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

type VmCache = {
    ts: number;
    inFlight: Promise<PveVmInfo[]> | null;
    vms: PveVmInfo[] | null;
};

const vmCache: VmCache = {
    ts: 0,
    inFlight: null,
    vms: null,
};

const VM_CACHE_TTL_MS = 20_000;
const MAX_VMS = 200;

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

async function fetchAllVms(): Promise<PveVmInfo[]> {
    const now = Date.now();
    if (vmCache.vms && now - vmCache.ts < VM_CACHE_TTL_MS) {
        return vmCache.vms;
    }
    if (vmCache.inFlight) {
        return vmCache.inFlight;
    }
    vmCache.inFlight = (async () => {
        const usp = new URLSearchParams();
        usp.set("runningOnly", "0");
        usp.set("max", String(MAX_VMS));
        const vms = await waveFetchJson<PveVmInfo[]>(`/wave/pve/vms?${usp.toString()}`);
        vmCache.ts = Date.now();
        vmCache.vms = Array.isArray(vms) ? vms : [];
        vmCache.inFlight = null;
        return vmCache.vms;
    })().catch((e) => {
        vmCache.inFlight = null;
        throw e;
    });
    return vmCache.inFlight;
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

export async function resolvePveVmForConnection(connName: string, sshHostName?: string): Promise<PveVmInfo | null> {
    if (isBlank(connName)) {
        return null;
    }
    const vms = await fetchAllVms();
    return resolveVmFromList(vms, connName, sshHostName);
}

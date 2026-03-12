// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as electron from "electron";
import fs from "fs";
import * as http from "node:http";
import * as https from "node:https";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as path from "path";
import { promisify } from "node:util";
import { URL } from "node:url";
import WebSocket, { WebSocketServer } from "ws";
import { getWaveConfigDir } from "./emain-platform";

const DEFAULT_PVE_AUTOLOGIN_HOSTS = new Set(["192.168.1.250", "192.168.1.250:8006"]);
const PVE_AUTH_COOKIE_NAME = "PVEAuthCookie";
const PVE_DEFAULT_REALM = "pam";

const PVE_CREDENTIALS_FILE_NAME = "pve-auth.json";
const PVE_CONSOLE_PROXY_TTL_MS = 2 * 60 * 1000;

const PVE_AUTOLOGIN_USERNAME_ENV = "WAVETERM_PVE_AUTOLOGIN_USERNAME";
const PVE_AUTOLOGIN_PASSWORD_ENV = "WAVETERM_PVE_AUTOLOGIN_PASSWORD";
const PVE_AUTOLOGIN_JSON_ENV = "WAVETERM_PVE_AUTOLOGIN_JSON";
const execFileAsync = promisify(execFile);

export type PveListMachinesRequest = {
    origin?: string;
    timeoutMs?: number;
};

export type PveCreateConsoleSessionRequest = {
    origin?: string;
    node: string;
    vmid: number;
    type: "qemu" | "lxc";
    name?: string;
    timeoutMs?: number;
};

export type PveMachineInfo = {
    vmid: number;
    node: string;
    type: "qemu" | "lxc";
    name: string;
    status?: string;
    sshHost?: string;
    ipHints?: string[];
};

export type PveListMachinesResult = {
    ok: boolean;
    error?: string;
    machines?: PveMachineInfo[];
};

export type PveCreateConsoleSessionResult = {
    ok: boolean;
    websocketUrl?: string;
    password?: string;
    ticket?: string;
    port?: number;
    origin?: string;
    node?: string;
    vmid?: number;
    type?: "qemu" | "lxc";
    name?: string;
    error?: string;
};

type StoredPveCredEntryV1 = {
    username: string;
    passwordCiphertext: string;
    updatedTs: number;
};

type StoredPveCredsFileV1 = {
    version: 1;
    entries: Record<string, StoredPveCredEntryV1>;
};

type PveTicketLoginResult = {
    origin: string;
    ticket: string;
    csrfPreventionToken: string;
    username: string;
};

type PendingPveConsoleProxySession = {
    upstreamUrl: string;
    authCookie: string;
    origin: string;
    createdAt: number;
};

let pveConsoleProxyServer: http.Server | null = null;
let pveConsoleProxyWss: WebSocketServer | null = null;
let pveConsoleProxyPort: number | null = null;
let pveConsoleProxyReadyPromise: Promise<number> | null = null;
const pendingPveConsoleProxySessions = new Map<string, PendingPveConsoleProxySession>();

function normalizeHostToken(value: string): string {
    return String(value ?? "").trim().toLowerCase();
}

function getHostLookupKeys(value: string): string[] {
    const seen = new Set<string>();
    const keys: string[] = [];
    const push = (candidate: string) => {
        const normalized = normalizeHostToken(candidate);
        if (!normalized || seen.has(normalized)) {
            return;
        }
        seen.add(normalized);
        keys.push(normalized);
    };

    const raw = String(value ?? "").trim();
    if (!raw) {
        return keys;
    }

    push(raw);
    try {
        const url = raw.includes("://") ? new URL(raw) : new URL(`https://${raw}`);
        push(url.host);
        push(url.hostname);
    } catch {
        const portless = raw.replace(/:\d+$/, "");
        push(portless);
    }

    return keys;
}

function normalizeOrigin(value: string): string {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) {
        return "";
    }
    try {
        const u = new URL(trimmed);
        return `${u.protocol}//${u.host}`;
    } catch {
        return "";
    }
}

function cleanupExpiredPveConsoleProxySessions(now: number = Date.now()): void {
    const cutoff = now - PVE_CONSOLE_PROXY_TTL_MS;
    for (const [sessionId, session] of pendingPveConsoleProxySessions.entries()) {
        if (session.createdAt < cutoff) {
            pendingPveConsoleProxySessions.delete(sessionId);
        }
    }
}

function closeWebSocketQuietly(socket: WebSocket | null | undefined): void {
    if (socket == null) {
        return;
    }
    try {
        socket.close();
    } catch {
        // ignore close failures during proxy teardown
    }
}

function attachPveConsoleProxy(clientSocket: WebSocket, session: PendingPveConsoleProxySession): void {
    const upstreamSocket = new WebSocket(session.upstreamUrl, ["binary"], {
        rejectUnauthorized: false,
        perMessageDeflate: false,
        headers: {
            Cookie: `${PVE_AUTH_COOKIE_NAME}=${session.authCookie}`,
            Origin: session.origin,
        },
    });

    clientSocket.on("message", (data, isBinary) => {
        if (upstreamSocket.readyState === WebSocket.OPEN) {
            upstreamSocket.send(data, { binary: isBinary });
        }
    });
    clientSocket.on("close", () => closeWebSocketQuietly(upstreamSocket));
    clientSocket.on("error", () => closeWebSocketQuietly(upstreamSocket));

    upstreamSocket.on("message", (data, isBinary) => {
        if (clientSocket.readyState === WebSocket.OPEN) {
            clientSocket.send(data, { binary: isBinary });
        }
    });
    upstreamSocket.on("close", () => closeWebSocketQuietly(clientSocket));
    upstreamSocket.on("error", (error) => {
        console.warn("pve console upstream websocket error", error?.message || String(error));
        closeWebSocketQuietly(clientSocket);
    });
}

async function ensurePveConsoleProxyServer(): Promise<number> {
    if (pveConsoleProxyPort != null) {
        return pveConsoleProxyPort;
    }
    if (pveConsoleProxyReadyPromise != null) {
        return await pveConsoleProxyReadyPromise;
    }

    pveConsoleProxyReadyPromise = new Promise<number>((resolve, reject) => {
        const server = http.createServer((_req, res) => {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("not found");
        });
        const wss = new WebSocketServer({ noServer: true });

        server.on("upgrade", (request, socket, head) => {
            let requestUrl: URL;
            try {
                requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
            } catch {
                socket.destroy();
                return;
            }
            if (!requestUrl.pathname.startsWith("/pve-console/")) {
                socket.destroy();
                return;
            }
            cleanupExpiredPveConsoleProxySessions();
            const sessionId = requestUrl.pathname.slice("/pve-console/".length);
            const session = pendingPveConsoleProxySessions.get(sessionId);
            if (session == null) {
                socket.destroy();
                return;
            }
            pendingPveConsoleProxySessions.delete(sessionId);
            wss.handleUpgrade(request, socket, head, (clientSocket) => {
                attachPveConsoleProxy(clientSocket, session);
            });
        });

        server.once("error", (error) => {
            if (pveConsoleProxyServer === server) {
                pveConsoleProxyServer = null;
                pveConsoleProxyWss = null;
                pveConsoleProxyPort = null;
            }
            reject(error);
        });
        server.on("close", () => {
            if (pveConsoleProxyServer === server) {
                pveConsoleProxyServer = null;
                pveConsoleProxyWss = null;
                pveConsoleProxyPort = null;
            }
        });
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (address == null || typeof address === "string") {
                reject(new Error("failed to start local PVE console proxy"));
                return;
            }
            pveConsoleProxyServer = server;
            pveConsoleProxyWss = wss;
            pveConsoleProxyPort = address.port;
            server.unref();
            resolve(address.port);
        });
    });

    try {
        return await pveConsoleProxyReadyPromise;
    } finally {
        pveConsoleProxyReadyPromise = null;
    }
}

setInterval(() => {
    cleanupExpiredPveConsoleProxySessions();
}, 30_000).unref();

function isAllowedPveHost(host: string): boolean {
    return getHostLookupKeys(host).some((candidate) => DEFAULT_PVE_AUTOLOGIN_HOSTS.has(candidate));
}

function getCredentialsFilePath(): string {
    return path.join(getWaveConfigDir(), PVE_CREDENTIALS_FILE_NAME);
}

function getCredentialsFileCandidates(): string[] {
    const primary = getCredentialsFilePath();
    const seen = new Set<string>();
    const candidates: string[] = [];
    const pushCandidate = (value: string) => {
        const normalized = String(value ?? "").trim();
        if (!normalized || seen.has(normalized)) {
            return;
        }
        seen.add(normalized);
        candidates.push(normalized);
    };

    pushCandidate(primary);

    const homeDir = electron.app.getPath("home");
    if (homeDir) {
        pushCandidate(path.join(homeDir, ".config", "wave-dev", PVE_CREDENTIALS_FILE_NAME));
        pushCandidate(path.join(homeDir, ".config", "wave", PVE_CREDENTIALS_FILE_NAME));
    }

    return candidates;
}

function readStoredCredsFile(): StoredPveCredsFileV1 {
    for (const filePath of getCredentialsFileCandidates()) {
        try {
            const raw = fs.readFileSync(filePath, "utf8");
            const parsed = JSON.parse(raw) as StoredPveCredsFileV1;
            if (parsed?.version !== 1 || parsed.entries == null || typeof parsed.entries !== "object") {
                continue;
            }
            if (filePath !== getCredentialsFilePath()) {
                console.log("using fallback pve credentials file", filePath);
            }
            return { version: 1, entries: parsed.entries };
        } catch {
            // try next location
        }
    }
    return { version: 1, entries: {} };
}

function decryptPasswordFromBase64(ciphertext: string): string {
    if (!electron.safeStorage.isEncryptionAvailable()) {
        throw new Error("encryption is not available");
    }
    const encrypted = Buffer.from(ciphertext, "base64");
    return electron.safeStorage.decryptString(encrypted);
}

function parseBootstrapCredsFromEnv(): Record<string, { username: string; password: string }> {
    const map: Record<string, { username: string; password: string }> = {};

    const username = String(process.env[PVE_AUTOLOGIN_USERNAME_ENV] ?? "").trim();
    const password = String(process.env[PVE_AUTOLOGIN_PASSWORD_ENV] ?? "");
    if (username && password) {
        map["default"] = { username, password };
    }

    const rawJson = String(process.env[PVE_AUTOLOGIN_JSON_ENV] ?? "").trim();
    if (!rawJson) {
        return map;
    }
    try {
        const parsed = JSON.parse(rawJson) as Record<string, { username?: string; password?: string }>;
        if (parsed == null || typeof parsed !== "object") {
            return map;
        }
        for (const [host, creds] of Object.entries(parsed)) {
            const normalizedHost = normalizeHostToken(host);
            const u = String(creds?.username ?? "").trim();
            const p = String(creds?.password ?? "");
            if (!normalizedHost || !u || !p) {
                continue;
            }
            map[normalizedHost] = { username: u, password: p };
        }
    } catch {
        // ignore invalid json
    }
    return map;
}

function loadCredentialsForHost(host: string): { username: string; password: string } | null {
    const keys = getHostLookupKeys(host);
    if (keys.length === 0) {
        return null;
    }

    const stored = readStoredCredsFile();
    for (const key of keys) {
        const entry = stored.entries[key];
        if (entry?.username && entry?.passwordCiphertext) {
            try {
                const password = decryptPasswordFromBase64(entry.passwordCiphertext);
                if (password) {
                    return { username: String(entry.username).trim(), password };
                }
            } catch {
                // ignore decrypt errors
            }
        }
    }

    const bootstrap = parseBootstrapCredsFromEnv();
    for (const key of keys) {
        const creds = bootstrap[key];
        if (creds?.username && creds?.password) {
            return creds;
        }
    }
    return bootstrap["default"] ?? null;
}

async function getApiTicketForOriginViaSsh(origin: string, timeoutMs: number): Promise<PveTicketLoginResult> {
    const base = new URL(normalizeOrigin(origin));
    const sshHost = normalizeHostToken(base.hostname);
    if (!sshHost || !isAllowedPveHost(sshHost)) {
        throw new Error("ssh fallback host not allowed");
    }

    const sshTimeoutSec = Math.max(3, Math.min(15, Math.ceil(timeoutMs / 1000)));
    const remoteCmd =
        "perl -MPVE::AccessControl -MJSON::PP -e 'print encode_json({ ticket => PVE::AccessControl::assemble_ticket(q(root@pam)), csrf => PVE::AccessControl::assemble_csrf_prevention_token(q(root@pam)), username => q(root@pam) })'";
    const { stdout } = await execFileAsync(
        "ssh",
        [
            "-o",
            "BatchMode=yes",
            "-o",
            `ConnectTimeout=${sshTimeoutSec}`,
            "-o",
            "StrictHostKeyChecking=no",
            `root@${sshHost}`,
            remoteCmd,
        ],
        {
            timeout: timeoutMs + 1500,
            windowsHide: true,
            maxBuffer: 1024 * 1024,
        }
    );

    const parsed = JSON.parse(String(stdout ?? "{}"));
    const ticket = String(parsed?.ticket ?? "").trim();
    const csrfPreventionToken = String(parsed?.csrf ?? "").trim();
    const username = String(parsed?.username ?? "").trim() || "root@pam";
    if (!ticket) {
        throw new Error("ssh fallback ticket missing");
    }

    return {
        origin: `${base.protocol}//${base.host}`,
        ticket,
        csrfPreventionToken,
        username,
    };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    let t: NodeJS.Timeout | null = null;
    return Promise.race([
        p,
        new Promise<T>((_resolve, reject) => {
            t = setTimeout(() => reject(new Error(`${label} after ${ms}ms`)), ms);
        }),
    ]).finally(() => {
        if (t) {
            clearTimeout(t);
        }
    });
}

async function pveTicketLogin(
    origin: string,
    usernameRaw: string,
    passwordRaw: string,
    timeoutMs: number
): Promise<PveTicketLoginResult> {
    const base = normalizeOrigin(origin);
    const baseUrl = new URL(base);
    const url = new URL("/api2/json/access/ticket", base);
    const username = String(usernameRaw || "").trim();
    const password = String(passwordRaw || "");
    const body = new URLSearchParams({ username, password }).toString();

    const isHttps = url.protocol === "https:";
    const mod = isHttps ? https : http;
    const agent = isHttps ? new https.Agent({ rejectUnauthorized: false }) : undefined;

    const doReq = () =>
        new Promise<PveTicketLoginResult>((resolve, reject) => {
            const req = mod.request(
                {
                    method: "POST",
                    hostname: url.hostname,
                    port: url.port || (isHttps ? 443 : 80),
                    path: url.pathname + url.search,
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Content-Length": Buffer.byteLength(body),
                    },
                    agent,
                },
                (res) => {
                    const chunks: Buffer[] = [];
                    res.on("data", (d) => chunks.push(d));
                    res.on("end", () => {
                        const text = Buffer.concat(chunks).toString("utf8");
                        if (res.statusCode && res.statusCode >= 400) {
                            reject(new Error(`PVE login HTTP ${res.statusCode}`));
                            return;
                        }
                        try {
                            const parsed = JSON.parse(text);
                            const ticket = String(parsed?.data?.ticket ?? "").trim();
                            const csrfPreventionToken = String(parsed?.data?.CSRFPreventionToken ?? "").trim();
                            if (!ticket) {
                                reject(new Error("PVE login ok but ticket missing"));
                                return;
                            }
                            resolve({
                                origin: `${baseUrl.protocol}//${baseUrl.host}`,
                                ticket,
                                csrfPreventionToken,
                                username,
                            });
                        } catch (e: any) {
                            reject(new Error(`PVE login parse failed: ${e?.message || String(e)}`));
                        }
                    });
                }
            );
            req.on("error", (e) => reject(e));
            req.setTimeout(timeoutMs, () => {
                try {
                    req.destroy(new Error("timeout"));
                } catch {
                    // ignore
                }
            });
            req.write(body);
            req.end();
        });

    return withTimeout(doReq(), timeoutMs + 1500, "pveTicketLogin");
}

function extractIpv4Candidates(input: string): string[] {
    const matches: string[] = String(input ?? "").match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
    return matches.filter((candidate) => {
        const parts = candidate.split(".").map((part) => Number(part));
        if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
            return false;
        }
        if (parts[0] === 10) {
            return true;
        }
        if (parts[0] === 192 && parts[1] === 168) {
            return true;
        }
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
            return true;
        }
        return false;
    });
}

function collectStringLeaves(value: any, out: string[] = []): string[] {
    if (value == null) {
        return out;
    }
    if (typeof value === "string") {
        out.push(value);
        return out;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectStringLeaves(item, out);
        }
        return out;
    }
    if (typeof value === "object") {
        for (const item of Object.values(value)) {
            collectStringLeaves(item, out);
        }
    }
    return out;
}

function uniqStrings(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const normalized = String(value ?? "").trim();
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        result.push(normalized);
    }
    return result;
}

async function pveApiJsonGet(origin: string, apiPath: string, ticket: string, timeoutMs: number): Promise<any> {
    const base = normalizeOrigin(origin);
    const url = new URL(apiPath, base);
    const isHttps = url.protocol === "https:";
    const mod = isHttps ? https : http;
    const agent = isHttps ? new https.Agent({ rejectUnauthorized: false }) : undefined;

    const doReq = () =>
        new Promise<any>((resolve, reject) => {
            const req = mod.request(
                {
                    method: "GET",
                    hostname: url.hostname,
                    port: url.port || (isHttps ? 443 : 80),
                    path: url.pathname + url.search,
                    headers: {
                        Cookie: `${PVE_AUTH_COOKIE_NAME}=${ticket}`,
                        Accept: "application/json",
                    },
                    agent,
                },
                (res) => {
                    const chunks: Buffer[] = [];
                    res.on("data", (d) => chunks.push(d));
                    res.on("end", () => {
                        const text = Buffer.concat(chunks).toString("utf8");
                        if (res.statusCode && res.statusCode >= 400) {
                            reject(new Error(`PVE API ${apiPath} HTTP ${res.statusCode}`));
                            return;
                        }
                        try {
                            const parsed = JSON.parse(text);
                            resolve(parsed?.data);
                        } catch (e: any) {
                            reject(new Error(`PVE API parse failed for ${apiPath}: ${e?.message || String(e)}`));
                        }
                    });
                }
            );
            req.on("error", (e) => reject(e));
            req.setTimeout(timeoutMs, () => {
                try {
                    req.destroy(new Error("timeout"));
                } catch {
                    // ignore
                }
            });
            req.end();
        });

    return withTimeout(doReq(), timeoutMs + 1500, `pveApiJsonGet ${apiPath}`);
}

async function pveApiJsonPost(
    origin: string,
    apiPath: string,
    auth: Pick<PveTicketLoginResult, "ticket" | "csrfPreventionToken">,
    body: Record<string, string | number | boolean>,
    timeoutMs: number
): Promise<any> {
    const base = normalizeOrigin(origin);
    const url = new URL(apiPath, base);
    const isHttps = url.protocol === "https:";
    const mod = isHttps ? https : http;
    const agent = isHttps ? new https.Agent({ rejectUnauthorized: false }) : undefined;
    const payload = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
        payload.set(key, String(value));
    }
    const encodedBody = payload.toString();

    const doReq = () =>
        new Promise<any>((resolve, reject) => {
            const req = mod.request(
                {
                    method: "POST",
                    hostname: url.hostname,
                    port: url.port || (isHttps ? 443 : 80),
                    path: url.pathname + url.search,
                    headers: {
                        Cookie: `${PVE_AUTH_COOKIE_NAME}=${auth.ticket}`,
                        CSRFPreventionToken: auth.csrfPreventionToken,
                        Accept: "application/json",
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Content-Length": Buffer.byteLength(encodedBody),
                    },
                    agent,
                },
                (res) => {
                    const chunks: Buffer[] = [];
                    res.on("data", (d) => chunks.push(d));
                    res.on("end", () => {
                        const text = Buffer.concat(chunks).toString("utf8");
                        if (res.statusCode && res.statusCode >= 400) {
                            reject(new Error(`PVE API ${apiPath} HTTP ${res.statusCode}`));
                            return;
                        }
                        try {
                            const parsed = JSON.parse(text);
                            resolve(parsed?.data);
                        } catch (e: any) {
                            reject(new Error(`PVE API parse failed for ${apiPath}: ${e?.message || String(e)}`));
                        }
                    });
                }
            );
            req.on("error", (e) => reject(e));
            req.setTimeout(timeoutMs, () => {
                try {
                    req.destroy(new Error("timeout"));
                } catch {
                    // ignore
                }
            });
            req.write(encodedBody);
            req.end();
        });

    return withTimeout(doReq(), timeoutMs + 1500, `pveApiJsonPost ${apiPath}`);
}

async function pveApiGetWithFallback(
    origin: string,
    apiPath: string,
    ticket: string,
    timeoutMs: number,
    fallbackValue: any
): Promise<any> {
    try {
        return await pveApiJsonGet(origin, apiPath, ticket, timeoutMs);
    } catch {
        return fallbackValue;
    }
}

function extractIpHintsFromPayload(payload: any): string[] {
    const stringLeaves = collectStringLeaves(payload);
    const ips = stringLeaves.flatMap((value) => extractIpv4Candidates(value));
    return uniqStrings(ips);
}

function pickPreferredSshHost(ipHints: string[]): string {
    return uniqStrings(ipHints)[0] ?? "";
}

async function listPveMachinesViaSsh(origin: string, timeoutMs: number): Promise<PveMachineInfo[]> {
    const base = new URL(origin);
    const sshHost = normalizeHostToken(base.hostname);
    if (!sshHost || !isAllowedPveHost(sshHost)) {
        throw new Error("ssh fallback host not allowed");
    }
    const sshTimeoutSec = Math.max(3, Math.min(15, Math.ceil(timeoutMs / 1000)));
    const { stdout } = await execFileAsync(
        "ssh",
        [
            "-o",
            "BatchMode=yes",
            "-o",
            `ConnectTimeout=${sshTimeoutSec}`,
            "-o",
            "StrictHostKeyChecking=no",
            `root@${sshHost}`,
            "pvesh get /cluster/resources --type vm --output-format json",
        ],
        {
            timeout: timeoutMs + 1500,
            windowsHide: true,
            maxBuffer: 2 * 1024 * 1024,
        }
    );
    const resources = JSON.parse(String(stdout ?? "[]"));
    if (!Array.isArray(resources)) {
        throw new Error("ssh fallback returned invalid json");
    }
    const machines = resources
        .filter(
            (item) =>
                item != null &&
                (item.type === "qemu" || item.type === "lxc") &&
                String(item.template ?? "0") !== "1"
        )
        .map((item) => {
            const type = item.type as "qemu" | "lxc";
            const vmid = Number(item.vmid ?? 0);
            return {
                vmid,
                node: String(item.node ?? "").trim(),
                type,
                name: String(item.name ?? `${type}-${vmid}`).trim() || `${type}-${vmid}`,
                status: String(item.status ?? "").trim() || undefined,
                ipHints: [],
                sshHost: undefined,
            } satisfies PveMachineInfo;
        });
    machines.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    return machines;
}

async function getApiTicketForOrigin(origin: string, timeoutMs: number): Promise<PveTicketLoginResult> {
    let host = "";
    try {
        host = normalizeHostToken(new URL(origin).host);
    } catch {
        host = "";
    }
    if (!host || !isAllowedPveHost(host)) {
        throw new Error("origin host not allowed");
    }
    const creds = loadCredentialsForHost(host);
    if (creds?.username && creds?.password) {
        const username = creds.username.includes("@") ? creds.username : `${creds.username}@${PVE_DEFAULT_REALM}`;
        return await pveTicketLogin(origin, username, creds.password, timeoutMs);
    }
    return await getApiTicketForOriginViaSsh(origin, timeoutMs);
}

export async function listPveMachines(req?: PveListMachinesRequest): Promise<PveListMachinesResult> {
    const origin = normalizeOrigin(req?.origin ?? "https://192.168.1.250:8006");
    if (!origin) {
        return { ok: false, error: "origin is required" };
    }
    const timeoutMs = Math.max(1000, Math.min(20000, Number(req?.timeoutMs ?? 8000) || 8000));
    try {
        const login = await getApiTicketForOrigin(origin, timeoutMs);
        const resources = await pveApiJsonGet(origin, "/api2/json/cluster/resources?type=vm", login.ticket, timeoutMs);
        const vmResources = Array.isArray(resources)
            ? resources.filter(
                  (item) =>
                      item != null &&
                      (item.type === "qemu" || item.type === "lxc") &&
                      String(item.template ?? "0") !== "1"
              )
            : [];
        const machines = await Promise.all(
            vmResources.map(async (item) => {
                const type = item.type as "qemu" | "lxc";
                const vmid = Number(item.vmid ?? 0);
                const node = String(item.node ?? "").trim();
                const configPath =
                    type === "qemu"
                        ? `/api2/json/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`
                        : `/api2/json/nodes/${encodeURIComponent(node)}/lxc/${vmid}/config`;
                const configData = await pveApiGetWithFallback(origin, configPath, login.ticket, timeoutMs, {});
                const extraData =
                    type === "qemu"
                        ? await pveApiGetWithFallback(
                              origin,
                              `/api2/json/nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/network-get-interfaces`,
                              login.ticket,
                              timeoutMs,
                              {}
                          )
                        : await pveApiGetWithFallback(
                              origin,
                              `/api2/json/nodes/${encodeURIComponent(node)}/lxc/${vmid}/interfaces`,
                              login.ticket,
                              timeoutMs,
                              {}
                          );
                const ipHints = uniqStrings([
                    ...extractIpHintsFromPayload(item),
                    ...extractIpHintsFromPayload(configData),
                    ...extractIpHintsFromPayload(extraData),
                ]);
                return {
                    vmid,
                    node,
                    type,
                    name: String(item.name ?? `${type}-${vmid}`).trim() || `${type}-${vmid}`,
                    status: String(item.status ?? "").trim() || undefined,
                    ipHints,
                    sshHost: pickPreferredSshHost(ipHints) || undefined,
                } satisfies PveMachineInfo;
            })
        );
        machines.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
        return { ok: true, machines };
    } catch (e: any) {
        const apiError = e?.message || String(e);
        try {
            const machines = await listPveMachinesViaSsh(origin, timeoutMs);
            return { ok: true, machines };
        } catch (sshErr: any) {
            const fallbackError = sshErr?.message || String(sshErr);
            return { ok: false, error: `${apiError}; ssh fallback failed: ${fallbackError}` };
        }
    }
}

export async function createPveConsoleSession(
    req: PveCreateConsoleSessionRequest
): Promise<PveCreateConsoleSessionResult> {
    const origin = normalizeOrigin(req?.origin ?? "https://192.168.1.250:8006");
    if (!origin) {
        return { ok: false, error: "origin is required" };
    }
    const node = String(req?.node ?? "").trim();
    const vmid = Number(req?.vmid ?? 0);
    const type = String(req?.type ?? "qemu").trim().toLowerCase() === "lxc" ? "lxc" : "qemu";
    const name = String(req?.name ?? "").trim() || `${type}-${vmid}`;
    if (!node) {
        return { ok: false, error: "node is required" };
    }
    if (!Number.isFinite(vmid) || vmid <= 0) {
        return { ok: false, error: "vmid is required" };
    }
    const timeoutMs = Math.max(1000, Math.min(15000, Number(req?.timeoutMs ?? 6000) || 6000));

    try {
        const login = await getApiTicketForOrigin(origin, timeoutMs);
        const vmPathType = type === "lxc" ? "lxc" : "qemu";
        const proxyData = await pveApiJsonPost(
            origin,
            `/api2/json/nodes/${encodeURIComponent(node)}/${vmPathType}/${vmid}/vncproxy`,
            login,
            { websocket: 1, "generate-password": 1 },
            timeoutMs
        );
        const port = Number(proxyData?.port ?? 0);
        const ticket = String(proxyData?.ticket ?? "").trim();
        const password = String(proxyData?.password ?? "").trim() || ticket;
        if (!Number.isFinite(port) || port <= 0 || !ticket) {
            return { ok: false, error: "PVE returned an invalid VNC proxy session" };
        }
        const upstreamWebsocketUrl = new URL(
            `/api2/json/nodes/${encodeURIComponent(node)}/${vmPathType}/${vmid}/vncwebsocket`,
            origin
        );
        upstreamWebsocketUrl.searchParams.set("port", String(port));
        upstreamWebsocketUrl.searchParams.set("vncticket", ticket);
        upstreamWebsocketUrl.protocol = upstreamWebsocketUrl.protocol === "https:" ? "wss:" : "ws:";
        const localProxyPort = await ensurePveConsoleProxyServer();
        const proxySessionId = randomUUID();
        pendingPveConsoleProxySessions.set(proxySessionId, {
            upstreamUrl: upstreamWebsocketUrl.toString(),
            authCookie: login.ticket,
            origin,
            createdAt: Date.now(),
        });
        return {
            ok: true,
            websocketUrl: `ws://127.0.0.1:${localProxyPort}/pve-console/${proxySessionId}`,
            password,
            ticket,
            port,
            origin,
            node,
            vmid,
            type,
            name,
        };
    } catch (e: any) {
        return { ok: false, error: e?.message || String(e) };
    }
}

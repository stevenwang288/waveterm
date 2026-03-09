// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as electron from "electron";
import fs from "fs";
import * as http from "node:http";
import * as https from "node:https";
import * as path from "path";
import { URL } from "node:url";
import { getWaveConfigDir } from "./emain-platform";

const DEFAULT_PVE_AUTOLOGIN_HOSTS = new Set(["192.168.1.250", "192.168.1.250:8006"]);
const PVE_LANG_COOKIE_NAME = "PVELangCookie";
const PVE_AUTH_COOKIE_NAME = "PVEAuthCookie";
const PVE_DEFAULT_REALM = "pam";
const PVE_DEFAULT_LANG = "zh_CN";

const PVE_CREDENTIALS_FILE_NAME = "pve-auth.json";

const PVE_AUTOLOGIN_USERNAME_ENV = "WAVETERM_PVE_AUTOLOGIN_USERNAME";
const PVE_AUTOLOGIN_PASSWORD_ENV = "WAVETERM_PVE_AUTOLOGIN_PASSWORD";
const PVE_AUTOLOGIN_JSON_ENV = "WAVETERM_PVE_AUTOLOGIN_JSON";

export type PveEnsureAuthRequest = {
    partition: string;
    origin: string;
    lang?: string;
    timeoutMs?: number;
};

export type PveEnsureAuthResult = {
    ok: boolean;
    cached?: boolean;
    skipped?: boolean;
    error?: string;
};

export type PveListMachinesRequest = {
    origin?: string;
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
    guiUrl: string;
};

export type PveListMachinesResult = {
    ok: boolean;
    error?: string;
    machines?: PveMachineInfo[];
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

function normalizeHostToken(value: string): string {
    return String(value ?? "").trim().toLowerCase();
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

function isAllowedPveHost(host: string): boolean {
    const normalized = normalizeHostToken(host);
    return normalized ? DEFAULT_PVE_AUTOLOGIN_HOSTS.has(normalized) : false;
}

function getCredentialsFilePath(): string {
    return path.join(getWaveConfigDir(), PVE_CREDENTIALS_FILE_NAME);
}

function readStoredCredsFile(): StoredPveCredsFileV1 {
    const filePath = getCredentialsFilePath();
    try {
        const raw = fs.readFileSync(filePath, "utf8");
        const parsed = JSON.parse(raw) as StoredPveCredsFileV1;
        if (parsed?.version !== 1 || parsed.entries == null || typeof parsed.entries !== "object") {
            return { version: 1, entries: {} };
        }
        return { version: 1, entries: parsed.entries };
    } catch {
        return { version: 1, entries: {} };
    }
}

function writeStoredCredsFile(next: StoredPveCredsFileV1): void {
    const filePath = getCredentialsFilePath();
    const tmpPath = `${filePath}.tmp`;
    const payload = JSON.stringify(next, null, 2);
    fs.writeFileSync(tmpPath, payload, "utf8");
    try {
        fs.rmSync(filePath, { force: true });
    } catch {
        // ignore
    }
    fs.renameSync(tmpPath, filePath);
}

function encryptPasswordToBase64(password: string): string {
    if (!electron.safeStorage.isEncryptionAvailable()) {
        throw new Error("encryption is not available");
    }
    const encrypted = electron.safeStorage.encryptString(password);
    return encrypted.toString("base64");
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
    const normalizedHost = normalizeHostToken(host);
    if (!normalizedHost) {
        return null;
    }

    const stored = readStoredCredsFile();
    const entry = stored.entries[normalizedHost];
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

    const bootstrap = parseBootstrapCredsFromEnv();
    return bootstrap[normalizedHost] ?? bootstrap["default"] ?? null;
}

function buildPveLangCookie(origin: string, lang: string): Electron.CookiesSetDetails | null {
    try {
        const base = normalizeOrigin(origin);
        if (!base) {
            return null;
        }
        const u = new URL(base);
        const value = String(lang || "").trim() || PVE_DEFAULT_LANG;
        return {
            url: base,
            name: PVE_LANG_COOKIE_NAME,
            value,
            secure: u.protocol === "https:",
            httpOnly: false,
            sameSite: "lax",
            path: "/",
        };
    } catch {
        return null;
    }
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

async function pveTicketLogin(origin: string, usernameRaw: string, passwordRaw: string, timeoutMs: number) {
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
        new Promise<{ origin: string; ticket: string }>((resolve, reject) => {
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
                            if (!ticket) {
                                reject(new Error("PVE login ok but ticket missing"));
                                return;
                            }
                            resolve({ origin: `${baseUrl.protocol}//${baseUrl.host}`, ticket });
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

function buildPveVmGuiUrl(origin: string, type: "qemu" | "lxc", vmid: number): string {
    const base = normalizeOrigin(origin);
    const target = encodeURIComponent(`${type}/${vmid}`);
    return `${base}/#v1:0:=${target}:4:::::8::`;
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

async function getApiTicketForOrigin(origin: string, timeoutMs: number): Promise<string> {
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
    if (!creds?.username || !creds?.password) {
        throw new Error("missing credentials");
    }
    const username = creds.username.includes("@") ? creds.username : `${creds.username}@${PVE_DEFAULT_REALM}`;
    const login = await pveTicketLogin(origin, username, creds.password, timeoutMs);
    return login.ticket;
}

export async function listPveMachines(req?: PveListMachinesRequest): Promise<PveListMachinesResult> {
    const origin = normalizeOrigin(req?.origin ?? "https://192.168.1.250:8006");
    if (!origin) {
        return { ok: false, error: "origin is required" };
    }
    const timeoutMs = Math.max(1000, Math.min(20000, Number(req?.timeoutMs ?? 8000) || 8000));
    try {
        const ticket = await getApiTicketForOrigin(origin, timeoutMs);
        const resources = await pveApiJsonGet(origin, "/api2/json/cluster/resources?type=vm", ticket, timeoutMs);
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
                const configData = await pveApiGetWithFallback(origin, configPath, ticket, timeoutMs, {});
                const extraData =
                    type === "qemu"
                        ? await pveApiGetWithFallback(
                              origin,
                              `/api2/json/nodes/${encodeURIComponent(node)}/qemu/${vmid}/agent/network-get-interfaces`,
                              ticket,
                              timeoutMs,
                              {}
                          )
                        : await pveApiGetWithFallback(
                              origin,
                              `/api2/json/nodes/${encodeURIComponent(node)}/lxc/${vmid}/interfaces`,
                              ticket,
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
                    guiUrl: buildPveVmGuiUrl(origin, type, vmid),
                } satisfies PveMachineInfo;
            })
        );
        machines.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
        return { ok: true, machines };
    } catch (e: any) {
        return { ok: false, error: e?.message || String(e) };
    }
}

export async function ensurePveAuth(req: PveEnsureAuthRequest): Promise<PveEnsureAuthResult> {
    const partition = String(req?.partition ?? "").trim();
    if (!partition) {
        return { ok: false, error: "partition is required" };
    }
    const origin = normalizeOrigin(req?.origin ?? "");
    if (!origin) {
        return { ok: false, error: "origin is required" };
    }

    let host = "";
    try {
        host = normalizeHostToken(new URL(origin).host);
    } catch {
        host = "";
    }
    if (!host || !isAllowedPveHost(host)) {
        return { ok: false, error: "origin host not allowed" };
    }

    const timeoutMs = Math.max(800, Math.min(15000, Number(req?.timeoutMs ?? 4000) || 4000));
    const lang = String(req?.lang ?? "").trim() || PVE_DEFAULT_LANG;

    const sess = electron.session.fromPartition(partition);

    // Always pin Simplified Chinese for the official UI.
    const langCookie = buildPveLangCookie(origin, lang);
    if (langCookie) {
        try {
            await sess.cookies.set(langCookie);
        } catch {
            // ignore
        }
    }

    let hasAuthCookie = false;
    try {
        const existing = await sess.cookies.get({ url: origin, name: PVE_AUTH_COOKIE_NAME });
        const hasAuth = String(existing?.[0]?.value ?? "").trim();
        hasAuthCookie = Boolean(hasAuth);
    } catch {
        // ignore cookie read errors
    }

    const creds = loadCredentialsForHost(host);
    if (!creds?.username || !creds?.password) {
        return hasAuthCookie ? { ok: true, cached: true } : { ok: true, skipped: true, error: "missing credentials" };
    }

    try {
        const username = creds.username.includes("@") ? creds.username : `${creds.username}@${PVE_DEFAULT_REALM}`;
        const login = await pveTicketLogin(origin, username, creds.password, timeoutMs);
        await sess.cookies.set({
            url: origin,
            name: PVE_AUTH_COOKIE_NAME,
            value: login.ticket,
            secure: origin.startsWith("https:"),
            httpOnly: false,
            sameSite: "lax",
            path: "/",
        });
        return { ok: true, cached: false };
    } catch (e: any) {
        return { ok: false, error: e?.message || String(e) };
    }
}

export async function storePveCredentials(host: string, username: string, password: string): Promise<PveEnsureAuthResult> {
    const normalizedHost = normalizeHostToken(host);
    const normalizedUser = String(username ?? "").trim();
    const rawPassword = String(password ?? "");
    if (!normalizedHost || !isAllowedPveHost(normalizedHost)) {
        return { ok: false, error: "host not allowed" };
    }
    if (!normalizedUser || !rawPassword) {
        return { ok: false, error: "username/password required" };
    }

    try {
        const ciphertext = encryptPasswordToBase64(rawPassword);
        const file = readStoredCredsFile();
        file.entries[normalizedHost] = {
            username: normalizedUser,
            passwordCiphertext: ciphertext,
            updatedTs: Date.now(),
        };
        writeStoredCredsFile(file);
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e?.message || String(e) };
    }
}

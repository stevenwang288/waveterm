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
const PVE_ALLOWED_HOSTS_ENV = "WAVETERM_PVE_HOSTS";
const PVE_ORIGIN_ENV = "WAVETERM_PVE_ORIGIN";
const PVE_URL_ENV = "WAVETERM_PVE_URL";
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

function parseHostFromEnvValue(value: string): string {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) {
        return "";
    }
    try {
        return normalizeHostToken(new URL(trimmed).host);
    } catch {
        return normalizeHostToken(trimmed);
    }
}

function getImplicitAllowedHostsFromEnv(): Set<string> {
    const implicit = new Set<string>();
    const originHost = parseHostFromEnvValue(process.env[PVE_ORIGIN_ENV] ?? "");
    if (originHost) {
        implicit.add(originHost);
    }
    const urlHost = parseHostFromEnvValue(process.env[PVE_URL_ENV] ?? "");
    if (urlHost) {
        implicit.add(urlHost);
    }
    return implicit;
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
    if (!normalized) {
        return false;
    }
    if (DEFAULT_PVE_AUTOLOGIN_HOSTS.has(normalized)) {
        return true;
    }
    if (getImplicitAllowedHostsFromEnv().has(normalized)) {
        return true;
    }
    const envHosts = String(process.env[PVE_ALLOWED_HOSTS_ENV] ?? "").trim();
    if (!envHosts) {
        return false;
    }
    for (const rawHost of envHosts.split(",")) {
        const candidate = normalizeHostToken(rawHost);
        if (candidate && candidate == normalized) {
            return true;
        }
    }
    return false;
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

// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as electron from "electron";
import { FastAverageColor } from "fast-average-color";
import fs from "fs";
import * as child_process from "node:child_process";
import * as os from "node:os";
import * as path from "path";
import { promisify } from "node:util";
import { PNG } from "pngjs";
import { Readable } from "stream";
import { RpcApi } from "../frontend/app/store/wshclientapi";
import { getWebServerEndpoint } from "../frontend/util/endpoints";
import * as keyutil from "../frontend/util/keyutil";
import { fireAndForget, parseDataUrl } from "../frontend/util/util";
import {
    incrementTermCommandsDurable,
    incrementTermCommandsRemote,
    incrementTermCommandsRun,
    incrementTermCommandsWsl,
    setWasActive,
} from "./emain-activity";
import { createBuilderWindow, getAllBuilderWindows, getBuilderWindowByWebContentsId } from "./emain-builder";
import i18next from "./i18n-main";
import { callWithOriginalXdgCurrentDesktopAsync, getWaveDataDir, unamePlatform } from "./emain-platform";
import { getWaveTabViewByWebContentsId } from "./emain-tabview";
import { handleCtrlShiftState } from "./emain-util";
import { getWaveVersion } from "./emain-wavesrv";
import { createNewWaveWindow, getWaveWindowByWebContentsId } from "./emain-window";
import { ElectronWshClient } from "./emain-wsh";
import { synthesizeEdgeTtsToMp3Base64 } from "./local-tts-edge";
import {
    createPveConsoleSession,
    PveCreateConsoleSessionRequest,
    listPveMachines,
    PveListMachinesRequest,
} from "./pve-auth";

const electronApp = electron.app;

let webviewFocusId: number = null;
let webviewKeys: string[] = [];
const execFileAsync = promisify(child_process.execFile);

const allowedGitSubcommands = new Set([
    "status",
    "diff",
    "rev-parse",
    "branch",
    "log",
    "show",
    "remote",
    "symbolic-ref",
    "add",
    "restore",
    "commit",
    "push",
]);

function isAllowedGitArgs(args: string[]): boolean {
    if (!Array.isArray(args) || args.length === 0) {
        return false;
    }
    const subcmd = args[0];
    if (!allowedGitSubcommands.has(subcmd)) {
        return false;
    }
    for (const arg of args) {
        if (typeof arg !== "string") {
            return false;
        }
        if (arg.includes("\0")) {
            return false;
        }
    }
    return true;
}

async function runGitCommand(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    if (!cwd || !path.isAbsolute(cwd)) {
        return { code: 2, stdout: "", stderr: "Invalid git cwd" };
    }
    if (!isAllowedGitArgs(args)) {
        return { code: 2, stdout: "", stderr: "Unsupported git args" };
    }
    try {
        const result = await execFileAsync("git", args, {
            cwd,
            windowsHide: true,
            maxBuffer: 4 * 1024 * 1024,
        });
        return {
            code: 0,
            stdout: result.stdout ?? "",
            stderr: result.stderr ?? "",
        };
    } catch (error: any) {
        return {
            code: typeof error?.code === "number" ? error.code : 1,
            stdout: error?.stdout ?? "",
            stderr: error?.stderr ?? String(error),
        };
    }
}

export function openBuilderWindow(appId?: string) {
    const normalizedAppId = appId || "";
    const existingBuilderWindows = getAllBuilderWindows();
    const existingWindow = existingBuilderWindows.find((win) => win.builderAppId === normalizedAppId);
    if (existingWindow) {
        existingWindow.focus();
        return;
    }
    fireAndForget(() => createBuilderWindow(normalizedAppId));
}

type UrlInSessionResult = {
    stream: Readable;
    mimeType: string;
    fileName: string;
};

type SpeechRequestData = {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
};

type SpeechRequestResult = {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    bodyBase64: string;
};

type SpeechLogData = {
    event?: string;
    transport?: string;
    role?: string;
    ownerId?: string;
    playId?: number;
    chunkIndex?: number;
    chunkCount?: number;
    text?: string;
    endpoint?: string;
    model?: string;
    voice?: string;
    error?: string;
    ts?: number;
};

const MaxSpeechLogTextLength = 20000;
const SpeechLogDirName = "logs";
const SpeechLogFilePrefix = "tts-speech";

function clampSpeechLogText(value: unknown): string {
    const text = typeof value === "string" ? value : String(value ?? "");
    if (text.length <= MaxSpeechLogTextLength) {
        return text;
    }
    return `${text.slice(0, MaxSpeechLogTextLength)}...[truncated ${text.length - MaxSpeechLogTextLength} chars]`;
}

function normalizeSpeechLogData(entry: SpeechLogData): Record<string, string | number | null> {
    return {
        event: clampSpeechLogText(entry?.event || "unknown"),
        transport: clampSpeechLogText(entry?.transport || ""),
        role: clampSpeechLogText(entry?.role || ""),
        ownerId: clampSpeechLogText(entry?.ownerId || ""),
        playId: Number.isFinite(entry?.playId) ? Number(entry.playId) : null,
        chunkIndex: Number.isFinite(entry?.chunkIndex) ? Number(entry.chunkIndex) : null,
        chunkCount: Number.isFinite(entry?.chunkCount) ? Number(entry.chunkCount) : null,
        text: clampSpeechLogText(entry?.text || ""),
        endpoint: clampSpeechLogText(entry?.endpoint || ""),
        model: clampSpeechLogText(entry?.model || ""),
        voice: clampSpeechLogText(entry?.voice || ""),
        error: clampSpeechLogText(entry?.error || ""),
        ts: Number.isFinite(entry?.ts) ? Number(entry.ts) : Date.now(),
    };
}

function getSpeechLogFilePath(ts: number): string {
    const date = new Date(ts);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const fileName = `${SpeechLogFilePrefix}-${yyyy}${mm}${dd}.ndjson`;
    return path.join(getWaveDataDir(), SpeechLogDirName, fileName);
}

async function appendSpeechLogData(entry: Record<string, string | number | null>): Promise<void> {
    try {
        const ts = Number(entry.ts ?? Date.now());
        const filePath = getSpeechLogFilePath(Number.isFinite(ts) ? ts : Date.now());
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.appendFile(filePath, `${JSON.stringify(entry)}\n`, { encoding: "utf8" });
    } catch (error) {
        console.log("speech-log append failed", error instanceof Error ? error.message : String(error));
    }
}

function getSingleHeaderVal(headers: Record<string, string | string[]>, key: string): string {
    const val = headers[key];
    if (val == null) {
        return null;
    }
    if (Array.isArray(val)) {
        return val[0];
    }
    return val;
}

function cleanMimeType(mimeType: string): string {
    if (mimeType == null) {
        return null;
    }
    const parts = mimeType.split(";");
    return parts[0].trim();
}

function getFileNameFromUrl(url: string): string {
    try {
        const pathname = new URL(url).pathname;
        const filename = pathname.substring(pathname.lastIndexOf("/") + 1);
        return filename;
    } catch (e) {
        return null;
    }
}

function getUrlInSession(session: Electron.Session, url: string): Promise<UrlInSessionResult> {
    return new Promise((resolve, reject) => {
        if (url.startsWith("data:")) {
            try {
                const parsed = parseDataUrl(url);
                const buffer = Buffer.from(parsed.buffer);
                const readable = Readable.from(buffer);
                resolve({ stream: readable, mimeType: parsed.mimeType, fileName: "image" });
            } catch (err) {
                return reject(err);
            }
            return;
        }
        const request = electron.net.request({
            url,
            method: "GET",
            session,
        });
        const readable = new Readable({
            read() {},
        });
        request.on("response", (response) => {
            const statusCode = response.statusCode;
            if (statusCode < 200 || statusCode >= 300) {
                readable.destroy();
                request.abort();
                reject(new Error(`HTTP request failed with status ${statusCode}: ${response.statusMessage || ""}`));
                return;
            }

            const mimeType = cleanMimeType(getSingleHeaderVal(response.headers, "content-type"));
            const fileName = getFileNameFromUrl(url) || "image";
            response.on("data", (chunk) => {
                readable.push(chunk);
            });
            response.on("end", () => {
                readable.push(null);
                resolve({ stream: readable, mimeType, fileName });
            });
            response.on("error", (err) => {
                readable.destroy(err);
                reject(err);
            });
        });
        request.on("error", (err) => {
            readable.destroy(err);
            reject(err);
        });
        request.end();
    });
}

function isBuiltinLocalSpeechCandidate(requestUrl: URL): boolean {
    if (process.platform !== "win32") {
        return false;
    }
    if (!requestUrl) {
        return false;
    }
    if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") {
        return false;
    }
    const host = requestUrl.hostname.toLowerCase();
    if (host !== "127.0.0.1" && host !== "localhost") {
        return false;
    }
    const port = requestUrl.port || (requestUrl.protocol === "https:" ? "443" : "80");
    if (port !== "5050" && port !== "5051") {
        return false;
    }
    return requestUrl.pathname.toLowerCase() === "/v1/audio/speech";
}

function isBuiltinEdgeTtsCandidate(requestUrl: URL): boolean {
    if (!requestUrl) {
        return false;
    }
    if (requestUrl.protocol !== "wave:") {
        return false;
    }
    if (requestUrl.hostname.toLowerCase() !== "edge-tts") {
        return false;
    }
    return requestUrl.pathname.toLowerCase() === "/v1/audio/speech";
}

type WindowsListeningPortOwnerInfo = {
    pid: number;
    name?: string;
    path?: string;
    commandLine?: string;
};

function redactWindowsCommandLine(value: string): string {
    const raw = (value ?? "").toString().trim();
    if (!raw) {
        return "";
    }
    let redacted = raw;
    redacted = redacted.replace(
        /\b(OPENAI_API_KEY|SENTRY_AUTH_TOKEN|TAVILY_API_KEY|EXA_API_KEY|API_KEY|AUTH_TOKEN|TOKEN|PASSWORD|SECRET)\s*=\s*([^\s"']+)/gi,
        "$1=[REDACTED]"
    );
    redacted = redacted.replace(/(--(?:api-?key|auth-?token|token|password|secret|key)=)([^\s"']+)/gi, "$1[REDACTED]");
    redacted = redacted.replace(
        /(--(?:api-?key|auth-?token|token|password|secret|key)\s+)([^\s"']+)/gi,
        "$1[REDACTED]"
    );
    const maxLen = 420;
    if (redacted.length > maxLen) {
        return `${redacted.slice(0, maxLen)}…`;
    }
    return redacted;
}

async function getWindowsListeningPortOwner(port: number): Promise<WindowsListeningPortOwnerInfo | null> {
    if (process.platform !== "win32" || !Number.isFinite(port) || port <= 0) {
        return null;
    }
    try {
        const psScript = [
            "$ErrorActionPreference = 'SilentlyContinue'",
            `$port = ${Math.trunc(port)}`,
            "$conn = Get-NetTCPConnection -State Listen -LocalPort $port | Select-Object -First 1",
            "if (-not $conn) { return }",
            "$pid = $conn.OwningProcess",
            "if (-not $pid) { return }",
            "$proc = Get-CimInstance Win32_Process -Filter (\"ProcessId=\" + $pid) | Select-Object -First 1 Name,ExecutablePath,CommandLine",
            "$name = $null",
            "$path = $null",
            "$cmd = $null",
            "if ($proc) { $name = $proc.Name; $path = $proc.ExecutablePath; $cmd = $proc.CommandLine }",
            "$obj = [pscustomobject]@{ pid = [int]$pid; name = $name; path = $path; commandLine = $cmd }",
            "$obj | ConvertTo-Json -Compress",
        ].join("; ");
        const { stdout } = await execFileAsync(
            "powershell.exe",
            ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", psScript],
            {
                windowsHide: true,
                timeout: 3000,
                maxBuffer: 1024 * 1024,
            }
        );
        const raw = (stdout ?? "").toString().trim().replace(/^\uFEFF/, "");
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw) as any;
        const pid = Number(parsed?.pid);
        if (!Number.isFinite(pid) || pid <= 0) {
            return null;
        }
        const name = typeof parsed?.name === "string" ? parsed.name.trim() : "";
        const path = typeof parsed?.path === "string" ? parsed.path.trim() : "";
        const commandLineRaw = typeof parsed?.commandLine === "string" ? parsed.commandLine.trim() : "";
        const commandLine = commandLineRaw ? redactWindowsCommandLine(commandLineRaw) : "";
        return {
            pid: Math.trunc(pid),
            name: name || undefined,
            path: path || undefined,
            commandLine: commandLine || undefined,
        };
    } catch {
        return null;
    }
}

function formatWindowsListeningPortOwner(info: WindowsListeningPortOwnerInfo | null): string {
    if (!info) {
        return "";
    }
    const parts = [`PID=${info.pid}`];
    if (info.name) {
        parts.push(`name=${info.name}`);
    }
    if (info.path) {
        parts.push(`path=${info.path}`);
    }
    if (info.commandLine) {
        parts.push(`cmd=${info.commandLine}`);
    }
    return parts.join(", ");
}

function makeSpeechErrorResponse(status: number, statusText: string, message: string): SpeechRequestResult {
    return {
        status,
        statusText,
        headers: { "content-type": "text/plain; charset=utf-8" },
        bodyBase64: Buffer.from((message ?? "").toString(), "utf8").toString("base64"),
    };
}

function parseLocalSpeechPayload(body: unknown): { input: string; voice?: string; speed?: number } {
    if (typeof body !== "string" || !body.trim()) {
        return { input: "" };
    }
    try {
        const parsed = JSON.parse(body) as any;
        return {
            input: typeof parsed?.input === "string" ? parsed.input : "",
            voice: typeof parsed?.voice === "string" ? parsed.voice : undefined,
            speed: typeof parsed?.speed === "number" ? parsed.speed : undefined,
        };
    } catch {
        return { input: "" };
    }
}

async function runBuiltinEdgeSpeechRequest(req: SpeechRequestData): Promise<SpeechRequestResult> {
    const payload = parseLocalSpeechPayload(req?.body);
    const audioBase64 = await synthesizeEdgeTtsToMp3Base64({
        input: payload.input,
        voice: payload.voice,
        speed: payload.speed,
    });
    return {
        status: 200,
        statusText: "OK",
        headers: { "content-type": "audio/mpeg" },
        bodyBase64: audioBase64,
    };
}

function runNetSpeechRequest(req: SpeechRequestData, requestUrl: URL): Promise<SpeechRequestResult> {
    return new Promise((resolve, reject) => {
        const netRequest = electron.net.request({
            url: requestUrl.toString(),
            method: req.method?.toUpperCase() || "POST",
            session: electron.session.defaultSession,
        });
        const requestHeaders = req.headers ?? {};
        for (const [key, value] of Object.entries(requestHeaders)) {
            if (!key || value == null) {
                continue;
            }
            netRequest.setHeader(key, value);
        }
        netRequest.on("response", (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk) => {
                chunks.push(Buffer.from(chunk));
            });
            response.on("end", () => {
                const headers: Record<string, string> = {};
                for (const [key, value] of Object.entries(response.headers ?? {})) {
                    if (!key) {
                        continue;
                    }
                    if (Array.isArray(value)) {
                        headers[key.toLowerCase()] = value[0] ?? "";
                    } else if (value != null) {
                        headers[key.toLowerCase()] = String(value);
                    }
                }
                resolve({
                    status: response.statusCode ?? 0,
                    statusText: response.statusMessage ?? "",
                    headers,
                    bodyBase64: Buffer.concat(chunks).toString("base64"),
                });
            });
            response.on("error", (error) => reject(error));
        });
        netRequest.on("error", (error) => reject(error));
        if (typeof req.body === "string" && req.body.length > 0) {
            netRequest.write(req.body);
        }
        netRequest.end();
    });
}

async function runSpeechRequestInMain(req: SpeechRequestData): Promise<SpeechRequestResult> {
    if (!req?.url) {
        return makeSpeechErrorResponse(400, "Bad Request", "Missing speech request url.");
    }
    let requestUrl: URL;
    try {
        requestUrl = new URL(req.url);
    } catch {
        return makeSpeechErrorResponse(400, "Bad Request", "Invalid speech request url.");
    }

    if (isBuiltinEdgeTtsCandidate(requestUrl)) {
        try {
            return await runBuiltinEdgeSpeechRequest(req);
        } catch (e) {
            const message =
                `内置 Edge TTS 合成失败。` +
                ` 原始错误：${e instanceof Error ? e.message : String(e)}`;
            return makeSpeechErrorResponse(502, "Bad Gateway", message);
        }
    }

    // Edge-only: do not proxy external TTS endpoints (API or localhost sidecars).
    // This removes accidental downgrade to low-quality fallback TTS and avoids port conflicts.
    if (requestUrl.protocol === "http:" || requestUrl.protocol === "https:") {
        // Special-case old configs pointing to 127.0.0.1:5050/5051 for better diagnostics.
        if (isBuiltinLocalSpeechCandidate(requestUrl)) {
            const port = Number(requestUrl.port || "0");
            if (Number.isFinite(port) && port > 0) {
                const owner = await getWindowsListeningPortOwner(port);
                const formatted = formatWindowsListeningPortOwner(owner);
                const message =
                    `检测到旧版本地语音 Endpoint：${requestUrl.toString()}。` +
                    (formatted ? ` 端口占用：${formatted}。` : "") +
                    ` 当前版本只支持内置 Edge TTS（wave://edge-tts/v1/audio/speech），无需端口。`;
                return makeSpeechErrorResponse(400, "Bad Request", message);
            }
        }
        return makeSpeechErrorResponse(
            400,
            "Bad Request",
            `当前版本只支持内置 Edge TTS（wave://edge-tts/v1/audio/speech），不支持外部 Endpoint：${requestUrl.toString()}`
        );
    }

    return makeSpeechErrorResponse(400, "Bad Request", `Unsupported speech endpoint protocol: ${requestUrl.protocol}`);
}

function saveImageFileWithNativeDialog(
    sender: electron.WebContents,
    defaultFileName: string,
    mimeType: string,
    readStream: Readable
) {
    if (defaultFileName == null || defaultFileName == "") {
        defaultFileName = "image";
    }
    const ww = electron.BrowserWindow.fromWebContents(sender);
    if (ww == null) {
        readStream.destroy();
        return;
    }
    const mimeToExtension: { [key: string]: string } = {
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/gif": "gif",
        "image/webp": "webp",
        "image/bmp": "bmp",
        "image/tiff": "tiff",
        "image/heic": "heic",
        "image/svg+xml": "svg",
    };
    function addExtensionIfNeeded(fileName: string, mimeType: string): string {
        const extension = mimeToExtension[mimeType];
        if (!path.extname(fileName) && extension) {
            return `${fileName}.${extension}`;
        }
        return fileName;
    }
    defaultFileName = addExtensionIfNeeded(defaultFileName, mimeType);
    electron.dialog
        .showSaveDialog(ww, {
            title: i18next.t("native.saveImage"),
            defaultPath: defaultFileName,
            filters: [
                { name: i18next.t("native.images"), extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "heic"] },
            ],
        })
        .then((file) => {
            if (file.canceled) {
                readStream.destroy();
                return;
            }
            const writeStream = fs.createWriteStream(file.filePath);
            readStream.pipe(writeStream);
            writeStream.on("finish", () => {
                console.log("saved file", file.filePath);
            });
            writeStream.on("error", (err) => {
                console.log("error saving file (writeStream)", err);
                readStream.destroy();
            });
            readStream.on("error", (err) => {
                console.error("error saving file (readStream)", err);
                writeStream.destroy();
            });
        })
        .catch((err) => {
            console.log("error trying to save file", err);
            readStream.destroy();
        });
}

const MaxCodexTranslateChars = 20_000;

function getUserCodexHome(): string {
    const envHome = process.env.CODEX_HOME;
    if (envHome && envHome.trim()) {
        return envHome.trim();
    }
    return path.join(os.homedir(), ".codex");
}

type CodexAuthJson = {
    OPENAI_API_KEY?: string;
    [key: string]: unknown;
};

async function readCodexAuthJson(codexHome: string): Promise<CodexAuthJson | null> {
    try {
        const authPath = path.join(codexHome, "auth.json");
        const raw = await fs.promises.readFile(authPath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as CodexAuthJson;
        }
    } catch {
        // ignore
    }
    return null;
}

function codexAuthReadyFromAuthJson(auth: CodexAuthJson | null): boolean {
    const key = auth?.OPENAI_API_KEY;
    return typeof key === "string" && key.trim().length > 0;
}

async function copyCodexUserConfigToEphemeralHome(userCodexHome: string, tmpHome: string): Promise<void> {
    try {
        const configSrc = path.join(userCodexHome, "config.toml");
        const configDst = path.join(tmpHome, "config.toml");
        await fs.promises.copyFile(configSrc, configDst);
    } catch {
        // ignore
    }

    try {
        const rulesSrc = path.join(userCodexHome, "rules", "default.rules");
        const rulesDir = path.join(tmpHome, "rules");
        const rulesDst = path.join(rulesDir, "default.rules");
        await fs.promises.mkdir(rulesDir, { recursive: true });
        await fs.promises.copyFile(rulesSrc, rulesDst);
    } catch {
        // ignore
    }
}

async function makeCodexHomeForChildProcess(): Promise<{ home: string; cleanup: () => Promise<void> }> {
    const tmpHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), "wave-codex-home-"));
    const cleanup = async () => {
        await fs.promises.rm(tmpHome, { recursive: true, force: true }).catch(() => {});
    };

    try {
        const userCodexHome = getUserCodexHome();
        const userAuth = await readCodexAuthJson(userCodexHome);
        const envApiKey = process.env.OPENAI_API_KEY;
        const outAuth: CodexAuthJson = {};

        if (codexAuthReadyFromAuthJson(userAuth)) {
            outAuth.OPENAI_API_KEY = String(userAuth.OPENAI_API_KEY);
        } else if (typeof envApiKey === "string" && envApiKey.trim()) {
            outAuth.OPENAI_API_KEY = envApiKey.trim();
        }

        if (codexAuthReadyFromAuthJson(outAuth)) {
            await fs.promises.writeFile(path.join(tmpHome, "auth.json"), JSON.stringify(outAuth, null, 2), "utf8");
        }

        // Keep Codex behavior consistent with the user's setup (e.g. approval_policy=never),
        // while still running in an isolated ephemeral CODEX_HOME.
        await copyCodexUserConfigToEphemeralHome(userCodexHome, tmpHome);
    } catch {
        // ignore
    }

    return { home: tmpHome, cleanup };
}

async function runCodexTranslate(text: string): Promise<string> {
    if (typeof text !== "string") {
        throw new Error("Invalid text");
    }
    if (text.includes("\0")) {
        throw new Error("Invalid text");
    }
    const trimmed = text.trim();
    if (!trimmed) {
        throw new Error("No text to translate");
    }
    if (text.length > MaxCodexTranslateChars) {
        throw new Error(`Text too long (${text.length} chars). Please select less text.`);
    }

    const outPath = path.join(
        os.tmpdir(),
        `wave-codex-translate-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`
    );

    const prompt = [
        "Translate the text between <<<WAVE_TEXT_START>>> and <<<WAVE_TEXT_END>>> into Simplified Chinese.",
        "- Preserve formatting, code blocks, inline code, commands, file paths, and URLs.",
        "- Output only the translation and nothing else.",
        "",
        "<<<WAVE_TEXT_START>>>",
        text,
        "<<<WAVE_TEXT_END>>>",
        "",
    ].join("\n");

    const args = [
        "--ask-for-approval",
        "never",
        "exec",
        "--skip-git-repo-check",
        "--ephemeral",
        "--sandbox",
        "read-only",
        "--color",
        "never",
        "--output-last-message",
        outPath,
        "-",
    ];

    let stdout = "";
    let stderr = "";
    const codexHomeCtx = await makeCodexHomeForChildProcess();

    try {
        await new Promise<void>((resolve, reject) => {
            const proc = child_process.spawn("codex", args, {
                windowsHide: true,
                env: { ...process.env, CODEX_HOME: codexHomeCtx.home },
            });
            proc.on("error", (err) => reject(err));
            proc.stdout.on("data", (d) => {
                stdout += d.toString();
            });
            proc.stderr.on("data", (d) => {
                stderr += d.toString();
            });
            proc.on("close", (code) => {
                if (code !== 0) {
                    const msg = stderr.trim() || stdout.trim() || `codex exited with code ${code}`;
                    reject(new Error(msg));
                    return;
                }
                resolve();
            });
            proc.stdin.end(prompt);
        });

        const result = await fs.promises.readFile(outPath, "utf8");
        return result.replace(/\r\n/g, "\n").trimEnd();
    } finally {
        await codexHomeCtx.cleanup();
        await fs.promises.unlink(outPath).catch(() => {});
    }
}

export function initIpcHandlers() {
    const debugOpenExternal = process.env.WAVETERM_DEBUG_OPEN_EXTERNAL === "1";
    electron.ipcMain.on("open-external", (event, url) => {
        if (url && typeof url === "string") {
            if (debugOpenExternal) {
                console.log("openExternal", url);
            }
            fireAndForget(() =>
                callWithOriginalXdgCurrentDesktopAsync(() =>
                    electron.shell.openExternal(url).catch((err) => {
                        console.error(`Failed to open URL ${url}:`, err);
                    })
                )
            );
        } else {
            console.error("Invalid URL received in open-external event:", url);
        }
    });

    electron.ipcMain.on("webview-image-contextmenu", (event: electron.IpcMainEvent, payload: { src: string }) => {
        const menu = new electron.Menu();
        const win = getWaveWindowByWebContentsId(event.sender.hostWebContents.id);
        if (win == null) {
            return;
        }
        menu.append(
            new electron.MenuItem({
                label: i18next.t("native.saveImage"),
                click: () => {
                    const resultP = getUrlInSession(event.sender.session, payload.src);
                    resultP
                        .then((result) => {
                            saveImageFileWithNativeDialog(
                                event.sender.hostWebContents ?? event.sender,
                                result.fileName,
                                result.mimeType,
                                result.stream
                            );
                        })
                        .catch((e) => {
                            console.log("error getting image", e);
                        });
                },
            })
        );
        menu.popup();
    });

    electron.ipcMain.on("download", (event, payload) => {
        const baseName = encodeURIComponent(path.basename(payload.filePath));
        const streamingUrl =
            getWebServerEndpoint() + "/wave/stream-file/" + baseName + "?path=" + encodeURIComponent(payload.filePath);
        event.sender.downloadURL(streamingUrl);
    });

    electron.ipcMain.on("get-cursor-point", (event) => {
        const tabView = getWaveTabViewByWebContentsId(event.sender.id);
        if (tabView == null) {
            event.returnValue = null;
            return;
        }
        const screenPoint = electron.screen.getCursorScreenPoint();
        const windowRect = tabView.getBounds();
        const retVal: Electron.Point = {
            x: screenPoint.x - windowRect.x,
            y: screenPoint.y - windowRect.y,
        };
        event.returnValue = retVal;
    });

    electron.ipcMain.handle("capture-screenshot", async (event, rect) => {
        const tabView = getWaveTabViewByWebContentsId(event.sender.id);
        if (!tabView) {
            throw new Error("No tab view found for the given webContents id");
        }
        const image = await tabView.webContents.capturePage(rect);
        const base64String = image.toPNG().toString("base64");
        return `data:image/png;base64,${base64String}`;
    });

    electron.ipcMain.on("get-env", (event, varName) => {
        event.returnValue = process.env[varName] ?? null;
    });

    electron.ipcMain.on("get-about-modal-details", (event) => {
        const base = getWaveVersion() as AboutModalDetails;
        event.returnValue = {
            ...base,
            uiCommit: (process.env.WAVETERM_UI_COMMIT ?? "").toString(),
            uiBuildIso: (process.env.WAVETERM_UI_BUILD_ISO ?? "").toString(),
            uiDirty: (process.env.WAVETERM_UI_DIRTY ?? "") === "1",
            profile: (process.env.WAVETERM_PROFILE ?? "").toString(),
        } as AboutModalDetails;
    });

    electron.ipcMain.on("get-zoom-factor", (event) => {
        event.returnValue = event.sender.getZoomFactor();
    });

    const hasBeforeInputRegisteredMap = new Map<number, boolean>();

    electron.ipcMain.on("webview-focus", (event: Electron.IpcMainEvent, focusedId: number) => {
        webviewFocusId = focusedId;
        console.log("webview-focus", focusedId);
        if (focusedId == null) {
            return;
        }
        const parentWc = event.sender;
        const webviewWc = electron.webContents.fromId(focusedId);
        if (webviewWc == null) {
            webviewFocusId = null;
            return;
        }
        if (!hasBeforeInputRegisteredMap.get(focusedId)) {
            hasBeforeInputRegisteredMap.set(focusedId, true);
            webviewWc.on("before-input-event", (e, input) => {
                let waveEvent = keyutil.adaptFromElectronKeyEvent(input);
                handleCtrlShiftState(parentWc, waveEvent);
                if (webviewFocusId != focusedId) {
                    return;
                }
                if (input.type != "keyDown") {
                    return;
                }
                for (let keyDesc of webviewKeys) {
                    if (keyutil.checkKeyPressed(waveEvent, keyDesc)) {
                        e.preventDefault();
                        parentWc.send("reinject-key", waveEvent);
                        console.log("webview reinject-key", keyDesc);
                        return;
                    }
                }
            });
            webviewWc.on("destroyed", () => {
                hasBeforeInputRegisteredMap.delete(focusedId);
            });
        }
    });

    electron.ipcMain.on("register-global-webview-keys", (event, keys: string[]) => {
        webviewKeys = keys ?? [];
    });

    electron.ipcMain.on("set-keyboard-chord-mode", (event) => {
        event.returnValue = null;
        const tabView = getWaveTabViewByWebContentsId(event.sender.id);
        tabView?.setKeyboardChordMode(true);
    });

    electron.ipcMain.handle("set-is-active", () => {
        setWasActive(true);
    });

    const fac = new FastAverageColor();
    electron.ipcMain.on("update-window-controls-overlay", async (event, rect: Dimensions) => {
        if (unamePlatform === "darwin") return;
        try {
            const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
            if (fullConfig?.settings?.["window:nativetitlebar"] && unamePlatform !== "win32") return;

            const zoomFactor = event.sender.getZoomFactor();
            const electronRect: Electron.Rectangle = {
                x: rect.left * zoomFactor,
                y: rect.top * zoomFactor,
                height: rect.height * zoomFactor,
                width: rect.width * zoomFactor,
            };
            const overlay = await event.sender.capturePage(electronRect);
            const overlayBuffer = overlay.toPNG();
            const png = PNG.sync.read(overlayBuffer);
            const color = fac.prepareResult(fac.getColorFromArray4(png.data));
            const ww = getWaveWindowByWebContentsId(event.sender.id);
            ww.setTitleBarOverlay({
                color: unamePlatform === "linux" ? color.rgba : "#00000000",
                symbolColor: color.isDark ? "white" : "black",
            });
        } catch (e) {
            console.error("Error updating window controls overlay:", e);
        }
    });

    electron.ipcMain.on("quicklook", (event, filePath: string) => {
        if (unamePlatform !== "darwin") return;
        child_process.execFile("/usr/bin/qlmanage", ["-p", filePath], (error, stdout, stderr) => {
            if (error) {
                console.error(`Error opening Quick Look: ${error}`);
            }
        });
    });

    electron.ipcMain.handle("clear-webview-storage", async (event, webContentsId: number) => {
        try {
            const wc = electron.webContents.fromId(webContentsId);
            if (wc && wc.session) {
                await wc.session.clearStorageData();
                console.log("Cleared cookies and storage for webContentsId:", webContentsId);
            }
        } catch (e) {
            console.error("Failed to clear cookies and storage:", e);
            throw e;
        }
    });

    electron.ipcMain.handle("git-run", async (_event, cwd: string, args: string[]) => {
        return runGitCommand(cwd, args);
    });

    electron.ipcMain.handle("codex-translate", async (_event, text: string) => {
        return runCodexTranslate(text);
    });

    electron.ipcMain.handle("codex-auth-ready", async () => {
        const envKey = process.env.OPENAI_API_KEY;
        if (typeof envKey === "string" && envKey.trim()) {
            return true;
        }
        const auth = await readCodexAuthJson(getUserCodexHome());
        return codexAuthReadyFromAuthJson(auth);
    });

    electron.ipcMain.handle("speech-request", async (_event, req: SpeechRequestData) => {
        return await runSpeechRequestInMain(req);
    });

    electron.ipcMain.handle("get-listening-port-owner", async (_event, port: number) => {
        const normalized = Number(port);
        if (!Number.isFinite(normalized) || normalized <= 0 || normalized > 65535) {
            return null;
        }
        return await getWindowsListeningPortOwner(Math.trunc(normalized));
    });

    electron.ipcMain.handle("speech-log", async (_event, entry: SpeechLogData) => {
        const normalized = normalizeSpeechLogData(entry ?? {});
        await appendSpeechLogData(normalized);
        console.log("speech-log", JSON.stringify(normalized));
        return true;
    });

    electron.ipcMain.handle("pve-list-machines", async (_event, req?: PveListMachinesRequest) => {
        return await listPveMachines(req);
    });
    electron.ipcMain.handle("pve-create-console-session", async (_event, req: PveCreateConsoleSessionRequest) => {
        return await createPveConsoleSession(req);
    });

    electron.ipcMain.on("open-native-path", (event, filePath: string) => {
        console.log("open-native-path", filePath);
        filePath = filePath.replace("~", electronApp.getPath("home"));
        fireAndForget(() =>
            callWithOriginalXdgCurrentDesktopAsync(() =>
                electron.shell.openPath(filePath).then((excuse) => {
                    if (excuse) console.error(`Failed to open ${filePath} in native application: ${excuse}`);
                })
            )
        );
    });

    electron.ipcMain.on("set-window-init-status", (event, status: "ready" | "wave-ready") => {
        const tabView = getWaveTabViewByWebContentsId(event.sender.id);
        if (tabView != null && tabView.initResolve != null) {
            if (status === "ready") {
                tabView.initResolve();
                if (tabView.savedInitOpts) {
                    console.log("savedInitOpts calling wave-init", tabView.waveTabId);
                    tabView.webContents.send("wave-init", tabView.savedInitOpts);
                }
            } else if (status === "wave-ready") {
                tabView.waveReadyResolve();
            }
            return;
        }

        const builderWindow = getBuilderWindowByWebContentsId(event.sender.id);
        if (builderWindow != null) {
            if (status === "ready") {
                if (builderWindow.savedInitOpts) {
                    console.log("savedInitOpts calling builder-init", builderWindow.savedInitOpts.builderId);
                    builderWindow.webContents.send("builder-init", builderWindow.savedInitOpts);
                }
            }
            return;
        }

        console.log("set-window-init-status: no window found for webContentsId", event.sender.id);
    });

    electron.ipcMain.on("fe-log", (event, logStr: string) => {
        console.log("fe-log", logStr);
    });

    electron.ipcMain.on(
        "increment-term-commands",
        (event, opts?: { isRemote?: boolean; isWsl?: boolean; isDurable?: boolean }) => {
            incrementTermCommandsRun();
            if (opts?.isRemote) {
                incrementTermCommandsRemote();
            }
            if (opts?.isWsl) {
                incrementTermCommandsWsl();
            }
            if (opts?.isDurable) {
                incrementTermCommandsDurable();
            }
        }
    );

    electron.ipcMain.on("native-paste", (event) => {
        event.sender.paste();
    });

    electron.ipcMain.on("open-builder", (event, appId?: string) => {
        openBuilderWindow(appId);
    });

    electron.ipcMain.on("set-builder-window-appid", (event, appId: string) => {
        const bw = getBuilderWindowByWebContentsId(event.sender.id);
        if (bw == null) {
            return;
        }
        bw.builderAppId = appId;
        console.log("set-builder-window-appid", bw.builderId, appId);
    });

    electron.ipcMain.on("open-new-window", () => fireAndForget(createNewWaveWindow));

    electron.ipcMain.on("close-builder-window", async (event) => {
        const bw = getBuilderWindowByWebContentsId(event.sender.id);
        if (bw == null) {
            return;
        }
        const builderId = bw.builderId;
        if (builderId) {
            try {
                await RpcApi.SetRTInfoCommand(ElectronWshClient, {
                    oref: `builder:${builderId}`,
                    data: {} as ObjRTInfo,
                    delete: true,
                });
            } catch (e) {
                console.error("Error deleting builder rtinfo:", e);
            }
        }
        bw.destroy();
    });

    electron.ipcMain.on("do-refresh", (event) => {
        event.sender.reloadIgnoringCache();
    });

    electron.ipcMain.handle("save-text-file", async (event, fileName: string, content: string) => {
        const ww = electron.BrowserWindow.fromWebContents(event.sender);
        if (ww == null) {
            return false;
        }
        const result = await electron.dialog.showSaveDialog(ww, {
            title: "Save Scrollback",
            defaultPath: fileName || "session.log",
            filters: [{ name: "Text Files", extensions: ["txt", "log"] }],
        });
        if (result.canceled || !result.filePath) {
            return false;
        }
        try {
            await fs.promises.writeFile(result.filePath, content, "utf-8");
            console.log("saved scrollback to", result.filePath);
            return true;
        } catch (err) {
            console.error("error saving scrollback file", err);
            return false;
        }
    });
}

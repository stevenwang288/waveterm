// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { app } from "electron";
import { spawn, ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { getElectronAppBasePath } from "./emain-platform";

type GooseBridgeConfig = {
    waveProjectRoot: string;
    workspaceRoot: string;
    gooseSourceRoot: string;
    goosedBinaryPath: string | null;
    frontendUrl: string;
    workingDir: string;
    runtimeRoot: string;
    configDir: string;
    envFileVars: Record<string, string>;
    appConfig: Record<string, unknown>;
};

type GooseRuntimeState = {
    baseUrl: string;
    child: ChildProcess;
    secretKey: string;
};

let gooseRuntime: GooseRuntimeState = null;
let gooseRuntimePromise: Promise<GooseRuntimeState> = null;
let cleanupRegistered = false;

function ensureDir(dirPath: string) {
    mkdirSync(dirPath, { recursive: true });
    return dirPath;
}

function parseEnvValue(rawValue: string) {
    const trimmed = rawValue.trim();
    if (
        (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

function parseEnvFile(filePath: string) {
    if (!existsSync(filePath)) {
        return {};
    }
    const envVars: Record<string, string> = {};
    for (const line of readFileSync(filePath, "utf-8").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("#")) {
            continue;
        }
        const separatorIdx = trimmed.indexOf("=");
        if (separatorIdx <= 0) {
            continue;
        }
        const key = trimmed.slice(0, separatorIdx).trim();
        envVars[key] = parseEnvValue(trimmed.slice(separatorIdx + 1));
    }
    return envVars;
}

function findFirstExisting(paths: string[]) {
    return paths.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

function copyDirectoryContents(sourceDir: string, targetDir: string, force: boolean) {
    ensureDir(targetDir);
    for (const entryName of readdirSync(sourceDir)) {
        cpSync(path.join(sourceDir, entryName), path.join(targetDir, entryName), {
            recursive: true,
            force,
            errorOnExist: false,
        });
    }
}

function resolveWorkspaceRoot(waveProjectRoot: string) {
    const override = process.env.WAVE_GOOSE_WORKSPACE_ROOT;
    if (override) {
        return override;
    }
    const parentRoot = path.dirname(waveProjectRoot);
    if (existsSync(path.join(parentRoot, "goose-main")) || existsSync(path.join(parentRoot, "wae"))) {
        return parentRoot;
    }
    return waveProjectRoot;
}

function resolveGooseConfigSourceDir(workspaceRoot: string, waveProjectRoot: string) {
    const override = process.env.WAVE_GOOSE_CONFIG_SOURCE;
    if (override && existsSync(override)) {
        return override;
    }
    const candidates = [
        path.join(workspaceRoot, ".runtime", "goose-source-config"),
        path.join(waveProjectRoot, ".runtime", "goose-source-config"),
        path.join(app.getPath("appData"), "Block", "goose", "config"),
        process.env.HOME ? path.join(process.env.HOME, ".config", "goose", "config") : null,
    ].filter((candidate) => candidate != null);
    return findFirstExisting(candidates);
}

function syncGooseConfig(config: GooseBridgeConfig) {
    const shouldForce = process.env.WAVE_GOOSE_FORCE_CONFIG_SYNC === "true";
    const hasLocalConfig =
        existsSync(path.join(config.configDir, "config.yaml")) || existsSync(path.join(config.configDir, "secrets.yaml"));
    if (hasLocalConfig && !shouldForce) {
        return;
    }
    const sourceDir = resolveGooseConfigSourceDir(config.workspaceRoot, config.waveProjectRoot);
    if (sourceDir == null) {
        console.warn("[goose-bridge] no Goose config source found; continuing with project-local runtime only");
        return;
    }
    console.log("[goose-bridge] syncing config", {
        sourceDir,
        targetDir: config.configDir,
        force: shouldForce,
    });
    copyDirectoryContents(sourceDir, config.configDir, shouldForce);
}

function createAppConfig(config: GooseBridgeConfig) {
    const envVars = config.envFileVars;
    return {
        GOOSE_ALLOWLIST_WARNING: false,
        GOOSE_API_HOST: null,
        GOOSE_CONFIG_DIR: config.configDir,
        GOOSE_BASE_URL_SHARE: envVars.GOOSE_BASE_URL_SHARE ?? null,
        GOOSE_DEFAULT_MODEL: envVars.GOOSE_DEFAULT_MODEL ?? envVars.GOOSE_MODEL ?? null,
        GOOSE_DEFAULT_PROVIDER: envVars.GOOSE_DEFAULT_PROVIDER ?? envVars.GOOSE_PROVIDER ?? null,
        GOOSE_PATH_ROOT: config.runtimeRoot,
        GOOSE_PREDEFINED_MODELS: envVars.GOOSE_PREDEFINED_MODELS ?? null,
        GOOSE_VERSION: process.env.WAVE_GOOSE_VERSION ?? "Wave Goose Bridge",
        GOOSE_WORKING_DIR: config.workingDir,
        SECURITY_ML_MODEL_MAPPING: process.env.SECURITY_ML_MODEL_MAPPING ?? null,
    };
}

function resolveGooseBridgeConfig(): GooseBridgeConfig {
    const appBasePath = getElectronAppBasePath();
    const waveProjectRoot = path.resolve(appBasePath, "..");
    const workspaceRoot = resolveWorkspaceRoot(waveProjectRoot);
    const gooseSourceRoot =
        process.env.WAVE_GOOSE_SOURCE_ROOT ??
        findFirstExisting([path.join(workspaceRoot, "goose-main"), path.join(waveProjectRoot, "goose-main")]) ??
        path.join(workspaceRoot, "goose-main");
    const runtimeRoot = ensureDir(
        process.env.WAVE_GOOSE_PATH_ROOT ?? path.join(waveProjectRoot, ".runtime", "goose-home")
    );
    const configDir = ensureDir(path.join(runtimeRoot, "config"));
    ensureDir(path.join(runtimeRoot, "data"));
    ensureDir(path.join(runtimeRoot, "state"));

    const envFilePath = process.env.WAVE_GOOSE_ENV_FILE ?? path.join(waveProjectRoot, ".runtime", "goose.env");
    const envFileVars = parseEnvFile(envFilePath);
    const goosedBinaryPath =
        process.env.WAVE_GOOSE_BINARY ??
        findFirstExisting([
            process.env.CARGO_TARGET_DIR
                ? path.join(
                      process.env.CARGO_TARGET_DIR,
                      "release",
                      process.platform === "win32" ? "goosed.exe" : "goosed"
                  )
                : null,
            process.env.CARGO_TARGET_DIR
                ? path.join(process.env.CARGO_TARGET_DIR, "debug", process.platform === "win32" ? "goosed.exe" : "goosed")
                : null,
            path.join(gooseSourceRoot, "target", "release", process.platform === "win32" ? "goosed.exe" : "goosed"),
            path.join(gooseSourceRoot, "target", "debug", process.platform === "win32" ? "goosed.exe" : "goosed"),
        ].filter((candidate) => candidate != null));
    const config: GooseBridgeConfig = {
        waveProjectRoot,
        workspaceRoot,
        gooseSourceRoot,
        goosedBinaryPath,
        frontendUrl: process.env.WAVE_GOOSE_FRONTEND_URL ?? "http://127.0.0.1:5180/#/",
        workingDir: process.env.WAVE_GOOSE_WORKING_DIR ?? workspaceRoot,
        runtimeRoot,
        configDir,
        envFileVars,
        appConfig: {},
    };
    syncGooseConfig(config);
    config.appConfig = createAppConfig(config);
    return config;
}

function findAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            if (address == null || typeof address === "string") {
                server.close();
                reject(new Error("failed to allocate a Goose bridge port"));
                return;
            }
            server.close((closeError) => {
                if (closeError) {
                    reject(closeError);
                    return;
                }
                resolve(address.port);
            });
        });
    });
}

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServerReady(baseUrl: string, secretKey: string) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 20000) {
        try {
            const response = await fetch(`${baseUrl}/status`, {
                headers: {
                    "Content-Type": "application/json",
                    "X-Secret-Key": secretKey,
                },
            });
            if (response.ok) {
                return;
            }
        } catch {
            // keep waiting
        }
        await sleep(150);
    }
    throw new Error(`timed out waiting for Goose backend at ${baseUrl}`);
}

async function startGooseRuntime(config: GooseBridgeConfig): Promise<GooseRuntimeState> {
    if (config.goosedBinaryPath == null) {
        throw new Error(
            `Goose backend binary not found. Set WAVE_GOOSE_BINARY or build ${path.join(config.gooseSourceRoot, "target")}.`
        );
    }

    const port = await findAvailablePort();
    const secretKey = randomBytes(24).toString("hex");
    const baseUrl = `http://127.0.0.1:${port}`;
    const env = {
        ...process.env,
        ...config.envFileVars,
        GOOSE_DISABLE_KEYRING: "1",
        GOOSE_PATH_ROOT: config.runtimeRoot,
        GOOSE_PORT: String(port),
        GOOSE_SERVER__SECRET_KEY: secretKey,
        GOOSE_TLS: "false",
    };

    console.log("[goose-bridge] starting backend", {
        binary: config.goosedBinaryPath,
        frontendUrl: config.frontendUrl,
        runtimeRoot: config.runtimeRoot,
        workingDir: config.workingDir,
    });

    const child = spawn(config.goosedBinaryPath, ["agent"], {
        cwd: config.workingDir,
        env,
        detached: false,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
    });

    child.stdout?.setEncoding("utf-8");
    child.stderr?.setEncoding("utf-8");
    child.stdout?.on("data", (chunk: string) => console.log(`[goose-bridge][stdout] ${chunk.trimEnd()}`));
    child.stderr?.on("data", (chunk: string) => console.log(`[goose-bridge][stderr] ${chunk.trimEnd()}`));

    const runtime: GooseRuntimeState = {
        baseUrl,
        child,
        secretKey,
    };

    child.once("exit", (code, signal) => {
        console.log("[goose-bridge] backend exited", { code, signal });
        if (gooseRuntime?.child === child) {
            gooseRuntime = null;
        }
    });

    await waitForServerReady(baseUrl, secretKey);
    return runtime;
}

function registerCleanupOnce() {
    if (cleanupRegistered) {
        return;
    }
    cleanupRegistered = true;
    app.once("before-quit", () => {
        disposeGooseRuntime();
    });
}

async function ensureGooseRuntime() {
    registerCleanupOnce();
    if (gooseRuntime != null) {
        return gooseRuntime;
    }
    if (gooseRuntimePromise != null) {
        return gooseRuntimePromise;
    }

    const config = resolveGooseBridgeConfig();
    gooseRuntimePromise = startGooseRuntime(config)
        .then((runtime) => {
            gooseRuntime = runtime;
            gooseRuntimePromise = null;
            return runtime;
        })
        .catch((error) => {
            gooseRuntimePromise = null;
            throw error;
        });
    return gooseRuntimePromise;
}

export function getGooseAppConfig() {
    return resolveGooseBridgeConfig().appConfig;
}

export function getGooseFrontendUrl() {
    return resolveGooseBridgeConfig().frontendUrl;
}

export async function getGooseSecretKey() {
    const runtime = await ensureGooseRuntime();
    return runtime.secretKey;
}

export async function getGooseBaseUrl() {
    const runtime = await ensureGooseRuntime();
    return runtime.baseUrl;
}

export function disposeGooseRuntime() {
    if (gooseRuntime?.child && !gooseRuntime.child.killed) {
        gooseRuntime.child.kill();
    }
    gooseRuntime = null;
}

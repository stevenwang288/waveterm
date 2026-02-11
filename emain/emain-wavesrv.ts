// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as electron from "electron";
import * as child_process from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as readline from "readline";
import { WebServerEndpointVarName, WSServerEndpointVarName } from "../frontend/util/endpoints";
import { AuthKey, WaveAuthKeyEnv } from "./authkey";
import {
    getForceQuit,
    getGlobalIsQuitting,
    getGlobalIsRelaunching,
    getUserConfirmedQuit,
    setForceQuit,
    setGlobalIsRelaunching,
    setUserConfirmedQuit,
} from "./emain-activity";
import {
    getElectronAppResourcesPath,
    getElectronAppUnpackedBasePath,
    getWaveConfigDir,
    getWaveDataDir,
    getWaveSrvCwd,
    getWaveSrvPath,
    getXdgCurrentDesktop,
    WaveConfigHomeVarName,
    WaveDataHomeVarName,
} from "./emain-platform";
import {
    getElectronExecPath,
    WaveAppElectronExecPath,
    WaveAppPathVarName,
    WaveAppResourcesPathVarName,
} from "./emain-util";
import { updater } from "./updater";

let isWaveSrvDead = false;
let waveSrvProc: child_process.ChildProcessWithoutNullStreams | null = null;
let WaveVersion = "unknown"; // set by WAVESRV-ESTART
let WaveBuildTime = 0; // set by WAVESRV-ESTART

export function getWaveVersion(): { version: string; buildTime: number } {
    return { version: WaveVersion, buildTime: WaveBuildTime };
}

let waveSrvReadyResolve = (value: boolean) => {};
const waveSrvReady: Promise<boolean> = new Promise((resolve, _) => {
    waveSrvReadyResolve = resolve;
});

const waveSrvLineBuffer: string[] = [];
const MaxWaveSrvLineBufferSize = 800;

function parseDotEnvFile(contents: string): Record<string, string> {
    const out: Record<string, string> = {};
    if (!contents) {
        return out;
    }
    const lines = contents.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx <= 0) {
            continue;
        }
        const key = trimmed.slice(0, eqIdx).trim();
        if (!key) {
            continue;
        }
        let value = trimmed.slice(eqIdx + 1).trim();
        if (
            (value.startsWith("\"") && value.endsWith("\"") && value.length >= 2) ||
            (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
        ) {
            value = value.slice(1, -1);
        }
        out[key] = value;
    }
    return out;
}

function applyDotEnvToEnvCopy(envCopy: Record<string, string | undefined>): void {
    // In dev, we keep cloud endpoints in a repo-root `.env` (sibling of `dist/`).
    // Ensure the spawned `wavesrv` inherits these vars, otherwise it will exit early in dev mode.
    const dotenvPath = path.resolve(getElectronAppResourcesPath(), "..", ".env");
    try {
        if (!fs.existsSync(dotenvPath)) {
            return;
        }
        const parsed = parseDotEnvFile(fs.readFileSync(dotenvPath, "utf8"));
        for (const [key, value] of Object.entries(parsed)) {
            if (envCopy[key] == null || envCopy[key] === "") {
                envCopy[key] = value;
            }
        }
    } catch (err) {
        console.log("warning: failed to load .env for wavesrv (non-fatal):", dotenvPath, err);
    }
}

function pushWaveSrvLine(prefix: string, line: string) {
    const nextLine = `${prefix}${line}`;
    waveSrvLineBuffer.push(nextLine);
    if (waveSrvLineBuffer.length > MaxWaveSrvLineBufferSize) {
        waveSrvLineBuffer.splice(0, waveSrvLineBuffer.length - MaxWaveSrvLineBufferSize);
    }
}

function writeWaveSrvExitLog(code: number | null, signal: NodeJS.Signals | null): string {
    const logsDir = path.join(getWaveDataDir(), "logs");
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
    const ts = new Date();
    const safeTs = ts.toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(logsDir, `wavesrv-exit-${safeTs}.log`);
    const header = [
        `timestamp=${ts.toISOString()}`,
        `code=${code ?? "null"}`,
        `signal=${signal ?? "null"}`,
        `note=wavesrv exited unexpectedly; see waveapp.log for full logs`,
        "",
    ];
    fs.writeFileSync(filePath, header.concat(waveSrvLineBuffer).join("\n"), "utf8");
    return filePath;
}

export function getWaveSrvReady(): Promise<boolean> {
    return waveSrvReady;
}

export function getWaveSrvProc(): child_process.ChildProcessWithoutNullStreams | null {
    return waveSrvProc;
}

export function getIsWaveSrvDead(): boolean {
    return isWaveSrvDead;
}

export function runWaveSrv(handleWSEvent: (evtMsg: WSEventType) => void): Promise<boolean> {
    let pResolve: (value: boolean) => void;
    let pReject: (reason?: any) => void;
    const rtnPromise = new Promise<boolean>((argResolve, argReject) => {
        pResolve = argResolve;
        pReject = argReject;
    });
    const envCopy = { ...process.env };
    applyDotEnvToEnvCopy(envCopy);
    const xdgCurrentDesktop = getXdgCurrentDesktop();
    if (xdgCurrentDesktop != null) {
        envCopy["XDG_CURRENT_DESKTOP"] = xdgCurrentDesktop;
    }
    envCopy[WaveAppPathVarName] = getElectronAppUnpackedBasePath();
    envCopy[WaveAppResourcesPathVarName] = getElectronAppResourcesPath();
    envCopy[WaveAppElectronExecPath] = getElectronExecPath();
    envCopy[WaveAuthKeyEnv] = AuthKey;
    envCopy[WaveDataHomeVarName] = getWaveDataDir();
    envCopy[WaveConfigHomeVarName] = getWaveConfigDir();
    const waveSrvCmd = getWaveSrvPath();
    console.log("trying to run local server", waveSrvCmd);
    const proc = child_process.spawn(getWaveSrvPath(), {
        cwd: getWaveSrvCwd(),
        env: envCopy,
    });
    proc.on("exit", (code, signal) => {
        if (updater?.status == "installing") {
            return;
        }
        const exitingNormally =
            getGlobalIsQuitting() || getUserConfirmedQuit() || getForceQuit() || getGlobalIsRelaunching();
        console.log(
            `wavesrv exited (code=${code ?? "null"} signal=${signal ?? "null"} normal=${exitingNormally})`
        );

        let exitLogPath = "";
        if (!exitingNormally) {
            try {
                exitLogPath = writeWaveSrvExitLog(code, signal);
                console.log("wavesrv exit log written:", exitLogPath);
            } catch (err) {
                console.log("error writing wavesrv exit log (non-fatal):", err);
            }
        }

        setForceQuit(true);
        isWaveSrvDead = true;
        if (exitingNormally) {
            electron.app.quit();
            return;
        }

        try {
            setGlobalIsRelaunching(true);
            electron.app.relaunch();
        } catch (err) {
            console.log("error relaunching app after wavesrv exit (non-fatal):", err);
        }
        electron.app.quit();
    });
    proc.on("spawn", (e) => {
        console.log("spawned wavesrv");
        waveSrvProc = proc;
        pResolve(true);
    });
    proc.on("error", (e) => {
        console.log("error running wavesrv", e);
        pReject(e);
    });
    const rlStdout = readline.createInterface({
        input: proc.stdout,
        terminal: false,
    });
    rlStdout.on("line", (line) => {
        pushWaveSrvLine("[stdout] ", line);
        console.log(line);
    });
    const rlStderr = readline.createInterface({
        input: proc.stderr,
        terminal: false,
    });
    rlStderr.on("line", (line) => {
        pushWaveSrvLine("[stderr] ", line);
        if (line.includes("WAVESRV-ESTART")) {
            const startParams = /ws:([a-z0-9.:]+) web:([a-z0-9.:]+) version:([a-z0-9.\-]+) buildtime:(\d+)/gm.exec(
                line
            );
            if (startParams == null) {
                console.log("error parsing WAVESRV-ESTART line", line);
                setUserConfirmedQuit(true);
                electron.app.quit();
                return;
            }
            process.env[WSServerEndpointVarName] = startParams[1];
            process.env[WebServerEndpointVarName] = startParams[2];
            WaveVersion = startParams[3];
            WaveBuildTime = parseInt(startParams[4]);
            waveSrvReadyResolve(true);
            return;
        }
        if (line.startsWith("WAVESRV-EVENT:")) {
            const evtJson = line.slice("WAVESRV-EVENT:".length);
            try {
                const evtMsg: WSEventType = JSON.parse(evtJson);
                handleWSEvent(evtMsg);
            } catch (e) {
                console.log("error handling WAVESRV-EVENT", e);
            }
            return;
        }
        console.log(line);
    });
    return rtnPromise;
}

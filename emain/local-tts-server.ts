// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import http from "node:http";
import type { AddressInfo } from "node:net";
import { synthesizeSpeechToWavBase64 } from "./local-tts-win";

type LocalTtsServer = {
    port: number;
    server: http.Server;
    close: () => Promise<void>;
};

let edgeServer: LocalTtsServer | null = null;
let meloServer: LocalTtsServer | null = null;

function isWindows(): boolean {
    return process.platform === "win32";
}

function safeJsonParse<T>(raw: string): T | null {
    try {
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

async function readBody(req: http.IncomingMessage): Promise<string> {
    return await new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", (err) => reject(err));
    });
}

function makeServer(port: number): LocalTtsServer {
    const server = http.createServer(async (req, res) => {
        try {
            if (!req.url || req.method?.toUpperCase() !== "POST") {
                res.statusCode = 404;
                res.end("not found");
                return;
            }
            const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
            if (url.pathname.toLowerCase() !== "/v1/audio/speech") {
                res.statusCode = 404;
                res.end("not found");
                return;
            }
            const rawBody = await readBody(req);
            const payload = safeJsonParse<{ input?: string; voice?: string; speed?: number }>(rawBody || "") ?? {};
            const input = (payload.input ?? "").toString();
            const voice = payload.voice != null ? String(payload.voice) : undefined;
            const speed = typeof payload.speed === "number" ? payload.speed : undefined;
            const audioBase64 = await synthesizeSpeechToWavBase64({ input, voice, speed });
            const audioBytes = Buffer.from(audioBase64, "base64");

            res.statusCode = 200;
            res.setHeader("Content-Type", "audio/wav");
            res.setHeader("Cache-Control", "no-store");
            res.end(audioBytes);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: msg || "local tts failed" }));
        }
    });

    const close = async (): Promise<void> => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    };

    return { port, server, close };
}

async function listen(server: http.Server, port: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => resolve());
    });
}

export async function startBuiltinLocalTtsServers(): Promise<void> {
    if (!isWindows()) {
        return;
    }
    if (!edgeServer) {
        const srv = makeServer(5050);
        try {
            await listen(srv.server, srv.port);
            edgeServer = srv;
            const addr = srv.server.address() as AddressInfo | null;
            console.log("builtin local TTS server started", addr?.address, addr?.port);
        } catch (e) {
            console.log("builtin local TTS server failed to start on 5050", e);
            try {
                await srv.close();
            } catch {}
        }
    }
    if (!meloServer) {
        const srv = makeServer(5051);
        try {
            await listen(srv.server, srv.port);
            meloServer = srv;
            const addr = srv.server.address() as AddressInfo | null;
            console.log("builtin local TTS server started", addr?.address, addr?.port);
        } catch (e) {
            console.log("builtin local TTS server failed to start on 5051", e);
            try {
                await srv.close();
            } catch {}
        }
    }
}

export async function stopBuiltinLocalTtsServers(): Promise<void> {
    const servers = [edgeServer, meloServer].filter(Boolean) as LocalTtsServer[];
    edgeServer = null;
    meloServer = null;
    for (const srv of servers) {
        try {
            await srv.close();
        } catch {}
    }
}


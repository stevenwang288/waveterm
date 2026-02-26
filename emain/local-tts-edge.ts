// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Buffer } from "node:buffer";
import type { Readable } from "node:stream";

export type EdgeTtsRequest = {
    input: string;
    voice?: string;
    speed?: number;
};

function normalizeSpeed(speed: unknown): number {
    if (typeof speed !== "number" || Number.isNaN(speed) || !Number.isFinite(speed)) {
        return 1;
    }
    return Math.max(0.5, Math.min(2, speed));
}

function xmlEscape(value: string): string {
    return (value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

async function readStreamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

type MsEdgeTtsModule = {
    MsEdgeTTS: new (...args: any[]) => {
        setMetadata: (voiceName: string, outputFormat: string, opts?: any) => Promise<void>;
        toStream: (input: string, opts?: any) => { audioStream: Readable };
    };
    OUTPUT_FORMAT: Record<string, string>;
};

let msedgeTtsModulePromise: Promise<MsEdgeTtsModule> | null = null;

async function getMsEdgeTtsModule(): Promise<MsEdgeTtsModule> {
    if (!msedgeTtsModulePromise) {
        msedgeTtsModulePromise = import("msedge-tts") as unknown as Promise<MsEdgeTtsModule>;
    }
    return await msedgeTtsModulePromise;
}

const edgeTtsInstancesByVoice = new Map<string, any>();

export async function synthesizeEdgeTtsToMp3Base64(req: EdgeTtsRequest): Promise<string> {
    const inputRaw = (req?.input ?? "").trim();
    if (!inputRaw) {
        throw new Error("No text content to read.");
    }

    const voiceRaw = (req?.voice ?? "").trim();
    if (!voiceRaw || voiceRaw.toLowerCase() === "system-default") {
        throw new Error("Edge TTS requires an explicit voice (e.g. zh-CN-XiaoxiaoNeural).");
    }

    const speed = normalizeSpeed(req?.speed);
    const input = xmlEscape(inputRaw);

    const mod = await getMsEdgeTtsModule();
    const OUTPUT = mod.OUTPUT_FORMAT ?? {};
    const outputFormat = OUTPUT.AUDIO_24KHZ_96KBITRATE_MONO_MP3 || OUTPUT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;
    if (!outputFormat) {
        throw new Error("Edge TTS output format is unavailable.");
    }

    let tts = edgeTtsInstancesByVoice.get(voiceRaw);
    if (!tts) {
        tts = new mod.MsEdgeTTS();
        await tts.setMetadata(voiceRaw, outputFormat);
        edgeTtsInstancesByVoice.set(voiceRaw, tts);
    }

    const { audioStream } = tts.toStream(input, { rate: speed });
    const bytes = await readStreamToBuffer(audioStream);
    if (bytes.byteLength === 0) {
        throw new Error("Edge TTS returned empty audio.");
    }
    return bytes.toString("base64");
}


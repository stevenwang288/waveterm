// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    chunkSpeechInput,
    requestOpenAICompatibleSpeechAudio,
} from "./aispeech";
import { getSpeechVoiceForRole, ResolvedSpeechSettings, SpeechRole } from "./speechsettings";

type SpeechStateListener = (isActive: boolean) => void;
type SpeechOwnerId = string | null;
type SpeechLogEntry = {
    event: string;
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
type SpeechLogBase = Omit<SpeechLogEntry, "event" | "chunkIndex" | "chunkCount" | "text" | "error" | "ts">;

type SpeechPlayOptions = {
    ownerId?: string;
};

type SpeechSubscription = {
    listener: SpeechStateListener;
    ownerId?: string;
};

class SpeechRuntime {
    private apiAudio: HTMLAudioElement | null = null;
    private apiAudioUrl: string | null = null;
    private apiAbort: AbortController | null = null;
    private isActive = false;
    private activeOwnerId: SpeechOwnerId = null;
    private playSeq = 0;
    private listeners = new Set<SpeechSubscription>();

    private normalizeOwnerId(ownerId?: string): string | undefined {
        const trimmed = ownerId?.trim();
        return trimmed ? trimmed : undefined;
    }

    private logSpeech(entry: SpeechLogEntry): void {
        if (typeof window === "undefined") {
            return;
        }
        const api = (window as any)?.api;
        if (!api || typeof api.speechLog !== "function") {
            return;
        }
        try {
            void Promise.resolve(
                api.speechLog({
                    ...entry,
                    ts: entry.ts ?? Date.now(),
                })
            ).catch(() => {});
        } catch {
            // best-effort diagnostics only
        }
    }

    private isListenerActive(ownerId?: string): boolean {
        if (!this.isActive) {
            return false;
        }
        if (!ownerId) {
            return true;
        }
        return this.activeOwnerId === ownerId;
    }

    private notifyListeners(): void {
        for (const subscription of this.listeners) {
            subscription.listener(this.isListenerActive(subscription.ownerId));
        }
    }

    subscribe(listener: SpeechStateListener, ownerId?: string): () => void {
        const subscription: SpeechSubscription = {
            listener,
            ownerId: this.normalizeOwnerId(ownerId),
        };
        this.listeners.add(subscription);
        listener(this.isListenerActive(subscription.ownerId));
        return () => {
            this.listeners.delete(subscription);
        };
    }

    private setActive(active: boolean, ownerId?: string): void {
        const nextOwner: SpeechOwnerId = active ? this.normalizeOwnerId(ownerId) ?? null : null;
        if (this.isActive === active && this.activeOwnerId === nextOwner) {
            return;
        }
        this.isActive = active;
        this.activeOwnerId = nextOwner;
        this.notifyListeners();
    }

    private isCurrentPlay(playId: number): boolean {
        return playId === this.playSeq;
    }

    private cleanupApiAudioResources(): void {
        if (this.apiAudio) {
            this.apiAudio.onended = null;
            this.apiAudio.onerror = null;
            this.apiAudio.pause();
            this.apiAudio.src = "";
            this.apiAudio = null;
        }
        if (this.apiAudioUrl) {
            URL.revokeObjectURL(this.apiAudioUrl);
            this.apiAudioUrl = null;
        }
    }

    stop(ownerId?: string): void {
        const normalizedOwnerId = this.normalizeOwnerId(ownerId);
        if (normalizedOwnerId && this.activeOwnerId && this.activeOwnerId !== normalizedOwnerId) {
            return;
        }
        if (this.isActive) {
            this.logSpeech({
                event: "stop",
                ownerId: this.activeOwnerId ?? undefined,
                playId: this.playSeq,
            });
        }
        this.playSeq += 1;
        if (this.apiAbort) {
            this.apiAbort.abort();
            this.apiAbort = null;
        }
        this.cleanupApiAudioResources();
        this.setActive(false);
    }

    private isBenignInterruption(error: unknown): boolean {
        const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
        if (!message) {
            return false;
        }
        return (
            message.includes("interrupted") ||
            message.includes("abort") ||
            message.includes("aborted") ||
            message.includes("cancelled") ||
            message.includes("canceled")
        );
    }

    async play(
        text: string,
        settings: ResolvedSpeechSettings,
        role: SpeechRole,
        onError: (message: string) => void,
        options?: SpeechPlayOptions
    ): Promise<boolean> {
        const ownerId = this.normalizeOwnerId(options?.ownerId);
        const messageText = text.trim();
        if (!settings.enabled) {
            this.logSpeech({
                event: "error",
                transport: settings.transport,
                role,
                ownerId,
                error: "Speech is disabled in settings.",
            });
            onError("Speech is disabled in settings.");
            return false;
        }
        if (!messageText) {
            this.logSpeech({
                event: "error",
                transport: settings.transport,
                role,
                ownerId,
                error: "No text content to read.",
            });
            onError("No text content to read.");
            return false;
        }

        this.stop();
        const playId = ++this.playSeq;
        this.setActive(true, ownerId);

        const roleVoice = getSpeechVoiceForRole(settings, role);
        const logBase: SpeechLogBase = {
            transport: settings.transport,
            role,
            ownerId,
            playId,
            endpoint: settings.endpoint,
            model: settings.model,
            voice: roleVoice,
        };

        if (settings.transport !== "api") {
            if (this.isCurrentPlay(playId)) {
                this.setActive(false);
            }
            this.logSpeech({
                ...logBase,
                event: "error",
                error: `Unsupported speech transport: ${settings.transport}`,
            });
            onError(`Unsupported speech transport: ${settings.transport}`);
            return false;
        }

        if (!settings.endpoint) {
            if (this.isCurrentPlay(playId)) {
                this.setActive(false);
            }
            this.logSpeech({
                ...logBase,
                event: "error",
                error: "Speech endpoint is not configured.",
            });
            onError("Speech endpoint is not configured.");
            return false;
        }

        const chunks = chunkSpeechInput(messageText, settings.filterOptions);
        if (chunks.length === 0) {
            if (this.isCurrentPlay(playId)) {
                this.setActive(false);
            }
            this.logSpeech({
                ...logBase,
                event: "error",
                error: "No text content to read.",
            });
            onError("No text content to read.");
            return false;
        }

        this.logSpeech({
            ...logBase,
            event: "start",
            chunkCount: chunks.length,
            text: messageText,
        });

        const abortController = new AbortController();
        this.apiAbort = abortController;

        const speechConfig = {
            endpoint: settings.endpoint,
            model: settings.model,
            token: settings.token,
            voice: roleVoice,
            speed: settings.rate,
        };
        const playbackRate = Math.max(0.5, Math.min(2, settings.rate || 1));

        const clearAbortController = () => {
            if (this.apiAbort === abortController) {
                this.apiAbort = null;
            }
        };

        const finishPlayback = () => {
            if (!this.isCurrentPlay(playId)) {
                return;
            }
            this.cleanupApiAudioResources();
            clearAbortController();
            this.setActive(false);
        };

        const playChunk = async (chunkIndex: number): Promise<boolean> => {
            if (!this.isCurrentPlay(playId)) {
                return false;
            }
            if (abortController.signal.aborted) {
                finishPlayback();
                return false;
            }
            const chunkText = chunks[chunkIndex]?.trim() ?? "";
            if (!chunkText) {
                finishPlayback();
                return false;
            }
            this.logSpeech({
                ...logBase,
                event: "chunk",
                chunkIndex,
                chunkCount: chunks.length,
                text: chunkText,
            });

            let speechBlob: Blob;
            try {
                speechBlob = await requestOpenAICompatibleSpeechAudio(
                    chunkText,
                    speechConfig,
                    abortController.signal,
                    settings.filterOptions
                );
            } catch (error) {
                if (!this.isCurrentPlay(playId)) {
                    return false;
                }
                if (abortController.signal.aborted || this.isBenignInterruption(error)) {
                    finishPlayback();
                    return false;
                }
                this.logSpeech({
                    ...logBase,
                    event: "error",
                    chunkIndex,
                    chunkCount: chunks.length,
                    error: error instanceof Error ? error.message : String(error),
                });
                onError(error instanceof Error ? error.message : String(error));
                finishPlayback();
                return false;
            }

            if (!this.isCurrentPlay(playId)) {
                return false;
            }
            if (abortController.signal.aborted) {
                finishPlayback();
                return false;
            }

            this.cleanupApiAudioResources();
            const speechUrl = URL.createObjectURL(speechBlob);
            this.apiAudioUrl = speechUrl;
            const audio = new Audio(speechUrl);
            this.apiAudio = audio;
            audio.defaultPlaybackRate = playbackRate;
            audio.playbackRate = playbackRate;

            audio.onended = () => {
                if (this.apiAudio !== audio) {
                    return;
                }
                if (!this.isCurrentPlay(playId)) {
                    this.cleanupApiAudioResources();
                    clearAbortController();
                    return;
                }
                this.cleanupApiAudioResources();
                const nextIdx = chunkIndex + 1;
                if (nextIdx < chunks.length) {
                    void playChunk(nextIdx);
                    return;
                }
                clearAbortController();
                this.logSpeech({
                    ...logBase,
                    event: "end",
                });
                this.setActive(false);
            };
            audio.onerror = () => {
                if (this.apiAudio !== audio) {
                    return;
                }
                const endpointHint = settings.endpoint ?? "unknown-endpoint";
                const modelHint = settings.model || "unknown-model";
                this.logSpeech({
                    ...logBase,
                    event: "error",
                    chunkIndex,
                    chunkCount: chunks.length,
                    error: `Speech playback failed (endpoint=${endpointHint}, model=${modelHint}).`,
                });
                onError(`Speech playback failed (endpoint=${endpointHint}, model=${modelHint}).`);
                finishPlayback();
            };

            try {
                await audio.play();
                return true;
            } catch (error) {
                if (!this.isCurrentPlay(playId)) {
                    return false;
                }
                if (this.isBenignInterruption(error) || abortController.signal.aborted) {
                    finishPlayback();
                    return false;
                }
                const endpointHint = settings.endpoint ?? "unknown-endpoint";
                const modelHint = settings.model || "unknown-model";
                this.logSpeech({
                    ...logBase,
                    event: "error",
                    chunkIndex,
                    chunkCount: chunks.length,
                    error: `Speech playback failed (endpoint=${endpointHint}, model=${modelHint}).`,
                });
                onError(`Speech playback failed (endpoint=${endpointHint}, model=${modelHint}).`);
                finishPlayback();
                return false;
            }
        };

        try {
            const started = await playChunk(0);
            if (!started && this.isCurrentPlay(playId)) {
                finishPlayback();
            }
            return started;
        } catch (error) {
            if (!this.isCurrentPlay(playId)) {
                return false;
            }
            if (this.isBenignInterruption(error)) {
                finishPlayback();
                return false;
            }
            if (!abortController.signal.aborted) {
                this.logSpeech({
                    ...logBase,
                    event: "error",
                    error: error instanceof Error ? error.message : String(error),
                });
                onError(error instanceof Error ? error.message : String(error));
            }
            finishPlayback();
            return false;
        }
    }
}

export const speechRuntime = new SpeechRuntime();

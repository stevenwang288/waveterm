// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import {
    canUseLocalSpeechSynthesis,
    requestOpenAICompatibleSpeechAudio,
    speakLocally,
    stopLocalSpeechSynthesis,
} from "./aispeech";
import { getSpeechVoiceForRole, ResolvedSpeechSettings, SpeechRole } from "./speechsettings";

type SpeechStateListener = (isActive: boolean) => void;

class SpeechRuntime {
    private apiAudio: HTMLAudioElement | null = null;
    private apiAudioUrl: string | null = null;
    private apiAbort: AbortController | null = null;
    private isActive = false;
    private listeners = new Set<SpeechStateListener>();

    subscribe(listener: SpeechStateListener): () => void {
        this.listeners.add(listener);
        listener(this.isActive);
        return () => {
            this.listeners.delete(listener);
        };
    }

    private setActive(active: boolean): void {
        if (this.isActive === active) {
            return;
        }
        this.isActive = active;
        for (const listener of this.listeners) {
            listener(active);
        }
    }

    private cleanupApiAudioResources(): void {
        if (this.apiAudio) {
            this.apiAudio.pause();
            this.apiAudio.src = "";
            this.apiAudio = null;
        }
        if (this.apiAudioUrl) {
            URL.revokeObjectURL(this.apiAudioUrl);
            this.apiAudioUrl = null;
        }
    }

    stop(): void {
        stopLocalSpeechSynthesis();
        if (this.apiAbort) {
            this.apiAbort.abort();
            this.apiAbort = null;
        }
        this.cleanupApiAudioResources();
        this.setActive(false);
    }

    async play(
        text: string,
        settings: ResolvedSpeechSettings,
        role: SpeechRole,
        onError: (message: string) => void
    ): Promise<boolean> {
        const messageText = text.trim();
        if (!settings.enabled) {
            onError("Speech is disabled in settings.");
            return false;
        }
        if (!messageText) {
            onError("No text content to read.");
            return false;
        }

        this.stop();
        this.setActive(true);

        if (settings.transport === "browser") {
            if (!canUseLocalSpeechSynthesis()) {
                this.setActive(false);
                onError("Speech synthesis is not available.");
                return false;
            }
            const started = speakLocally(
                messageText,
                {
                    onDone: () => this.setActive(false),
                    onError: (errorMessage) => {
                        onError(errorMessage);
                        this.setActive(false);
                    },
                },
                settings.filterOptions
            );
            if (!started) {
                this.setActive(false);
            }
            return started;
        }

        if (!settings.endpoint) {
            this.setActive(false);
            onError("Speech endpoint is not configured.");
            return false;
        }

        const abortController = new AbortController();
        this.apiAbort = abortController;
        try {
            const speechBlob = await requestOpenAICompatibleSpeechAudio(
                messageText,
                {
                    endpoint: settings.endpoint,
                    model: settings.model,
                    token: settings.token,
                    voice: getSpeechVoiceForRole(settings, role),
                },
                abortController.signal,
                settings.filterOptions
            );
            if (abortController.signal.aborted) {
                this.setActive(false);
                return false;
            }
            const speechUrl = URL.createObjectURL(speechBlob);
            this.apiAudioUrl = speechUrl;
            const audio = new Audio(speechUrl);
            this.apiAudio = audio;
            audio.onended = () => {
                this.cleanupApiAudioResources();
                this.setActive(false);
            };
            audio.onerror = () => {
                this.cleanupApiAudioResources();
                this.setActive(false);
                onError("Speech playback failed.");
            };
            await audio.play();
            return true;
        } catch (error) {
            if (!abortController.signal.aborted) {
                onError(error instanceof Error ? error.message : String(error));
            }
            this.cleanupApiAudioResources();
            this.setActive(false);
            return false;
        } finally {
            if (this.apiAbort === abortController) {
                this.apiAbort = null;
            }
        }
    }
}

export const speechRuntime = new SpeechRuntime();

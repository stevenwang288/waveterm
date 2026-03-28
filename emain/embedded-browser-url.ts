// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type EmbeddedBrowserUrlAction = "internal" | "open-external-app" | "block";

const InternalSchemes = new Set(["http:", "https:", "file:", "about:", "data:", "blob:", "chrome-error:", "devtools:"]);
const ExternalAppSchemes = new Set(["mailto:", "tel:", "sms:"]);

export function getEmbeddedBrowserUrlAction(rawUrl: string | null | undefined): EmbeddedBrowserUrlAction {
    const value = String(rawUrl ?? "").trim();
    if (!value) {
        return "block";
    }
    let protocol = "";
    try {
        protocol = new URL(value).protocol.toLowerCase();
    } catch {
        return "block";
    }
    if (InternalSchemes.has(protocol)) {
        return "internal";
    }
    if (ExternalAppSchemes.has(protocol)) {
        return "open-external-app";
    }
    return "block";
}

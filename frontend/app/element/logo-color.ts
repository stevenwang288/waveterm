// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export const LOGO_COLOR_STORAGE_KEY = "waveterm-logo-color";
export const DEFAULT_LOGO_COLOR = "#58c142";

export const LOGO_COLOR_PRESETS = [
    { label: "Wave Green", value: "#58c142" },
    { label: "Teal", value: "#22b8cf" },
    { label: "Blue", value: "#3b82f6" },
    { label: "Purple", value: "#8b5cf6" },
    { label: "Orange", value: "#f97316" },
    { label: "Rose", value: "#f43f5e" },
] as const;

function normalizeHexColor(value: string): string | null {
    if (value == null) {
        return null;
    }
    const trimmed = value.trim();
    if (trimmed === "") {
        return null;
    }
    const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
    const shortMatch = withHash.match(/^#([0-9a-fA-F]{3})$/);
    if (shortMatch) {
        const [r, g, b] = shortMatch[1].split("");
        return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    const fullMatch = withHash.match(/^#([0-9a-fA-F]{6})$/);
    if (!fullMatch) {
        return null;
    }
    return `#${fullMatch[1]}`.toLowerCase();
}

function clampByte(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)));
}

function shadeHexColor(color: string, factor: number): string {
    const hex = normalizeHexColor(color);
    if (hex == null) {
        return DEFAULT_LOGO_COLOR;
    }
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    const shadeChannel = (channel: number): number => {
        if (factor >= 0) {
            return clampByte(channel + (255 - channel) * factor);
        }
        return clampByte(channel * (1 + factor));
    };

    const sr = shadeChannel(r).toString(16).padStart(2, "0");
    const sg = shadeChannel(g).toString(16).padStart(2, "0");
    const sb = shadeChannel(b).toString(16).padStart(2, "0");
    return `#${sr}${sg}${sb}`;
}

function setLogoColorVars(baseColor: string): void {
    const root = document.documentElement;
    root.style.setProperty("--wave-logo-color", baseColor);
    root.style.setProperty("--wave-logo-color-dark", shadeHexColor(baseColor, -0.45));
    root.style.setProperty("--wave-logo-color-light", shadeHexColor(baseColor, 0.2));
}

export function getStoredLogoColor(): string | null {
    try {
        const stored = localStorage.getItem(LOGO_COLOR_STORAGE_KEY);
        return normalizeHexColor(stored);
    } catch {
        return null;
    }
}

export function applyLogoColor(color: string | null | undefined): string {
    const normalized = normalizeHexColor(color) ?? DEFAULT_LOGO_COLOR;
    if (typeof document !== "undefined") {
        setLogoColorVars(normalized);
    }
    return normalized;
}

export function initLogoColorFromStorage(): void {
    applyLogoColor(getStoredLogoColor());
}

export function setStoredLogoColor(color: string | null | undefined): string {
    const normalized = normalizeHexColor(color);
    try {
        if (normalized == null) {
            localStorage.removeItem(LOGO_COLOR_STORAGE_KEY);
        } else {
            localStorage.setItem(LOGO_COLOR_STORAGE_KEY, normalized);
        }
    } catch {
        // no-op
    }
    return applyLogoColor(normalized);
}

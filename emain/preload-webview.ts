// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const { ipcRenderer } = require("electron");

document.addEventListener("contextmenu", (event) => {
    console.log("contextmenu event", event);
    if (event.target == null) {
        return;
    }
    const targetElement = event.target as HTMLElement;
    // Check if the right-click is on an image
    if (targetElement.tagName === "IMG") {
        setTimeout(() => {
            if (event.defaultPrevented) {
                return;
            }
            event.preventDefault();
            const imgElem = targetElement as HTMLImageElement;
            const imageUrl = imgElem.src;
            ipcRenderer.send("webview-image-contextmenu", { src: imageUrl });
        }, 50);
        return;
    }
    // do nothing
});

function sendClawXBridgePayload(channel: string, payload: unknown) {
    try {
        ipcRenderer.sendToHost(channel, payload ?? {});
    } catch (error) {
        console.warn("failed to send clawx bridge payload", error);
    }
}

function normalizeClawXBridgePayload(payload: any) {
    if (payload == null || typeof payload !== "object") {
        return null;
    }
    const source = String(payload.source ?? "").toLowerCase();
    if (source && source !== "clawx" && source !== "clawx-bridge") {
        return null;
    }
    const eventType = String(payload.type ?? payload.event ?? "status").toLowerCase();
    const normalizedPayload = payload.payload != null ? payload.payload : payload;
    return {
        type: eventType,
        payload: normalizedPayload,
    };
}

window.addEventListener("message", (event) => {
    const candidatePayload = event?.data?.detail ?? event?.data;
    const normalizedEvent = normalizeClawXBridgePayload(candidatePayload);
    if (normalizedEvent == null) {
        return;
    }
    sendClawXBridgePayload("clawx-status", normalizedEvent);
});

window.addEventListener("clawx-status", (event: Event) => {
    const customEvent = event as CustomEvent;
    const normalizedEvent = normalizeClawXBridgePayload({
        source: "clawx",
        type: "status",
        payload: customEvent?.detail ?? {},
    });
    if (normalizedEvent == null) {
        return;
    }
    sendClawXBridgePayload("clawx-status", normalizedEvent);
});

function injectClawXBridge() {
    try {
        const scriptContent = `
            (() => {
                if (window.WaveClawXBridge) {
                    return;
                }
                const postStatus = (payload) => {
                    window.postMessage(
                        {
                            source: "clawx",
                            type: "status",
                            payload: payload || {}
                        },
                        "*"
                    );
                };
                const postEvent = (type, payload) => {
                    window.postMessage(
                        {
                            source: "clawx",
                            type: type || "event",
                            payload: payload || {}
                        },
                        "*"
                    );
                };
                window.WaveClawXBridge = {
                    reportStatus: postStatus,
                    reportEvent: postEvent,
                    setUnread: (count = 1) => postEvent("attention", { unreadCount: count }),
                    clearUnread: () => postEvent("attention_cleared", { unreadCount: 0 })
                };
            })();
        `;
        const bootstrapScript = document.createElement("script");
        bootstrapScript.type = "text/javascript";
        bootstrapScript.textContent = scriptContent;
        (document.head || document.documentElement)?.appendChild(bootstrapScript);
        bootstrapScript.remove();
    } catch (error) {
        console.warn("failed to inject clawx bridge helper", error);
    }
}

const DEFAULT_PVE_HOSTS = new Set(["192.168.1.250", "192.168.1.250:8006"]);

function normalizeHostToken(value: string): string {
    return String(value ?? "").trim().toLowerCase();
}

function getHostForPveIntegration(): string {
    try {
        return normalizeHostToken(String(window.location?.host ?? ""));
    } catch {
        return "";
    }
}

function isAllowedPveHost(host: string): boolean {
    const normalized = normalizeHostToken(host);
    return normalized ? DEFAULT_PVE_HOSTS.has(normalized) : false;
}

type PveLoginFormHandles = {
    usernameInput: HTMLInputElement;
    passwordInput: HTMLInputElement;
};

function isVisibleInput(elem: HTMLInputElement): boolean {
    if (!elem || elem.disabled || elem.readOnly) {
        return false;
    }
    const rect = elem.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
        return false;
    }
    const style = window.getComputedStyle(elem);
    return style.display !== "none" && style.visibility !== "hidden";
}

function isVisibleElement(elem: HTMLElement | null): boolean {
    if (!elem) {
        return false;
    }
    const rect = elem.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
        return false;
    }
    const style = window.getComputedStyle(elem);
    return style.display !== "none" && style.visibility !== "hidden";
}

function findPveLoginFormHandles(): PveLoginFormHandles | null {
    const passwordInputs = Array.from(document.querySelectorAll("input[type='password']")) as HTMLInputElement[];
    const passwordInput = passwordInputs.find((input) => isVisibleInput(input));
    if (!passwordInput) {
        return null;
    }
    const container =
        (passwordInput.closest(".x-window, .x-panel, form, .x-box-layout-ct") as HTMLElement | null) ?? document.body;
    const usernameCandidates = Array.from(
        container.querySelectorAll("input[type='text'], input[type='email'], input:not([type])")
    ) as HTMLInputElement[];
    const usernameInput = usernameCandidates.find((input) => isVisibleInput(input));
    if (!usernameInput) {
        return null;
    }
    return { usernameInput, passwordInput };
}

function patchPveWindowOpen(host: string) {
    try {
        const key = "__wavePveWindowOpenPatched__";
        if ((window as any)[key]) {
            return;
        }
        (window as any)[key] = true;

        const originalOpen = window.open;
        window.open = ((url?: string | URL, ...args: any[]) => {
            try {
                const raw = typeof url === "string" ? url : url instanceof URL ? url.toString() : "";
                if (raw) {
                    const nextUrl = new URL(raw, window.location.href);
                    const nextHost = normalizeHostToken(nextUrl.host);
                    // Keep PVE popups inside the same webview/tab.
                    if (nextHost === host && nextUrl.searchParams.has("console")) {
                        window.location.href = nextUrl.toString();
                        return null;
                    }
                }
            } catch {
                // ignore parse errors
            }
            return originalOpen.call(window, url as any, ...args);
        }) as any;
    } catch {
        // ignore patch errors
    }
}

let lastPveCredSignature = "";
let lastPveCredTs = 0;

function maybePersistPveCredentials(host: string) {
    const handles = findPveLoginFormHandles();
    if (!handles) {
        return;
    }
    const username = String(handles.usernameInput.value ?? "").trim();
    const password = String(handles.passwordInput.value ?? "");
    if (!username || !password) {
        return;
    }

    const signature = `${host}|${username}|${password.length}`;
    const now = Date.now();
    if (signature === lastPveCredSignature && now - lastPveCredTs < 2000) {
        return;
    }
    lastPveCredSignature = signature;
    lastPveCredTs = now;

    ipcRenderer.invoke("pve-store-credentials", { host, username, password }).catch(() => {});
}

function setupPveIntegration() {
    const host = getHostForPveIntegration();
    if (!isAllowedPveHost(host)) {
        return;
    }

    patchPveWindowOpen(host);

    const onAttempt = () => {
        setTimeout(() => {
            maybePersistPveCredentials(host);
        }, 0);
    };

    document.addEventListener("click", onAttempt, true);
    document.addEventListener(
        "keydown",
        (event) => {
            if (event.key === "Enter") {
                onAttempt();
            }
        },
        true
    );
}

if (document.readyState === "loading") {
    document.addEventListener(
        "DOMContentLoaded",
        () => {
            injectClawXBridge();
            setupPveIntegration();
        },
        { once: true }
    );
} else {
    injectClawXBridge();
    setupPveIntegration();
}

console.log("loaded wave preload-webview.ts");

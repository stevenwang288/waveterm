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

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectClawXBridge, { once: true });
} else {
    injectClawXBridge();
}

console.log("loaded wave preload-webview.ts");

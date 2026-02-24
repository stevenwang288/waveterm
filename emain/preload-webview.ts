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

const DEFAULT_PVE_AUTOLOGIN_HOSTS = ["192.168.1.250", "192.168.1.250:8006"];
const PVE_AUTOLOGIN_STORAGE_PREFIX = "waveterm:pve-autologin:";
const PVE_AUTOLOGIN_HOSTS_ENV = "WAVETERM_PVE_AUTOLOGIN_HOSTS";
const PVE_AUTOLOGIN_JSON_ENV = "WAVETERM_PVE_AUTOLOGIN_JSON";
const PVE_AUTOLOGIN_USERNAME_ENV = "WAVETERM_PVE_AUTOLOGIN_USERNAME";
const PVE_AUTOLOGIN_PASSWORD_ENV = "WAVETERM_PVE_AUTOLOGIN_PASSWORD";
const PVE_AUTOLOGIN_DEFAULT_HOST = "default";

function getEnvValue(name: string): string {
    if (typeof process === "undefined" || process?.env == null) {
        return "";
    }
    const value = process.env[name];
    return typeof value === "string" ? value : "";
}

function normalizeHostToken(value: string): string {
    return String(value ?? "").trim().toLowerCase();
}

function getPveAutoLoginHosts(): Set<string> {
    const hosts = new Set<string>();
    for (const host of DEFAULT_PVE_AUTOLOGIN_HOSTS) {
        const normalized = normalizeHostToken(host);
        if (normalized) {
            hosts.add(normalized);
        }
    }
    const rawHosts = getEnvValue(PVE_AUTOLOGIN_HOSTS_ENV);
    if (rawHosts.trim()) {
        for (const host of rawHosts.split(",")) {
            const normalized = normalizeHostToken(host);
            if (normalized) {
                hosts.add(normalized);
            }
        }
    }
    return hosts;
}

const PVE_AUTOLOGIN_HOSTS = getPveAutoLoginHosts();
let cachedBootstrapCredentials: Record<string, { username: string; password: string }> | null = null;

function loadBootstrapCredentialsFromEnv(): Record<string, { username: string; password: string }> {
    if (cachedBootstrapCredentials != null) {
        return cachedBootstrapCredentials;
    }

    const map: Record<string, { username: string; password: string }> = {};
    const userFromEnv = getEnvValue(PVE_AUTOLOGIN_USERNAME_ENV).trim();
    const passFromEnv = getEnvValue(PVE_AUTOLOGIN_PASSWORD_ENV);
    if (userFromEnv && passFromEnv) {
        map[PVE_AUTOLOGIN_DEFAULT_HOST] = {
            username: userFromEnv,
            password: passFromEnv,
        };
    }

    const rawJson = getEnvValue(PVE_AUTOLOGIN_JSON_ENV).trim();
    if (rawJson) {
        try {
            const parsed = JSON.parse(rawJson) as Record<string, { username?: string; password?: string }>;
            for (const [rawHost, rawCred] of Object.entries(parsed ?? {})) {
                const host = normalizeHostToken(rawHost);
                const username = String(rawCred?.username ?? "").trim();
                const password = String(rawCred?.password ?? "");
                if (!host || !username || !password) {
                    continue;
                }
                map[host] = { username, password };
            }
        } catch {
            // ignore malformed env JSON
        }
    }

    cachedBootstrapCredentials = map;
    return map;
}

type PveLoginFormHandles = {
    usernameInput: HTMLInputElement;
    passwordInput: HTMLInputElement;
    loginButton: HTMLElement | null;
};

function getHostForPveAutoLogin(): string {
    try {
        return String(window.location?.host ?? "").trim().toLowerCase();
    } catch {
        return "";
    }
}

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
    const buttonCandidates = Array.from(container.querySelectorAll("button, a, div, span")) as HTMLElement[];
    const labelNode = buttonCandidates.find((elem) => {
        const text = String(elem.textContent ?? "").trim();
        return /^login$/i.test(text);
    });
    const loginButton = labelNode ? ((labelNode.closest("button, a, div.x-btn, span.x-btn") as HTMLElement) ?? labelNode) : null;
    return { usernameInput, passwordInput, loginButton };
}

function triggerInputChange(elem: HTMLInputElement, value: string) {
    if (!elem) {
        return;
    }
    elem.focus();
    elem.value = value;
    elem.dispatchEvent(new Event("input", { bubbles: true }));
    elem.dispatchEvent(new Event("change", { bubbles: true }));
}

function getPveBootstrapCredentials(host: string): { username: string; password: string } | null {
    const credentialsMap = loadBootstrapCredentialsFromEnv();
    const normalizedHost = normalizeHostToken(host);
    if (!normalizedHost) {
        return null;
    }
    return credentialsMap[normalizedHost] ?? credentialsMap[PVE_AUTOLOGIN_DEFAULT_HOST] ?? null;
}

function loadPersistedPveCredentials(host: string): { username: string; password: string } | null {
    if (!host) {
        return null;
    }
    try {
        const raw = window.localStorage.getItem(`${PVE_AUTOLOGIN_STORAGE_PREFIX}${host}`);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw) as { username?: string; password?: string };
        const username = String(parsed?.username ?? "").trim();
        const password = String(parsed?.password ?? "");
        if (!username || !password) {
            return null;
        }
        return { username, password };
    } catch {
        return null;
    }
}

function persistPveCredentials(host: string, username: string, password: string) {
    if (!host || !username || !password) {
        return;
    }
    try {
        window.localStorage.setItem(
            `${PVE_AUTOLOGIN_STORAGE_PREFIX}${host}`,
            JSON.stringify({
                username,
                password,
                ts: Date.now(),
            })
        );
    } catch {
        // ignore storage errors
    }
}

function setupPveAutoLogin() {
    const host = getHostForPveAutoLogin();
    if (!host || !PVE_AUTOLOGIN_HOSTS.has(host)) {
        return;
    }

    const tryPersistCurrentForm = () => {
        const handles = findPveLoginFormHandles();
        if (!handles) {
            return;
        }
        const username = String(handles.usernameInput.value ?? "").trim();
        const password = String(handles.passwordInput.value ?? "");
        if (!username || !password) {
            return;
        }
        persistPveCredentials(host, username, password);
    };

    let autoLoginTriggered = false;
    const maybeAutoLogin = () => {
        const handles = findPveLoginFormHandles();
        if (!handles) {
            return;
        }
        const creds = loadPersistedPveCredentials(host) ?? getPveBootstrapCredentials(host);
        if (!creds?.username || !creds?.password) {
            return;
        }
        if (autoLoginTriggered) {
            return;
        }

        triggerInputChange(handles.usernameInput, creds.username);
        triggerInputChange(handles.passwordInput, creds.password);
        persistPveCredentials(host, creds.username, creds.password);
        autoLoginTriggered = true;

        if (handles.loginButton) {
            handles.loginButton.click();
            return;
        }
        handles.passwordInput.dispatchEvent(
            new KeyboardEvent("keydown", {
                key: "Enter",
                code: "Enter",
                bubbles: true,
                cancelable: true,
            })
        );
        handles.passwordInput.dispatchEvent(
            new KeyboardEvent("keyup", {
                key: "Enter",
                code: "Enter",
                bubbles: true,
                cancelable: true,
            })
        );
    };

    document.addEventListener(
        "click",
        () => {
            setTimeout(() => {
                tryPersistCurrentForm();
            }, 0);
        },
        true
    );
    document.addEventListener(
        "keydown",
        (event) => {
            if (event.key === "Enter") {
                setTimeout(() => {
                    tryPersistCurrentForm();
                }, 0);
            }
        },
        true
    );

    const observer = new MutationObserver(() => {
        maybeAutoLogin();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    maybeAutoLogin();
    setTimeout(maybeAutoLogin, 500);
    setTimeout(maybeAutoLogin, 1200);
}

if (document.readyState === "loading") {
    document.addEventListener(
        "DOMContentLoaded",
        () => {
            injectClawXBridge();
            setupPveAutoLogin();
        },
        { once: true }
    );
} else {
    injectClawXBridge();
    setupPveAutoLogin();
}

console.log("loaded wave preload-webview.ts");

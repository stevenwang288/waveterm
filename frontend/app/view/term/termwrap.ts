// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { BlockNodeModel } from "@/app/block/blocktypes";
import i18next from "@/app/i18n";
import { getFileSubject } from "@/app/store/wps";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import {
    atoms,
    fetchWaveFile,
    getApi,
    getOverrideConfigAtom,
    getSettingsKeyAtom,
    globalStore,
    openLink,
    pushNotification,
    recordTEvent,
    setTabIndicator,
    useBlockAtom,
    WOS,
} from "@/store/global";
import * as services from "@/store/services";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { base64ToArray, base64ToString, fireAndForget, isBlank, isLocalConnName, stringToBase64 } from "@/util/util";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import * as TermTypes from "@xterm/xterm";
import { Terminal } from "@xterm/xterm";
import debug from "debug";
import * as jotai from "jotai";
import { debounce } from "throttle-debounce";
import { FitAddon } from "./fitaddon";
import { createTempFileFromBlob, extractAllClipboardData } from "./termutil";

const dlog = debug("wave:termwrap");

const TermFileName = "term";
const TermCacheFileName = "cache:term:full";
const MinDataProcessedForCache = 100 * 1024;
const ReflowReloadMaxBytes = 5 * 1024 * 1024;
const TerminalWriteBatchMaxBytes = 256 * 1024;
const TerminalStateSaveMinQuietMs = 1500;
const TerminalStateSaveMinIntervalMs = 30_000;
const Osc52MaxDecodedSize = 75 * 1024; // max clipboard size for OSC 52 (matches common terminal implementations)
const Osc52MaxRawLength = 128 * 1024; // includes selector + base64 + whitespace (rough check)
export const SupportsImageInput = true;

// detect webgl support
function detectWebGLSupport(): boolean {
    try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("webgl");
        return !!ctx;
    } catch (e) {
        return false;
    }
}

const WebGLSupported = detectWebGLSupport();
let loggedWebGL = false;

type TermWrapOptions = {
    keydownHandler?: (e: KeyboardEvent) => boolean;
    useWebGl?: boolean;
    sendDataHandler?: (data: string) => void;
    nodeModel?: BlockNodeModel;
};

// for xterm OSC handlers, we return true always because we "own" the OSC number.
// even if data is invalid we don't want to propagate to other handlers.
function handleOsc52Command(data: string, blockId: string, loaded: boolean, termWrap: TermWrap): boolean {
    if (!loaded) {
        return true;
    }
    const isBlockFocused = termWrap.nodeModel ? globalStore.get(termWrap.nodeModel.isFocused) : false;
    if (!document.hasFocus() || !isBlockFocused) {
        console.log("OSC 52: rejected, window or block not focused");
        return true;
    }
    if (!data || data.length === 0) {
        console.log("OSC 52: empty data received");
        return true;
    }
    if (data.length > Osc52MaxRawLength) {
        console.log("OSC 52: raw data too large", data.length);
        return true;
    }

    const semicolonIndex = data.indexOf(";");
    if (semicolonIndex === -1) {
        console.log("OSC 52: invalid format (no semicolon)", data.substring(0, 50));
        return true;
    }

    const clipboardSelection = data.substring(0, semicolonIndex);
    const base64Data = data.substring(semicolonIndex + 1);

    // clipboard query ("?") is not supported for security (prevents clipboard theft)
    if (base64Data === "?") {
        console.log("OSC 52: clipboard query not supported");
        return true;
    }

    if (base64Data.length === 0) {
        return true;
    }

    if (clipboardSelection.length > 10) {
        console.log("OSC 52: clipboard selection too long", clipboardSelection);
        return true;
    }

    const estimatedDecodedSize = Math.ceil(base64Data.length * 0.75);
    if (estimatedDecodedSize > Osc52MaxDecodedSize) {
        console.log("OSC 52: data too large", estimatedDecodedSize, "bytes");
        return true;
    }

    try {
        // strip whitespace from base64 data (some terminals chunk with newlines per RFC 4648)
        const cleanBase64Data = base64Data.replace(/\s+/g, "");
        const decodedText = base64ToString(cleanBase64Data);

        // validate actual decoded size (base64 estimate can be off for multi-byte UTF-8)
        const actualByteSize = new TextEncoder().encode(decodedText).length;
        if (actualByteSize > Osc52MaxDecodedSize) {
            console.log("OSC 52: decoded text too large", actualByteSize, "bytes");
            return true;
        }

        fireAndForget(async () => {
            try {
                await navigator.clipboard.writeText(decodedText);
                dlog("OSC 52: copied", decodedText.length, "characters to clipboard");
            } catch (err) {
                console.error("OSC 52: clipboard write failed:", err);
            }
        });
    } catch (e) {
        console.error("OSC 52: base64 decode error:", e);
    }

    return true;
}

// for xterm handlers, we return true always because we "own" OSC 7.
// even if it is invalid we dont want to propagate to other handlers
function handleOsc7Command(data: string, blockId: string, loaded: boolean): boolean {
    if (!loaded) {
        return true;
    }
    if (data == null || data.length == 0) {
        console.log("Invalid OSC 7 command received (empty)");
        return true;
    }
    if (data.length > 1024) {
        console.log("Invalid OSC 7, data length too long", data.length);
        return true;
    }

    let pathPart: string;
    try {
        const url = new URL(data);
        if (url.protocol !== "file:") {
            console.log("Invalid OSC 7 command received (non-file protocol)", data);
            return true;
        }
        pathPart = decodeURIComponent(url.pathname);

        // Normalize double slashes at the beginning to single slash
        if (pathPart.startsWith("//")) {
            pathPart = pathPart.substring(1);
        }

        // Handle Windows paths (e.g., /C:/... or /D:\...)
        if (/^\/[a-zA-Z]:[\\/]/.test(pathPart)) {
            // Strip leading slash and normalize to forward slashes
            pathPart = pathPart.substring(1).replace(/\\/g, "/");
        }

        // Handle UNC paths (e.g., /\\server\share)
        if (pathPart.startsWith("/\\\\")) {
            // Strip leading slash but keep backslashes for UNC
            pathPart = pathPart.substring(1);
        }
    } catch (e) {
        console.log("Invalid OSC 7 command received (parse error)", data, e);
        return true;
    }

    setTimeout(() => {
        fireAndForget(async () => {
            await services.ObjectService.UpdateObjectMeta(WOS.makeORef("block", blockId), {
                "cmd:cwd": pathPart,
            });

            const rtInfo = { "shell:hascurcwd": true };
            const rtInfoData: CommandSetRTInfoData = {
                oref: WOS.makeORef("block", blockId),
                data: rtInfo,
            };
            await RpcApi.SetRTInfoCommand(TabRpcClient, rtInfoData).catch((e) =>
                console.log("error setting RT info", e)
            );
        });
    }, 0);
    return true;
}

// some POC concept code for adding a decoration to a marker
function addTestMarkerDecoration(terminal: Terminal, marker: TermTypes.IMarker, termWrap: TermWrap): void {
    const decoration = terminal.registerDecoration({
        marker: marker,
        layer: "top",
    });
    if (!decoration) {
        return;
    }
    decoration.onRender((el) => {
        el.classList.add("wave-decoration");
        el.classList.add("bg-ansi-white");
        el.dataset.markerline = String(marker.line);
        if (!el.querySelector(".wave-deco-line")) {
            const line = document.createElement("div");
            line.classList.add("wave-deco-line", "bg-accent/20");
            line.style.position = "absolute";
            line.style.top = "0";
            line.style.left = "0";
            line.style.width = "500px";
            line.style.height = "1px";
            el.appendChild(line);
        }
    });
}

function checkCommandForTelemetry(decodedCmd: string) {
    if (!decodedCmd) {
        return;
    }

    if (decodedCmd.startsWith("ssh ")) {
        recordTEvent("conn:connect", { "conn:conntype": "ssh-manual" });
        return;
    }

    const editorsRegex = /^(vim|vi|nano|nvim)\b/;
    if (editorsRegex.test(decodedCmd)) {
        recordTEvent("action:term", { "action:type": "cli-edit" });
        return;
    }

    const tailFollowRegex = /(^|\|\s*)tail\s+-[fF]\b/;
    if (tailFollowRegex.test(decodedCmd)) {
        recordTEvent("action:term", { "action:type": "cli-tailf" });
        return;
    }
}

// OSC 16162 - Shell Integration Commands
// See aiprompts/wave-osc-16162.md for full documentation
type ShellIntegrationStatus = "ready" | "running-command";

type Osc16162Command =
    | { command: "A"; data: {} }
    | { command: "C"; data: { cmd64?: string } }
    | { command: "M"; data: { shell?: string; shellversion?: string; uname?: string; integration?: boolean } }
    | { command: "D"; data: { exitcode?: number } }
    | { command: "I"; data: { inputempty?: boolean } }
    | { command: "R"; data: {} };

function handleOsc16162Command(data: string, blockId: string, loaded: boolean, termWrap: TermWrap): boolean {
    const terminal = termWrap.terminal;
    if (!loaded) {
        return true;
    }
    if (!data || data.length === 0) {
        return true;
    }

    const parts = data.split(";");
    const commandStr = parts[0];
    const jsonDataStr = parts.length > 1 ? parts.slice(1).join(";") : null;
    let parsedData: Record<string, any> = {};
    if (jsonDataStr) {
        try {
            parsedData = JSON.parse(jsonDataStr);
        } catch (e) {
            console.error("Error parsing OSC 16162 JSON data:", e);
        }
    }

    const cmd: Osc16162Command = { command: commandStr, data: parsedData } as Osc16162Command;
    const rtInfo: ObjRTInfo = {};
    switch (cmd.command) {
        case "A":
            rtInfo["shell:state"] = "ready";
            globalStore.set(termWrap.shellIntegrationStatusAtom, "ready");
            const marker = terminal.registerMarker(0);
            if (marker) {
                termWrap.promptMarkers.push(marker);
                // addTestMarkerDecoration(terminal, marker, termWrap);
                marker.onDispose(() => {
                    const idx = termWrap.promptMarkers.indexOf(marker);
                    if (idx !== -1) {
                        termWrap.promptMarkers.splice(idx, 1);
                    }
                });
            }
            break;
        case "C":
            rtInfo["shell:state"] = "running-command";
            globalStore.set(termWrap.shellIntegrationStatusAtom, "running-command");
            getApi().incrementTermCommands();
            if (cmd.data.cmd64) {
                const decodedLen = Math.ceil(cmd.data.cmd64.length * 0.75);
                if (decodedLen > 8192) {
                    rtInfo["shell:lastcmd"] = `# command too large (${decodedLen} bytes)`;
                    globalStore.set(termWrap.lastCommandAtom, rtInfo["shell:lastcmd"]);
                } else {
                    try {
                        const decodedCmd = base64ToString(cmd.data.cmd64);
                        rtInfo["shell:lastcmd"] = decodedCmd;
                        globalStore.set(termWrap.lastCommandAtom, decodedCmd);
                        checkCommandForTelemetry(decodedCmd);
                    } catch (e) {
                        console.error("Error decoding cmd64:", e);
                        rtInfo["shell:lastcmd"] = null;
                        globalStore.set(termWrap.lastCommandAtom, null);
                    }
                }
            } else {
                rtInfo["shell:lastcmd"] = null;
                globalStore.set(termWrap.lastCommandAtom, null);
            }
            // also clear lastcmdexitcode (since we've now started a new command)
            rtInfo["shell:lastcmdexitcode"] = null;
            break;
        case "M":
            if (cmd.data.shell) {
                rtInfo["shell:type"] = cmd.data.shell;
            }
            if (cmd.data.shellversion) {
                rtInfo["shell:version"] = cmd.data.shellversion;
            }
            if (cmd.data.uname) {
                rtInfo["shell:uname"] = cmd.data.uname;
            }
            if (cmd.data.integration != null) {
                rtInfo["shell:integration"] = cmd.data.integration;
            }
            break;
        case "D":
            if (cmd.data.exitcode != null) {
                rtInfo["shell:lastcmdexitcode"] = cmd.data.exitcode;
            } else {
                rtInfo["shell:lastcmdexitcode"] = null;
            }
            break;
        case "I":
            if (cmd.data.inputempty != null) {
                rtInfo["shell:inputempty"] = cmd.data.inputempty;
            }
            break;
        case "R":
            globalStore.set(termWrap.shellIntegrationStatusAtom, null);
            if (terminal.buffer.active.type === "alternate") {
                terminal.write("\x1b[?1049l");
            }
            setTimeout(() => {
                globalStore.set(termWrap.altBufAtom, terminal.buffer.active.type === "alternate");
            }, 0);
            break;
    }

    if (Object.keys(rtInfo).length > 0) {
        setTimeout(() => {
            fireAndForget(async () => {
                const rtInfoData: CommandSetRTInfoData = {
                    oref: WOS.makeORef("block", blockId),
                    data: rtInfo,
                };
                await RpcApi.SetRTInfoCommand(TabRpcClient, rtInfoData).catch((e) =>
                    console.log("error setting RT info (OSC 16162)", e)
                );
            });
        }, 0);
    }

    return true;
}

export class TermWrap {
    tabId: string;
    blockId: string;
    ptyOffset: number;
    dataBytesProcessed: number;
    terminal: Terminal;
    connectElem: HTMLDivElement;
    fitAddon: FitAddon;
    searchAddon: SearchAddon;
    serializeAddon: SerializeAddon;
    mainFileSubject: SubjectWithRef<WSFileEventData>;
    loaded: boolean;
    heldData: Uint8Array[];
    handleResize_debounced: () => void;
    hasResized: boolean;
    multiInputCallback: (data: string) => void;
    sendDataHandler: (data: string) => void;
    onSearchResultsDidChange?: (result: { resultIndex: number; resultCount: number }) => void;
    private toDispose: TermTypes.IDisposable[] = [];
    pasteActive: boolean = false;
    lastUpdated: number;
    promptMarkers: TermTypes.IMarker[] = [];
    shellIntegrationStatusAtom: jotai.PrimitiveAtom<"ready" | "running-command" | null>;
    lastCommandAtom: jotai.PrimitiveAtom<string | null>;
    nodeModel: BlockNodeModel; // this can be null
    unreadAtom: jotai.PrimitiveAtom<boolean>;
    lastOutputTsAtom: jotai.PrimitiveAtom<number>;
    altBufAtom: jotai.PrimitiveAtom<boolean>;
    private isReflowReloading: boolean = false;
    private lastReflowReloadTermSize: TermSize | null = null;
    private lastBellNotifyTs: number = 0;
    private savedScrollPosition: number | null = null; // preserved scroll position for reflow reloads
    private pendingWriteChunks: Uint8Array[] = [];
    private pendingWriteHead: number = 0;
    private pendingWriteBytes: number = 0;
    private writeLoopRunning: boolean = false;
    private writeSequence: number = 0;
    private lastAltBufAtomUpdateTs: number = 0;
    private lastTerminalStateSaveTs: number = 0;

    // IME composition state tracking
    // Prevents duplicate input when switching input methods during composition (e.g., using Capslock)
    // xterm.js sends data during compositionupdate AND after compositionend, causing duplicates
    isComposing: boolean = false;
    composingData: string = "";
    lastCompositionEnd: number = 0;
    lastComposedText: string = "";
    firstDataAfterCompositionSent: boolean = false;

    // Paste deduplication
    // xterm.js paste() method triggers onData event, which can cause duplicate sends
    lastPasteData: string = "";
    lastPasteTime: number = 0;

    constructor(
        tabId: string,
        blockId: string,
        connectElem: HTMLDivElement,
        options: TermTypes.ITerminalOptions & TermTypes.ITerminalInitOnlyOptions,
        waveOptions: TermWrapOptions
    ) {
        this.loaded = false;
        this.tabId = tabId;
        this.blockId = blockId;
        this.sendDataHandler = waveOptions.sendDataHandler;
        this.nodeModel = waveOptions.nodeModel;
        this.unreadAtom = useBlockAtom(this.blockId, "term:unread", () => {
            return jotai.atom(false) as jotai.PrimitiveAtom<boolean>;
        }) as jotai.PrimitiveAtom<boolean>;
        this.lastOutputTsAtom = useBlockAtom(this.blockId, "term:lastoutputts", () => {
            return jotai.atom(0) as jotai.PrimitiveAtom<number>;
        }) as jotai.PrimitiveAtom<number>;
        this.altBufAtom = useBlockAtom(this.blockId, "term:altbuf", () => {
            return jotai.atom(false) as jotai.PrimitiveAtom<boolean>;
        }) as jotai.PrimitiveAtom<boolean>;
        this.ptyOffset = 0;
        this.dataBytesProcessed = 0;
        this.hasResized = false;
        this.lastUpdated = Date.now();
        this.promptMarkers = [];
        this.shellIntegrationStatusAtom = useBlockAtom(this.blockId, "term:shellstate", () => {
            return jotai.atom(null) as jotai.PrimitiveAtom<"ready" | "running-command" | null>;
        }) as jotai.PrimitiveAtom<"ready" | "running-command" | null>;
        this.lastCommandAtom = jotai.atom(null) as jotai.PrimitiveAtom<string | null>;
        this.terminal = new Terminal(options);
        this.fitAddon = new FitAddon();
        this.fitAddon.noScrollbar = PLATFORM === PlatformMacOS;
        this.serializeAddon = new SerializeAddon();
        this.searchAddon = new SearchAddon();
        this.terminal.loadAddon(this.searchAddon);
        this.terminal.loadAddon(this.fitAddon);
        this.terminal.loadAddon(this.serializeAddon);
        this.terminal.loadAddon(
            new WebLinksAddon((e, uri) => {
                e.preventDefault();
                switch (PLATFORM) {
                    case PlatformMacOS:
                        if (e.metaKey) {
                            fireAndForget(() => openLink(uri));
                        }
                        break;
                    default:
                        if (e.ctrlKey) {
                            fireAndForget(() => openLink(uri));
                        }
                        break;
                }
            })
        );
        if (WebGLSupported && waveOptions.useWebGl) {
            const webglAddon = new WebglAddon();
            this.toDispose.push(
                webglAddon.onContextLoss(() => {
                    webglAddon.dispose();
                })
            );
            this.terminal.loadAddon(webglAddon);
            if (!loggedWebGL) {
                console.log("loaded webgl!");
                loggedWebGL = true;
            }
        }
        // Register OSC handlers
        this.terminal.parser.registerOscHandler(7, (data: string) => {
            return handleOsc7Command(data, this.blockId, this.loaded);
        });
        this.terminal.parser.registerOscHandler(52, (data: string) => {
            return handleOsc52Command(data, this.blockId, this.loaded, this);
        });
        this.terminal.parser.registerOscHandler(16162, (data: string) => {
            return handleOsc16162Command(data, this.blockId, this.loaded, this);
        });
        this.toDispose.push(
            this.terminal.onBell(() => {
                if (!this.loaded) {
                    return true;
                }
                console.log("BEL received in terminal", this.blockId);
                const isBlockFocused = this.nodeModel ? globalStore.get(this.nodeModel.isFocused) : false;
                const documentFocused = document.hasFocus();
                const shouldMarkUnread = !documentFocused || !isBlockFocused;
                if (shouldMarkUnread) {
                    globalStore.set(this.unreadAtom, true);
                    if (documentFocused) {
                        this.maybePushBellBubbleNotification();
                    } else {
                        this.maybeSendBellNotification();
                    }
                }
                const bellSoundEnabled =
                    globalStore.get(getOverrideConfigAtom(this.blockId, "term:bellsound")) ?? false;
                if (bellSoundEnabled) {
                    fireAndForget(() => RpcApi.ElectronSystemBellCommand(TabRpcClient, { route: "electron" }));
                }
                const bellIndicatorEnabled =
                    globalStore.get(getOverrideConfigAtom(this.blockId, "term:bellindicator")) ?? false;
                if (bellIndicatorEnabled) {
                    const tabId = globalStore.get(atoms.staticTabId);
                    setTabIndicator(tabId, {
                        icon: "bell",
                        color: "var(--warning-color)",
                        clearonfocus: true,
                        priority: 1,
                    });
                }
                return true;
            })
        );
        this.terminal.attachCustomKeyEventHandler(waveOptions.keydownHandler);
        this.connectElem = connectElem;
        this.mainFileSubject = null;
        this.heldData = [];
        this.handleResize_debounced = debounce(50, this.handleResize.bind(this));
        this.terminal.open(this.connectElem);
        this.handleResize();
        this.updateAltBufState();

        const wheelLineScrollAtom = getOverrideConfigAtom(this.blockId, "term:wheellinescroll");
        const wheelLineScrollEnabled = globalStore.get(wheelLineScrollAtom) ?? true;
        if (wheelLineScrollEnabled) {
            const wheelHandler = (e: WheelEvent) => {
                const buffer = this.terminal?.buffer?.active;
                if (!buffer || buffer.type === "alternate") {
                    return;
                }

                // Avoid interfering with browser-style zoom or alternate scroll behaviors.
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) {
                    return;
                }

                // Preserve smooth touchpad scrolling by only overriding "notch-like" wheel deltas.
                const absDeltaY = Math.abs(e.deltaY);
                const isPixelMode = e.deltaMode === WheelEvent.DOM_DELTA_PIXEL;
                const isLikelyTouchpad = isPixelMode && absDeltaY > 0 && absDeltaY < 50;
                if (isLikelyTouchpad) {
                    return;
                }

                this.terminal.scrollLines(e.deltaY > 0 ? 1 : -1);
                e.preventDefault();
                e.stopPropagation();
            };

            this.connectElem.addEventListener("wheel", wheelHandler, { passive: false, capture: true });
            this.toDispose.push({
                dispose: () => {
                    this.connectElem.removeEventListener("wheel", wheelHandler, { capture: true });
                },
            });
        }
        if (this.nodeModel) {
            const unsubFn = globalStore.sub(this.nodeModel.isFocused, () => {
                const isFocused = globalStore.get(this.nodeModel.isFocused);
                if (isFocused) {
                    globalStore.set(this.unreadAtom, false);
                }
            });
            this.toDispose.push({ dispose: () => unsubFn() });
        }
        const pasteHandler = this.pasteHandler.bind(this);
        this.connectElem.addEventListener("paste", pasteHandler, true);
        this.toDispose.push({
            dispose: () => {
                this.connectElem.removeEventListener("paste", pasteHandler, true);
            },
        });
    }

    private maybeSendBellNotification() {
        const configured = globalStore.get(getOverrideConfigAtom(this.blockId, "term:bellnotify"));
        const enabled = configured ?? true;
        if (!enabled) {
            return;
        }

        const now = Date.now();
        // Avoid spamming multiple notifications for noisy programs.
        if (this.lastBellNotifyTs && now - this.lastBellNotifyTs < 2500) {
            return;
        }
        this.lastBellNotifyTs = now;

        const tabId = this.tabId || globalStore.get(atoms.staticTabId);
        const workspaceId = globalStore.get(atoms.workspace)?.oid;

        const tabAtom = WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId));
        const tabData = globalStore.get(tabAtom);
        const tabName = typeof tabData?.name === "string" ? tabData.name.trim() : "";

        const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", this.blockId));
        const blockData = globalStore.get(blockAtom);
        const connName = typeof blockData?.meta?.connection === "string" ? String(blockData.meta.connection).trim() : "";
        const cwdRaw = typeof blockData?.meta?.["cmd:cwd"] === "string" ? String(blockData.meta["cmd:cwd"]) : "";

        let cwd = cwdRaw.trim();
        if (!isBlank(cwd)) {
            cwd = cwd.replace(/[\\/]+$/, "");
            if (/^[A-Za-z]:$/.test(cwd)) {
                cwd = `${cwd}\\`;
            } else if (cwd === "") {
                cwd = cwdRaw.trim();
            }
        }

        const targetParts: string[] = [];
        if (!isBlank(connName) && !isLocalConnName(connName)) {
            targetParts.push(connName);
        }
        if (!isBlank(cwd)) {
            targetParts.push(cwd);
        }
        const targetLabel = targetParts.join(" · ");

        const bodyParts: string[] = [];
        if (!isBlank(tabName)) {
            bodyParts.push(tabName);
        }
        if (!isBlank(targetLabel)) {
            bodyParts.push(targetLabel);
        }

        fireAndForget(() =>
            RpcApi.NotifyCommand(
                TabRpcClient,
                {
                    title: i18next.t("term.bellNotifyTitle"),
                    body: bodyParts.join(" · ") || undefined,
                    silent: true,
                    workspaceid: workspaceId,
                    tabid: tabId,
                    blockid: this.blockId,
                },
                { route: "electron", timeout: 2000 }
            )
        );
    }

    private maybePushBellBubbleNotification() {
        const configured = globalStore.get(getOverrideConfigAtom(this.blockId, "term:bellnotify"));
        const enabled = configured ?? true;
        if (!enabled) {
            return;
        }

        const now = Date.now();
        // Avoid spamming multiple notifications for noisy programs.
        if (this.lastBellNotifyTs && now - this.lastBellNotifyTs < 2500) {
            return;
        }
        this.lastBellNotifyTs = now;

        const tabId = this.tabId || globalStore.get(atoms.staticTabId);

        const tabAtom = WOS.getWaveObjectAtom<Tab>(WOS.makeORef("tab", tabId));
        const tabData = globalStore.get(tabAtom);
        const tabName = typeof tabData?.name === "string" ? tabData.name.trim() : "";

        const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", this.blockId));
        const blockData = globalStore.get(blockAtom);
        const connName = typeof blockData?.meta?.connection === "string" ? String(blockData.meta.connection).trim() : "";
        const cwdRaw = typeof blockData?.meta?.["cmd:cwd"] === "string" ? String(blockData.meta["cmd:cwd"]) : "";

        let cwd = cwdRaw.trim();
        if (!isBlank(cwd)) {
            cwd = cwd.replace(/[\\/]+$/, "");
            if (/^[A-Za-z]:$/.test(cwd)) {
                cwd = `${cwd}\\`;
            } else if (cwd === "") {
                cwd = cwdRaw.trim();
            }
        }

        const targetParts: string[] = [];
        if (!isBlank(connName) && !isLocalConnName(connName)) {
            targetParts.push(connName);
        }
        if (!isBlank(cwd)) {
            targetParts.push(cwd);
        }
        const targetLabel = targetParts.join(" · ");

        const bodyParts: string[] = [];
        if (!isBlank(tabName)) {
            bodyParts.push(tabName);
        }
        if (!isBlank(targetLabel)) {
            bodyParts.push(targetLabel);
        }

        const clickActionPayload64 = stringToBase64(JSON.stringify({ tabId, blockId: this.blockId }));

        pushNotification({
            icon: "bell",
            title: i18next.t("term.bellNotifyTitle"),
            message: bodyParts.join(" · ") || "",
            timestamp: new Date(now).toISOString(),
            expiration: now + 2 * 60 * 1000,
            type: "warning",
            clickActionKey: `focus:${clickActionPayload64}`,
        });
    }

    getZoneId(): string {
        return this.blockId;
    }

    resetCompositionState() {
        this.isComposing = false;
        this.composingData = "";
    }

    private handleCompositionStart = (e: CompositionEvent) => {
        dlog("compositionstart", e.data);
        this.isComposing = true;
        this.composingData = "";
    };

    private handleCompositionUpdate = (e: CompositionEvent) => {
        dlog("compositionupdate", e.data);
        this.composingData = e.data || "";
    };

    private handleCompositionEnd = (e: CompositionEvent) => {
        dlog("compositionend", e.data);
        this.isComposing = false;
        this.lastComposedText = e.data || "";
        this.lastCompositionEnd = Date.now();
        this.firstDataAfterCompositionSent = false;
    };

    async initTerminal() {
        const copyOnSelectAtom = getSettingsKeyAtom("term:copyonselect");
        this.toDispose.push(this.terminal.onData(this.handleTermData.bind(this)));
        this.toDispose.push(this.terminal.onKey(this.onKeyHandler.bind(this)));
        this.toDispose.push(
            this.terminal.onSelectionChange(
                debounce(50, () => {
                    if (!globalStore.get(copyOnSelectAtom)) {
                        return;
                    }
                    const selectedText = this.terminal.getSelection();
                    if (selectedText.length > 0) {
                        navigator.clipboard.writeText(selectedText);
                    }
                })
            )
        );
        if (this.onSearchResultsDidChange != null) {
            this.toDispose.push(this.searchAddon.onDidChangeResults(this.onSearchResultsDidChange.bind(this)));
        }

        // Register IME composition event listeners on the xterm.js textarea
        const textareaElem = this.connectElem.querySelector("textarea");
        if (textareaElem) {
            textareaElem.addEventListener("compositionstart", this.handleCompositionStart);
            textareaElem.addEventListener("compositionupdate", this.handleCompositionUpdate);
            textareaElem.addEventListener("compositionend", this.handleCompositionEnd);

            // Handle blur during composition - reset state to avoid stale data
            const blurHandler = () => {
                if (this.isComposing) {
                    dlog("Terminal lost focus during composition, resetting IME state");
                    this.resetCompositionState();
                }
            };
            textareaElem.addEventListener("blur", blurHandler);

            this.toDispose.push({
                dispose: () => {
                    textareaElem.removeEventListener("compositionstart", this.handleCompositionStart);
                    textareaElem.removeEventListener("compositionupdate", this.handleCompositionUpdate);
                    textareaElem.removeEventListener("compositionend", this.handleCompositionEnd);
                    textareaElem.removeEventListener("blur", blurHandler);
                },
            });
        }

        this.mainFileSubject = getFileSubject(this.getZoneId(), TermFileName);
        this.mainFileSubject.subscribe(this.handleNewFileSubjectData.bind(this));

        try {
            const rtInfo = await RpcApi.GetRTInfoCommand(TabRpcClient, {
                oref: WOS.makeORef("block", this.blockId),
            });

            if (rtInfo && rtInfo["shell:integration"]) {
                const shellState = rtInfo["shell:state"] as ShellIntegrationStatus;
                globalStore.set(this.shellIntegrationStatusAtom, shellState || null);
            } else {
                globalStore.set(this.shellIntegrationStatusAtom, null);
            }

            const lastCmd = rtInfo ? rtInfo["shell:lastcmd"] : null;
            globalStore.set(this.lastCommandAtom, lastCmd || null);
        } catch (e) {
            console.log("Error loading runtime info:", e);
        }

        try {
            await this.loadInitialTerminalData();
        } finally {
            this.loaded = true;
        }
        this.runProcessIdleTimeout();
    }

    dispose() {
        this.promptMarkers.forEach((marker) => {
            try {
                marker.dispose();
            } catch (_) {}
        });
        this.promptMarkers = [];
        this.terminal.dispose();
        this.toDispose.forEach((d) => {
            try {
                d.dispose();
            } catch (_) {}
        });
        this.mainFileSubject.release();
    }

    handleTermData(data: string) {
        if (!this.loaded) {
            return;
        }

        // IME Composition Handling
        // Block all data during composition - only send the final text after compositionend
        // This prevents xterm.js from sending intermediate composition data (e.g., during compositionupdate)
        if (this.isComposing) {
            dlog("Blocked data during composition:", data);
            return;
        }

        if (this.pasteActive) {
            if (this.multiInputCallback) {
                this.multiInputCallback(data);
            }
        }

        // IME Deduplication (for Capslock input method switching)
        // When switching input methods with Capslock during composition, some systems send the
        // composed text twice. We allow the first send and block subsequent duplicates.
        const IMEDedupWindowMs = 50;
        const now = Date.now();
        const timeSinceCompositionEnd = now - this.lastCompositionEnd;
        if (timeSinceCompositionEnd < IMEDedupWindowMs && data === this.lastComposedText && this.lastComposedText) {
            if (!this.firstDataAfterCompositionSent) {
                // First send after composition - allow it but mark as sent
                this.firstDataAfterCompositionSent = true;
                dlog("First data after composition, allowing:", data);
            } else {
                // Second send of the same data - this is a duplicate from Capslock switching, block it
                dlog("Blocked duplicate IME data:", data);
                this.lastComposedText = ""; // Clear to allow same text to be typed again later
                this.firstDataAfterCompositionSent = false;
                return;
            }
        }

        this.sendDataHandler?.(data);
    }

    onKeyHandler(data: { key: string; domEvent: KeyboardEvent }) {
        if (this.multiInputCallback) {
            this.multiInputCallback(data.key);
        }
    }

    addFocusListener(focusFn: () => void) {
        this.terminal.textarea.addEventListener("focus", focusFn);
    }

    handleNewFileSubjectData(msg: WSFileEventData) {
        if (this.isReflowReloading && msg.fileop === "append") {
            return;
        }
        if (msg.fileop == "truncate") {
            this.terminal.clear();
            this.heldData = [];
            this.writeSequence++;
            this.pendingWriteChunks = [];
            this.pendingWriteHead = 0;
            this.pendingWriteBytes = 0;
        } else if (msg.fileop == "append") {
            const decodedData = base64ToArray(msg.data64);
            if (this.loaded) {
                const isBlockFocused = this.nodeModel ? globalStore.get(this.nodeModel.isFocused) : false;
                if (!document.hasFocus() || !isBlockFocused) {
                    globalStore.set(this.unreadAtom, true);
                }
                globalStore.set(this.lastOutputTsAtom, Date.now());
                this.enqueueTerminalBytes(decodedData);
            } else {
                this.heldData.push(decodedData);
            }
        } else {
            console.log("bad fileop for terminal", msg);
            return;
        }
    }

    private enqueueTerminalBytes(data: Uint8Array) {
        if (!data || data.length === 0) {
            return;
        }
        this.pendingWriteChunks.push(data);
        this.pendingWriteBytes += data.length;
        fireAndForget(() => this.flushTerminalWriteQueue());
    }

    private takeWriteBatch(): Uint8Array | null {
        if (this.pendingWriteHead >= this.pendingWriteChunks.length) {
            // Compact to reclaim memory when we’ve advanced through the queue.
            this.pendingWriteChunks = [];
            this.pendingWriteHead = 0;
            this.pendingWriteBytes = 0;
            return null;
        }

        const start = this.pendingWriteHead;
        let end = start;
        let totalBytes = 0;
        while (end < this.pendingWriteChunks.length) {
            const next = this.pendingWriteChunks[end];
            if (totalBytes > 0 && totalBytes + next.length > TerminalWriteBatchMaxBytes) {
                break;
            }
            totalBytes += next.length;
            end++;
            if (totalBytes >= TerminalWriteBatchMaxBytes) {
                break;
            }
        }

        if (end <= start) {
            return null;
        }

        let batch: Uint8Array;
        if (end - start === 1) {
            batch = this.pendingWriteChunks[start];
        } else {
            const combined = new Uint8Array(totalBytes);
            let offset = 0;
            for (let i = start; i < end; i++) {
                const chunk = this.pendingWriteChunks[i];
                combined.set(chunk, offset);
                offset += chunk.length;
            }
            batch = combined;
        }

        this.pendingWriteHead = end;
        this.pendingWriteBytes = Math.max(0, this.pendingWriteBytes - totalBytes);

        // Periodic compaction to avoid O(n) growth due to head advancement.
        if (this.pendingWriteHead > 1024) {
            this.pendingWriteChunks = this.pendingWriteChunks.slice(this.pendingWriteHead);
            this.pendingWriteHead = 0;
        }

        return batch;
    }

    private maybeUpdateAltBufState(force: boolean = false) {
        const now = Date.now();
        if (!force && now - this.lastAltBufAtomUpdateTs < 200) {
            return;
        }
        this.lastAltBufAtomUpdateTs = now;
        this.updateAltBufState();
    }

    private async flushTerminalWriteQueue() {
        if (!this.loaded) {
            return;
        }
        if (this.writeLoopRunning) {
            return;
        }

        const seq = this.writeSequence;
        this.writeLoopRunning = true;
        try {
            while (seq === this.writeSequence) {
                const batch = this.takeWriteBatch();
                if (!batch) {
                    break;
                }
                await this.doTerminalWrite(batch, null);
                this.maybeUpdateAltBufState();
            }
        } catch (e) {
            console.error("terminal write loop failed", this.blockId, e);
        } finally {
            this.writeLoopRunning = false;
            this.maybeUpdateAltBufState(true);
            if (this.pendingWriteBytes > 0) {
                fireAndForget(() => this.flushTerminalWriteQueue());
            }
        }
    }

    // Preserve the current scroll position so we can restore it after a reflow reload.
    saveScrollPosition(): void {
        if (!this.terminal) {
            return;
        }
        const buffer = this.terminal.buffer.active;
        if (buffer) {
            this.savedScrollPosition = buffer.viewportY;
        }
    }

    // Restore the previously preserved scroll position (best-effort).
    restoreScrollPosition(): void {
        if (!this.terminal || this.savedScrollPosition == null) {
            return;
        }
        const buffer = this.terminal.buffer.active;
        if (buffer) {
            // 确保目标位置在有效范围内
            const maxScroll = Math.max(0, buffer.baseY);
            const targetY = Math.min(Math.max(this.savedScrollPosition, 0), maxScroll);
            this.terminal.scrollToLine(targetY);
        }
        this.savedScrollPosition = null;
    }

    // Scroll to the bottom (latest output).
    scrollToBottom(): void {
        if (!this.terminal) {
            return;
        }
        this.terminal.scrollToBottom();
    }

    async reflowHistoryToCurrentWidth(reason: string) {
        if (!this.loaded) {
            return;
        }
        if (this.isReflowReloading) {
            return;
        }
        if (this.terminal == null) {
            return;
        }
        if (this.terminal.buffer.active.type === "alternate") {
            return;
        }

        // Preserve scroll position across reloads so the viewport doesn't jump.
        this.saveScrollPosition();
        // Avoid downloading/replaying huge histories on the UI thread.
        if (this.ptyOffset > ReflowReloadMaxBytes) {
            console.warn("term reflow reload skipped (history too large)", this.blockId, {
                ptyOffset: this.ptyOffset,
                maxBytes: ReflowReloadMaxBytes,
                reason,
            });
            return;
        }

        const currentSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
        if (
            this.lastReflowReloadTermSize != null &&
            this.lastReflowReloadTermSize.rows === currentSize.rows &&
            this.lastReflowReloadTermSize.cols === currentSize.cols
        ) {
            return;
        }

        this.isReflowReloading = true;
        try {
            // Ensure we have the final fitted size before replaying.
            this.handleResize();

            const zoneId = this.getZoneId();
            const { data: fullData, fileInfo } = await fetchWaveFile(zoneId, TermFileName, 0);
            if (fileInfo == null || fullData == null) {
                return;
            }
            if (fileInfo.size > ReflowReloadMaxBytes) {
                console.warn("term reflow reload skipped (file too large)", this.blockId, {
                    size: fileInfo.size,
                    maxBytes: ReflowReloadMaxBytes,
                    reason,
                });
                return;
            }

            this.promptMarkers.forEach((marker) => {
                try {
                    marker.dispose();
                } catch (_) {}
            });
            this.promptMarkers = [];
            this.dataBytesProcessed = 0;
            this.terminal.reset();
            this.handleResize();

            await this.doTerminalWrite(fullData, fileInfo.size);
            const { data: deltaData, fileInfo: deltaFileInfo } = await fetchWaveFile(zoneId, TermFileName, fileInfo.size);
            if (deltaFileInfo != null && deltaData != null && deltaData.byteLength > 0) {
                await this.doTerminalWrite(deltaData, null);
            }
            this.lastReflowReloadTermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
            // Restore scroll position after reflow reload.
            this.restoreScrollPosition();
        } catch (e) {
            console.error("term reflow reload failed", this.blockId, reason, e);
        } finally {
            this.isReflowReloading = false;
        }
    }

    doTerminalWrite(data: string | Uint8Array, setPtyOffset?: number): Promise<void> {
        let resolve: () => void = null;
        let prtn = new Promise<void>((presolve, _) => {
            resolve = presolve;
        });
        this.terminal.write(data, () => {
            if (setPtyOffset != null) {
                this.ptyOffset = setPtyOffset;
            } else {
                this.ptyOffset += data.length;
                this.dataBytesProcessed += data.length;
            }
            this.lastUpdated = Date.now();
            resolve();
        });
        return prtn;
    }

    async loadInitialTerminalData(): Promise<void> {
        const startTs = Date.now();
        const zoneId = this.getZoneId();
        const { data: cacheData, fileInfo: cacheFile } = await fetchWaveFile(zoneId, TermCacheFileName);
        let ptyOffset = 0;
        if (cacheFile != null) {
            ptyOffset = cacheFile.meta["ptyoffset"] ?? 0;
            if (cacheData.byteLength > 0) {
                const curTermSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
                const fileTermSize: TermSize = cacheFile.meta["termsize"];
                let didResize = false;
                if (
                    fileTermSize != null &&
                    (fileTermSize.rows != curTermSize.rows || fileTermSize.cols != curTermSize.cols)
                ) {
                    console.log("terminal restore size mismatch, temp resize", fileTermSize, curTermSize);
                    this.terminal.resize(fileTermSize.cols, fileTermSize.rows);
                    didResize = true;
                }
                this.doTerminalWrite(cacheData, ptyOffset);
                if (didResize) {
                    this.terminal.resize(curTermSize.cols, curTermSize.rows);
                }
            }
        }
        const { data: mainData, fileInfo: mainFile } = await fetchWaveFile(zoneId, TermFileName, ptyOffset);
        console.log(
            `terminal loaded cachefile:${cacheData?.byteLength ?? 0} main:${mainData?.byteLength ?? 0} bytes, ${Date.now() - startTs}ms`
        );
        if (mainFile != null) {
            await this.doTerminalWrite(mainData, null);
        }
        // After initial load, show the latest output.
        this.scrollToBottom();
    }

    async resyncController(reason: string) {
        dlog("resync controller", this.blockId, reason);
        const rtOpts: RuntimeOpts = { termsize: { rows: this.terminal.rows, cols: this.terminal.cols } };
        try {
            await RpcApi.ControllerResyncCommand(TabRpcClient, {
                tabid: this.tabId,
                blockid: this.blockId,
                rtopts: rtOpts,
            });
        } catch (e) {
            console.log(`error controller resync (${reason})`, this.blockId, e);
        }
    }

    handleResize() {
        const oldRows = this.terminal.rows;
        const oldCols = this.terminal.cols;
        this.fitAddon.fit();
        if (oldRows !== this.terminal.rows || oldCols !== this.terminal.cols) {
            const termSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
            RpcApi.ControllerInputCommand(TabRpcClient, { blockid: this.blockId, termsize: termSize });
        }
        dlog("resize", `${this.terminal.rows}x${this.terminal.cols}`, `${oldRows}x${oldCols}`, this.hasResized);
        if (!this.hasResized) {
            this.hasResized = true;
            this.resyncController("initial resize");
        }
    }

    private updateAltBufState() {
        const buffer = this.terminal?.buffer?.active;
        if (!buffer) {
            return;
        }
        globalStore.set(this.altBufAtom, buffer.type === "alternate");
    }

    processAndCacheData() {
        if (this.dataBytesProcessed < MinDataProcessedForCache) {
            return;
        }
        const now = Date.now();
        if (now - this.lastUpdated < TerminalStateSaveMinQuietMs) {
            return;
        }
        if (this.writeLoopRunning || this.pendingWriteBytes > 0) {
            return;
        }
        if (this.lastTerminalStateSaveTs > 0 && now - this.lastTerminalStateSaveTs < TerminalStateSaveMinIntervalMs) {
            return;
        }
        const serializedOutput = this.serializeAddon.serialize();
        const termSize: TermSize = { rows: this.terminal.rows, cols: this.terminal.cols };
        console.log("idle timeout term", this.dataBytesProcessed, serializedOutput.length, termSize);
        this.lastTerminalStateSaveTs = now;
        fireAndForget(() =>
            services.BlockService.SaveTerminalState(this.blockId, serializedOutput, "full", this.ptyOffset, termSize)
        );
        this.dataBytesProcessed = 0;
    }

    runProcessIdleTimeout() {
        setTimeout(() => {
            window.requestIdleCallback(() => {
                this.processAndCacheData();
                this.runProcessIdleTimeout();
            });
        }, 5000);
    }

    async pasteHandler(e?: ClipboardEvent): Promise<void> {
        this.pasteActive = true;
        e?.preventDefault();
        e?.stopPropagation();

        try {
            const clipboardData = await extractAllClipboardData(e);
            let firstImage = true;
            for (const data of clipboardData) {
                if (data.image && SupportsImageInput) {
                    if (!firstImage) {
                        await new Promise((r) => setTimeout(r, 150));
                    }
                    const tempPath = await createTempFileFromBlob(data.image);
                    this.terminal.paste(tempPath + " ");
                    firstImage = false;
                }
                if (data.text) {
                    this.terminal.paste(data.text);
                }
            }
        } catch (err) {
            console.error("Paste error:", err);
        } finally {
            setTimeout(() => {
                this.pasteActive = false;
            }, 30);
        }
    }
}

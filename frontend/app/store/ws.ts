// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { type WebSocket, newWebSocket } from "@/util/wsutil";
import debug from "debug";
import { sprintf } from "sprintf-js";

const AuthKeyHeader = "X-AuthKey";

const dlog = debug("wave:ws");

const WarnWebSocketSendSize = 1024 * 1024; // 1MB
const MaxWebSocketSendSize = 5 * 1024 * 1024; // 5MB
const reconnectHandlers: (() => void)[] = [];
const StableConnTime = 2000;

function addWSReconnectHandler(handler: () => void) {
    reconnectHandlers.push(handler);
}

function removeWSReconnectHandler(handler: () => void) {
    const index = reconnectHandlers.indexOf(handler);
    if (index > -1) {
        reconnectHandlers.splice(index, 1);
    }
}

type WSEventCallback = (arg0: WSEventType) => void;

type ElectronOverrideOpts = {
    authKey: string;
};

class WSControl {
    wsConn: WebSocket;
    open: boolean;
    opening: boolean = false;
    reconnectTimes: number = 0;
    msgQueue: any[] = [];
    stableId: string;
    messageCallback: WSEventCallback;
    watchSessionId: string = null;
    watchScreenId: string = null;
    wsLog: string[] = [];
    baseHostPort: string;
    lastReconnectTime: number = 0;
    eoOpts: ElectronOverrideOpts;
    noReconnect: boolean = false;
    onOpenTimeoutId: NodeJS.Timeout = null;
    pingIntervalId: ReturnType<typeof setInterval> | null = null;

    constructor(
        baseHostPort: string,
        stableId: string,
        messageCallback: WSEventCallback,
        electronOverrideOpts?: ElectronOverrideOpts
    ) {
        this.baseHostPort = baseHostPort;
        this.messageCallback = messageCallback;
        this.stableId = stableId;
        this.open = false;
        this.eoOpts = electronOverrideOpts;
        this.pingIntervalId = setInterval(this.sendPing.bind(this), 5000);
    }

    shutdown() {
        this.noReconnect = true;
        if (this.onOpenTimeoutId) {
            clearTimeout(this.onOpenTimeoutId);
            this.onOpenTimeoutId = null;
        }
        if (this.pingIntervalId) {
            clearInterval(this.pingIntervalId);
            this.pingIntervalId = null;
        }
        this.safeClose("shutdown");
    }

    onerror(event: any) {
        // In the browser, an error typically leads to an onclose callback.
        // In Node (we use the `ws` package when `window` is undefined), an
        // unhandled 'error' event can terminate the process. Always attach an
        // error handler to keep the app alive.
        dlog("connection error", event);
    }

    private safeSend(raw: string, context: string) {
        const wsConn = this.wsConn as any;
        if (!wsConn || typeof wsConn.send !== "function") {
            return;
        }
        try {
            wsConn.send(raw);
        } catch (e) {
            console.log("ws send error", context, e);
        }
    }

    private safeClose(context: string) {
        const wsConn = this.wsConn as any;
        if (!wsConn || typeof wsConn.close !== "function") {
            return;
        }
        try {
            wsConn.close();
        } catch (e) {
            console.log("ws close error", context, e);
        }
    }

    connectNow(desc: string) {
        if (this.open || this.noReconnect) {
            return;
        }
        this.lastReconnectTime = Date.now();
        dlog("try reconnect:", desc);
        this.opening = true;
        this.wsConn = newWebSocket(
            this.baseHostPort + "/ws?stableid=" + encodeURIComponent(this.stableId),
            this.eoOpts
                ? {
                      [AuthKeyHeader]: this.eoOpts.authKey,
                  }
                : null
        );
        this.wsConn.onopen = (e: Event) => {
            this.onopen(e);
        };
        this.wsConn.onmessage = (e: MessageEvent) => {
            this.onmessage(e);
        };
        this.wsConn.onclose = (e: CloseEvent) => {
            this.onclose(e);
        };
        this.wsConn.onerror = (e: Event) => {
            this.onerror(e);
        };
        const wsConnAny = this.wsConn as any;
        if (typeof wsConnAny.on === "function") {
            wsConnAny.on("error", (e: any) => {
                this.onerror(e);
            });
        }
    }

    reconnect(forceClose?: boolean) {
        if (this.noReconnect) {
            return;
        }
        if (this.open) {
            if (forceClose) {
                this.safeClose("reconnect");
            }
            return;
        }
        this.reconnectTimes++;
        if (this.reconnectTimes > 20) {
            dlog("cannot connect, giving up");
            return;
        }
        const timeoutArr = [0, 0, 2, 5, 10, 10, 30, 60];
        let timeout = 60;
        if (this.reconnectTimes < timeoutArr.length) {
            timeout = timeoutArr[this.reconnectTimes];
        }
        if (Date.now() - this.lastReconnectTime < 500) {
            timeout = 1;
        }
        if (timeout > 0) {
            dlog(sprintf("sleeping %ds", timeout));
        }
        setTimeout(() => {
            this.connectNow(String(this.reconnectTimes));
        }, timeout * 1000);
    }

    onclose(event: CloseEvent) {
        // console.log("close", event);
        if (this.onOpenTimeoutId) {
            clearTimeout(this.onOpenTimeoutId);
            this.onOpenTimeoutId = null;
        }
        if (event.wasClean) {
            dlog("connection closed");
        } else {
            dlog("connection error/disconnected");
        }
        if (this.open || this.opening) {
            this.open = false;
            this.opening = false;
            this.reconnect();
        }
    }

    onopen(e: Event) {
        dlog("connection open");
        this.open = true;
        this.opening = false;
        this.onOpenTimeoutId = setTimeout(() => {
            this.reconnectTimes = 0;
            dlog("clear reconnect times");
        }, StableConnTime);
        for (let handler of reconnectHandlers) {
            handler();
        }
        this.runMsgQueue();
    }

    runMsgQueue() {
        if (!this.open) {
            return;
        }
        if (this.msgQueue.length == 0) {
            return;
        }
        const msg = this.msgQueue.shift();
        this.sendMessage(msg);
        setTimeout(() => {
            this.runMsgQueue();
        }, 100);
    }

    onmessage(event: MessageEvent) {
        let eventData = null;
        if ((event as any)?.data != null) {
            const raw = (event as any).data;
            let rawStr: string = null;
            if (typeof raw === "string") {
                rawStr = raw;
            } else if (raw instanceof ArrayBuffer) {
                rawStr = new TextDecoder().decode(new Uint8Array(raw));
            } else if (ArrayBuffer.isView(raw)) {
                rawStr = new TextDecoder().decode(
                    new Uint8Array((raw as ArrayBufferView).buffer, (raw as ArrayBufferView).byteOffset, raw.byteLength)
                );
            }

            if (rawStr == null) {
                // Unexpected payload type; ignore to avoid crashing the app.
                return;
            }

            try {
                eventData = JSON.parse(rawStr);
            } catch (e) {
                dlog("error parsing ws message", e);
                return;
            }
        }
        if (eventData == null) {
            return;
        }
        if (eventData.type == "ping") {
            this.safeSend(JSON.stringify({ type: "pong", stime: Date.now() }), "pong");
            return;
        }
        if (eventData.type == "pong") {
            // nothing
            return;
        }
        if (this.messageCallback) {
            try {
                this.messageCallback(eventData);
            } catch (e) {
                console.log("[error] messageCallback", e);
            }
        }
    }

    sendPing() {
        if (!this.open) {
            return;
        }
        this.safeSend(JSON.stringify({ type: "ping", stime: Date.now() }), "ping");
    }

    sendMessage(data: WSCommandType) {
        if (!this.open) {
            return;
        }
        const msg = JSON.stringify(data);
        const byteSize = new Blob([msg]).size;
        if (byteSize > MaxWebSocketSendSize) {
            console.log("ws message too large", byteSize, data.wscommand, msg.substring(0, 100));
            return;
        }
        if (byteSize > WarnWebSocketSendSize) {
            console.log("ws message large", byteSize, data.wscommand, msg.substring(0, 100));
        }
        this.safeSend(msg, "sendMessage");
    }

    pushMessage(data: WSCommandType) {
        if (!this.open) {
            if (data.wscommand === "rpc" && data.message) {
                const cmd = data.message.command;
                if (cmd === "routeannounce" || cmd === "routeunannounce") {
                    return;
                }
            }
            this.msgQueue.push(data);
            return;
        }
        this.sendMessage(data);
    }
}

let globalWS: WSControl;
function initGlobalWS(
    baseHostPort: string,
    stableId: string,
    messageCallback: WSEventCallback,
    electronOverrideOpts?: ElectronOverrideOpts
) {
    globalWS = new WSControl(baseHostPort, stableId, messageCallback, electronOverrideOpts);
}

function sendRawRpcMessage(msg: RpcMessage) {
    const wsMsg: WSRpcCommand = { wscommand: "rpc", message: msg };
    sendWSCommand(wsMsg);
}

function sendWSCommand(cmd: WSCommandType) {
    globalWS?.pushMessage(cmd);
}

export {
    WSControl,
    addWSReconnectHandler,
    globalWS,
    initGlobalWS,
    removeWSReconnectHandler,
    sendRawRpcMessage,
    sendWSCommand,
    type ElectronOverrideOpts,
};

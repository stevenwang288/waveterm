// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WindowService } from "@/app/store/services";
import { RpcResponseHelper, WshClient } from "@/app/store/wshclient";
import { RpcApi } from "@/app/store/wshclientapi";
import { fireAndForget, isBlank } from "@/util/util";
import { Notification, net, safeStorage, shell } from "electron";
import { getResolvedUpdateChannel } from "emain/updater";
import { unamePlatform } from "./emain-platform";
import { getWebContentsByBlockId, webGetSelector } from "./emain-web";
import {
    createBrowserWindow,
    createWindowForWorkspace,
    focusedWaveWindow,
    getAllWaveWindows,
    getWaveWindowById,
    getWaveWindowByTabId,
    getWaveWindowByWorkspaceId,
} from "./emain-window";

export class ElectronWshClientType extends WshClient {
    constructor() {
        super("electron");
    }

    private async focusFromNotification(
        notificationOptions: WaveNotificationOptions,
        sourceRouteId?: string
    ): Promise<void> {
        let tabId = notificationOptions?.tabid;
        let workspaceId = notificationOptions?.workspaceid;
        const blockId = notificationOptions?.blockid;

        if (isBlank(tabId) && sourceRouteId?.startsWith("tab:")) {
            tabId = sourceRouteId.slice("tab:".length);
        }

        if ((isBlank(tabId) || isBlank(workspaceId)) && !isBlank(blockId)) {
            try {
                const blockInfo = await RpcApi.BlockInfoCommand(ElectronWshClient, blockId, { timeout: 2000 });
                tabId = tabId || blockInfo?.tabid;
                workspaceId = workspaceId || blockInfo?.workspaceid;
            } catch (e) {
                // ignore; fall back to focusing a window
            }
        }

        let ww = !isBlank(tabId) ? getWaveWindowByTabId(tabId) : null;
        if (ww == null && !isBlank(workspaceId)) {
            ww = getWaveWindowByWorkspaceId(workspaceId);
        }
        if (ww == null && !isBlank(workspaceId)) {
            try {
                await createWindowForWorkspace(workspaceId);
            } catch {
                // ignore
            }
            ww = getWaveWindowByWorkspaceId(workspaceId);
        }
        if (ww == null) {
            ww = focusedWaveWindow;
        }
        if (ww == null) {
            ww = getAllWaveWindows()?.[0];
        }
        if (ww == null) {
            return;
        }

        try {
            ww.show();
        } catch {
            // ignore
        }
        ww.focus();

        if (!isBlank(tabId)) {
            await ww.setActiveTab(tabId, true);
            if (!isBlank(blockId)) {
                try {
                    await RpcApi.SetBlockFocusCommand(ElectronWshClient, blockId, {
                        route: `tab:${tabId}`,
                        timeout: 2000,
                    });
                } catch {
                    // ignore
                }
            }
        }
    }

    async handle_webselector(rh: RpcResponseHelper, data: CommandWebSelectorData): Promise<string[]> {
        if (!data.tabid || !data.blockid || !data.workspaceid) {
            throw new Error("tabid and blockid are required");
        }
        const ww = getWaveWindowByWorkspaceId(data.workspaceid);
        if (ww == null) {
            throw new Error(`no window found with workspace ${data.workspaceid}`);
        }
        const wc = await getWebContentsByBlockId(ww, data.tabid, data.blockid);
        if (wc == null) {
            throw new Error(`no webcontents found with blockid ${data.blockid}`);
        }
        const rtn = await webGetSelector(wc, data.selector, data.opts);
        return rtn;
    }

    async handle_notify(rh: RpcResponseHelper, notificationOptions: WaveNotificationOptions) {
        const sourceRouteId = rh.getSource();
        const notification = new Notification({
            title: notificationOptions.title,
            body: notificationOptions.body,
            silent: notificationOptions.silent,
        });
        notification.on("click", () => {
            fireAndForget(() => this.focusFromNotification(notificationOptions, sourceRouteId));
        });
        notification.show();
    }

    async handle_getupdatechannel(rh: RpcResponseHelper): Promise<string> {
        return getResolvedUpdateChannel();
    }

    async handle_focuswindow(rh: RpcResponseHelper, windowId: string) {
        console.log(`focuswindow ${windowId}`);
        const fullConfig = await RpcApi.GetFullConfigCommand(ElectronWshClient);
        let ww = getWaveWindowById(windowId);
        if (ww == null) {
            const window = await WindowService.GetWindow(windowId);
            if (window == null) {
                throw new Error(`window ${windowId} not found`);
            }
            ww = await createBrowserWindow(window, fullConfig, {
                unamePlatform,
                isPrimaryStartupWindow: false,
            });
        }
        ww.focus();
    }

    async handle_electronencrypt(
        rh: RpcResponseHelper,
        data: CommandElectronEncryptData
    ): Promise<CommandElectronEncryptRtnData> {
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error("encryption is not available");
        }
        const encrypted = safeStorage.encryptString(data.plaintext);
        const ciphertext = encrypted.toString("base64");

        let storagebackend = "";
        if (process.platform === "linux") {
            storagebackend = safeStorage.getSelectedStorageBackend();
        }

        return {
            ciphertext,
            storagebackend,
        };
    }

    async handle_electrondecrypt(
        rh: RpcResponseHelper,
        data: CommandElectronDecryptData
    ): Promise<CommandElectronDecryptRtnData> {
        if (!safeStorage.isEncryptionAvailable()) {
            throw new Error("encryption is not available");
        }
        const encrypted = Buffer.from(data.ciphertext, "base64");
        const plaintext = safeStorage.decryptString(encrypted);

        let storagebackend = "";
        if (process.platform === "linux") {
            storagebackend = safeStorage.getSelectedStorageBackend();
        }

        return {
            plaintext,
            storagebackend,
        };
    }

    async handle_networkonline(rh: RpcResponseHelper): Promise<boolean> {
        return net.isOnline();
    }

    async handle_electronsystembell(rh: RpcResponseHelper): Promise<void> {
        shell.beep();
    }

    // async handle_workspaceupdate(rh: RpcResponseHelper) {
    //     console.log("workspaceupdate");
    //     fireAndForget(async () => {
    //         console.log("workspace menu clicked");
    //         const updatedWorkspaceMenu = await getWorkspaceMenu();
    //         const workspaceMenu = Menu.getApplicationMenu().getMenuItemById("workspace-menu");
    //         workspaceMenu.submenu = Menu.buildFromTemplate(updatedWorkspaceMenu);
    //     });
    // }
}

export let ElectronWshClient: ElectronWshClientType;

export function initElectronWshClient() {
    ElectronWshClient = new ElectronWshClientType();
}

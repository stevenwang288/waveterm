// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import i18next from "@/app/i18n";

export const PlatformMacOS = "darwin";
export const PlatformWindows = "win32";
export let PLATFORM: NodeJS.Platform = PlatformMacOS;

export function setPlatform(platform: NodeJS.Platform) {
    PLATFORM = platform;
}

export function isMacOS(): boolean {
    return PLATFORM == PlatformMacOS;
}

export function isWindows(): boolean {
    return PLATFORM == PlatformWindows;
}

export function makeNativeLabel(isDirectory: boolean) {
    if (!isDirectory) {
        return i18next.t("native.openInDefaultApp");
    }
    let managerName: string;
    if (PLATFORM === PlatformMacOS) {
        managerName = i18next.t("native.manager.finder");
    } else if (PLATFORM == PlatformWindows) {
        managerName = i18next.t("native.manager.explorer");
    } else {
        managerName = i18next.t("native.manager.fileManager");
    }
    return i18next.t("native.revealInManager", { manager: managerName });
}

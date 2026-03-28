// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isWindows } from "@/util/platformutil";

export type WorkbenchAgentPreset = "codex" | "cloud";

type WorkbenchAgentSpec = {
    preset: WorkbenchAgentPreset;
    label: string;
    displayName: string;
    launchTitle: string;
    launchCommand: string;
};

function resolveCodexLaunchCommand(): string {
    if (isWindows()) {
        return "codex.cmd";
    }
    if (typeof navigator !== "undefined") {
        const navigatorWithPlatform = navigator as Navigator & {
            userAgentData?: {
                platform?: string;
            };
        };
        const platform = String(
            navigatorWithPlatform.userAgentData?.platform ?? navigator.platform ?? ""
        ).toLowerCase();
        if (platform.includes("win")) {
            return "codex.cmd";
        }
    }
    return "codex";
}

export const WORKBENCH_AGENT_SPECS: Record<WorkbenchAgentPreset, WorkbenchAgentSpec> = {
    codex: {
        preset: "codex",
        label: "Codex",
        displayName: "Codex",
        launchTitle: "启动 Codex",
        launchCommand: resolveCodexLaunchCommand(),
    },
    cloud: {
        preset: "cloud",
        label: "Claude",
        displayName: "Claude",
        launchTitle: "启动 Claude",
        launchCommand: "claude",
    },
};

export function getWorkbenchAgentSpec(preset: WorkbenchAgentPreset): WorkbenchAgentSpec {
    return WORKBENCH_AGENT_SPECS[preset];
}

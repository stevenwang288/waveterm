// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { formatCwdForDisplay } from "@/util/cwdlabel";
import { getEnv } from "@/util/getenv";

export const WaveLaunchCwdVarName = "WAVETERM_LAUNCH_CWD";

export function getLaunchCwdForDisplay(): string {
    return formatCwdForDisplay(getEnv(WaveLaunchCwdVarName) ?? "");
}

export function getTerminalDisplayCwd(meta?: Record<string, any>): string {
    const explicitDisplayCwd = typeof meta?.["display:launchcwd"] === "string" ? meta["display:launchcwd"] : "";
    const initialCmdCwd = typeof meta?.["cmd:cwd"] === "string" ? meta["cmd:cwd"] : "";
    return formatCwdForDisplay(explicitDisplayCwd || initialCmdCwd || getLaunchCwdForDisplay());
}

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isBlank } from "@/util/util";

export function shouldOpenNewWindowInCurrentView(meta?: Record<string, any> | null): boolean {
    return !isBlank(meta?.["web:partition"]);
}

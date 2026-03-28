// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { isBlank } from "@/util/util";

export function getWebViewTitle(frameTitle: string | null | undefined): string {
    const normalizedTitle = String(frameTitle ?? "").trim();
    return isBlank(normalizedTitle) ? "Web" : normalizedTitle;
}

export function shouldHideWebViewTitle(frameTitle: string | null | undefined): boolean {
    return isBlank(String(frameTitle ?? "").trim());
}

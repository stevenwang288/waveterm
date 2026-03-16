// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export function syncHeaderTailInput(input: HTMLInputElement | null | undefined): void {
    if (input == null) {
        return;
    }
    input.scrollLeft = input.scrollWidth;
}

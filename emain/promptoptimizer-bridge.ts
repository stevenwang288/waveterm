// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { optimizePromptViaGooseBackend } from "./goose-promptoptimizer-bridge";

export async function optimizeWavePromptInput(prompt: string): Promise<string> {
    return optimizePromptViaGooseBackend({ prompt });
}

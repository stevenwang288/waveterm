// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import * as jotai from "jotai";

const waveAIStreamingAtom = jotai.atom(false);
const waveAICurrentModeAtom = jotai.atom("");
const waveAIErrorAtom = jotai.atom(null) as jotai.PrimitiveAtom<string>;
const waveAILatestAssistantMessageTextAtom = jotai.atom("");
const waveAIPreviousAssistantMessageTextAtom = jotai.atom("");

export {
    waveAIStreamingAtom,
    waveAICurrentModeAtom,
    waveAIErrorAtom,
    waveAILatestAssistantMessageTextAtom,
    waveAIPreviousAssistantMessageTextAtom,
};

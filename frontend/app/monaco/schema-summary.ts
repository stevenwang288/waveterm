// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

type MonacoSchemaSummaryItem = {
    uri: string;
    fileMatch: Array<string>;
};

const MonacoSchemaSummary: MonacoSchemaSummaryItem[] = [
    {
        uri: "wave://schema/settings.json",
        fileMatch: ["*/WAVECONFIGPATH/settings.json"],
    },
    {
        uri: "wave://schema/connections.json",
        fileMatch: ["*/WAVECONFIGPATH/connections.json"],
    },
    {
        uri: "wave://schema/aipresets.json",
        fileMatch: ["*/WAVECONFIGPATH/presets/ai.json"],
    },
    {
        uri: "wave://schema/bgpresets.json",
        fileMatch: ["*/WAVECONFIGPATH/presets/bg.json"],
    },
    {
        uri: "wave://schema/waveai.json",
        fileMatch: ["*/WAVECONFIGPATH/waveai.json"],
    },
    {
        uri: "wave://schema/widgets.json",
        fileMatch: ["*/WAVECONFIGPATH/widgets.json"],
    },
];

export { MonacoSchemaSummary };
export type { MonacoSchemaSummaryItem };

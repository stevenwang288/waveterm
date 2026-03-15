// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type WidgetBarMode = "normal" | "compact" | "supercompact";

interface UtilityWidgetCountOptions {
    showAppsButton?: boolean;
    showDevIndicator?: boolean;
    showExplorerConnection?: boolean;
}

interface WidgetBarModeOptions {
    containerHeight: number;
    normalHeight: number;
    widgetCount: number;
    utilityWidgetCount: number;
    gracePeriod?: number;
    minHeightPerWidget?: number;
}

export function getUtilityWidgetCount({
    showAppsButton = false,
    showDevIndicator = false,
    showExplorerConnection = false,
}: UtilityWidgetCountOptions): number {
    const baseUtilityWidgets = 3; // git, ai launcher, settings
    return (
        baseUtilityWidgets +
        Number(showAppsButton) +
        Number(showDevIndicator) +
        Number(showExplorerConnection)
    );
}

export function getWidgetBarMode({
    containerHeight,
    normalHeight,
    widgetCount,
    utilityWidgetCount,
    gracePeriod = 10,
    minHeightPerWidget = 32,
}: WidgetBarModeOptions): WidgetBarMode {
    if (normalHeight <= containerHeight - gracePeriod) {
        return "normal";
    }

    const requiredHeight = (widgetCount + utilityWidgetCount) * minHeightPerWidget;
    return requiredHeight > containerHeight ? "supercompact" : "compact";
}

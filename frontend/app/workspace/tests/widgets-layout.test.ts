// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import { getUtilityWidgetCount, getWidgetBarMode } from "../widgets-layout";

test("getUtilityWidgetCount only counts currently rendered utility buttons", () => {
    assert.equal(getUtilityWidgetCount({}), 3);
    assert.equal(getUtilityWidgetCount({ showExplorerConnection: true }), 4);
    assert.equal(getUtilityWidgetCount({ showAppsButton: true, showExplorerConnection: true }), 5);
    assert.equal(getUtilityWidgetCount({ showAppsButton: true, showDevIndicator: true, showExplorerConnection: true }), 6);
});

test("getWidgetBarMode keeps a single-column compact rail when the actual buttons still fit", () => {
    const mode = getWidgetBarMode({
        containerHeight: 320,
        normalHeight: 360,
        widgetCount: 5,
        utilityWidgetCount: getUtilityWidgetCount({}),
    });

    assert.equal(mode, "compact");
});

test("getWidgetBarMode only falls back to supercompact when even the icon-only rail does not fit", () => {
    const mode = getWidgetBarMode({
        containerHeight: 250,
        normalHeight: 360,
        widgetCount: 6,
        utilityWidgetCount: getUtilityWidgetCount({
            showAppsButton: true,
            showDevIndicator: true,
            showExplorerConnection: true,
        }),
    });

    assert.equal(mode, "supercompact");
});

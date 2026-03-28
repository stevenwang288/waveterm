import { describe, expect, it } from "vitest";

import { shouldOpenNewWindowInCurrentView } from "../new-window-utils";

describe("new-window-utils", () => {
    it("keeps partitioned webviews in the current browser session", () => {
        expect(
            shouldOpenNewWindowInCurrentView({
                "web:partition": "persist:wave-browser:beta",
            })
        ).toBe(true);
    });

    it("does not change generic webview behavior when no partition is configured", () => {
        expect(shouldOpenNewWindowInCurrentView(undefined)).toBe(false);
        expect(shouldOpenNewWindowInCurrentView({})).toBe(false);
        expect(shouldOpenNewWindowInCurrentView({ "web:partition": "" })).toBe(false);
    });
});

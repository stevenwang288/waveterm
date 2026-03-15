import {
    captureTerminalScrollRestoreState,
    isTerminalViewportNearBottom,
    resolveTerminalScrollRestoreTarget,
} from "../term-scroll";
import { describe, expect, it } from "vitest";

describe("term scroll follow logic", () => {
    it("treats near-bottom viewport as still following latest output", () => {
        expect(isTerminalViewportNearBottom(120, 120)).toBe(true);
        expect(isTerminalViewportNearBottom(120, 119)).toBe(true);
        expect(isTerminalViewportNearBottom(120, 118)).toBe(false);
    });

    it("restores to bottom when reflow starts from the latest output", () => {
        const snapshot = captureTerminalScrollRestoreState(80, 79);

        expect(snapshot).toEqual({
            restoreBottom: true,
            savedScrollPosition: null,
        });
        expect(resolveTerminalScrollRestoreTarget(snapshot.savedScrollPosition, snapshot.restoreBottom, 120)).toBe("bottom");
    });

    it("restores the previous viewport when the user was reading history", () => {
        const snapshot = captureTerminalScrollRestoreState(80, 42);

        expect(snapshot).toEqual({
            restoreBottom: false,
            savedScrollPosition: 42,
        });
        expect(resolveTerminalScrollRestoreTarget(snapshot.savedScrollPosition, snapshot.restoreBottom, 30)).toBe(30);
        expect(resolveTerminalScrollRestoreTarget(snapshot.savedScrollPosition, snapshot.restoreBottom, 100)).toBe(42);
    });
});

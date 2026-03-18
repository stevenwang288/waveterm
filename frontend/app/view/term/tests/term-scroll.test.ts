import {
    captureTerminalScrollRestoreState,
    isTerminalViewportNearBottom,
    TerminalAutoFollowResumeController,
    TerminalAutoFollowResumeDelayMs,
    resolveTerminalFollowLatestState,
    resolveTerminalScrollRestoreTarget,
} from "../term-scroll";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

    it("keeps manual upward scrolling detached until the viewport returns to the exact bottom", () => {
        expect(resolveTerminalFollowLatestState(120, 119, true)).toEqual({
            followLatestOutput: false,
            manuallyDetached: true,
        });
        expect(resolveTerminalFollowLatestState(240, 119, true)).toEqual({
            followLatestOutput: false,
            manuallyDetached: true,
        });
        expect(resolveTerminalFollowLatestState(120, 120, true)).toEqual({
            followLatestOutput: true,
            manuallyDetached: false,
        });
    });
});

describe("terminal auto follow resume controller", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("waits for 10 seconds of inactivity before resuming", () => {
        const onResume = vi.fn();
        const controller = new TerminalAutoFollowResumeController(onResume);

        controller.markActivity(true);
        vi.advanceTimersByTime(TerminalAutoFollowResumeDelayMs - 1);
        expect(onResume).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(onResume).toHaveBeenCalledTimes(1);
    });

    it("resets the countdown whenever new manual activity happens", () => {
        const onResume = vi.fn();
        const controller = new TerminalAutoFollowResumeController(onResume);

        controller.markActivity(true);
        vi.advanceTimersByTime(4_000);
        controller.markActivity(true);
        vi.advanceTimersByTime(9_999);
        expect(onResume).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(onResume).toHaveBeenCalledTimes(1);
    });

    it("cancels the pending resume once auto-follow is restored another way", () => {
        const onResume = vi.fn();
        const controller = new TerminalAutoFollowResumeController(onResume);

        controller.markActivity(true);
        controller.markActivity(false);
        vi.advanceTimersByTime(TerminalAutoFollowResumeDelayMs);

        expect(onResume).not.toHaveBeenCalled();
    });
});

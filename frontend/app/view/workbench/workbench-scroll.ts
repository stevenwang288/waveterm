import { TerminalAutoFollowResumeController, TerminalAutoFollowResumeDelayMs } from "../term/term-scroll";

export { TerminalAutoFollowResumeController, TerminalAutoFollowResumeDelayMs };

export const WorkbenchBottomFollowThresholdPx = 8;

export function getWorkbenchDistanceFromBottom(scrollHeight: number, scrollTop: number, clientHeight: number): number {
    return scrollHeight - scrollTop - clientHeight;
}

export function isWorkbenchViewportNearBottom(
    scrollHeight: number,
    scrollTop: number,
    clientHeight: number,
    threshold = WorkbenchBottomFollowThresholdPx
): boolean {
    return getWorkbenchDistanceFromBottom(scrollHeight, scrollTop, clientHeight) <= threshold;
}

export function isWorkbenchViewportAtBottom(scrollHeight: number, scrollTop: number, clientHeight: number): boolean {
    return getWorkbenchDistanceFromBottom(scrollHeight, scrollTop, clientHeight) <= 0;
}

export function resolveWorkbenchFollowLatestState(
    scrollHeight: number,
    scrollTop: number,
    clientHeight: number,
    manuallyDetached: boolean,
    threshold = WorkbenchBottomFollowThresholdPx
) {
    if (!manuallyDetached) {
        return {
            followLatestOutput: isWorkbenchViewportNearBottom(scrollHeight, scrollTop, clientHeight, threshold),
            manuallyDetached: false,
        };
    }
    if (isWorkbenchViewportAtBottom(scrollHeight, scrollTop, clientHeight)) {
        return {
            followLatestOutput: true,
            manuallyDetached: false,
        };
    }
    return {
        followLatestOutput: false,
        manuallyDetached: true,
    };
}

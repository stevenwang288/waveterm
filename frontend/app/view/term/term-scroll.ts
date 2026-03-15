export const TerminalBottomFollowThreshold = 1;

export function isTerminalViewportNearBottom(baseY: number, viewportY: number, threshold = TerminalBottomFollowThreshold) {
    return baseY - viewportY <= threshold;
}

export function captureTerminalScrollRestoreState(
    baseY: number,
    viewportY: number,
    threshold = TerminalBottomFollowThreshold
): {
    restoreBottom: boolean;
    savedScrollPosition: number | null;
} {
    if (isTerminalViewportNearBottom(baseY, viewportY, threshold)) {
        return {
            restoreBottom: true,
            savedScrollPosition: null,
        };
    }
    return {
        restoreBottom: false,
        savedScrollPosition: viewportY,
    };
}

export function resolveTerminalScrollRestoreTarget(
    savedScrollPosition: number | null,
    restoreBottom: boolean,
    maxScroll: number
): number | "bottom" | null {
    if (restoreBottom) {
        return "bottom";
    }
    if (savedScrollPosition == null) {
        return null;
    }
    return Math.min(Math.max(savedScrollPosition, 0), Math.max(0, maxScroll));
}

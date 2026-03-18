import { colord } from "colord";

export const DEFAULT_BLOCK_FOCUS_RING_COLOR = "#2be4b8";
export const FOCUSED_BLOCK_BORDER_WIDTH_PX = 6;

const FOCUS_SIGNAL_BLEND = 0.72;
const FOCUS_WHITE_LIFT = 0.08;
const FOCUS_RING_OUTLINE_ALPHA = 0.46;
const FOCUS_RING_GLOW_ALPHA = 0.34;

type BlockMaskStyleOptions = {
    baseBorderColor?: string;
    disableFocusHighlight?: boolean;
    isFocused: boolean;
};

function isValidColor(value?: string): value is string {
    return value != null && value.trim() !== "" && colord(value).isValid();
}

function mixColors(sourceColor: string, targetColor: string, weight: number): string {
    const source = colord(sourceColor).toRgb();
    const target = colord(targetColor).toRgb();
    const mixChannel = (sourceChannel: number, targetChannel: number) => {
        return Math.round(sourceChannel + (targetChannel - sourceChannel) * weight);
    };

    return colord({
        r: mixChannel(source.r, target.r),
        g: mixChannel(source.g, target.g),
        b: mixChannel(source.b, target.b),
    }).toHex();
}

function withAlpha(color: string, alpha: number): string {
    return colord(color).alpha(alpha).toRgbString();
}

export function getFocusedBlockRingColor(baseBorderColor?: string): string {
    if (!isValidColor(baseBorderColor)) {
        return DEFAULT_BLOCK_FOCUS_RING_COLOR;
    }

    const baseColor = colord(baseBorderColor).toHex();
    const signalColor = mixColors(baseColor, DEFAULT_BLOCK_FOCUS_RING_COLOR, FOCUS_SIGNAL_BLEND);
    return mixColors(signalColor, "#ffffff", FOCUS_WHITE_LIFT);
}

export function computeBlockMaskStyle({
    baseBorderColor,
    disableFocusHighlight = false,
    isFocused,
}: BlockMaskStyleOptions): Record<string, string> {
    if (isFocused && !disableFocusHighlight) {
        const focusRingColor = getFocusedBlockRingColor(baseBorderColor);
        return {
            borderColor: focusRingColor,
            borderWidth: `${FOCUSED_BLOCK_BORDER_WIDTH_PX}px`,
            boxShadow: `0 0 0 1px ${withAlpha(focusRingColor, FOCUS_RING_OUTLINE_ALPHA)}, 0 0 24px ${withAlpha(focusRingColor, FOCUS_RING_GLOW_ALPHA)}`,
        };
    }

    if (!isValidColor(baseBorderColor)) {
        return {};
    }

    return {
        borderColor: baseBorderColor.trim(),
    };
}

import {
    computeBlockMaskStyle,
    DEFAULT_BLOCK_FOCUS_RING_COLOR,
    FOCUSED_BLOCK_BORDER_WIDTH_PX,
    getFocusedBlockRingColor,
} from "../block-focus-style";
import { describe, expect, it } from "vitest";

describe("block focus style", () => {
    it("uses the shared focus ring when no explicit color exists", () => {
        const style = computeBlockMaskStyle({ isFocused: true });

        expect(style.borderWidth).toBe(`${FOCUSED_BLOCK_BORDER_WIDTH_PX}px`);
        expect(style.borderColor).toBe(DEFAULT_BLOCK_FOCUS_RING_COLOR);
        expect(style.boxShadow).toContain("rgba(43, 228, 184, 0.46)");
    });

    it("keeps the resting border color when the block is not focused", () => {
        const style = computeBlockMaskStyle({ baseBorderColor: "#445566", isFocused: false });

        expect(style.borderColor).toBe("#445566");
        expect(style.borderWidth).toBeUndefined();
        expect(style.boxShadow).toBeUndefined();
    });

    it("lifts explicit focus colors into a brighter mint ring", () => {
        expect(getFocusedBlockRingColor("#58c142")).toBe("#48dd9f");
    });

    it("does not apply the thick focus ring when highlight is disabled", () => {
        const style = computeBlockMaskStyle({
            baseBorderColor: "#58c142",
            isFocused: true,
            disableFocusHighlight: true,
        });

        expect(style.borderColor).toBe("#58c142");
        expect(style.borderWidth).toBeUndefined();
        expect(style.boxShadow).toBeUndefined();
    });
});

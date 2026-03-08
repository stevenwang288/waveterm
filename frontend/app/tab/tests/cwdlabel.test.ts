import { describe, expect, it } from "vitest";
import { formatCwdForDisplay } from "@/util/cwdlabel";

describe("formatCwdForDisplay", () => {
    it("returns the normalized cwd for full paths", () => {
        expect(formatCwdForDisplay("D:/OneDrive/steven/code/ai/12CLI/waveterm-main/")).toBe(
            "D:/OneDrive/steven/code/ai/12CLI/waveterm-main"
        );
    });

    it("preserves drive roots", () => {
        expect(formatCwdForDisplay("C:")).toBe("C:\\");
    });

    it("returns empty for blank input", () => {
        expect(formatCwdForDisplay("   ")).toBe("");
    });
});

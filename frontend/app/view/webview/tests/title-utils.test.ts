import { describe, expect, it } from "vitest";

import { getWebViewTitle, shouldHideWebViewTitle } from "../title-utils";

describe("title-utils", () => {
    it("falls back to Web when frame title is blank", () => {
        expect(getWebViewTitle("")).toBe("Web");
        expect(getWebViewTitle("   ")).toBe("Web");
        expect(getWebViewTitle(null)).toBe("Web");
        expect(shouldHideWebViewTitle("")).toBe(true);
        expect(shouldHideWebViewTitle("   ")).toBe(true);
    });

    it("uses the trimmed frame title when provided", () => {
        expect(getWebViewTitle("  Beta Browser  ")).toBe("Beta Browser");
        expect(shouldHideWebViewTitle("  Beta Browser  ")).toBe(false);
    });
});

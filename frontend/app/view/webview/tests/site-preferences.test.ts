import { describe, expect, it } from "vitest";

import { getPreferredExternalSiteLabel, shouldSuggestExternalBrowser } from "../site-preferences";

describe("site-preferences", () => {
    it("suggests external browser for Douyin hostnames", () => {
        expect(shouldSuggestExternalBrowser("https://www.douyin.com/user/self")).toBe(true);
        expect(shouldSuggestExternalBrowser("https://v.douyin.com/abcd1234")).toBe(true);
        expect(shouldSuggestExternalBrowser("https://www.iesdouyin.com/share/video/1")).toBe(true);
        expect(getPreferredExternalSiteLabel("https://www.douyin.com/video/1")).toBe("Douyin");
    });

    it("does not match lookalike or unsupported URLs", () => {
        expect(shouldSuggestExternalBrowser("https://douyin.com.evil.example/video/1")).toBe(false);
        expect(shouldSuggestExternalBrowser("https://example.com")).toBe(false);
        expect(shouldSuggestExternalBrowser("bytedance://open")).toBe(false);
        expect(getPreferredExternalSiteLabel("notaurl")).toBeNull();
    });
});

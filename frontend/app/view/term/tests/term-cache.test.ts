import { describe, expect, it } from "vitest";

import { createTerminalCacheMeta, shouldRestoreTerminalCache, shouldSaveTerminalCache, TerminalCacheMetaVersion } from "../term-cache";

describe("term cache helpers", () => {
    it("does not persist alternate-buffer snapshots", () => {
        expect(shouldSaveTerminalCache("alternate")).toBe(false);
        expect(shouldSaveTerminalCache("normal")).toBe(true);
    });

    it("marks normal-buffer caches as safe to restore", () => {
        expect(createTerminalCacheMeta("normal")).toEqual({
            cacheversion: TerminalCacheMetaVersion,
            buffertype: "normal",
        });
        expect(shouldRestoreTerminalCache(createTerminalCacheMeta("normal"))).toBe(true);
    });

    it("rejects alternate-buffer or legacy caches during restore", () => {
        expect(shouldRestoreTerminalCache(createTerminalCacheMeta("alternate"))).toBe(false);
        expect(shouldRestoreTerminalCache({ buffertype: "normal" })).toBe(false);
        expect(shouldRestoreTerminalCache(undefined)).toBe(false);
    });
});

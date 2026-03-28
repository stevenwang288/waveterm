// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
    buildEmbeddedBrowserBlockMeta,
    buildEmbeddedBrowserPartition,
    findCurrentTabEmbeddedBrowserBlockId,
    resolveEmbeddedBrowserRuntimeMeta,
    resolveEmbeddedBrowserSessionMeta,
} from "../../app/workspace/browser-block";

describe("embedded-browser-block", () => {
    it("builds stable session/profile/partition metadata from the same workspace source", () => {
        const sourceMeta = {
            connection: "local",
            "term:displaycwd": "E:\\code\\cx-workbench",
        } as MetaType;
        const first = resolveEmbeddedBrowserSessionMeta({ sourceMeta, tabId: "tab-1" });
        const second = resolveEmbeddedBrowserSessionMeta({ sourceMeta, tabId: "tab-2" });
        expect(first.sessionId).toBe(second.sessionId);
        expect(first.profileId).toBe(second.profileId);
        expect(first.partition).toBe(second.partition);
        expect(first.partition.startsWith("persist:waveterm-browser:")).toBe(true);
    });

    it("falls back to the tab id when no workspace source is available", () => {
        const meta = buildEmbeddedBrowserBlockMeta(null, { tabId: "tab-42" });
        expect(String(meta["browser:sessionid"] ?? "")).toContain("embedded-browser:");
        expect(String(meta["browser:profileid"] ?? "")).toContain("profile-eb-");
        expect(String(meta["embedded:partition"] ?? "")).toContain("persist:waveterm-browser:");
        expect(meta["embedded:partition"]).toBe(meta["web:partition"]);
    });

    it("rebuilds a stable partition from profile metadata when partition is missing", () => {
        const runtimeMeta = resolveEmbeddedBrowserRuntimeMeta("block-1", {
            "browser:sessionid": "embedded-browser:eb-123",
            "browser:profileid": "profile-eb-123",
        } as MetaType);
        expect(runtimeMeta.sessionId).toBe("embedded-browser:eb-123");
        expect(runtimeMeta.profileId).toBe("profile-eb-123");
        expect(runtimeMeta.partition).toBe(buildEmbeddedBrowserPartition("profile-eb-123"));
    });

    it("assigns a legacy runtime contract for blocks missing explicit browser metadata", () => {
        const runtimeMeta = resolveEmbeddedBrowserRuntimeMeta("legacy-block", {
            view: "embedded-browser",
        } as MetaType);
        expect(runtimeMeta.sessionId).toContain("embedded-browser:");
        expect(runtimeMeta.profileId).toContain("profile-legacy-");
        expect(runtimeMeta.partition).toContain("persist:waveterm-browser:");
    });

    it("finds an existing embedded browser block in the current tab by session contract", () => {
        const sourceMeta = {
            connection: "local",
            "term:displaycwd": "E:\\code\\cx-workbench",
        } as MetaType;
        const sessionMeta = resolveEmbeddedBrowserSessionMeta({ sourceMeta, tabId: "tab-1" });
        const foundBlockId = findCurrentTabEmbeddedBrowserBlockId({
            tabBlockIds: ["block-a", "block-b"],
            sessionMeta,
            getBlockMeta: (blockId) => {
                if (blockId === "block-b") {
                    return {
                        view: "embedded-browser",
                        "browser:sessionid": sessionMeta.sessionId,
                        "browser:profileid": sessionMeta.profileId,
                        "embedded:partition": sessionMeta.partition,
                    } as MetaType;
                }
                return {
                    view: "term",
                } as MetaType;
            },
        });
        expect(foundBlockId).toBe("block-b");
    });
});

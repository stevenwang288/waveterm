// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { getEmbeddedBrowserUrlAction } from "../../../emain/embedded-browser-url";

describe("getEmbeddedBrowserUrlAction", () => {
    it("allows normal browser navigations", () => {
        expect(getEmbeddedBrowserUrlAction("https://example.com")).toBe("internal");
        expect(getEmbeddedBrowserUrlAction("file:///C:/temp/example.html")).toBe("internal");
        expect(getEmbeddedBrowserUrlAction("about:blank")).toBe("internal");
        expect(getEmbeddedBrowserUrlAction("blob:https://example.com/123")).toBe("internal");
    });

    it("allows explicit app handoff schemes only from a small allowlist", () => {
        expect(getEmbeddedBrowserUrlAction("mailto:test@example.com")).toBe("open-external-app");
        expect(getEmbeddedBrowserUrlAction("tel:+8613800000000")).toBe("open-external-app");
        expect(getEmbeddedBrowserUrlAction("sms:+8613800000000")).toBe("open-external-app");
    });

    it("blocks unknown custom protocols to avoid OS app-picker popups", () => {
        expect(getEmbeddedBrowserUrlAction("bytedance://open/something")).toBe("block");
        expect(getEmbeddedBrowserUrlAction("obsidian://open?vault=demo")).toBe("block");
        expect(getEmbeddedBrowserUrlAction("javascript:alert(1)")).toBe("block");
    });

    it("blocks invalid or empty urls", () => {
        expect(getEmbeddedBrowserUrlAction("")).toBe("block");
        expect(getEmbeddedBrowserUrlAction("not a url")).toBe("block");
        expect(getEmbeddedBrowserUrlAction(null)).toBe("block");
    });
});

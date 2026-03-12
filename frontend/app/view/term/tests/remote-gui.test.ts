import {
    clampRemoteGuiSplitPct,
    getNextRemoteGuiMode,
    getRemoteGuiModeTransitionStrategy,
    hasConfiguredRemoteGuiTarget,
    shouldAttemptPveDiscovery,
    shouldShowRemoteGuiButton,
} from "../remote-gui";
import { describe, expect, it } from "vitest";

describe("remote GUI helpers", () => {
    it("shows the GUI button for SSH connections and hides it for local targets", () => {
        expect(shouldShowRemoteGuiButton("Administrator@10.20.0.152")).toBe(true);
        expect(shouldShowRemoteGuiButton("ssh://root@10.20.0.152:22")).toBe(true);
        expect(shouldShowRemoteGuiButton("local")).toBe(false);
        expect(shouldShowRemoteGuiButton("wsl://Ubuntu")).toBe(false);
    });

    it("treats PVE metadata and explicit gui urls as actionable GUI targets", () => {
        expect(hasConfiguredRemoteGuiTarget({ "pve:vmid": 152 })).toBe(true);
        expect(hasConfiguredRemoteGuiTarget({ "conn:guiurl": "https://guac.example/vnc/152" })).toBe(true);
        expect(hasConfiguredRemoteGuiTarget({ "conn:guiurl": "https://192.168.1.250:8006/#v1:0:=qemu/152" })).toBe(
            false
        );
        expect(hasConfiguredRemoteGuiTarget({})).toBe(false);
    });

    it("attempts PVE discovery for private-network SSH hosts without an existing GUI target", () => {
        expect(shouldAttemptPveDiscovery("Administrator@10.20.0.152", {})).toBe(true);
        expect(shouldAttemptPveDiscovery("root@192.168.1.9", {})).toBe(true);
        expect(shouldAttemptPveDiscovery("root@example.com", {})).toBe(false);
        expect(shouldAttemptPveDiscovery("local", {})).toBe(false);
        expect(shouldAttemptPveDiscovery("Administrator@10.20.0.152", { "pve:vmid": 152 })).toBe(false);
    });

    it("cycles terminal, VNC full-screen, and split-screen in the requested order", () => {
        expect(getNextRemoteGuiMode("term")).toBe("web");
        expect(getNextRemoteGuiMode("web")).toBe("websplit");
        expect(getNextRemoteGuiMode("websplit")).toBe("term");
    });

    it("switches instantly once the paired GUI block already exists", () => {
        expect(
            getRemoteGuiModeTransitionStrategy({
                currentMode: "term",
                targetMode: "web",
                guiBlockId: "block-123",
            })
        ).toBe("switch-immediately");
        expect(
            getRemoteGuiModeTransitionStrategy({
                currentMode: "web",
                targetMode: "web",
                guiBlockId: "block-123",
            })
        ).toBe("noop");
        expect(
            getRemoteGuiModeTransitionStrategy({
                currentMode: "term",
                targetMode: "websplit",
                guiBlockId: "",
            })
        ).toBe("prepare-first");
    });

    it("clamps the split ratio into a draggable but safe range", () => {
        expect(clampRemoteGuiSplitPct(undefined)).toBe(0.5);
        expect(clampRemoteGuiSplitPct(0.05)).toBe(0.2);
        expect(clampRemoteGuiSplitPct(0.5)).toBe(0.5);
        expect(clampRemoteGuiSplitPct(0.95)).toBe(0.8);
    });
});

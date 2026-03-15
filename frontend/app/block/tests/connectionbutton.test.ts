import { describe, expect, it, vi } from "vitest";
import { getTerminalConnectionDisplayLabel, getTerminalConnectionLabelPresentation } from "../connectionbutton-label";
import { buildTerminalLabelContextMenu } from "../connectionbutton-menu";

describe("buildTerminalLabelContextMenu", () => {
    it("includes inherit-path action and creates a term block with cwd and connection", () => {
        const createTermBlock = vi.fn();
        const copyText = vi.fn();
        const menu = buildTerminalLabelContextMenu({
            connection: "ubuntu@F1-10.20.0.161",
            terminalCwd: "/home/ubuntu",
            terminalLabel: "/home/ubuntu",
            t: (key) => key,
            createTermBlock,
            copyText,
        });

        expect(menu).toHaveLength(3);
        expect(menu[0].label).toBe("term.newBlockInheritCwd");
        expect(menu[0].enabled).toBe(true);
        menu[0].click?.();
        expect(createTermBlock).toHaveBeenCalledWith({
            meta: {
                view: "term",
                controller: "shell",
                "cmd:cwd": "/home/ubuntu",
                connection: "ubuntu@F1-10.20.0.161",
            },
        });

        expect(menu[2].label).toBe("preview.copyFullPath");
        menu[2].click?.();
        expect(copyText).toHaveBeenCalledWith("/home/ubuntu");
    });

    it("disables inherit-path action when cwd is missing and falls back to the visible label for copy", () => {
        const createTermBlock = vi.fn();
        const copyText = vi.fn();
        const menu = buildTerminalLabelContextMenu({
            connection: "",
            terminalCwd: "",
            terminalLabel: "D:\\\\work",
            t: (key) => key,
            createTermBlock,
            copyText,
        });

        expect(menu[0].enabled).toBe(false);
        menu[2].click?.();
        expect(copyText).toHaveBeenCalledWith("D:\\\\work");
        expect(createTermBlock).not.toHaveBeenCalled();
    });
});

describe("connection button terminal label", () => {
    it("right-aligns local terminal paths and left-aligns remote terminal paths", () => {
        expect(getTerminalConnectionLabelPresentation(true)).toEqual({
            align: "right",
            className: "text-muted group-hover:text-secondary",
        });
        expect(getTerminalConnectionLabelPresentation(false)).toEqual({
            align: "left",
            className: "text-green-500 group-hover:text-green-400",
        });
    });

    it("shows only the cwd for remote terminals", () => {
        expect(
            getTerminalConnectionDisplayLabel({
                isLocal: false,
                connection: "ubuntu@F2-10.20.0.162",
                connectionDisplayName: "ubuntu@F2-10.20.0.162",
                terminalLabel: "/home/ubuntu/project",
            })
        ).toBe("/home/ubuntu/project");
    });

    it("falls back to the connection name when a remote terminal cwd is unavailable", () => {
        expect(
            getTerminalConnectionDisplayLabel({
                isLocal: false,
                connection: "ubuntu@F2-10.20.0.162",
                connectionDisplayName: "ubuntu@F2-10.20.0.162",
                terminalLabel: "",
            })
        ).toBe("ubuntu@F2-10.20.0.162");
    });

    it("does not fall back to a local connection name when the local cwd is unavailable", () => {
        expect(
            getTerminalConnectionDisplayLabel({
                isLocal: true,
                connection: "local",
                connectionDisplayName: "local",
                terminalLabel: "",
            })
        ).toBe("");
    });
});

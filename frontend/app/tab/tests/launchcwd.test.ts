import { describe, expect, it } from "vitest";

describe("launchcwd helpers", () => {
    it("returns the explicit display cwd when present", async () => {
        const { getTerminalDisplayCwd } = await import("@/util/launchcwd");

        expect(
            getTerminalDisplayCwd({
                connection: "local",
                "display:launchcwd": "D:/local/start",
            })
        ).toBe("D:/local/start");
    });

    it("returns the remote cwd when ssh metadata already has one", async () => {
        const { getTerminalDisplayCwd } = await import("@/util/launchcwd");

        expect(
            getTerminalDisplayCwd({
                connection: "ubuntu@example",
                "cmd:cwd": "/home/ubuntu/project/",
                "display:launchcwd": "D:/local/start",
            })
        ).toBe("/home/ubuntu/project");
    });

    it("does not fall back to the local launch cwd for ssh terminals", async () => {
        const { getTerminalDisplayCwd } = await import("@/util/launchcwd");

        expect(
            getTerminalDisplayCwd({
                connection: "ubuntu@example",
                "display:launchcwd": "D:/local/start",
            })
        ).toBe("");
    });

    it("returns empty when no cwd metadata is available", async () => {
        const { getTerminalDisplayCwd } = await import("@/util/launchcwd");

        expect(getTerminalDisplayCwd({ connection: "local" })).toBe("");
    });

    it("extracts a Windows project path from a model status footer line", async () => {
        const { extractTerminalDisplayCwdFromBufferLines } = await import("@/util/launchcwd");

        expect(
            extractTerminalDisplayCwdFromBufferLines([
                "Working (4m 57s • esc to interrupt)",
                "gpt-5.4 xhigh · 70% left · D:\\OneDrive\\steven\\code\\ai\\12CLI\\goose",
            ])
        ).toBe("D:\\OneDrive\\steven\\code\\ai\\12CLI\\goose");
    });

    it("extracts a remote path from a directory hint line", async () => {
        const { extractTerminalDisplayCwdFromBufferLines } = await import("@/util/launchcwd");

        expect(extractTerminalDisplayCwdFromBufferLines(["directory: /home/ubuntu/project/"])).toBe(
            "/home/ubuntu/project"
        );
    });

    it("returns empty inheritable cwd when cmd:cwd is blank", async () => {
        const { getTerminalInheritableCwd } = await import("@/util/launchcwd");

        expect(getTerminalInheritableCwd({ "cmd:cwd": "   " })).toBe("");
    });

    it("returns trimmed inheritable cwd when cmd:cwd exists", async () => {
        const { getTerminalInheritableCwd } = await import("@/util/launchcwd");

        expect(getTerminalInheritableCwd({ "cmd:cwd": "  /home/ubuntu/project/  " })).toBe("/home/ubuntu/project/");
    });

    it("falls back to persisted display cwd for local terminals when cmd:cwd is missing", async () => {
        const { getTerminalInheritableCwd } = await import("@/util/launchcwd");

        expect(
            getTerminalInheritableCwd({
                connection: "local",
                "display:launchcwd": "D:/OneDrive/steven/code/ai/12CLI/waveterm-main",
            })
        ).toBe("D:/OneDrive/steven/code/ai/12CLI/waveterm-main");
    });
});

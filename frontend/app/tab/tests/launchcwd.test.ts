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

    it("returns persisted term display cwd when present", async () => {
        const { getTerminalDisplayCwd } = await import("@/util/launchcwd");

        expect(
            getTerminalDisplayCwd({
                connection: "local",
                "term:displaycwd": "D:/runtime/project",
            })
        ).toBe("D:/runtime/project");
    });

    it("prefers term display cwd over stale cwd metadata", async () => {
        const { getTerminalDisplayCwd } = await import("@/util/launchcwd");

        expect(
            getTerminalDisplayCwd({
                connection: "ubuntu@example",
                "term:displaycwd": "/home/ubuntu/runtime",
                "cmd:cwd": "/home/ubuntu/start",
                "display:launchcwd": "D:/local/start",
            })
        ).toBe("/home/ubuntu/runtime");
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

    it("reconstructs a wrapped status footer path instead of persisting only the visible tail", async () => {
        const { extractTerminalDisplayCwdFromBufferLines } = await import("@/util/launchcwd");

        expect(
            extractTerminalDisplayCwdFromBufferLines([
                {
                    text: "gpt-5.4 xhigh · 70% left · D:\\OneDrive\\steven\\code\\ai\\12CLI\\",
                    wrapped: false,
                },
                {
                    text: "waveterm-main",
                    wrapped: true,
                },
            ])
        ).toBe("D:\\OneDrive\\steven\\code\\ai\\12CLI\\waveterm-main");
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

    it("ignores the ordered dictionary placeholder in cmd:cwd", async () => {
        const { getTerminalInheritableCwd, getTerminalDisplayCwd } = await import("@/util/launchcwd");

        expect(
            getTerminalInheritableCwd({
                connection: "local",
                "cmd:cwd": "System.Collections.Specialized.OrderedDictionary",
                "display:launchcwd": "E:/code/waveterm-main",
            })
        ).toBe("E:/code/waveterm-main");
        expect(
            getTerminalDisplayCwd({
                connection: "local",
                "cmd:cwd": "System.Collections.Specialized.OrderedDictionary",
                cwd: "E:/code/waveterm-main",
            })
        ).toBe("");
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

    it("prefers the live display cwd for action menus when available", async () => {
        const { resolveTerminalActionCwd } = await import("@/util/launchcwd");

        expect(
            resolveTerminalActionCwd(
                {
                    connection: "local",
                    "cmd:cwd": "C:/Users/baba1",
                    "display:launchcwd": "C:/Users/baba1",
                },
                "D:/OneDrive/steven/code/ai/12CLI/waveterm-main"
            )
        ).toBe("D:/OneDrive/steven/code/ai/12CLI/waveterm-main");
    });

    it("keeps the persisted absolute path when a live cwd is only a shortened tail", async () => {
        const { resolveTerminalActionCwd } = await import("@/util/launchcwd");

        expect(
            resolveTerminalActionCwd(
                {
                    connection: "local",
                    "display:launchcwd": "D:/OneDrive/steven/code/ai/12CLI/waveterm-main",
                },
                "waveterm-main"
            )
        ).toBe("D:/OneDrive/steven/code/ai/12CLI/waveterm-main");
    });
});

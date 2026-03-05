import { describe, expect, it } from "vitest";
import { inferNextCwdFromCommand, resolveVirtualCwdFromCdFlag } from "../cwd-utils";

describe("cwd-utils", () => {
    describe("resolveVirtualCwdFromCdFlag", () => {
        it("extracts --cd absolute paths (Windows)", () => {
            const result = resolveVirtualCwdFromCdFlag("codex exec --cd E:\\\\code\\\\cx", "C:/Users/baba1");
            expect(result).toBe("E:/code/cx");
        });

        it("extracts -C absolute paths (Windows)", () => {
            const result = resolveVirtualCwdFromCdFlag("opencode -C E:\\\\code\\\\cx", "C:/Users/baba1");
            expect(result).toBe("E:/code/cx");
        });

        it("uses the last occurrence when multiple flags are present", () => {
            const result = resolveVirtualCwdFromCdFlag("codex --cd C:/Users/baba1 --cd E:/code/cx", "C:/Users/baba1");
            expect(result).toBe("E:/code/cx");
        });

        it("resolves relative targets against current cwd", () => {
            const result = resolveVirtualCwdFromCdFlag("codex --cd repo", "E:/code");
            expect(result).toBe("E:/code/repo");
        });

        it("returns empty for relative targets when current cwd is unknown", () => {
            const result = resolveVirtualCwdFromCdFlag("codex --cd repo", "");
            expect(result).toBe("");
        });
    });

    describe("inferNextCwdFromCommand", () => {
        it("infers cd absolute targets", () => {
            const result = inferNextCwdFromCommand("cd E:\\\\code\\\\cx", "C:/Users/baba1");
            expect(result).toBe("E:/code/cx");
        });

        it("infers cd relative targets", () => {
            const result = inferNextCwdFromCommand("cd repo", "E:/code");
            expect(result).toBe("E:/code/repo");
        });

        it("infers Set-Location -Path ..", () => {
            const result = inferNextCwdFromCommand("Set-Location -Path ..", "E:/code/repo");
            expect(result).toBe("E:/code");
        });
    });
});


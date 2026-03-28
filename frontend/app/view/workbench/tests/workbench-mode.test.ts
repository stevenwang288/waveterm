import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateObjectMetaMock, blockAtom, liveDisplayCwdAtom } = vi.hoisted(() => ({
    updateObjectMetaMock: vi.fn(),
    blockAtom: { key: "block-atom" },
    liveDisplayCwdAtom: { key: "live-display-cwd-atom" },
}));

vi.mock("@/app/store/global", () => ({
    globalStore: {
        get: vi.fn((targetAtom) => {
            if (targetAtom === blockAtom) {
                return {
                    meta: {
                        view: "term",
                        connection: "local",
                        "cmd:cwd": "C:/Users/baba1",
                    },
                };
            }
            if (targetAtom === liveDisplayCwdAtom) {
                return "C:/Users/baba1";
            }
            return undefined;
        }),
    },
    useBlockAtom: vi.fn((_blockId: string, key: string, init: () => unknown) => {
        if (key === "term:displaycwd") {
            return liveDisplayCwdAtom;
        }
        return init();
    }),
    WOS: {
        getWaveObjectAtom: vi.fn(() => blockAtom),
        makeORef: vi.fn((otype: string, oid: string) => ({ otype, oid })),
    },
}));

vi.mock("@/app/store/services", () => ({
    ObjectService: {
        UpdateObjectMeta: updateObjectMetaMock,
    },
}));

describe("workbench mode", () => {
    beforeEach(() => {
        updateObjectMetaMock.mockReset();
    });

    it("persists the live terminal display cwd when enabling workbench mode", async () => {
        const { setWorkbenchMode } = await import("../workbench-mode");

        await setWorkbenchMode("block-1", true);

        expect(updateObjectMetaMock).toHaveBeenCalledWith(
            { otype: "block", oid: "block-1" },
            expect.objectContaining({
                view: "workbench",
                "workbench:returnview": "term",
                "term:displaycwd": "C:/Users/baba1",
            })
        );
    });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateObjectMetaMock, blockAtom, liveDisplayCwdAtom, stateRef } = vi.hoisted(() => ({
    updateObjectMetaMock: vi.fn(),
    blockAtom: { key: "block-atom" },
    liveDisplayCwdAtom: { key: "live-display-cwd-atom" },
    stateRef: {
        liveDisplayCwd: "C:/Users/baba1",
        meta: {
            view: "term",
            connection: "local",
            "cmd:cwd": "C:/Users/baba1",
        } as Record<string, unknown>,
    },
}));

vi.mock("@/app/store/global", () => ({
    globalStore: {
        get: vi.fn((targetAtom) => {
            if (targetAtom === blockAtom) {
                return { meta: stateRef.meta };
            }
            if (targetAtom === liveDisplayCwdAtom) {
                return stateRef.liveDisplayCwd;
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

describe("workbench mode shared header path snapshot", () => {
    beforeEach(() => {
        updateObjectMetaMock.mockReset();
        stateRef.liveDisplayCwd = "C:/Users/baba1";
        stateRef.meta = {
            view: "term",
            connection: "local",
            "cmd:cwd": "C:/Users/baba1",
        };
    });

    it("promotes the live terminal display cwd into the shared workbench path fields", async () => {
        stateRef.liveDisplayCwd = "E:/code/cx-workbench";
        const { setWorkbenchMode } = await import("../../view/workbench/workbench-mode");

        await setWorkbenchMode("block-1", true);

        expect(updateObjectMetaMock).toHaveBeenCalledWith(
            { otype: "block", oid: "block-1" },
            expect.objectContaining({
                view: "workbench",
                "workbench:returnview": "term",
                "cmd:cwd": "E:/code/cx-workbench",
                "display:launchcwd": "E:/code/cx-workbench",
                "term:displaycwd": "E:/code/cx-workbench",
                cwd: "E:/code/cx-workbench",
            })
        );
    });

    it("falls back to the persisted terminal path when the live cwd atom is blank", async () => {
        stateRef.liveDisplayCwd = "";
        stateRef.meta = {
            view: "term",
            connection: "local",
            "display:launchcwd": "E:/code/cx-workbench",
        };

        const { setWorkbenchMode } = await import("../../view/workbench/workbench-mode");

        await setWorkbenchMode("block-1", true);

        expect(updateObjectMetaMock).toHaveBeenCalledWith(
            { otype: "block", oid: "block-1" },
            expect.objectContaining({
                view: "workbench",
                "workbench:returnview": "term",
                "cmd:cwd": "E:/code/cx-workbench",
                "display:launchcwd": "E:/code/cx-workbench",
                "term:displaycwd": "E:/code/cx-workbench",
                cwd: "E:/code/cx-workbench",
            })
        );
    });
});

import { atom } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import {
    __clearBlockAtomCacheForTests,
    __setBlockAtomCacheValueForTests,
    globalStore,
    useBlockAtom,
} from "../global";

describe("useBlockAtom", () => {
    afterEach(() => {
        __clearBlockAtomCacheForTests();
    });

    it("self-heals an invalid cached block atom entry before writing through jotai", () => {
        __setBlockAtomCacheValueForTests("block-change-conn", "changeConn", false);

        const changeConnModalAtom = useBlockAtom<boolean>("block-change-conn", "changeConn", () => atom(false));

        expect(globalStore.get(changeConnModalAtom)).toBe(false);

        globalStore.set(changeConnModalAtom, true);

        expect(globalStore.get(changeConnModalAtom)).toBe(true);
        expect(useBlockAtom<boolean>("block-change-conn", "changeConn", () => atom(false))).toBe(changeConnModalAtom);
    });
});

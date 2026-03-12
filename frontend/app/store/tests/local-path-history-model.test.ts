import { describe, expect, it } from "vitest";
import {
    normalizeLocalPath,
    recordPathHistoryEntry,
    splitCurrentAndHistoryEntries,
    type CurrentLocalPathItem,
    type LocalPathHistoryEntry,
} from "../local-path-history-model";

describe("local path history helpers", () => {
    it("normalizes trailing separators but keeps drive roots intact", () => {
        expect(normalizeLocalPath("D:/work/project///")).toBe("D:/work/project");
        expect(normalizeLocalPath("D:\\")).toBe("D:\\");
    });

    it("deduplicates paths and bumps usage metadata when re-recorded", () => {
        const first = recordPathHistoryEntry([], "D:/work/project", 100);
        const second = recordPathHistoryEntry(first, "D:/work/project/", 250);

        expect(second).toEqual([
            {
                path: "D:/work/project",
                hitCount: 2,
                lastAccessed: 250,
            },
        ]);
    });

    it("sorts current paths first and removes them from the history section", () => {
        const currentItems: CurrentLocalPathItem[] = [
            { path: "D:/work/alpha", blockId: "b2", isActive: false, order: 1 },
            { path: "D:/work/beta", blockId: "b1", isActive: true, order: 0 },
            { path: "D:/work/alpha/", blockId: "b3", isActive: true, order: 2 },
        ];
        const historyItems: LocalPathHistoryEntry[] = [
            { path: "D:/work/alpha", hitCount: 8, lastAccessed: 500 },
            { path: "D:/work/gamma", hitCount: 2, lastAccessed: 700 },
            { path: "D:/work/delta", hitCount: 5, lastAccessed: 600 },
        ];

        const groups = splitCurrentAndHistoryEntries(currentItems, historyItems);

        expect(groups.currentItems).toEqual([
            { path: "D:/work/beta", blockId: "b1", isActive: true, order: 0 },
            { path: "D:/work/alpha", blockId: "b3", isActive: true, order: 2 },
        ]);
        expect(groups.historyItems).toEqual([
            { path: "D:/work/gamma", hitCount: 2, lastAccessed: 700 },
            { path: "D:/work/delta", hitCount: 5, lastAccessed: 600 },
        ]);
    });
});

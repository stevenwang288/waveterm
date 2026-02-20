import { globalStore } from "@/app/store/global";
import { beforeEach, describe, expect, it } from "vitest";
import * as jotai from "jotai";
import { TermWshClient } from "../term-wsh";

type FakeBufferLine = {
    translateToString: (trimRight?: boolean) => string;
};

function makeFakeBuffer(lines: string[]) {
    return {
        length: lines.length,
        getLine: (idx: number): FakeBufferLine | undefined => {
            if (idx < 0 || idx >= lines.length) {
                return undefined;
            }
            return {
                translateToString: () => lines[idx],
            };
        },
    };
}

describe("TermWshClient.handle_termgetscrollbacklines", () => {
    beforeEach(() => {
        // no-op reset hook for isolation if needed later
    });

    it("returns the just-finished command segment when shell is ready", async () => {
        const shellIntegrationStatusAtom = jotai.atom<"ready" | "running-command" | null>("ready");
        globalStore.set(shellIntegrationStatusAtom, "ready");

        const lines = ["old-1", "› q1", "• a1", "› ", "tail-after-prompt"];
        const termWrap = {
            terminal: {
                buffer: {
                    active: makeFakeBuffer(lines),
                },
            },
            promptMarkers: [{ line: 1 }, { line: 3 }],
            shellIntegrationStatusAtom,
            lastUpdated: 123,
        } as any;

        const model = {
            termRef: { current: termWrap },
        } as any;

        const client = new TermWshClient("block-test", model);
        const result = await client.handle_termgetscrollbacklines({} as any, {
            linestart: 0,
            lineend: 0,
            lastcommand: true,
        });

        expect(result.lines).toEqual(["› q1", "• a1", "› "]);
        expect(result.linestart).toBe(1);
    });

    it("returns output from the current prompt marker when shell is running", async () => {
        const shellIntegrationStatusAtom = jotai.atom<"ready" | "running-command" | null>("running-command");
        globalStore.set(shellIntegrationStatusAtom, "running-command");

        const lines = ["› q1", "• a1", "› q2", "• partial answer"];
        const termWrap = {
            terminal: {
                buffer: {
                    active: makeFakeBuffer(lines),
                },
            },
            promptMarkers: [{ line: 0 }, { line: 2 }],
            shellIntegrationStatusAtom,
            lastUpdated: 456,
        } as any;

        const model = {
            termRef: { current: termWrap },
        } as any;

        const client = new TermWshClient("block-test-running", model);
        const result = await client.handle_termgetscrollbacklines({} as any, {
            linestart: 0,
            lineend: 0,
            lastcommand: true,
        });

        expect(result.lines).toEqual(["› q2", "• partial answer"]);
        expect(result.linestart).toBe(2);
    });

    it("returns whole buffer when no prompt marker exists", async () => {
        const shellIntegrationStatusAtom = jotai.atom<"ready" | "running-command" | null>("ready");
        globalStore.set(shellIntegrationStatusAtom, "ready");

        const lines = ["line-a", "line-b"];
        const termWrap = {
            terminal: {
                buffer: {
                    active: makeFakeBuffer(lines),
                },
            },
            promptMarkers: [],
            shellIntegrationStatusAtom,
            lastUpdated: 321,
        } as any;

        const model = {
            termRef: { current: termWrap },
        } as any;

        const client = new TermWshClient("block-test-2", model);
        const result = await client.handle_termgetscrollbacklines({} as any, {
            linestart: 0,
            lineend: 0,
            lastcommand: true,
        });

        expect(result.lines).toEqual(lines);
        expect(result.linestart).toBe(0);
    });
});

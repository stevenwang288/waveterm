import { describe, expect, it, vi } from "vitest";

import {
    resolveWorkbenchCodexBootstrapMode,
    streamWorkbenchCodexTerminalGateway,
} from "../workbench-gateway";

describe("workbench codex bootstrap mode", () => {
    it("routes local term-backed workbench blocks to ready, resume, or launch once the shell is interactive", () => {
        expect(
            resolveWorkbenchCodexBootstrapMode({
                connection: "local",
                returnView: "term",
                shellState: "ready",
                hasActiveCodexUi: true,
                lastSessionId: "sess_123",
            })
        ).toBe("ready");
        expect(
            resolveWorkbenchCodexBootstrapMode({
                connection: "local",
                returnView: "term",
                shellState: "ready",
                hasActiveCodexUi: false,
                lastSessionId: "sess_123",
            })
        ).toBe("resume");
        expect(
            resolveWorkbenchCodexBootstrapMode({
                connection: "local",
                returnView: "term",
                shellState: "ready",
                hasActiveCodexUi: false,
                lastSessionId: "",
            })
        ).toBe("launch");
    });

    it("treats non-local or busy blocks as unavailable to the true codex chain", () => {
        expect(
            resolveWorkbenchCodexBootstrapMode({
                connection: "wsl://Ubuntu",
                returnView: "term",
                hasActiveCodexUi: false,
            })
        ).toBe("unavailable");
        expect(
            resolveWorkbenchCodexBootstrapMode({
                connection: "local",
                returnView: "preview",
                hasActiveCodexUi: false,
            })
        ).toBe("unavailable");
        expect(
            resolveWorkbenchCodexBootstrapMode({
                connection: "local",
                returnView: "term",
                shellState: "running-command",
                hasActiveCodexUi: true,
                lastSessionId: "sess_123",
            })
        ).toBe("busy");
        expect(
            resolveWorkbenchCodexBootstrapMode({
                connection: "local",
                returnView: "term",
                shellState: "running-command",
                hasActiveCodexUi: false,
                lastSessionId: "sess_123",
            })
        ).toBe("busy");
        expect(
            resolveWorkbenchCodexBootstrapMode({
                connection: "local",
                returnView: "term",
                shellState: null,
                hasActiveCodexUi: true,
                resumeLines: [
                    "• Starting MCP servers (2/7): context7, exa, filesystem, …",
                    "› 请只回复：验证  tab to queue message",
                ],
                lastSessionId: "sess_123",
            })
        ).toBe("busy");
    });
});

describe("workbench codex terminal gateway", () => {
    it("sends the prompt to the terminal and waits for the final codex reply", async () => {
        const sendTerminalInput = vi.fn().mockResolvedValue(undefined);
        const loadReplyPayload = vi
            .fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({
                id: "reply-1",
                text: "真实 Codex 回复",
                outputTs: 222,
            });

        const packets: Array<{ text?: string; error?: string }> = [];
        for await (const packet of streamWorkbenchCodexTerminalGateway(
            {
                blockId: "block-1",
                promptText: "继续推进当前 Phase 1",
                baselineOutputTs: 120,
                getOutputTs: () => 222,
                sendTerminalInput,
                timeoutMs: 5000,
                pollMs: 10,
            },
            {
                loadReplyPayload,
                wait: async () => undefined,
            }
        )) {
            packets.push(packet);
        }

        expect(sendTerminalInput).toHaveBeenCalledWith("继续推进当前 Phase 1\r");
        expect(loadReplyPayload).toHaveBeenCalledTimes(2);
        expect(packets).toEqual([{ text: "真实 Codex 回复" }]);
    });

    it("aborts by sending escape when the user cancels mid-wait", async () => {
        const abortTerminalInput = vi.fn().mockResolvedValue(undefined);
        const sendTerminalInput = vi.fn().mockResolvedValue(undefined);
        const loadReplyPayload = vi.fn().mockResolvedValue(null);
        let cancelled = false;

        const packets: Array<{ text?: string; error?: string }> = [];
        for await (const packet of streamWorkbenchCodexTerminalGateway(
            {
                blockId: "block-1",
                promptText: "停止当前操作",
                baselineOutputTs: 120,
                getOutputTs: () => 120,
                sendTerminalInput,
                isAbortRequested: () => cancelled,
                abortTerminalInput,
                timeoutMs: 5000,
                pollMs: 10,
            },
            {
                loadReplyPayload,
                wait: async () => {
                    cancelled = true;
                },
            }
        )) {
            packets.push(packet);
        }

        expect(sendTerminalInput).toHaveBeenCalledWith("停止当前操作\r");
        expect(abortTerminalInput).toHaveBeenCalledTimes(1);
        expect(packets).toEqual([]);
    });
});

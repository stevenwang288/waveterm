import {
    buildCodexResumeCommand,
    buildCodexResumeFollowupInput,
    canRunCodexResume,
    CodexResumeFollowupDelayMs,
    CodexResumePrompt,
    getEligibleCodexResumeBlockIds,
    hasCodexResumeUiCues,
    isCodexResumeReadyForFollowup,
    resolveCodexResumeTargetBlock,
    resolveWorkbenchEntryTarget,
    runCodexResumeSequence,
    shouldShowCodexResumeButton,
    waitForCodexResumeToBecomeInteractive,
} from "../codex-resume";
import { describe, expect, it, vi } from "vitest";

describe("codex resume helper", () => {
    it("builds the first-stage resume command without inlining the followup prompt", () => {
        expect(buildCodexResumeCommand()).toBe("codex resume --last");
    });

    it("trims the second-stage followup prompt and drops it when blank", () => {
        expect(buildCodexResumeFollowupInput()).toBe(CodexResumePrompt);
        expect(buildCodexResumeFollowupInput("  继续  ")).toBe(CodexResumePrompt);
        expect(buildCodexResumeFollowupInput("   ")).toBe("");
    });

    it("keeps a conservative 5 second delay before the followup input", () => {
        expect(CodexResumeFollowupDelayMs).toBe(5000);
    });

    it("shows the button only for local blocks that still have the terminal main chain", () => {
        expect(shouldShowCodexResumeButton("term", "local")).toBe(true);
        expect(shouldShowCodexResumeButton("workbench", "local", "term")).toBe(true);
        expect(shouldShowCodexResumeButton("workbench", "local")).toBe(false);
        expect(shouldShowCodexResumeButton("workbench", "local", "preview")).toBe(false);
        expect(shouldShowCodexResumeButton("term", "wsl://Ubuntu")).toBe(false);
        expect(shouldShowCodexResumeButton("preview", "local")).toBe(false);
    });

    it("disables the button while the shell reports a running foreground command", () => {
        expect(canRunCodexResume("ready")).toBe(true);
        expect(canRunCodexResume(null)).toBe(true);
        expect(canRunCodexResume("running-command")).toBe(false);
    });

    it("filters batch targets down to local idle blocks that still sit on the terminal main chain", () => {
        const blockMap = {
            "term-local-ready": { meta: { view: "term", connection: "local" } },
            "workbench-local-ready": { meta: { view: "workbench", connection: "local", "workbench:returnview": "term" } },
            "workbench-detached-ready": { meta: { view: "workbench", connection: "local" } },
            "term-blank-ready": { meta: { view: "term", connection: "" } },
            "term-remote-ready": { meta: { view: "term", connection: "ssh://prod" } },
            "preview-local-ready": { meta: { view: "preview", connection: "local" } },
            "term-local-running": { meta: { view: "term", connection: "local" } },
        };
        const shellStateMap = {
            "term-local-ready": "ready" as const,
            "workbench-local-ready": "ready" as const,
            "workbench-detached-ready": "ready" as const,
            "term-blank-ready": null,
            "term-remote-ready": "ready" as const,
            "preview-local-ready": "ready" as const,
            "term-local-running": "running-command" as const,
        };

        expect(
            getEligibleCodexResumeBlockIds(
                Object.keys(blockMap),
                (blockId) => blockMap[blockId],
                (blockId) => shellStateMap[blockId] ?? null
            )
        ).toEqual(["term-local-ready", "workbench-local-ready", "term-blank-ready"]);
    });

    it("prefers the currently focused eligible block instead of resuming every candidate in the tab", () => {
        const blockMap = {
            "term-local-ready": { meta: { view: "term", connection: "local" } },
            "workbench-local-ready": { meta: { view: "workbench", connection: "local", "workbench:returnview": "term" } },
            preview: { meta: { view: "preview", connection: "local" } },
        };
        const shellStateMap = {
            "term-local-ready": "ready" as const,
            "workbench-local-ready": "ready" as const,
            preview: "ready" as const,
        };

        expect(
            resolveCodexResumeTargetBlock(
                ["term-local-ready", "workbench-local-ready", "preview"],
                "workbench-local-ready",
                (blockId) => blockMap[blockId],
                (blockId) => shellStateMap[blockId] ?? null
            )
        ).toEqual({
            eligibleBlockIds: ["term-local-ready", "workbench-local-ready"],
            targetBlockId: "workbench-local-ready",
        });
    });

    it("falls back to the first eligible block when the focused block cannot resume codex", () => {
        const blockMap = {
            preview: { meta: { view: "preview", connection: "local" } },
            "term-local-ready": { meta: { view: "term", connection: "local" } },
            "term-local-running": { meta: { view: "term", connection: "local" } },
        };
        const shellStateMap = {
            preview: "ready" as const,
            "term-local-ready": "ready" as const,
            "term-local-running": "running-command" as const,
        };

        expect(
            resolveCodexResumeTargetBlock(
                ["preview", "term-local-ready", "term-local-running"],
                "preview",
                (blockId) => blockMap[blockId],
                (blockId) => shellStateMap[blockId] ?? null
            )
        ).toEqual({
            eligibleBlockIds: ["term-local-ready"],
            targetBlockId: "term-local-ready",
        });
    });

    it("prefers the current page's existing terminal/workbench main chain before creating a detached workbench", () => {
        const blockMap = {
            preview: { meta: { view: "preview", connection: "local" } },
            "workbench-detached": { meta: { view: "workbench", connection: "local" } },
            "workbench-main": { meta: { view: "workbench", connection: "local", "workbench:returnview": "term" } },
            term: { meta: { view: "term", connection: "local" } },
        };

        expect(
            resolveWorkbenchEntryTarget(["preview", "workbench-detached", "workbench-main"], "preview", (blockId) => blockMap[blockId])
        ).toEqual({ action: "focus", blockId: "workbench-main" });

        expect(
            resolveWorkbenchEntryTarget(["preview", "workbench-detached", "term"], "workbench-detached", (blockId) => blockMap[blockId])
        ).toEqual({ action: "toggle", blockId: "term" });

        expect(
            resolveWorkbenchEntryTarget(["preview", "workbench-detached"], "preview", (blockId) => blockMap[blockId])
        ).toEqual({ action: "focus", blockId: "workbench-detached" });

        expect(resolveWorkbenchEntryTarget(["preview"], "preview", (blockId) => blockMap[blockId])).toEqual({
            action: "create",
            blockId: null,
        });
    });

    it("detects codex ui cues from restored terminal lines", () => {
        expect(
            hasCodexResumeUiCues([
                "╭──────────────────────────────────────────╮",
                "│ >_ OpenAI Codex (v0.0.0)                 │",
                "│ 模型： gpt-5.3-codex xhigh   /model 切换 │",
                "╰──────────────────────────────────────────╯",
            ])
        ).toBe(true);
        expect(hasCodexResumeUiCues(["plain shell output", "npm ERR! missing script: 继续"])).toBe(false);
    });

    it("does not treat stale restored history as ready before fresh output arrives", () => {
        expect(
            isCodexResumeReadyForFollowup({
                shellState: null,
                outputTs: 2000,
                baselineOutputTs: 2000,
                lines: ["│ >_ OpenAI Codex (v0.0.0) │", "│ 模型： gpt-5.3-codex │"],
            })
        ).toBe(false);
    });

    it("treats fresh codex ui output as ready even when shell integration is unavailable", () => {
        expect(
            isCodexResumeReadyForFollowup({
                shellState: null,
                outputTs: 2500,
                baselineOutputTs: 2000,
                lines: ["│ >_ OpenAI Codex (v0.0.0) │", "• 已恢复上一轮会话"],
            })
        ).toBe(true);
    });

    it("does not treat running-command startup output as interactive while codex is still busy", () => {
        expect(
            isCodexResumeReadyForFollowup({
                shellState: "running-command",
                outputTs: 2500,
                baselineOutputTs: 2000,
                lines: [
                    "• Starting MCP servers (2/7): context7, exa, filesystem, …",
                    "› 请只回复：验证  tab to queue message",
                ],
            })
        ).toBe(false);
    });

    it("treats fresh running-command output as interactive once codex ui is no longer busy", () => {
        expect(
            isCodexResumeReadyForFollowup({
                shellState: "running-command",
                outputTs: 2600,
                baselineOutputTs: 2000,
                lines: ["│ >_ OpenAI Codex (v0.0.0) │", "• 已恢复上一轮会话"],
            })
        ).toBe(true);
    });

    it("runs the two-stage resume sequence with a delay before sending 继续", async () => {
        const sentInputs: string[] = [];
        const wait = vi.fn(async (_ms: number) => undefined);
        const waitUntilReadyForFollowup = vi.fn(async () => undefined);

        await runCodexResumeSequence((input) => {
            sentInputs.push(input);
            return Promise.resolve();
        }, { wait, waitUntilReadyForFollowup });

        expect(sentInputs).toEqual(["codex resume --last\r", "继续\r"]);
        expect(waitUntilReadyForFollowup).toHaveBeenCalledTimes(1);
        expect(wait).toHaveBeenCalledTimes(1);
        expect(wait).toHaveBeenCalledWith(5000);
    });

    it("skips the second-stage input when the followup prompt is blank", async () => {
        const sentInputs: string[] = [];
        const wait = vi.fn(async (_ms: number) => undefined);

        await runCodexResumeSequence((input) => {
            sentInputs.push(input);
            return Promise.resolve();
        }, { prompt: "   ", wait });

        expect(sentInputs).toEqual(["codex resume --last\r"]);
        expect(wait).not.toHaveBeenCalled();
    });

    it("waits until the resumed codex session becomes interactive before allowing the followup", async () => {
        const getSnapshot = vi
            .fn()
            .mockResolvedValueOnce({
                shellState: null,
                outputTs: 2000,
                baselineOutputTs: 2000,
                lines: ["│ >_ OpenAI Codex (v0.0.0) │"],
            })
            .mockResolvedValueOnce({
                shellState: null,
                outputTs: 2600,
                baselineOutputTs: 2000,
                lines: ["│ >_ OpenAI Codex (v0.0.0) │", "• 已恢复上一轮会话"],
            });
        const wait = vi.fn(async (_ms: number) => undefined);

        await waitForCodexResumeToBecomeInteractive({
            getSnapshot,
            wait,
            timeoutMs: 1000,
            pollMs: 10,
        });

        expect(getSnapshot).toHaveBeenCalledTimes(2);
        expect(wait).toHaveBeenCalledTimes(1);
    });
});

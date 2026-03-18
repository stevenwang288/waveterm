import {
    buildCodexResumeCommand,
    buildCodexResumeFollowupInput,
    canRunCodexResume,
    CodexResumeFollowupDelayMs,
    CodexResumePrompt,
    getEligibleCodexResumeBlockIds,
    runCodexResumeSequence,
    shouldShowCodexResumeButton,
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

    it("shows the button only for local terminal blocks", () => {
        expect(shouldShowCodexResumeButton(true, "local")).toBe(true);
        expect(shouldShowCodexResumeButton(true, "wsl://Ubuntu")).toBe(false);
        expect(shouldShowCodexResumeButton(false, "local")).toBe(false);
    });

    it("disables the button while the shell reports a running foreground command", () => {
        expect(canRunCodexResume("ready")).toBe(true);
        expect(canRunCodexResume(null)).toBe(true);
        expect(canRunCodexResume("running-command")).toBe(false);
    });

    it("filters batch targets down to local idle terminal blocks in the current page", () => {
        const blockMap = {
            "term-local-ready": { meta: { view: "term", connection: "local" } },
            "term-blank-ready": { meta: { view: "term", connection: "" } },
            "term-remote-ready": { meta: { view: "term", connection: "ssh://prod" } },
            "preview-local-ready": { meta: { view: "preview", connection: "local" } },
            "term-local-running": { meta: { view: "term", connection: "local" } },
        };
        const shellStateMap = {
            "term-local-ready": "ready" as const,
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
        ).toEqual(["term-local-ready", "term-blank-ready"]);
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
});

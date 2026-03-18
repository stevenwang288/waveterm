import * as util from "@/util/util";

export const CodexResumePrompt = "继续";
export const CodexResumeFollowupDelayMs = 5000;
export const CodexResumeInputEnter = "\r";
export type CodexResumeShellState = "ready" | "running-command" | null;

type CodexResumeCandidateBlock = {
    meta?: {
        view?: string;
        connection?: string;
    };
};

export function buildCodexResumeCommand(): string {
    return "codex resume --last";
}

export function buildCodexResumeFollowupInput(prompt = CodexResumePrompt): string {
    const trimmedPrompt = typeof prompt === "string" ? prompt.trim() : "";
    return util.isBlank(trimmedPrompt) ? "" : trimmedPrompt;
}

export function shouldShowCodexResumeButton(isTerminalBlock: boolean, connection?: string): boolean {
    if (!isTerminalBlock) {
        return false;
    }
    return util.isLocalConnName(connection);
}

export function canRunCodexResume(shellState: CodexResumeShellState): boolean {
    return shellState !== "running-command";
}

export function getEligibleCodexResumeBlockIds(
    blockIds: string[],
    getBlockData: (blockId: string) => CodexResumeCandidateBlock | null | undefined,
    getShellState: (blockId: string) => CodexResumeShellState
): string[] {
    return blockIds.filter((blockId) => {
        const blockData = getBlockData(blockId);
        return shouldShowCodexResumeButton(blockData?.meta?.view === "term", blockData?.meta?.connection) && canRunCodexResume(getShellState(blockId));
    });
}

function defaultWait(delayMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function runCodexResumeSequence(
    sendInput: (input: string) => Promise<void>,
    options?: {
        prompt?: string;
        delayMs?: number;
        wait?: (delayMs: number) => Promise<void>;
        waitUntilReadyForFollowup?: () => Promise<void> | void;
    }
): Promise<void> {
    await sendInput(`${buildCodexResumeCommand()}${CodexResumeInputEnter}`);
    const followupInput = buildCodexResumeFollowupInput(options?.prompt);
    if (util.isBlank(followupInput)) {
        return;
    }
    await options?.waitUntilReadyForFollowup?.();
    await (options?.wait ?? defaultWait)(options?.delayMs ?? CodexResumeFollowupDelayMs);
    await sendInput(`${followupInput}${CodexResumeInputEnter}`);
}

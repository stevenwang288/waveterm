import { loadLatestTerminalFormalReplyPayload } from "@/app/block/terminal-speech";
import { hasCodexResumeBusyUiCues, type CodexResumeShellState } from "@/app/block/codex-resume";
import { isBlank, isLocalConnName } from "@/util/util";

export type WorkbenchCodexBootstrapMode = "unavailable" | "busy" | "ready" | "resume" | "launch";

export function resolveWorkbenchCodexBootstrapMode(options: {
    connection?: string | null;
    returnView?: string | null;
    shellState?: CodexResumeShellState;
    hasActiveCodexUi?: boolean;
    resumeLines?: string[];
    lastSessionId?: string | null;
}): WorkbenchCodexBootstrapMode {
    const connection = String(options.connection ?? "").trim();
    const returnView = String(options.returnView ?? "").trim();
    if (!isLocalConnName(connection) || returnView !== "term") {
        return "unavailable";
    }
    if (options.shellState === "running-command") {
        return "busy";
    }
    if (options.hasActiveCodexUi && hasCodexResumeBusyUiCues(options.resumeLines ?? [])) {
        return "busy";
    }
    if (options.hasActiveCodexUi) {
        return "ready";
    }
    if (!isBlank(String(options.lastSessionId ?? ""))) {
        return "resume";
    }
    return "launch";
}

type WorkbenchCodexGatewayDeps = {
    loadReplyPayload?: typeof loadLatestTerminalFormalReplyPayload;
    wait?: (delayMs: number) => Promise<void>;
};

export type WorkbenchCodexGatewayRequest = {
    blockId: string;
    promptText: string;
    baselineOutputTs: number;
    getOutputTs: () => number;
    sendTerminalInput: (input: string) => Promise<void>;
    isAbortRequested?: () => boolean;
    abortTerminalInput?: () => Promise<void>;
    timeoutMs?: number;
    pollMs?: number;
};

function defaultWait(delayMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function* streamWorkbenchCodexTerminalGateway(
    request: WorkbenchCodexGatewayRequest,
    deps?: WorkbenchCodexGatewayDeps
): AsyncGenerator<{ text?: string; error?: string }> {
    const wait = deps?.wait ?? defaultWait;
    const loadReplyPayload = deps?.loadReplyPayload ?? loadLatestTerminalFormalReplyPayload;
    const timeoutMs = Math.max(5000, Math.floor(request.timeoutMs ?? 120000));
    const pollMs = Math.max(120, Math.floor(request.pollMs ?? 260));
    const promptText = String(request.promptText ?? "").trim();
    if (isBlank(promptText)) {
        return;
    }

    await request.sendTerminalInput(`${promptText}\r`);

    const timeoutAt = Date.now() + timeoutMs;
    while (Date.now() < timeoutAt) {
        if (request.isAbortRequested?.()) {
            if (request.abortTerminalInput) {
                await request.abortTerminalInput().catch(() => {});
            }
            return;
        }

        const outputTs = Number(request.getOutputTs?.() ?? 0);
        const payload = await loadReplyPayload({
            blockId: request.blockId,
            outputTs: Number.isFinite(outputTs) && outputTs > 0 ? Math.floor(outputTs) : Date.now(),
            minLastUpdatedTs: Number.isFinite(request.baselineOutputTs) ? request.baselineOutputTs : 0,
            requirePromptAfterCodexReply: true,
        });
        if (!isBlank(payload?.text ?? "")) {
            yield { text: String(payload?.text ?? "") };
            return;
        }

        await wait(pollMs);
    }

    throw new Error(`Codex CLI did not produce a final reply within ${Math.ceil(timeoutMs / 1000)} seconds.`);
}

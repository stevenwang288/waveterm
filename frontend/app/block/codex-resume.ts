import * as util from "@/util/util";

export const CodexResumePrompt = "继续";
export const CodexResumeFollowupDelayMs = 5000;
export const CodexResumeInputEnter = "\r";
export const CodexResumeStartupTimeoutMs = 15000;
export const CodexResumePollIntervalMs = 200;
export type CodexResumeShellState = "ready" | "running-command" | null;

const CodexResumeAssistantBulletPattern = /^\s*[•●]\s+\S/u;
const CodexResumeBrandPattern = /openai\s+codex/i;
const CodexResumeModelPattern = /^\s*(?:模型|model)\s*[:：]\s*.+$/i;
const CodexResumeShortcutPattern = /\bfor shortcuts\b/i;
const CodexResumeContextLeftPattern = /\bcontext left\b/i;
const CodexResumeWorkingPattern = /^\s*(?:[•●]\s*)?working\b/i;
const CodexResumeInterruptHintPattern = /\besc\b.*(?:interrupt|中断|打断)\b/i;
const CodexResumeMcpServerPattern = /\bmcp\s+servers?\b|mcp\s*服务器/i;
const CodexResumeMcpServerStartupPattern =
    /^(?:\s*[•●]\s*)?(?:starting|checking|restarting|stopping)\s+mcp\s+servers?\b|^(?:\s*[•●]\s*)?(?:正在)?(?:启动|检测|检查|重启|停止)\s*mcp\s*服务器/i;
const CodexResumeQueueMessagePattern = /\btab\s+to\s+queue\s+message\b/i;
const CodexResumeModelLoadingPattern = /^\s*(?:[│┃]\s*)?(?:模型|model)\s*[:：]\s*loading\b/i;

type CodexResumeCandidateBlock = {
    meta?: {
        view?: string;
        connection?: string;
        "workbench:returnview"?: string;
    };
};

export type CodexResumeReadinessSnapshot = {
    shellState: CodexResumeShellState;
    outputTs?: number;
    baselineOutputTs?: number;
    lines?: string[];
};

export function buildCodexResumeCommand(): string {
    return "codex resume --last";
}

export function buildCodexResumeFollowupInput(prompt = CodexResumePrompt): string {
    const trimmedPrompt = typeof prompt === "string" ? prompt.trim() : "";
    return util.isBlank(trimmedPrompt) ? "" : trimmedPrompt;
}

export function shouldShowCodexResumeButton(
    currentView: string | null | undefined,
    connection?: string,
    returnView?: string | null | undefined
): boolean {
    const normalizedView = String(currentView ?? "").trim();
    if (normalizedView === "workbench") {
        return String(returnView ?? "").trim() === "term" && util.isLocalConnName(connection);
    }
    if (normalizedView !== "term") {
        return false;
    }
    return util.isLocalConnName(connection);
}

export function canRunCodexResume(shellState: CodexResumeShellState): boolean {
    return shellState !== "running-command";
}

export function hasCodexResumeUiCues(lines: string[]): boolean {
    return lines.some((line) => {
        const trimmed = typeof line === "string" ? line.trim() : "";
        if (util.isBlank(trimmed)) {
            return false;
        }
        return (
            CodexResumeAssistantBulletPattern.test(trimmed) ||
            CodexResumeBrandPattern.test(trimmed) ||
            CodexResumeModelPattern.test(trimmed) ||
            CodexResumeShortcutPattern.test(trimmed) ||
            CodexResumeContextLeftPattern.test(trimmed) ||
            (CodexResumeWorkingPattern.test(trimmed) && CodexResumeInterruptHintPattern.test(trimmed)) ||
            CodexResumeMcpServerPattern.test(trimmed)
        );
    });
}

export function hasCodexResumeBusyUiCues(lines: string[]): boolean {
    return lines.some((line) => {
        const trimmed = typeof line === "string" ? line.trim() : "";
        if (util.isBlank(trimmed)) {
            return false;
        }
        return (
            CodexResumeQueueMessagePattern.test(trimmed) ||
            CodexResumeModelLoadingPattern.test(trimmed) ||
            CodexResumeMcpServerStartupPattern.test(trimmed) ||
            (CodexResumeWorkingPattern.test(trimmed) && CodexResumeInterruptHintPattern.test(trimmed))
        );
    });
}

export function isCodexResumeReadyForFollowup(snapshot: CodexResumeReadinessSnapshot): boolean {
    const outputTs = Number(snapshot.outputTs);
    const baselineOutputTs = Number(snapshot.baselineOutputTs);
    const hasFreshOutput =
        Number.isFinite(outputTs) &&
        outputTs > 0 &&
        (!Number.isFinite(baselineOutputTs) || baselineOutputTs <= 0 || outputTs > baselineOutputTs);
    if (!hasFreshOutput) {
        return false;
    }
    const lines = snapshot.lines ?? [];
    if (!hasCodexResumeUiCues(lines)) {
        return false;
    }
    if (hasCodexResumeBusyUiCues(lines)) {
        return false;
    }
    return true;
}

export function getEligibleCodexResumeBlockIds(
    blockIds: string[],
    getBlockData: (blockId: string) => CodexResumeCandidateBlock | null | undefined,
    getShellState: (blockId: string) => CodexResumeShellState
): string[] {
    return blockIds.filter((blockId) => {
        const blockData = getBlockData(blockId);
        return (
            shouldShowCodexResumeButton(
                blockData?.meta?.view,
                blockData?.meta?.connection,
                blockData?.meta?.["workbench:returnview"]
            ) && canRunCodexResume(getShellState(blockId))
        );
    });
}

export function resolveCodexResumeTargetBlock(
    blockIds: string[],
    currentBlockId: string | null | undefined,
    getBlockData: (blockId: string) => CodexResumeCandidateBlock | null | undefined,
    getShellState: (blockId: string) => CodexResumeShellState
): { eligibleBlockIds: string[]; targetBlockId: string | null } {
    const eligibleBlockIds = getEligibleCodexResumeBlockIds(blockIds, getBlockData, getShellState);
    const normalizedCurrentBlockId = typeof currentBlockId === "string" ? currentBlockId.trim() : "";
    if (!util.isBlank(normalizedCurrentBlockId) && eligibleBlockIds.includes(normalizedCurrentBlockId)) {
        return {
            eligibleBlockIds,
            targetBlockId: normalizedCurrentBlockId,
        };
    }
    return {
        eligibleBlockIds,
        targetBlockId: eligibleBlockIds[0] ?? null,
    };
}

export function resolveWorkbenchEntryTarget(
    blockIds: string[],
    currentBlockId: string | null | undefined,
    getBlockData: (blockId: string) => CodexResumeCandidateBlock | null | undefined
): { action: "focus" | "toggle" | "create"; blockId: string | null } {
    const normalizedCurrentBlockId = typeof currentBlockId === "string" ? currentBlockId : "";
    const mainChainBlockId =
        blockIds.find((blockId) => {
            const meta = getBlockData(blockId)?.meta;
            return shouldShowCodexResumeButton(meta?.view, meta?.connection, meta?.["workbench:returnview"]);
        }) ?? null;
    if (mainChainBlockId) {
        const mainChainView = String(getBlockData(mainChainBlockId)?.meta?.view ?? "").trim();
        if (mainChainView === "term" && normalizedCurrentBlockId !== mainChainBlockId) {
            return {
                action: "toggle",
                blockId: mainChainBlockId,
            };
        }
        return {
            action: "focus",
            blockId: mainChainBlockId,
        };
    }
    const detachedWorkbenchBlockId =
        blockIds.find((blockId) => String(getBlockData(blockId)?.meta?.view ?? "").trim() === "workbench") ?? null;
    if (detachedWorkbenchBlockId) {
        return {
            action: "focus",
            blockId: detachedWorkbenchBlockId,
        };
    }
    return {
        action: "create",
        blockId: null,
    };
}

function defaultWait(delayMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function waitForCodexResumeToBecomeInteractive(options: {
    getSnapshot: () => Promise<CodexResumeReadinessSnapshot> | CodexResumeReadinessSnapshot;
    wait?: (delayMs: number) => Promise<void>;
    timeoutMs?: number;
    pollMs?: number;
}): Promise<void> {
    const timeoutMs = Math.max(1000, Math.floor(options.timeoutMs ?? CodexResumeStartupTimeoutMs));
    const pollMs = Math.max(50, Math.floor(options.pollMs ?? CodexResumePollIntervalMs));
    const wait = options.wait ?? defaultWait;
    const timeoutAt = Date.now() + timeoutMs;
    while (Date.now() < timeoutAt) {
        const snapshot = await options.getSnapshot();
        if (isCodexResumeReadyForFollowup(snapshot)) {
            return;
        }
        await wait(pollMs);
    }
    throw new Error(`Codex resume did not become interactive within ${Math.ceil(timeoutMs / 1000)} seconds.`);
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

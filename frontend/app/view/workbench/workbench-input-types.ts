export type WorkbenchComposerEntryKind = "plain-text";
export type WorkbenchCommandId = "plan" | "todo" | "spec" | "agents" | "evidence";
export type WorkbenchAgentId = "planner" | "reviewer";

export type WorkbenchAgentMention = {
    agentId: WorkbenchAgentId;
    label: `@${WorkbenchAgentId}`;
};

export type WorkbenchComposerEntry = {
    kind: WorkbenchComposerEntryKind;
    rawText: string;
    normalizedText: string;
    agentMentions: WorkbenchAgentMention[];
};

const WORKBENCH_AGENT_IDS = new Set<WorkbenchAgentId>(["planner", "reviewer"]);

export function extractWorkbenchAgentMentions(text: string): WorkbenchAgentMention[] {
    const normalizedText = String(text ?? "");
    const matches = normalizedText.match(/(^|\s)@([a-z][a-z0-9_-]*)\b/gi) ?? [];
    const seen = new Set<WorkbenchAgentId>();
    const mentions: WorkbenchAgentMention[] = [];
    for (const match of matches) {
        const agentId = match.trim().slice(1).toLowerCase() as WorkbenchAgentId;
        if (!WORKBENCH_AGENT_IDS.has(agentId) || seen.has(agentId)) {
            continue;
        }
        seen.add(agentId);
        mentions.push({
            agentId,
            label: `@${agentId}` as const,
        });
    }
    return mentions;
}

export type WorkbenchLaunchTerminalIntent = {
    kind: "local-action";
    actionId: "launch-terminal";
    path: string;
    command: string;
    connection?: string;
};

export type WorkbenchPickDirectoryIntent = {
    kind: "local-action";
    actionId: "pick-directory";
    connection?: string;
};

export type WorkbenchRestoreHistoryIntent = {
    kind: "local-action";
    actionId: "restore-history";
};

export type WorkbenchCommandIntent = {
    kind: "local-action";
    actionId: "workbench-command";
    commandId: WorkbenchCommandId;
    argumentText: string;
    entry: WorkbenchComposerEntry;
};

export type WorkbenchLocalActionIntent =
    | WorkbenchLaunchTerminalIntent
    | WorkbenchPickDirectoryIntent
    | WorkbenchRestoreHistoryIntent
    | WorkbenchCommandIntent;

export type WorkbenchDispatchIntent =
    | {
          kind: "codex-turn";
          entry: WorkbenchComposerEntry;
      }
    | WorkbenchLocalActionIntent;

export function createWorkbenchComposerEntry(rawText: string): WorkbenchComposerEntry | null {
    const normalizedText = rawText.trim();
    if (normalizedText === "") {
        return null;
    }
    return {
        kind: "plain-text",
        rawText,
        normalizedText,
        agentMentions: extractWorkbenchAgentMentions(normalizedText),
    };
}

export function createWorkbenchLaunchTerminalIntent(params: {
    path: string;
    command: string;
    connection?: string;
}): WorkbenchLaunchTerminalIntent {
    return {
        kind: "local-action",
        actionId: "launch-terminal",
        path: params.path,
        command: params.command,
        connection: params.connection,
    };
}

export function createWorkbenchPickDirectoryIntent(params: { connection?: string }): WorkbenchPickDirectoryIntent {
    return {
        kind: "local-action",
        actionId: "pick-directory",
        connection: params.connection,
    };
}

export function createWorkbenchRestoreHistoryIntent(): WorkbenchRestoreHistoryIntent {
    return {
        kind: "local-action",
        actionId: "restore-history",
    };
}

export function createWorkbenchCommandIntent(params: {
    commandId: WorkbenchCommandId;
    argumentText?: string;
    entry: WorkbenchComposerEntry;
}): WorkbenchCommandIntent {
    return {
        kind: "local-action",
        actionId: "workbench-command",
        commandId: params.commandId,
        argumentText: String(params.argumentText ?? "").trim(),
        entry: params.entry,
    };
}

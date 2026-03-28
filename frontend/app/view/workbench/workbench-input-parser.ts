import { createWorkbenchCommandIntent, type WorkbenchCommandId, type WorkbenchComposerEntry } from "./workbench-input-types";

const WORKBENCH_COMMAND_IDS = new Set<WorkbenchCommandId>(["plan", "todo", "spec", "agents", "evidence"]);

export type WorkbenchParsedCommand = {
    commandId: WorkbenchCommandId;
    argumentText: string;
};

export function parseWorkbenchCommandText(text: string): WorkbenchParsedCommand | null {
    const normalizedText = String(text ?? "").trim();
    const match = normalizedText.match(/^\/([a-z]+)(?:\s+(.*))?$/i);
    if (match == null) {
        return null;
    }
    const commandId = match[1].toLowerCase() as WorkbenchCommandId;
    if (!WORKBENCH_COMMAND_IDS.has(commandId)) {
        return null;
    }
    return {
        commandId,
        argumentText: String(match[2] ?? "").trim(),
    };
}

export function resolveWorkbenchDispatchIntent(entry: WorkbenchComposerEntry) {
    const parsedCommand = parseWorkbenchCommandText(entry.normalizedText);
    if (parsedCommand == null) {
        return {
            kind: "codex-turn" as const,
            entry,
        };
    }
    return createWorkbenchCommandIntent({
        commandId: parsedCommand.commandId,
        argumentText: parsedCommand.argumentText,
        entry,
    });
}

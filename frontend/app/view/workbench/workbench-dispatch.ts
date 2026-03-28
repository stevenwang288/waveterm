import type { WorkbenchDispatchIntent } from "./workbench-input-types";

export type WorkbenchDispatchHandlers<T> = {
    onCodexTurn: (intent: Extract<WorkbenchDispatchIntent, { kind: "codex-turn" }>) => Promise<T> | T;
    onLocalAction: (intent: Extract<WorkbenchDispatchIntent, { kind: "local-action" }>) => Promise<T> | T;
};

export async function dispatchWorkbenchIntent<T>(
    intent: WorkbenchDispatchIntent,
    handlers: WorkbenchDispatchHandlers<T>
): Promise<T> {
    if (intent.kind === "local-action") {
        return handlers.onLocalAction(intent);
    }
    return handlers.onCodexTurn(intent);
}

import { isBlank } from "@/util/util";

export type WorkbenchQuickInsertTemplate = {
    id: "plan" | "spec";
    label: string;
    text: string;
};

export type WorkbenchQuickInsertAgent = {
    id: "planner" | "reviewer";
    label: string;
    mention: string;
};

type WorkbenchReplayMessage = {
    role?: string;
    content?: string;
    isUpdating?: boolean;
};

export const WORKBENCH_QUICK_INSERT_TEMPLATES: WorkbenchQuickInsertTemplate[] = [
    {
        id: "plan",
        label: "计划模板",
        text: ["请先给出本轮任务的最小执行计划：", "1. 目标", "2. 风险", "3. 实现步骤", "4. 验证方式"].join("\n"),
    },
    {
        id: "spec",
        label: "规格模板",
        text: ["请先把这件事收口成最小规格：", "1. 输入", "2. 预期行为", "3. 边界条件", "4. 验收标准"].join("\n"),
    },
];

export const WORKBENCH_QUICK_INSERT_AGENTS: WorkbenchQuickInsertAgent[] = [
    { id: "planner", label: "@planner", mention: "@planner " },
    { id: "reviewer", label: "@reviewer", mention: "@reviewer " },
];

export function appendWorkbenchComposerText(currentText: string, insertText: string): string {
    const nextChunk = String(insertText ?? "").trim();
    if (isBlank(nextChunk)) {
        return String(currentText ?? "");
    }
    const current = String(currentText ?? "").trimEnd();
    if (isBlank(current)) {
        return nextChunk;
    }
    const separator = current.endsWith("\n") ? "\n" : "\n\n";
    return `${current}${separator}${nextChunk}`;
}

export function findLatestWorkbenchReplayText(
    messages: WorkbenchReplayMessage[],
    role: "user" | "assistant"
): string {
    for (let idx = messages.length - 1; idx >= 0; idx--) {
        const message = messages[idx];
        if (message?.role !== role || message?.isUpdating) {
            continue;
        }
        const content = String(message?.content ?? "").trim();
        if (!isBlank(content)) {
            return content;
        }
    }
    return "";
}

export function buildWorkbenchDiagnosticsInsertText(items: Array<[string, string]>): string {
    const lines = items
        .map(([label, value]) => {
            const normalizedLabel = String(label ?? "").trim();
            const normalizedValue = String(value ?? "").trim();
            if (isBlank(normalizedLabel) || isBlank(normalizedValue)) {
                return "";
            }
            return `- ${normalizedLabel}：${normalizedValue}`;
        })
        .filter((line) => !isBlank(line));
    if (lines.length === 0) {
        return "";
    }
    return ["诊断摘要", ...lines].join("\n");
}

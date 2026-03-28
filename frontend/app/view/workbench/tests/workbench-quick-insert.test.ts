import { describe, expect, it } from "vitest";

import {
    appendWorkbenchComposerText,
    buildWorkbenchDiagnosticsInsertText,
    findLatestWorkbenchReplayText,
    WORKBENCH_QUICK_INSERT_AGENTS,
    WORKBENCH_QUICK_INSERT_TEMPLATES,
} from "../workbench-quick-insert";

describe("workbench quick insert helpers", () => {
    it("appends inserts into the shared composer without creating a parallel send path", () => {
        expect(appendWorkbenchComposerText("", "诊断摘要")).toBe("诊断摘要");
        expect(appendWorkbenchComposerText("已有问题", "诊断摘要")).toBe("已有问题\n\n诊断摘要");
        expect(appendWorkbenchComposerText("已有问题\n", "诊断摘要")).toBe("已有问题\n\n诊断摘要");
        expect(appendWorkbenchComposerText("已有问题", "   ")).toBe("已有问题");
    });

    it("finds the latest completed replay text for the requested role", () => {
        expect(
            findLatestWorkbenchReplayText(
                [
                    { role: "user", content: "最早问题" },
                    { role: "assistant", content: "处理中", isUpdating: true },
                    { role: "user", content: "   " },
                    { role: "user", content: "最近问题" },
                ],
                "user"
            )
        ).toBe("最近问题");

        expect(
            findLatestWorkbenchReplayText(
                [
                    { role: "assistant", content: "旧回复" },
                    { role: "assistant", content: "最新回复", isUpdating: true },
                ],
                "assistant"
            )
        ).toBe("旧回复");
    });

    it("builds diagnostics insert text from the visible status pairs", () => {
        expect(
            buildWorkbenchDiagnosticsInsertText([
                ["连接", "本机就绪"],
                ["", "忽略"],
                ["最近正式回复", "Codex 已恢复"],
            ])
        ).toBe(["诊断摘要", "- 连接：本机就绪", "- 最近正式回复：Codex 已恢复"].join("\n"));
        expect(buildWorkbenchDiagnosticsInsertText([["", ""], ["连接", "   "]])).toBe("");
    });

    it("keeps template and agent quick inserts as explicit refill snippets", () => {
        expect(WORKBENCH_QUICK_INSERT_TEMPLATES).toEqual([
            expect.objectContaining({ id: "plan", label: "计划模板" }),
            expect.objectContaining({ id: "spec", label: "规格模板" }),
        ]);
        expect(WORKBENCH_QUICK_INSERT_AGENTS).toEqual([
            { id: "planner", label: "@planner", mention: "@planner " },
            { id: "reviewer", label: "@reviewer", mention: "@reviewer " },
        ]);
    });
});

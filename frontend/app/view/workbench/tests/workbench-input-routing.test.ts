import { describe, expect, it } from "vitest";

import { createWorkbenchComposerEntry, extractWorkbenchAgentMentions } from "../workbench-input-types";
import { parseWorkbenchCommandText, resolveWorkbenchDispatchIntent } from "../workbench-input-parser";
import { routeWorkbenchCommand } from "../workbench-router";

describe("workbench input parser", () => {
    it("parses the supported slash commands into local actions", () => {
        const planEntry = createWorkbenchComposerEntry("/plan tighten batch 2");
        const todoEntry = createWorkbenchComposerEntry("/todo");
        const evidenceEntry = createWorkbenchComposerEntry("/evidence latest diagnostics");

        expect(planEntry).not.toBeNull();
        expect(todoEntry).not.toBeNull();
        expect(evidenceEntry).not.toBeNull();

        expect(resolveWorkbenchDispatchIntent(planEntry!)).toMatchObject({
            kind: "local-action",
            actionId: "workbench-command",
            commandId: "plan",
            argumentText: "tighten batch 2",
        });
        expect(resolveWorkbenchDispatchIntent(todoEntry!)).toMatchObject({
            kind: "local-action",
            actionId: "workbench-command",
            commandId: "todo",
            argumentText: "",
        });
        expect(resolveWorkbenchDispatchIntent(evidenceEntry!)).toMatchObject({
            kind: "local-action",
            actionId: "workbench-command",
            commandId: "evidence",
            argumentText: "latest diagnostics",
        });
    });

    it("keeps plain text, windows paths, and non-agent @ text on the codex-turn path", () => {
        const plainEntry = createWorkbenchComposerEntry("整理一下当前 workbench 的主发送链");
        const windowsPathEntry = createWorkbenchComposerEntry("E:\\code\\foo\\bar.ts");
        const emailEntry = createWorkbenchComposerEntry("联系邮箱 foo@bar.com 不应该被当成 agent");
        const unsupportedSlashEntry = createWorkbenchComposerEntry("/resume");
        const mentionEntry = createWorkbenchComposerEntry("@planner 先收口本轮计划，再继续实现");

        expect(resolveWorkbenchDispatchIntent(plainEntry!)).toMatchObject({
            kind: "codex-turn",
            entry: {
                normalizedText: "整理一下当前 workbench 的主发送链",
            },
        });
        expect(resolveWorkbenchDispatchIntent(windowsPathEntry!)).toMatchObject({
            kind: "codex-turn",
            entry: {
                normalizedText: "E:\\code\\foo\\bar.ts",
            },
        });
        expect(resolveWorkbenchDispatchIntent(emailEntry!)).toMatchObject({
            kind: "codex-turn",
            entry: {
                normalizedText: "联系邮箱 foo@bar.com 不应该被当成 agent",
                agentMentions: [],
            },
        });
        expect(resolveWorkbenchDispatchIntent(unsupportedSlashEntry!)).toMatchObject({
            kind: "codex-turn",
            entry: {
                normalizedText: "/resume",
                agentMentions: [],
            },
        });
        expect(resolveWorkbenchDispatchIntent(mentionEntry!)).toMatchObject({
            kind: "codex-turn",
            entry: {
                normalizedText: "@planner 先收口本轮计划，再继续实现",
                agentMentions: [{ agentId: "planner", label: "@planner" }],
            },
        });
    });

    it("parses only the supported slash commands", () => {
        expect(parseWorkbenchCommandText("/plan review current batch")).toEqual({
            commandId: "plan",
            argumentText: "review current batch",
        });
        expect(parseWorkbenchCommandText("/agents")).toEqual({
            commandId: "agents",
            argumentText: "",
        });
        expect(parseWorkbenchCommandText("/resume")).toBeNull();
        expect(parseWorkbenchCommandText("E:\\code\\foo\\bar.ts")).toBeNull();
    });

    it("extracts supported @agent mentions without误伤邮箱或普通文本", () => {
        expect(extractWorkbenchAgentMentions("@planner 先整理计划")).toEqual([
            { agentId: "planner", label: "@planner" },
        ]);
        expect(extractWorkbenchAgentMentions("先 @reviewer 过一遍，再 @planner 收口")).toEqual([
            { agentId: "reviewer", label: "@reviewer" },
            { agentId: "planner", label: "@planner" },
        ]);
        expect(extractWorkbenchAgentMentions("联系 foo@bar.com")).toEqual([]);
        expect(extractWorkbenchAgentMentions("@unknown 不该被识别")).toEqual([]);
    });
});

describe("workbench command router", () => {
    it("routes commands to real local workbench surfaces", () => {
        expect(routeWorkbenchCommand("plan")).toMatchObject({
            drawerSection: "task",
            title: "已切到计划视图",
        });
        expect(routeWorkbenchCommand("todo")).toMatchObject({
            drawerSection: "task",
            title: "已切到待办视图",
        });
        expect(routeWorkbenchCommand("spec")).toMatchObject({
            drawerSection: "status",
            title: "已切到规格状态视图",
        });
        expect(routeWorkbenchCommand("agents")).toMatchObject({
            drawerSection: "status",
            title: "已切到代理状态视图",
        });
        expect(routeWorkbenchCommand("evidence")).toMatchObject({
            drawerSection: "lsp",
            title: "已切到证据视图",
        });
    });
});

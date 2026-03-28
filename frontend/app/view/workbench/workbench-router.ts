import type { WorkbenchCommandId } from "./workbench-input-types";

export type WorkbenchCommandRoute = {
    commandId: WorkbenchCommandId;
    drawerSection: "task" | "lsp" | "status";
    title: string;
    message: string;
};

export function routeWorkbenchCommand(commandId: WorkbenchCommandId): WorkbenchCommandRoute {
    switch (commandId) {
        case "plan":
            return {
                commandId,
                drawerSection: "task",
                title: "已切到计划视图",
                message: "右栏已切到任务面板，当前可继续围绕计划和行动项组织输入。",
            };
        case "todo":
            return {
                commandId,
                drawerSection: "task",
                title: "已切到待办视图",
                message: "右栏已切到任务面板，可直接查看当前待办和最近结论。",
            };
        case "spec":
            return {
                commandId,
                drawerSection: "status",
                title: "已切到规格状态视图",
                message: "当前批次先复用状态面板承接 spec 命令，不额外再造第二套规格界面。",
            };
        case "agents":
            return {
                commandId,
                drawerSection: "status",
                title: "已切到代理状态视图",
                message: "当前批次先复用状态面板承接 agents 命令，后续再接更细的代理对象视图。",
            };
        case "evidence":
            return {
                commandId,
                drawerSection: "lsp",
                title: "已切到证据视图",
                message: "右栏已切到 LSP 与诊断面板，当前证据入口先落在这里，不把命令发给模型。",
            };
    }
}

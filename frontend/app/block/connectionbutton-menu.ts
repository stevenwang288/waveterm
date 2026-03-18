import * as util from "@/util/util";
import { isMacOS, isWindows } from "@/util/platformutil";

type TerminalLabelMenuOptions = {
    connection?: string;
    terminalCwd?: string;
    terminalLabel?: string;
    t: (key: string, options?: Record<string, string>) => string;
    createTermBlock: (blockDef: BlockDef) => void;
    copyText: (text: string) => Promise<void> | void;
    openNativePath: (path: string) => void;
};

function getRevealInManagerLabel(t: TerminalLabelMenuOptions["t"]): string {
    let managerName: string;
    if (isMacOS()) {
        managerName = t("native.manager.finder");
    } else if (isWindows()) {
        managerName = t("native.manager.explorer");
    } else {
        managerName = t("native.manager.fileManager");
    }
    return t("native.revealInManager", { manager: managerName });
}

export function buildTerminalLabelContextMenu({
    connection,
    terminalCwd,
    terminalLabel,
    t,
    createTermBlock,
    copyText,
    openNativePath,
}: TerminalLabelMenuOptions): ContextMenuItem[] {
    const terminalCwdTrimmed = typeof terminalCwd === "string" ? terminalCwd.trim() : "";
    const terminalLabelTrimmed = typeof terminalLabel === "string" ? terminalLabel.trim() : "";
    const canOpenNativePath = util.isLocalConnName(connection) && !util.isBlank(terminalCwdTrimmed);
    return [
        {
            label: t("term.newBlockInheritCwd"),
            enabled: !util.isBlank(terminalCwdTrimmed),
            click: () => {
                const meta: Record<string, any> = {
                    view: "term",
                    controller: "shell",
                    "cmd:cwd": terminalCwdTrimmed,
                };
                if (!util.isBlank(connection)) {
                    meta.connection = connection;
                }
                createTermBlock({ meta });
            },
        },
        { type: "separator" },
        {
            label: getRevealInManagerLabel(t),
            enabled: canOpenNativePath,
            click: () => {
                if (!canOpenNativePath) {
                    return;
                }
                openNativePath(terminalCwdTrimmed);
            },
        },
        { type: "separator" },
        {
            label: t("preview.copyFullPath"),
            click: () => copyText(util.isBlank(terminalCwdTrimmed) ? terminalLabelTrimmed : terminalCwdTrimmed),
        },
    ];
}

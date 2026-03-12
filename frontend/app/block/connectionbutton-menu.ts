import * as util from "@/util/util";

type TerminalLabelMenuOptions = {
    connection?: string;
    terminalCwd?: string;
    terminalLabel?: string;
    t: (key: string) => string;
    createTermBlock: (blockDef: BlockDef) => void;
    copyText: (text: string) => Promise<void> | void;
};

export function buildTerminalLabelContextMenu({
    connection,
    terminalCwd,
    terminalLabel,
    t,
    createTermBlock,
    copyText,
}: TerminalLabelMenuOptions): ContextMenuItem[] {
    const terminalCwdTrimmed = typeof terminalCwd === "string" ? terminalCwd.trim() : "";
    const terminalLabelTrimmed = typeof terminalLabel === "string" ? terminalLabel.trim() : "";
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
            label: t("preview.copyFullPath"),
            click: () => copyText(util.isBlank(terminalCwdTrimmed) ? terminalLabelTrimmed : terminalCwdTrimmed),
        },
    ];
}

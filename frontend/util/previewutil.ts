import { createBlock, getApi } from "@/app/store/global";
import i18next from "@/app/i18n";
import { makeNativeLabel } from "./platformutil";
import { fireAndForget } from "./util";
import { formatRemoteUri } from "./waveutil";

function openCliInNewTerminal(cwd: string, conn: string, cliCommand: string) {
    const meta: Record<string, any> = {
        controller: "shell",
        view: "term",
        "cmd:cwd": cwd,
        "cmd:initscript": `${cliCommand}\n`,
    };
    if (conn) {
        meta.connection = conn;
    }
    const termBlockDef: BlockDef = { meta };
    fireAndForget(() => createBlock(termBlockDef));
}

const AI_LAUNCH_COMMANDS: Array<{ label: string; command: string }> = [
    { label: "Codex", command: "codex" },
    { label: "Claude", command: "claude" },
    { label: "Gemini", command: "gemini" },
    { label: "Amp", command: "amp" },
    { label: "IFlow", command: "iflow" },
    { label: "OpenCode", command: "opencode" },
];

function makeAiLaunchMenuItems(targetCwd: string, conn: string): ContextMenuItem[] {
    return AI_LAUNCH_COMMANDS.map((item) => ({
        label: i18next.t("preview.openAiHere", { ai: item.label }),
        click: () => openCliInNewTerminal(targetCwd, conn, item.command),
    }));
}

export function addOpenMenuItems(menu: ContextMenuItem[], conn: string, finfo: FileInfo): ContextMenuItem[] {
    if (!finfo) {
        return menu;
    }
    menu.push({
        type: "separator",
    });
    if (!conn) {
        // TODO:  resolve correct host path if connection is WSL
        // if the entry is a directory, reveal it in the file manager, if the entry is a file, reveal its parent directory
        menu.push({
            label: makeNativeLabel(true),
            click: () => {
                getApi().openNativePath(finfo.isdir ? finfo.path : finfo.dir);
            },
        });
        // if the entry is a file, open it in the default application
        if (!finfo.isdir) {
            menu.push({
                label: makeNativeLabel(false),
                click: () => {
                    getApi().openNativePath(finfo.path);
                },
            });
        }
    } else {
        menu.push({
            label: i18next.t("preview.downloadFile"),
            click: () => {
                const remoteUri = formatRemoteUri(finfo.path, conn);
                getApi().downloadFile(remoteUri);
            },
        });
    }
    menu.push({
        type: "separator",
    });
    if (!finfo.isdir) {
        menu.push({
            label: i18next.t("preview.openPreviewInNewBlock"),
            click: () =>
                fireAndForget(async () => {
                    const blockDef: BlockDef = {
                        meta: {
                            view: "preview",
                            file: finfo.path,
                            connection: conn,
                        },
                    };
                    await createBlock(blockDef);
                }),
        });
    }
    const targetCwd = finfo.isdir ? finfo.path : finfo.dir;
    menu.push({
        label: i18next.t("preview.openTerminalHere"),
        click: () => {
            const termBlockDef: BlockDef = {
                meta: {
                    controller: "shell",
                    view: "term",
                    "cmd:cwd": targetCwd,
                    connection: conn,
                },
            };
            fireAndForget(() => createBlock(termBlockDef));
        },
    });
    menu.push({
        label: i18next.t("preview.openWithAi"),
        submenu: makeAiLaunchMenuItems(targetCwd, conn),
    });
    return menu;
}


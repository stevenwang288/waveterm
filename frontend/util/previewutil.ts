import { createBlock, getApi, getFocusedBlockId, globalStore, WOS } from "@/app/store/global";
import i18next from "@/app/i18n";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { makeNativeLabel } from "./platformutil";
import { fireAndForget, isBlank, stringToBase64 } from "./util";
import { formatRemoteUri } from "./waveutil";

function findFocusedTerminalBlockId(): string {
    const focusedBlockId = getFocusedBlockId();
    if (isBlank(focusedBlockId)) {
        return null;
    }
    const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", focusedBlockId));
    const block = globalStore.get(blockAtom);
    if (block?.meta?.view !== "term") {
        return null;
    }
    return focusedBlockId;
}

function runCliInExistingTerminal(cliCommand: string): boolean {
    const targetBlockId = findFocusedTerminalBlockId();
    if (isBlank(targetBlockId) || isBlank(cliCommand)) {
        return false;
    }
    fireAndForget(async () => {
        await RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("block", targetBlockId),
            meta: { "term:autoCmd": cliCommand },
        });
        await RpcApi.ControllerInputCommand(TabRpcClient, {
            blockid: targetBlockId,
            inputdata64: stringToBase64(`${cliCommand}\n`),
        });
    });
    return true;
}

const AI_LAUNCH_COMMANDS: Array<{ label: string; command: string }> = [
    { label: "Codex", command: "codex" },
    { label: "Claude", command: "claude" },
    { label: "Gemini", command: "gemini" },
    { label: "Amp", command: "amp" },
    { label: "IFlow", command: "iflow" },
    { label: "OpenCode", command: "opencode" },
];

function makeAiLaunchMenuItems(): ContextMenuItem[] {
    return AI_LAUNCH_COMMANDS.map((item) => ({
        label: i18next.t("preview.openAiHere", { ai: item.label }),
        click: () => {
            runCliInExistingTerminal(item.command);
        },
    }));
}

function makeAutoCommandMenuItems(): ContextMenuItem[] {
    return AI_LAUNCH_COMMANDS.map((item) => ({
        label: item.label,
        click: () => {
            runCliInExistingTerminal(item.command);
        },
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
    menu.push(
        {
            label: "自动命令",
            submenu: makeAutoCommandMenuItems(),
        },
        {
            label: i18next.t("preview.openWithAi"),
            submenu: makeAiLaunchMenuItems(),
        }
    );
    return menu;
}

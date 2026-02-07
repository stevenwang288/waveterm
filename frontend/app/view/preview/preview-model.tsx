// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import i18next from "@/app/i18n";
import type { TabModel } from "@/app/store/tab-model";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { getApi, getConnStatusAtom, getOverrideConfigAtom, getSettingsKeyAtom, globalStore, refocusNode } from "@/store/global";
import * as services from "@/store/services";
import * as WOS from "@/store/wos";
import { goHistory, goHistoryBack, goHistoryForward } from "@/util/historyutil";
import { checkKeyPressed } from "@/util/keyutil";
import { addOpenMenuItems } from "@/util/previewutil";
import { base64ToString, fireAndForget, isBlank, jotaiLoadableValue, stringToBase64 } from "@/util/util";
import { formatRemoteUri } from "@/util/waveutil";
import clsx from "clsx";
import { Atom, atom, Getter, PrimitiveAtom, WritableAtom } from "jotai";
import { loadable } from "jotai/utils";
import type * as MonacoTypes from "monaco-editor";
import { createRef } from "react";
import { PreviewView } from "./preview";

// TODO drive this using config
const BOOKMARKS: { label: string; path: string }[] = [
    { label: i18next.t("preview.bookmarks.home"), path: "~" },
    { label: i18next.t("preview.bookmarks.desktop"), path: "~/Desktop" },
    { label: i18next.t("preview.bookmarks.downloads"), path: "~/Downloads" },
    { label: i18next.t("preview.bookmarks.documents"), path: "~/Documents" },
    { label: i18next.t("preview.bookmarks.root"), path: "/" },
];

const MaxFileSize = 1024 * 1024 * 10; // 10MB
const MaxCSVSize = 1024 * 1024 * 1; // 1MB

const textApplicationMimetypes = [
    "application/sql",
    "application/x-php",
    "application/x-pem-file",
    "application/x-httpd-php",
    "application/liquid",
    "application/graphql",
    "application/javascript",
    "application/typescript",
    "application/x-javascript",
    "application/x-typescript",
    "application/dart",
    "application/vnd.dart",
    "application/x-ruby",
    "application/sql",
    "application/wasm",
    "application/x-latex",
    "application/x-sh",
    "application/x-python",
    "application/x-awk",
];

function isTextFile(mimeType: string): boolean {
    if (mimeType == null) {
        return false;
    }
    return (
        mimeType.startsWith("text/") ||
        textApplicationMimetypes.includes(mimeType) ||
        (mimeType.startsWith("application/") &&
            (mimeType.includes("json") || mimeType.includes("yaml") || mimeType.includes("toml"))) ||
        mimeType.includes("xml")
    );
}

function isStreamingType(mimeType: string): boolean {
    if (mimeType == null) {
        return false;
    }
    return (
        mimeType.startsWith("application/pdf") ||
        mimeType.startsWith("video/") ||
        mimeType.startsWith("audio/") ||
        mimeType.startsWith("image/")
    );
}

function isMarkdownLike(mimeType: string): boolean {
    if (mimeType == null) {
        return false;
    }
    return mimeType.startsWith("text/markdown") || mimeType.startsWith("text/mdx");
}

function iconForFile(mimeType: string): string {
    if (mimeType == null) {
        mimeType = "unknown";
    }
    if (mimeType == "application/pdf") {
        return "file-pdf";
    } else if (mimeType.startsWith("image/")) {
        return "image";
    } else if (mimeType.startsWith("video/")) {
        return "film";
    } else if (mimeType.startsWith("audio/")) {
        return "headphones";
    } else if (isMarkdownLike(mimeType)) {
        return "file-lines";
    } else if (mimeType == "text/csv") {
        return "file-csv";
    } else if (
        mimeType.startsWith("text/") ||
        mimeType == "application/sql" ||
        (mimeType.startsWith("application/") &&
            (mimeType.includes("json") || mimeType.includes("yaml") || mimeType.includes("toml")))
    ) {
        return "file-code";
    } else {
        return "file";
    }
}

export class PreviewModel implements ViewModel {
    viewType: string;
    blockId: string;
    nodeModel: BlockNodeModel;
    tabModel: TabModel;
    connBtnRef?: React.RefObject<HTMLDivElement>;
    noPadding?: Atom<boolean>;
    blockAtom: Atom<Block>;
    viewIcon: Atom<string | IconButtonDecl>;
    viewName: Atom<string>;
    viewText: Atom<HeaderElem[]>;
    preIconButton: Atom<IconButtonDecl>;
    endIconButtons: Atom<IconButtonDecl[]>;
    hideViewName: Atom<boolean>;
    noHeader?: Atom<boolean>;
    previewTextRef: React.RefObject<HTMLDivElement>;
    addressBarInputRef: React.RefObject<HTMLInputElement>;
    editMode: Atom<boolean>;
    canPreview: PrimitiveAtom<boolean>;
    specializedView: Atom<Promise<{ specializedView?: string; errorStr?: string }>>;
    loadableSpecializedView: Atom<Loadable<{ specializedView?: string; errorStr?: string }>>;
    manageConnection: Atom<boolean>;
    connStatus: Atom<ConnStatus>;
    filterOutNowsh?: Atom<boolean>;

    metaFilePath: Atom<string>;
    statFilePath: Atom<Promise<string>>;
    loadableFileInfo: Atom<Loadable<FileInfo>>;
    connection: Atom<Promise<string>>;
    connectionImmediate: Atom<string>;
    statFile: Atom<Promise<FileInfo>>;
    fullFile: Atom<Promise<FileData>>;
    fileMimeType: Atom<Promise<string>>;
    fileMimeTypeLoadable: Atom<Loadable<string>>;
    fileContentSaved: PrimitiveAtom<string | null>;
    fileContent: WritableAtom<Promise<string>, [string], void>;
    newFileContent: PrimitiveAtom<string | null>;
    connectionError: PrimitiveAtom<string>;
    errorMsgAtom: PrimitiveAtom<ErrorMsg>;

    openFileModal: PrimitiveAtom<boolean>;
    openFileModalDelay: PrimitiveAtom<boolean>;
    openFileError: PrimitiveAtom<string>;
    openFileModalGiveFocusRef: React.RefObject<() => boolean>;

    markdownShowToc: PrimitiveAtom<boolean>;

    monacoRef: React.RefObject<MonacoTypes.editor.IStandaloneCodeEditor>;

    showHiddenFiles: PrimitiveAtom<boolean>;
    refreshVersion: PrimitiveAtom<number>;
    directorySearchActive: PrimitiveAtom<boolean>;
    addressBarEditing: PrimitiveAtom<boolean>;
    addressBarInput: PrimitiveAtom<string>;
    refreshCallback: () => void;
    directoryKeyDownHandler: (waveEvent: WaveKeyboardEvent) => boolean;
    codeEditKeyDownHandler: (waveEvent: WaveKeyboardEvent) => boolean;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        this.viewType = "preview";
        this.blockId = blockId;
        this.nodeModel = nodeModel;
        this.tabModel = tabModel;
        let showHiddenFiles = globalStore.get(getSettingsKeyAtom("preview:showhiddenfiles")) ?? true;
        this.showHiddenFiles = atom<boolean>(showHiddenFiles);
        this.refreshVersion = atom(0);
        this.directorySearchActive = atom(false);
        this.previewTextRef = createRef();
        this.addressBarInputRef = createRef();
        this.addressBarEditing = atom(false);
        this.addressBarInput = atom("");
        this.openFileModal = atom(false);
        this.openFileModalDelay = atom(false);
        this.openFileError = atom(null) as PrimitiveAtom<string>;
        this.openFileModalGiveFocusRef = createRef();
        this.manageConnection = atom(true);
        this.blockAtom = WOS.getWaveObjectAtom<Block>(`block:${blockId}`);
        this.connBtnRef = createRef();
        this.markdownShowToc = atom(false);
        this.filterOutNowsh = atom(true);
        this.monacoRef = createRef();
        this.connectionError = atom("");
        this.errorMsgAtom = atom(null) as PrimitiveAtom<ErrorMsg | null>;
        this.viewIcon = atom((get) => {
            const blockData = get(this.blockAtom);
            if (blockData?.meta?.icon) {
                return blockData.meta.icon;
            }
            const connStatus = get(this.connStatus);
            if (connStatus?.status != "connected") {
                return null;
            }
            const mimeTypeLoadable = get(this.fileMimeTypeLoadable);
            const mimeType = jotaiLoadableValue(mimeTypeLoadable, "");
            if (mimeType == "directory") {
                return {
                    elemtype: "iconbutton",
                    icon: "folder-open",
                    longClick: (e: React.MouseEvent<any>) => {
                        const menuItems: ContextMenuItem[] = BOOKMARKS.map((bookmark) => ({
                            label: i18next.t("preview.goToBookmark", { label: bookmark.label, path: bookmark.path }),
                            click: () => this.goHistory(bookmark.path),
                        }));
                        ContextMenuModel.showContextMenu(menuItems, e);
                    },
                };
            }
            return iconForFile(mimeType);
        });
        this.editMode = atom((get) => {
            const blockData = get(this.blockAtom);
            return blockData?.meta?.edit ?? false;
        });
        this.viewName = atom(i18next.t("block.viewName.preview"));
        this.hideViewName = atom(true);
        this.noHeader = atom(false);
        this.viewText = atom((get) => {
            let headerPath = get(this.metaFilePath);
            const connName = get(this.connectionImmediate);
            const isLocalConnection = isBlank(connName) || connName === "local";
            const connStatus = get(this.connStatus);
            if (connStatus?.status != "connected") {
                return [
                    {
                        elemtype: "text",
                        text: headerPath,
                        className: "preview-filename",
                    },
                ];
            }
            const loadableSV = get(this.loadableSpecializedView);
            const isCeView = loadableSV.state == "hasData" && loadableSV.data.specializedView == "codeedit";
            const loadableFileInfo = get(this.loadableFileInfo);
            if (loadableFileInfo.state == "hasData") {
                headerPath = loadableFileInfo.data?.path;
                if (headerPath == "~" && !isBlank(loadableFileInfo.data?.dir) && !isBlank(loadableFileInfo.data?.name)) {
                    headerPath = `${loadableFileInfo.data?.dir}/${loadableFileInfo.data?.name}`;
                }
            }
            if (!isBlank(headerPath) && headerPath != "/" && headerPath.endsWith("/")) {
                headerPath = headerPath.slice(0, -1);
            }
            if (isLocalConnection && !isBlank(headerPath)) {
                headerPath = headerPath.replace(/\//g, "\\");
            }
            const addressBarEditing = get(this.addressBarEditing);
            const addressBarInput = get(this.addressBarInput);
            const viewTextChildren: HeaderElem[] = [
                addressBarEditing
                    ? {
                          elemtype: "input",
                          value: addressBarInput,
                          ref: this.addressBarInputRef,
                          className: "preview-filename-input",
                          onChange: (e) => {
                              globalStore.set(this.addressBarInput, e.target.value);
                          },
                          onFocus: (e) => {
                              e.target.select();
                          },
                          onKeyDown: (e) => {
                              if (e.key === "Enter") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  fireAndForget(() => this.commitAddressBarPath());
                                  return;
                              }
                              if (e.key === "Escape") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  globalStore.set(this.addressBarEditing, false);
                              }
                          },
                          onBlur: () => {
                              globalStore.set(this.addressBarEditing, false);
                          },
                      }
                    : {
                          elemtype: "text",
                          text: headerPath,
                          ref: this.previewTextRef,
                          className: "preview-filename",
                          onClick: () => fireAndForget(() => this.enterAddressBarEditMode()),
                      },
            ];
            let saveClassName = "grey";
            if (get(this.newFileContent) !== null) {
                saveClassName = "green";
            }
            if (isCeView) {
                const fileInfo = globalStore.get(this.loadableFileInfo);
                if (fileInfo.state != "hasData") {
                    viewTextChildren.push({
                        elemtype: "textbutton",
                        text: i18next.t("common.loading"),
                        className: clsx(`grey rounded-[4px] !py-[2px] !px-[10px] text-[11px] font-[500]`),
                        onClick: () => {},
                    });
                } else if (fileInfo.data.readonly) {
                    viewTextChildren.push({
                        elemtype: "textbutton",
                        text: i18next.t("preview.readOnly"),
                        className: clsx(`yellow rounded-[4px] !py-[2px] !px-[10px] text-[11px] font-[500]`),
                        onClick: () => {},
                    });
                } else {
                    viewTextChildren.push({
                        elemtype: "textbutton",
                        text: i18next.t("common.save"),
                        className: clsx(`${saveClassName} rounded-[4px] !py-[2px] !px-[10px] text-[11px] font-[500]`),
                        onClick: () => fireAndForget(this.handleFileSave.bind(this)),
                    });
                }
                if (get(this.canPreview)) {
                    viewTextChildren.push({
                        elemtype: "textbutton",
                        text: i18next.t("block.viewName.preview"),
                        className: "grey rounded-[4px] !py-[2px] !px-[10px] text-[11px] font-[500]",
                        onClick: () => fireAndForget(() => this.setEditMode(false)),
                    });
                }
            } else if (get(this.canPreview)) {
                viewTextChildren.push({
                    elemtype: "textbutton",
                    text: i18next.t("preview.edit"),
                    className: "grey rounded-[4px] !py-[2px] !px-[10px] text-[11px] font-[500]",
                    onClick: () => fireAndForget(() => this.setEditMode(true)),
                });
            }
            return [
                {
                    elemtype: "div",
                    children: viewTextChildren,
                },
            ] as HeaderElem[];
        });
        this.preIconButton = atom((get) => {
            const connStatus = get(this.connStatus);
            if (connStatus?.status != "connected") {
                return null;
            }
            const mimeType = jotaiLoadableValue(get(this.fileMimeTypeLoadable), "");
            const metaPath = get(this.metaFilePath);
            if (mimeType == "directory" && metaPath == "/") {
                return null;
            }
            return {
                elemtype: "iconbutton",
                icon: "chevron-left",
                click: this.goParentDirectory.bind(this),
            };
        });
        this.endIconButtons = atom((get) => {
            const connStatus = get(this.connStatus);
            if (connStatus?.status != "connected") {
                return null;
            }
            const mimeType = jotaiLoadableValue(get(this.fileMimeTypeLoadable), "");
            const loadableSV = get(this.loadableSpecializedView);
            const isCeView = loadableSV.state == "hasData" && loadableSV.data.specializedView == "codeedit";
            if (mimeType == "directory") {
                const showHiddenFiles = get(this.showHiddenFiles);
                return [
                    {
                        elemtype: "iconbutton",
                        icon: "arrow-left",
                        title: i18next.t("explorer.back"),
                        click: () => fireAndForget(() => this.goHistoryBack()),
                    },
                    {
                        elemtype: "iconbutton",
                        icon: "arrow-right",
                        title: i18next.t("explorer.forward"),
                        click: () => fireAndForget(() => this.goHistoryForward()),
                    },
                    {
                        elemtype: "iconbutton",
                        icon: "arrow-up",
                        title: i18next.t("explorer.up"),
                        click: () => fireAndForget(() => this.goParentDirectory({})),
                    },
                    {
                        elemtype: "iconbutton",
                        icon: "table-cells-large",
                        title: i18next.t("explorer.context.view"),
                        click: (event) => {
                            const quickViewModes: Array<{ mode: string; label: string }> = [
                                { mode: "details", label: i18next.t("explorer.view.details") },
                                { mode: "list", label: i18next.t("explorer.view.list") },
                                { mode: "smallIcons", label: i18next.t("explorer.view.smallIcons") },
                                { mode: "mediumIcons", label: i18next.t("explorer.view.mediumIcons") },
                                { mode: "largeIcons", label: i18next.t("explorer.view.largeIcons") },
                            ];
                            const menu: ContextMenuItem[] = quickViewModes.map((item) => ({
                                label: item.label,
                                click: () => this.setDirectoryViewMode(item.mode),
                            }));
                            ContextMenuModel.showContextMenu(menu, event);
                        },
                    },
                    {
                        elemtype: "iconbutton",
                        icon: "copy",
                        title: i18next.t("preview.copyFullPath"),
                        click: () => fireAndForget(() => this.copyCurrentPathToClipboard()),
                    },
                    {
                        elemtype: "iconbutton",
                        icon: showHiddenFiles ? "eye" : "eye-slash",
                        click: () => {
                            globalStore.set(this.showHiddenFiles, (prev) => !prev);
                        },
                    },
                    {
                        elemtype: "iconbutton",
                        icon: "arrows-rotate",
                        click: () => this.refreshCallback?.(),
                    },
                ] as IconButtonDecl[];
            } else if (!isCeView && isMarkdownLike(mimeType)) {
                return [
                    {
                        elemtype: "iconbutton",
                        icon: "copy",
                        title: i18next.t("preview.copyFullPath"),
                        click: () => fireAndForget(() => this.copyCurrentPathToClipboard()),
                    },
                    {
                        elemtype: "iconbutton",
                        icon: "book",
                        title: i18next.t("preview.tableOfContents"),
                        click: () => this.markdownShowTocToggle(),
                    },
                    {
                        elemtype: "iconbutton",
                        icon: "arrows-rotate",
                        title: i18next.t("preview.refresh"),
                        click: () => this.refreshCallback?.(),
                    },
                ] as IconButtonDecl[];
            } else if (!isCeView && mimeType) {
                // For all other file types (text, code, etc.), add refresh button
                return [
                    {
                        elemtype: "iconbutton",
                        icon: "copy",
                        title: i18next.t("preview.copyFullPath"),
                        click: () => fireAndForget(() => this.copyCurrentPathToClipboard()),
                    },
                    {
                        elemtype: "iconbutton",
                        icon: "arrows-rotate",
                        title: i18next.t("preview.refresh"),
                        click: () => this.refreshCallback?.(),
                    },
                ] as IconButtonDecl[];
            }
            return null;
        });
        this.metaFilePath = atom<string>((get) => {
            const file = get(this.blockAtom)?.meta?.file;
            if (isBlank(file)) {
                return "~";
            }
            return file;
        });
        this.statFilePath = atom<Promise<string>>(async (get) => {
            const fileInfo = await get(this.statFile);
            return fileInfo?.path;
        });
        this.connection = atom<Promise<string>>(async (get) => {
            const connName = get(this.blockAtom)?.meta?.connection;
            try {
                await RpcApi.ConnEnsureCommand(TabRpcClient, { connname: connName }, { timeout: 60000 });
                globalStore.set(this.connectionError, "");
            } catch (e) {
                globalStore.set(this.connectionError, e as string);
            }
            return connName;
        });
        this.connectionImmediate = atom<string>((get) => {
            return get(this.blockAtom)?.meta?.connection;
        });
        this.statFile = atom<Promise<FileInfo>>(async (get) => {
            const fileName = get(this.metaFilePath);
            const path = await this.formatRemoteUri(fileName, get);
            if (fileName == null) {
                return null;
            }
            try {
                const statFile = await RpcApi.FileInfoCommand(
                    TabRpcClient,
                    {
                        info: {
                            path,
                        },
                    },
                    { timeout: 30000 }
                );
                return statFile;
            } catch (e) {
                const errorStatus: ErrorMsg = {
                    status: "File Read Failed",
                    text: `${e}`,
                };
                globalStore.set(this.errorMsgAtom, errorStatus);
            }
        });
        this.fileMimeType = atom<Promise<string>>(async (get) => {
            const fileInfo = await get(this.statFile);
            return fileInfo?.mimetype;
        });
        this.fileMimeTypeLoadable = loadable(this.fileMimeType);
        this.newFileContent = atom(null) as PrimitiveAtom<string | null>;
        this.goParentDirectory = this.goParentDirectory.bind(this);

        const fullFileAtom = atom<Promise<FileData>>(async (get) => {
            get(this.refreshVersion); // Subscribe to refreshVersion to trigger re-fetch
            const fileName = get(this.metaFilePath);
            const path = await this.formatRemoteUri(fileName, get);
            if (fileName == null) {
                return null;
            }
            try {
                const file = await RpcApi.FileReadCommand(
                    TabRpcClient,
                    {
                        info: {
                            path,
                        },
                    },
                    { timeout: 45000 }
                );
                return file;
            } catch (e) {
                const errorStatus: ErrorMsg = {
                    status: "File Read Failed",
                    text: `${e}`,
                };
                globalStore.set(this.errorMsgAtom, errorStatus);
            }
        });

        this.fileContentSaved = atom(null) as PrimitiveAtom<string | null>;
        const fileContentAtom = atom(
            async (get) => {
                const newContent = get(this.newFileContent);
                if (newContent != null) {
                    return newContent;
                }
                const savedContent = get(this.fileContentSaved);
                if (savedContent != null) {
                    return savedContent;
                }
                const fullFile = await get(fullFileAtom);
                return base64ToString(fullFile?.data64);
            },
            (_, set, update: string) => {
                set(this.fileContentSaved, update);
            }
        );

        this.fullFile = fullFileAtom;
        this.fileContent = fileContentAtom;

        this.specializedView = atom<Promise<{ specializedView?: string; errorStr?: string }>>(async (get) => {
            return this.getSpecializedView(get);
        });
        this.loadableSpecializedView = loadable(this.specializedView);
        this.canPreview = atom(false);
        this.loadableFileInfo = loadable(this.statFile);
        this.connStatus = atom((get) => {
            const blockData = get(this.blockAtom);
            const connName = blockData?.meta?.connection;
            const connAtom = getConnStatusAtom(connName);
            return get(connAtom);
        });

        this.noPadding = atom(true);
    }

    markdownShowTocToggle() {
        globalStore.set(this.markdownShowToc, !globalStore.get(this.markdownShowToc));
    }

    get viewComponent(): ViewComponent {
        return PreviewView;
    }

    async getSpecializedView(getFn: Getter): Promise<{ specializedView?: string; errorStr?: string }> {
        const mimeType = await getFn(this.fileMimeType);
        const fileInfo = await getFn(this.statFile);
        const fileName = fileInfo?.name;
        const connErr = getFn(this.connectionError);
        const editMode = getFn(this.editMode);
        const genErr = getFn(this.errorMsgAtom);

        if (!fileInfo) {
            return { errorStr: `Load Error: ${genErr?.text}` };
        }
        if (connErr != "") {
            return { errorStr: `Connection Error: ${connErr}` };
        }
        if (fileInfo?.notfound) {
            return { specializedView: "codeedit" };
        }
        if (mimeType == null) {
            return { errorStr: `Unable to determine mimetype for: ${fileInfo.path}` };
        }
        if (isStreamingType(mimeType)) {
            return { specializedView: "streaming" };
        }
        if (!fileInfo) {
            const fileNameStr = fileName ? " " + JSON.stringify(fileName) : "";
            return { errorStr: "File Not Found" + fileNameStr };
        }
        if (fileInfo.size > MaxFileSize) {
            return { errorStr: "File Too Large to Preview (10 MB Max)" };
        }
        if (mimeType == "text/csv" && fileInfo.size > MaxCSVSize) {
            return { errorStr: "CSV File Too Large to Preview (1 MB Max)" };
        }
        if (mimeType == "directory") {
            return { specializedView: "directory" };
        }
        if (mimeType == "text/csv") {
            if (editMode) {
                return { specializedView: "codeedit" };
            }
            return { specializedView: "csv" };
        }
        if (isMarkdownLike(mimeType)) {
            if (editMode) {
                return { specializedView: "codeedit" };
            }
            return { specializedView: "markdown" };
        }
        if (isTextFile(mimeType) || fileInfo.size == 0) {
            return { specializedView: "codeedit" };
        }
        return { errorStr: `Preview (${mimeType})` };
    }

    updateOpenFileModalAndError(isOpen, errorMsg = null) {
        globalStore.set(this.openFileModal, isOpen);
        globalStore.set(this.openFileError, errorMsg);
        if (isOpen) {
            globalStore.set(this.openFileModalDelay, true);
        } else {
            const delayVal = globalStore.get(this.openFileModalDelay);
            if (delayVal) {
                setTimeout(() => {
                    globalStore.set(this.openFileModalDelay, false);
                }, 200);
            }
        }
    }

    toggleOpenFileModal() {
        const modalOpen = globalStore.get(this.openFileModal);
        const delayVal = globalStore.get(this.openFileModalDelay);
        if (!modalOpen && delayVal) {
            return;
        }
        this.updateOpenFileModalAndError(!modalOpen);
    }

    async goHistory(newPath: string) {
        let fileName = globalStore.get(this.metaFilePath);
        if (fileName == null) {
            fileName = "";
        }
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const updateMeta = goHistory("file", fileName, newPath, blockMeta);
        if (updateMeta == null) {
            return;
        }
        const blockOref = WOS.makeORef("block", this.blockId);
        await services.ObjectService.UpdateObjectMeta(blockOref, updateMeta);

        // Clear the saved file buffers
        globalStore.set(this.fileContentSaved, null);
        globalStore.set(this.newFileContent, null);
    }

    async goParentDirectory({ fileInfo = null }: { fileInfo?: FileInfo | null }) {
        // optional parameter needed for recursive case
        const defaultFileInfo = await globalStore.get(this.statFile);
        if (fileInfo === null) {
            fileInfo = defaultFileInfo;
        }
        if (fileInfo == null) {
            this.updateOpenFileModalAndError(false);
            return true;
        }
        try {
            this.updateOpenFileModalAndError(false);
            await this.goHistory(fileInfo.dir);
            refocusNode(this.blockId);
        } catch (e) {
            globalStore.set(this.openFileError, e.message);
            console.error("Error opening file", fileInfo.dir, e);
        }
    }

    async goHistoryBack() {
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const curPath = globalStore.get(this.metaFilePath);
        const updateMeta = goHistoryBack("file", curPath, blockMeta, true);
        if (updateMeta == null) {
            return;
        }
        updateMeta.edit = false;
        const blockOref = WOS.makeORef("block", this.blockId);
        await services.ObjectService.UpdateObjectMeta(blockOref, updateMeta);
    }

    async goHistoryForward() {
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const curPath = globalStore.get(this.metaFilePath);
        const updateMeta = goHistoryForward("file", curPath, blockMeta);
        if (updateMeta == null) {
            return;
        }
        updateMeta.edit = false;
        const blockOref = WOS.makeORef("block", this.blockId);
        await services.ObjectService.UpdateObjectMeta(blockOref, updateMeta);
    }

    async setEditMode(edit: boolean) {
        const blockMeta = globalStore.get(this.blockAtom)?.meta;
        const blockOref = WOS.makeORef("block", this.blockId);
        await services.ObjectService.UpdateObjectMeta(blockOref, { ...blockMeta, edit });
    }

    async handleFileSave() {
        const filePath = await globalStore.get(this.statFilePath);
        if (filePath == null) {
            return;
        }
        const newFileContent = globalStore.get(this.newFileContent);
        if (newFileContent == null) {
            console.log("not saving file, newFileContent is null");
            return;
        }
        try {
            await RpcApi.FileWriteCommand(TabRpcClient, {
                info: {
                    path: await this.formatRemoteUri(filePath, globalStore.get),
                },
                data64: stringToBase64(newFileContent),
            });
            globalStore.set(this.fileContent, newFileContent);
            globalStore.set(this.newFileContent, null);
            console.log("saved file", filePath);
        } catch (e) {
            const errorStatus: ErrorMsg = {
                status: "Save Failed",
                text: `${e}`,
            };
            globalStore.set(this.errorMsgAtom, errorStatus);
        }
    }

    async handleFileRevert() {
        const fileContent = await globalStore.get(this.fileContent);
        this.monacoRef.current?.setValue(fileContent);
        globalStore.set(this.newFileContent, null);
    }

    async handleOpenFile(filePath: string) {
        const fileInfo = await globalStore.get(this.statFile);
        this.updateOpenFileModalAndError(false);
        if (fileInfo == null) {
            return true;
        }
        try {
            this.goHistory(filePath);
            refocusNode(this.blockId);
        } catch (e) {
            globalStore.set(this.openFileError, e.message);
            console.error("Error opening file", filePath, e);
        }
    }

    setDirectoryViewMode(mode: string) {
        window.dispatchEvent(
            new CustomEvent("preview-directory-view-mode", {
                detail: { blockId: this.blockId, mode },
            })
        );
    }

    async resolveCurrentPath(windowsStyle = false): Promise<string> {
        const fileInfo = await globalStore.get(this.statFile);
        let path = fileInfo?.path ?? "";
        if (path === "~" && !isBlank(fileInfo?.dir) && !isBlank(fileInfo?.name)) {
            path = `${fileInfo?.dir}/${fileInfo?.name}`;
        }
        if (isBlank(path)) {
            path = globalStore.get(this.metaFilePath) ?? "";
        }
        const conn = await globalStore.get(this.connection);
        const isLocalConnection = isBlank(conn) || conn === "local";
        if (isLocalConnection && !isBlank(path)) {
            const homeDir = getApi().getHomeDir()?.trim();
            if (!isBlank(homeDir)) {
                const normalizedHomeDir = homeDir.replace(/\\/g, "/");
                if (path === "~") {
                    path = normalizedHomeDir;
                } else if (path.startsWith("~/") || path.startsWith("~\\")) {
                    const suffix = path.slice(2).replace(/^[/\\]+/, "");
                    path = `${normalizedHomeDir}/${suffix}`;
                }
            }
        }
        if (windowsStyle && isLocalConnection && !isBlank(path)) {
            path = path.replace(/\//g, "\\");
        }
        return path;
    }

    async enterAddressBarEditMode() {
        const resolvedPath = await this.resolveCurrentPath(true);
        if (isBlank(resolvedPath)) {
            return;
        }
        globalStore.set(this.addressBarInput, resolvedPath);
        globalStore.set(this.addressBarEditing, true);
        setTimeout(() => {
            this.addressBarInputRef.current?.focus();
            this.addressBarInputRef.current?.select();
        }, 0);
    }

    async commitAddressBarPath() {
        const inputPath = (globalStore.get(this.addressBarInput) ?? "").trim();
        if (isBlank(inputPath)) {
            globalStore.set(this.addressBarEditing, false);
            return;
        }
        const conn = await globalStore.get(this.connection);
        const isLocalConnection = isBlank(conn) || conn === "local";
        const normalizedInputPath = isLocalConnection ? inputPath.replace(/\\/g, "/") : inputPath;
        globalStore.set(this.addressBarEditing, false);
        await this.goHistory(normalizedInputPath);
    }

    async copyCurrentPathToClipboard() {
        const filePath = await this.resolveCurrentPath(true);
        if (isBlank(filePath)) {
            return;
        }
        const conn = await globalStore.get(this.connection);
        const isLocalConnection = isBlank(conn) || conn === "local";
        if (!isLocalConnection && conn) {
            await navigator.clipboard.writeText(formatRemoteUri(filePath, conn));
        } else {
            await navigator.clipboard.writeText(filePath);
        }
    }

    isSpecializedView(sv: string): boolean {
        const loadableSV = globalStore.get(this.loadableSpecializedView);
        return loadableSV.state == "hasData" && loadableSV.data.specializedView == sv;
    }

    getSettingsMenuItems(): ContextMenuItem[] {
        const defaultFontSize = globalStore.get(getSettingsKeyAtom("editor:fontsize")) ?? 12;
        const blockData = globalStore.get(this.blockAtom);
        const overrideFontSize = blockData?.meta?.["editor:fontsize"];
        const menuItems: ContextMenuItem[] = [];
        menuItems.push({
            label: i18next.t("preview.copyFullPath"),
            click: () => fireAndForget(() => this.copyCurrentPathToClipboard()),
        });
        menuItems.push({
            label: i18next.t("preview.copyFileName"),
            click: () =>
                fireAndForget(async () => {
                    const fileInfo = await globalStore.get(this.statFile);
                    if (fileInfo == null || fileInfo.name == null) {
                        return;
                    }
                    await navigator.clipboard.writeText(fileInfo.name);
                }),
        });
        menuItems.push({ type: "separator" });
        const fontSizeSubMenu: ContextMenuItem[] = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map(
            (fontSize: number) => {
                return {
                    label: fontSize.toString() + "px",
                    type: "checkbox",
                    checked: overrideFontSize == fontSize,
                    click: () => {
                        RpcApi.SetMetaCommand(TabRpcClient, {
                            oref: WOS.makeORef("block", this.blockId),
                            meta: { "editor:fontsize": fontSize },
                        });
                    },
                };
            }
        );
        fontSizeSubMenu.unshift({
            label: i18next.t("common.defaultWithValue", { value: `${defaultFontSize}px` }),
            type: "checkbox",
            checked: overrideFontSize == null,
            click: () => {
                RpcApi.SetMetaCommand(TabRpcClient, {
                    oref: WOS.makeORef("block", this.blockId),
                    meta: { "editor:fontsize": null },
                });
            },
        });
        menuItems.push({
            label: i18next.t("preview.editorFontSize"),
            submenu: fontSizeSubMenu,
        });
        const finfo = jotaiLoadableValue(globalStore.get(this.loadableFileInfo), null);
        addOpenMenuItems(menuItems, globalStore.get(this.connectionImmediate), finfo);
        const loadableSV = globalStore.get(this.loadableSpecializedView);
        const wordWrapAtom = getOverrideConfigAtom(this.blockId, "editor:wordwrap");
        const wordWrap = globalStore.get(wordWrapAtom) ?? false;
        if (loadableSV.state == "hasData") {
            if (loadableSV.data.specializedView == "codeedit") {
                if (globalStore.get(this.newFileContent) != null) {
                    menuItems.push({ type: "separator" });
                    menuItems.push({
                        label: i18next.t("preview.saveFile"),
                        click: () => fireAndForget(this.handleFileSave.bind(this)),
                    });
                    menuItems.push({
                        label: i18next.t("preview.revertFile"),
                        click: () => fireAndForget(this.handleFileRevert.bind(this)),
                    });
                }
                menuItems.push({ type: "separator" });
                menuItems.push({
                    label: i18next.t("preview.wordWrap"),
                    type: "checkbox",
                    checked: wordWrap,
                    click: () =>
                        fireAndForget(async () => {
                            const blockOref = WOS.makeORef("block", this.blockId);
                            await services.ObjectService.UpdateObjectMeta(blockOref, {
                                "editor:wordwrap": !wordWrap,
                            });
                        }),
                });
            }
        }
        return menuItems;
    }

    giveFocus(): boolean {
        const openModalOpen = globalStore.get(this.openFileModal);
        if (openModalOpen) {
            this.openFileModalGiveFocusRef.current?.();
            return true;
        }
        if (this.monacoRef.current) {
            this.monacoRef.current.focus();
            return true;
        }
        return false;
    }

    keyDownHandler(e: WaveKeyboardEvent): boolean {
        if (checkKeyPressed(e, "Cmd:ArrowLeft")) {
            fireAndForget(this.goHistoryBack.bind(this));
            return true;
        }
        if (checkKeyPressed(e, "Cmd:ArrowRight")) {
            fireAndForget(this.goHistoryForward.bind(this));
            return true;
        }
        if (checkKeyPressed(e, "Cmd:ArrowUp")) {
            // handle up directory
            fireAndForget(() => this.goParentDirectory({}));
            return true;
        }
        if (checkKeyPressed(e, "Cmd:o")) {
            this.toggleOpenFileModal();
            return true;
        }
        const canPreview = globalStore.get(this.canPreview);
        if (canPreview) {
            if (checkKeyPressed(e, "Cmd:e")) {
                const editMode = globalStore.get(this.editMode);
                fireAndForget(() => this.setEditMode(!editMode));
                return true;
            }
        }
        if (this.directoryKeyDownHandler) {
            const handled = this.directoryKeyDownHandler(e);
            if (handled) {
                return true;
            }
        }
        if (this.codeEditKeyDownHandler) {
            const handled = this.codeEditKeyDownHandler(e);
            if (handled) {
                return true;
            }
        }
        return false;
    }

    async formatRemoteUri(path: string, get: Getter): Promise<string> {
        return formatRemoteUri(path, await get(this.connection));
    }
}

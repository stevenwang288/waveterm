// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ContextMenuModel } from "@/app/store/contextmenu";
import { atoms, getApi, globalStore } from "@/app/store/global";
import i18next from "@/app/i18n";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { FavoritesModel } from "@/app/store/favorites-model";
import { checkKeyPressed, isCharacterKeyEvent } from "@/util/keyutil";
import { PLATFORM, PlatformMacOS } from "@/util/platformutil";
import { addOpenMenuItems } from "@/util/previewutil";
import { fireAndForget } from "@/util/util";
import { formatRemoteUri } from "@/util/waveutil";
import { offset, useDismiss, useFloating, useInteractions } from "@floating-ui/react";
import {
    Header,
    Row,
    RowData,
    SortingState,
    Table,
    createColumnHelper,
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table";
import clsx from "clsx";
import { PrimitiveAtom, atom, useAtom, useAtomValue, useSetAtom } from "jotai";
import { OverlayScrollbarsComponent, OverlayScrollbarsComponentRef } from "overlayscrollbars-react";
import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDrag, useDrop } from "react-dnd";
import { quote as shellQuote } from "shell-quote";
import { debounce } from "throttle-debounce";
import "./directorypreview.scss";
import { EntryManagerOverlay, EntryManagerOverlayProps, EntryManagerType } from "./entry-manager";
import {
    cleanMimetype,
    getBestUnit,
    getLastModifiedTime,
    getSortIcon,
    handleFileDelete,
    handleRename,
    isIconValid,
    mergeError,
    overwriteError,
} from "./preview-directory-utils";
import { type PreviewModel } from "./preview-model";

const PageJumpSize = 20;
type DragDropOperation = "copy" | "move";
export type DirectoryViewMode = "details" | "list" | "smallIcons" | "mediumIcons" | "largeIcons";

function parseWshUri(uri: string): { connection: string; path: string } | null {
    if (!uri) {
        return null;
    }
    const match = uri.match(/^wsh:\/\/([^/]+)\/(.*)$/);
    if (!match) {
        return null;
    }
    return {
        connection: match[1] ?? "",
        path: match[2] ?? "",
    };
}

function getWindowsDriveLetter(path: string): string | null {
    if (!path) {
        return null;
    }
    const match = path.match(/^([A-Za-z]):[\\/]/);
    if (!match) {
        return null;
    }
    return match[1]!.toUpperCase();
}

function isPathEqualOrDescendant(ancestor: string, maybeDescendant: string): boolean {
    if (!ancestor || !maybeDescendant) {
        return false;
    }
    const aNorm = ancestor.replace(/[\\/]+$/, "");
    const dNorm = maybeDescendant.replace(/[\\/]+$/, "");
    if (!aNorm || !dNorm) {
        return false;
    }

    const aLower = aNorm.toLowerCase();
    const dLower = dNorm.toLowerCase();
    if (aLower === dLower) {
        return true;
    }
    if (dLower.startsWith(aLower + "/") || dLower.startsWith(aLower + "\\")) {
        return true;
    }
    return false;
}

function determineDragDropOperation(srcUri: string, destUri: string): DragDropOperation {
    const src = parseWshUri(srcUri);
    const dest = parseWshUri(destUri);
    if (!src || !dest) {
        return "copy";
    }
    if (!src.connection || !dest.connection) {
        return "copy";
    }
    if (src.connection !== dest.connection) {
        return "copy";
    }
    const srcDrive = getWindowsDriveLetter(src.path);
    const destDrive = getWindowsDriveLetter(dest.path);
    if (srcDrive && destDrive && srcDrive !== destDrive) {
        return "copy";
    }
    return "move";
}

interface DirectoryTableHeaderCellProps {
    header: Header<FileInfo, unknown>;
}

function DirectoryTableHeaderCell({ header }: DirectoryTableHeaderCellProps) {
    return (
        <div
            className="dir-table-head-cell"
            key={header.id}
            style={{ width: `calc(var(--header-${header.id}-size) * 1px)` }}
        >
            <div className="dir-table-head-cell-content" onClick={() => header.column.toggleSorting()}>
                {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                {getSortIcon(header.column.getIsSorted())}
            </div>
            <div className="dir-table-head-resize-box">
                <div
                    className="dir-table-head-resize"
                    onMouseDown={header.getResizeHandler()}
                    onTouchStart={header.getResizeHandler()}
                />
            </div>
        </div>
    );
}

declare module "@tanstack/react-table" {
    interface TableMeta<TData extends RowData> {
        updateName: (path: string, isDir: boolean) => void;
        newFile: () => void;
        newDirectory: () => void;
    }
}

interface DirectoryTableProps {
    model: PreviewModel;
    data: FileInfo[];
    search: string;
    viewMode: DirectoryViewMode;
    sorting: SortingState;
    setSorting: React.Dispatch<React.SetStateAction<SortingState>>;
    focusIndex: number;
    setFocusIndex: (_: number) => void;
    setSearch: (_: string) => void;
    setSelectedPath: (_path: string, _isDir?: boolean) => void;
    setRefreshVersion: React.Dispatch<React.SetStateAction<number>>;
    entryManagerOverlayPropsAtom: PrimitiveAtom<EntryManagerOverlayProps>;
    newFile: () => void;
    newDirectory: () => void;
}

const columnHelper = createColumnHelper<FileInfo>();

function DirectoryTable({
    model,
    data,
    search,
    viewMode,
    sorting,
    setSorting,
    focusIndex,
    setFocusIndex,
    setSearch,
    setSelectedPath,
    setRefreshVersion,
    entryManagerOverlayPropsAtom,
    newFile,
    newDirectory,
}: DirectoryTableProps) {
    const searchActive = useAtomValue(model.directorySearchActive);
    const fullConfig = useAtomValue(atoms.fullConfigAtom);
    const blockData = useAtomValue(model.blockAtom);
    const isExplorerView = !!blockData?.meta?.["preview:explorer"];
    const setErrorMsg = useSetAtom(model.errorMsgAtom);
    const isCompactView = viewMode !== "details";
    const getIconFromMimeType = useCallback(
        (mimeType: string): string => {
            while (mimeType.length > 0) {
                const icon = fullConfig.mimetypes?.[mimeType]?.icon ?? null;
                if (isIconValid(icon)) {
                    return `fa fa-solid fa-${icon} fa-fw`;
                }
                mimeType = mimeType.slice(0, -1);
            }
            return "fa fa-solid fa-file fa-fw";
        },
        [fullConfig.mimetypes]
    );
    const getIconColor = useCallback(
        (mimeType: string): string => fullConfig.mimetypes?.[mimeType]?.color ?? "inherit",
        [fullConfig.mimetypes]
    );
    const columns = useMemo(
        () => {
            const iconColumn = columnHelper.accessor("mimetype", {
                cell: (info) => (
                    <i
                        className={getIconFromMimeType(info.getValue() ?? "")}
                        style={{ color: getIconColor(info.getValue() ?? "") }}
                    ></i>
                ),
                header: () => <span></span>,
                id: "logo",
                size: 25,
                enableSorting: false,
            });
            const nameColumn = columnHelper.accessor("name", {
                cell: (info) => <span className="dir-table-name ellipsis">{info.getValue()}</span>,
                header: () => <span className="dir-table-head-name">{i18next.t("preview.directory.columns.name")}</span>,
                sortingFn: "alphanumeric",
                size: 240,
                minSize: 120,
            });
            const modTimeColumn = columnHelper.accessor("modtime", {
                cell: (info) => (
                    <span className="dir-table-lastmod">{getLastModifiedTime(info.getValue(), info.column)}</span>
                ),
                header: () => <span>{i18next.t("preview.directory.columns.lastModified")}</span>,
                size: 140,
                minSize: 90,
                sortingFn: "datetime",
            });
            const typeColumn = columnHelper.accessor("mimetype", {
                cell: (info) => <span className="dir-table-type ellipsis">{cleanMimetype(info.getValue() ?? "")}</span>,
                header: () => <span className="dir-table-head-type">{i18next.t("preview.directory.columns.type")}</span>,
                size: 140,
                minSize: 110,
                sortingFn: "alphanumeric",
            });
            const sizeColumn = columnHelper.accessor("size", {
                cell: (info) => <span className="dir-table-size">{getBestUnit(info.getValue())}</span>,
                header: () => <span className="dir-table-head-size">{i18next.t("preview.directory.columns.size")}</span>,
                size: 90,
                minSize: 70,
                sortingFn: "auto",
            });
            const pathColumn = columnHelper.accessor("path", {});

            if (isExplorerView) {
                return [iconColumn, nameColumn, modTimeColumn, typeColumn, sizeColumn, pathColumn];
            }

            const permColumn = columnHelper.accessor("modestr", {
                cell: (info) => <span className="dir-table-modestr">{info.getValue()}</span>,
                header: () => <span>{i18next.t("preview.directory.columns.perm")}</span>,
                size: 91,
                minSize: 90,
                sortingFn: "alphanumeric",
            });
            return [iconColumn, nameColumn, permColumn, modTimeColumn, sizeColumn, typeColumn, pathColumn];
        },
        [fullConfig, getIconColor, getIconFromMimeType, isExplorerView]
    );

    const setEntryManagerProps = useSetAtom(entryManagerOverlayPropsAtom);

    const updateName = useCallback(
        (path: string, isDir: boolean) => {
            const fileName = path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1);
            setEntryManagerProps({
                entryManagerType: EntryManagerType.EditName,
                startingValue: fileName,
                onSave: (newName: string) => {
                    let newPath: string;
                    if (newName !== fileName) {
                        const lastInstance = path.lastIndexOf(fileName);
                        newPath = path.substring(0, lastInstance) + newName;
                        console.log(`replacing ${fileName} with ${newName}: ${path}`);
                        handleRename(model, path, newPath, isDir, setErrorMsg);
                    }
                    setEntryManagerProps(undefined);
                },
            });
        },
        [model, setErrorMsg]
    );

    const columnVisibility = useMemo(() => {
        if (!isCompactView) {
            return { path: false };
        }
        return {
            path: false,
            modtime: false,
            size: false,
            mimetype: false,
            modestr: false,
        };
    }, [isCompactView]);

    const table = useReactTable({
        data,
        columns,
        state: { sorting, columnVisibility },
        onSortingChange: setSorting,
        columnResizeMode: "onChange",
        getSortedRowModel: getSortedRowModel(),
        getCoreRowModel: getCoreRowModel(),

        initialState: {
            columnVisibility: {
                path: false,
            },
        },
        enableMultiSort: false,
        enableSortingRemoval: false,
        meta: {
            updateName,
            newFile,
            newDirectory,
        },
    });
    const sortingState = table.getState().sorting;
    useEffect(() => {
        const allRows = table.getRowModel()?.flatRows || [];
        const row = allRows[focusIndex];
        const path = (row?.getValue("path") as string) ?? "";
        const fileInfo = row?.original;
        const isDir = fileInfo?.isdir ?? undefined;
        setSelectedPath(path, isDir);
    }, [focusIndex, data, setSelectedPath, sortingState]);

    const columnSizeVars = useMemo(() => {
        const headers = table.getFlatHeaders();
        const colSizes: { [key: string]: number } = {};
        for (let i = 0; i < headers.length; i++) {
            const header = headers[i]!;
            colSizes[`--header-${header.id}-size`] = header.getSize();
            colSizes[`--col-${header.column.id}-size`] = header.column.getSize();
        }
        return colSizes;
    }, [table.getState().columnSizingInfo]);

    const osRef = useRef<OverlayScrollbarsComponentRef>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const [scrollHeight, setScrollHeight] = useState(0);

    const onScroll = useCallback(
        debounce(2, () => {
            setScrollHeight(osRef.current.osInstance().elements().viewport.scrollTop);
        }),
        []
    );

    const TableComponent = table.getState().columnSizingInfo.isResizingColumn ? MemoizedTableBody : TableBody;

    return (
        <OverlayScrollbarsComponent
            options={{ scrollbars: { autoHide: "leave" } }}
            events={{ scroll: onScroll }}
            className="dir-table"
            style={{ ...columnSizeVars }}
            ref={osRef}
            data-scroll-height={scrollHeight}
        >
            {!isCompactView && (
                <div className="dir-table-head">
                    {table.getHeaderGroups().map((headerGroup) => (
                        <div className="dir-table-head-row" key={headerGroup.id}>
                            {headerGroup.headers.map((header) => (
                                <DirectoryTableHeaderCell key={header.id} header={header} />
                            ))}
                        </div>
                    ))}
                </div>
            )}
            <TableComponent
                bodyRef={bodyRef}
                model={model}
                data={data}
                table={table}
                search={search}
                focusIndex={focusIndex}
                setFocusIndex={setFocusIndex}
                setSearch={setSearch}
                setSelectedPath={setSelectedPath}
                setRefreshVersion={setRefreshVersion}
                osRef={osRef.current}
            />
        </OverlayScrollbarsComponent>
    );
}

interface TableBodyProps {
    bodyRef: React.RefObject<HTMLDivElement>;
    model: PreviewModel;
    data: Array<FileInfo>;
    table: Table<FileInfo>;
    search: string;
    focusIndex: number;
    setFocusIndex: (_: number) => void;
    setSearch: (_: string) => void;
    setSelectedPath: (_path: string, _isDir?: boolean) => void;
    setRefreshVersion: React.Dispatch<React.SetStateAction<number>>;
    osRef: OverlayScrollbarsComponentRef;
}

function TableBody({
    bodyRef,
    model,
    table,
    search,
    focusIndex,
    setFocusIndex,
    setSearch,
    setRefreshVersion,
    osRef,
}: TableBodyProps) {
    const searchActive = useAtomValue(model.directorySearchActive);
    const blockData = useAtomValue(model.blockAtom);
    const isExplorerView = !!blockData?.meta?.["preview:explorer"];
    const dummyLineRef = useRef<HTMLDivElement>(null);
    const warningBoxRef = useRef<HTMLDivElement>(null);
    const conn = useAtomValue(model.connection);
    const setErrorMsg = useSetAtom(model.errorMsgAtom);

    useEffect(() => {
        if (focusIndex === null || !bodyRef.current || !osRef) {
            return;
        }

        const rowElement = bodyRef.current.querySelector(`[data-rowindex="${focusIndex}"]`) as HTMLDivElement;
        if (!rowElement) {
            return;
        }

        const viewport = osRef.osInstance().elements().viewport;
        const viewportHeight = viewport.offsetHeight;
        const rowRect = rowElement.getBoundingClientRect();
        const parentRect = viewport.getBoundingClientRect();
        const viewportScrollTop = viewport.scrollTop;
        const rowTopRelativeToViewport = rowRect.top - parentRect.top + viewport.scrollTop;
        const rowBottomRelativeToViewport = rowRect.bottom - parentRect.top + viewport.scrollTop;

        if (rowTopRelativeToViewport - 30 < viewportScrollTop) {
            // Row is above the visible area
            let topVal = rowTopRelativeToViewport - 30;
            if (topVal < 0) {
                topVal = 0;
            }
            viewport.scrollTo({ top: topVal });
        } else if (rowBottomRelativeToViewport + 5 > viewportScrollTop + viewportHeight) {
            // Row is below the visible area
            const topVal = rowBottomRelativeToViewport - viewportHeight + 5;
            viewport.scrollTo({ top: topVal });
        }
    }, [focusIndex]);


    const handleFileContextMenu = useCallback(
        async (e: any, finfo: FileInfo) => {
            e.preventDefault();
            e.stopPropagation();
            if (finfo == null) {
                return;
            }
            const fileName = finfo.path.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1);
            const menu: ContextMenuItem[] = [
                {
                    label: i18next.t("preview.entryManager.newFile"),
                    click: () => {
                        table.options.meta.newFile();
                    },
                },
                {
                    label: i18next.t("preview.entryManager.newFolder"),
                    click: () => {
                        table.options.meta.newDirectory();
                    },
                },
                {
                    label: i18next.t("preview.entryManager.rename"),
                    click: () => {
                        table.options.meta.updateName(finfo.path, finfo.isdir);
                    },
                },
                {
                    type: "separator",
                },
                {
                    label: i18next.t("preview.copyFileName"),
                    click: () => fireAndForget(() => navigator.clipboard.writeText(fileName)),
                },
                {
                    label: i18next.t("preview.copyFullFileName"),
                    click: () => fireAndForget(() => navigator.clipboard.writeText(finfo.path)),
                },
                {
                    label: i18next.t("preview.copyFileNameShellQuoted"),
                    click: () => fireAndForget(() => navigator.clipboard.writeText(shellQuote([fileName]))),
                },
                {
                    label: i18next.t("preview.copyFullFileNameShellQuoted"),
                    click: () => fireAndForget(() => navigator.clipboard.writeText(shellQuote([finfo.path]))),
                },
            ];
            addOpenMenuItems(menu, conn, finfo);

            menu.push(
                {
                    type: "separator",
                },
                {
                    label: i18next.t("favorites.add"),
                    click: () => {
                        const favoritesModel = FavoritesModel.getInstance();
                        favoritesModel.addFavorite(finfo.path, fileName, undefined, conn);
                        window.dispatchEvent(new Event("favorites-updated"));
                    },
                }
            );

            menu.push(
                {
                    type: "separator",
                },
                {
                    label: i18next.t("common.delete"),
                    click: () => handleFileDelete(model, finfo.path, false, setErrorMsg),
                }
            );
            ContextMenuModel.showContextMenu(menu, e);
        },
        [setRefreshVersion, conn]
    );

    const allRows = table.getRowModel().flatRows;
    const dotdotRow = allRows.find((row) => row.getValue("name") === "..");
    const otherRows = allRows.filter((row) => row.getValue("name") !== "..");

    return (
        <div className="dir-table-body" ref={bodyRef}>
            {!isExplorerView && (searchActive || search !== "") && (
                <div className="flex rounded-[3px] py-1 px-2 bg-warning text-black" ref={warningBoxRef}>
                    <span>
                        {search === ""
                            ? i18next.t("preview.directory.search.typeToSearch")
                            : i18next.t("preview.directory.search.searchingFor", { search })}
                    </span>
                    <div
                        className="ml-auto bg-transparent flex justify-center items-center flex-col p-0.5 rounded-md hover:bg-hoverbg focus:bg-hoverbg focus-within:bg-hoverbg cursor-pointer"
                        onClick={() => {
                            setSearch("");
                            globalStore.set(model.directorySearchActive, false);
                        }}
                    >
                        <i className="fa-solid fa-xmark" />
                        <input
                            type="text"
                            value={search}
                            onChange={() => {}}
                            className="w-0 h-0 opacity-0 p-0 border-none pointer-events-none"
                        />
                    </div>
                </div>
            )}
            <div className="dir-table-body-scroll-box">
                <div className="dummy dir-table-body-row" ref={dummyLineRef}>
                    <div className="dir-table-body-cell">..</div>
                </div>
                {dotdotRow && (
                    <TableRow
                        model={model}
                        row={dotdotRow}
                        focusIndex={focusIndex}
                        setFocusIndex={setFocusIndex}
                        setSearch={setSearch}
                        idx={0}
                        handleFileContextMenu={handleFileContextMenu}
                        key="dotdot"
                    />
                )}
                {otherRows.map((row, idx) => (
                    <TableRow
                        model={model}
                        row={row}
                        focusIndex={focusIndex}
                        setFocusIndex={setFocusIndex}
                        setSearch={setSearch}
                        idx={dotdotRow ? idx + 1 : idx}
                        handleFileContextMenu={handleFileContextMenu}
                        key={idx}
                    />
                ))}
            </div>
        </div>
    );
}

type TableRowProps = {
    model: PreviewModel;
    row: Row<FileInfo>;
    focusIndex: number;
    setFocusIndex: (_: number) => void;
    setSearch: (_: string) => void;
    idx: number;
    handleFileContextMenu: (e: any, finfo: FileInfo) => Promise<void>;
};

const TableRow = React.forwardRef(function ({
    model,
    row,
    focusIndex,
    setFocusIndex,
    setSearch,
    idx,
    handleFileContextMenu,
}: TableRowProps) {
    const dirPath = useAtomValue(model.statFilePath);
    const connection = useAtomValue(model.connection);

    const dragItem: DraggedFile = {
        relName: row.getValue("name") as string,
        absParent: dirPath,
        uri: formatRemoteUri(row.getValue("path") as string, connection),
        isDir: row.original.isdir,
    };
    const [_, drag] = useDrag(
        () => ({
            type: "FILE_ITEM",
            canDrag: true,
            item: () => dragItem,
        }),
        [dragItem]
    );

    const dragRef = useCallback(
        (node: HTMLDivElement | null) => {
            drag(node);
        },
        [drag]
    );

    return (
        <div
            className={clsx("dir-table-body-row", { focused: focusIndex === idx })}
            data-rowindex={idx}
            onDoubleClick={() => {
                const newFileName = row.getValue("path") as string;
                model.goHistory(newFileName);
                setSearch("");
                globalStore.set(model.directorySearchActive, false);
            }}
            onClick={() => setFocusIndex(idx)}
            onContextMenu={(e) => handleFileContextMenu(e, row.original)}
            ref={dragRef}
        >
            {row.getVisibleCells().map((cell) => (
                <div
                    className={clsx("dir-table-body-cell", "col-" + cell.column.id)}
                    key={cell.id}
                    style={{ width: `calc(var(--col-${cell.column.id}-size) * 1px)` }}
                >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
            ))}
        </div>
    );
});

const MemoizedTableBody = React.memo(
    TableBody,
    (prev, next) => prev.table.options.data == next.table.options.data
) as typeof TableBody;

interface DirectoryPreviewProps {
    model: PreviewModel;
    searchText?: string;
    setSearchText?: React.Dispatch<React.SetStateAction<string>>;
    onSelectedPathChange?: (path: string, isDir?: boolean) => void;
    viewMode?: DirectoryViewMode;
    setViewMode?: React.Dispatch<React.SetStateAction<DirectoryViewMode>>;
    showQuickViewControls?: boolean;
}

function DirectoryPreview({
    model,
    searchText: searchTextProp,
    setSearchText: setSearchTextProp,
    onSelectedPathChange,
    viewMode: viewModeProp,
    setViewMode: setViewModeProp,
    showQuickViewControls = true,
}: DirectoryPreviewProps) {
    const [internalSearchText, setInternalSearchText] = useState("");
    const searchText = searchTextProp ?? internalSearchText;
    const setSearchText = setSearchTextProp ?? setInternalSearchText;
    const [focusIndex, setFocusIndex] = useState(0);
    const sortingStorageKey = "waveterm-directory-sorting";
    const viewModeStorageKey = "waveterm-directory-viewmode";
    const [internalViewMode, setInternalViewMode] = useState<DirectoryViewMode>(() => {
        try {
            const stored = localStorage.getItem(viewModeStorageKey);
            if (
                stored === "details" ||
                stored === "list" ||
                stored === "smallIcons" ||
                stored === "mediumIcons" ||
                stored === "largeIcons"
            ) {
                return stored;
            }
        } catch {
            // ignore
        }
        return "details";
    });
    const viewMode = viewModeProp ?? internalViewMode;
    const setViewMode = setViewModeProp ?? setInternalViewMode;

    useEffect(() => {
        const handler = (event: Event) => {
            const customEvent = event as CustomEvent<{ blockId?: string; mode?: DirectoryViewMode }>;
            if (customEvent.detail?.blockId !== model.blockId) {
                return;
            }
            const mode = customEvent.detail?.mode;
            if (!mode) {
                return;
            }
            setViewMode(mode);
        };
        window.addEventListener("preview-directory-view-mode", handler as EventListener);
        return () => {
            window.removeEventListener("preview-directory-view-mode", handler as EventListener);
        };
    }, [model.blockId, setViewMode]);

    const [sorting, setSorting] = useState<SortingState>(() => {
        try {
            const stored = localStorage.getItem(sortingStorageKey);
            if (stored) {
                const parsed = JSON.parse(stored) as unknown;
                if (Array.isArray(parsed) && parsed.length > 0) {
                    const first = parsed[0] as any;
                    if (typeof first?.id === "string" && typeof first?.desc === "boolean") {
                        return parsed as SortingState;
                    }
                }
            }
        } catch {
            // ignore
        }
        return [{ id: "name", desc: false }];
    });
    const [unfilteredData, setUnfilteredData] = useState<FileInfo[]>([]);
    const showHiddenFiles = useAtomValue(model.showHiddenFiles);
    const [selectedPath, setSelectedPath] = useState("");
    const [selectedPathIsDir, setSelectedPathIsDir] = useState<boolean | undefined>(undefined);
    const [refreshVersion, setRefreshVersion] = useAtom(model.refreshVersion);
    const conn = useAtomValue(model.connection);
    const blockData = useAtomValue(model.blockAtom);
    const isExplorerView = !!blockData?.meta?.["preview:explorer"];
    const finfo = useAtomValue(model.statFile);
    const dirPath = finfo?.path;
    const setErrorMsg = useSetAtom(model.errorMsgAtom);

    useEffect(() => {
        model.refreshCallback = () => {
            setRefreshVersion((refreshVersion) => refreshVersion + 1);
        };
        return () => {
            model.refreshCallback = null;
        };
    }, [setRefreshVersion]);

    useEffect(() => {
        let cancelled = false;

        fireAndForget(async () => {
            if (!dirPath) {
                if (!cancelled) {
                    setUnfilteredData([]);
                }
                return;
            }

            let entries: FileInfo[] = [];
            try {
                const file = await RpcApi.FileReadCommand(
                    TabRpcClient,
                    {
                        info: {
                            path: await model.formatRemoteUri(dirPath, globalStore.get),
                        },
                    },
                    { timeout: 30000 }
                );

                entries = file.entries ?? [];
                if (file?.info && file.info.dir && file.info?.path !== file.info?.dir) {
                    entries.unshift({
                        name: "..",
                        path: file?.info?.dir,
                        isdir: true,
                        modtime: new Date().getTime(),
                        mimetype: "directory",
                    });
                }
            } catch (e) {
                if (!cancelled) {
                    setErrorMsg({
                        status: "Cannot Read Directory",
                        text: `${e}`,
                    });
                }
            }

            if (!cancelled) {
                setUnfilteredData(entries);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [conn, dirPath, model, refreshVersion, setErrorMsg]);

    const effectiveSearchText = isExplorerView ? "" : searchText;
    const filteredData = useMemo(
        () =>
            unfilteredData?.filter((fileInfo) => {
                if (fileInfo.name == null) {
                    console.log("fileInfo.name is null", fileInfo);
                    return false;
                }
                if (!showHiddenFiles && fileInfo.name.startsWith(".") && fileInfo.name != "..") {
                    return false;
                }
                return fileInfo.name.toLowerCase().includes(effectiveSearchText.toLowerCase());
            }) ?? [],
        [effectiveSearchText, showHiddenFiles, unfilteredData]
    );

    useEffect(() => {
        onSelectedPathChange?.(selectedPath, selectedPathIsDir);
    }, [onSelectedPathChange, selectedPath, selectedPathIsDir]);

    useEffect(() => {
        try {
            localStorage.setItem(sortingStorageKey, JSON.stringify(sorting));
        } catch {
            // ignore
        }
    }, [sorting]);

    useEffect(() => {
        try {
            localStorage.setItem(viewModeStorageKey, viewMode);
        } catch {
            // ignore
        }
    }, [viewMode]);

    useEffect(() => {
        model.directoryKeyDownHandler = (waveEvent: WaveKeyboardEvent): boolean => {
            if (!isExplorerView && checkKeyPressed(waveEvent, "Cmd:f")) {
                globalStore.set(model.directorySearchActive, true);
                return true;
            }
            if (!isExplorerView && checkKeyPressed(waveEvent, "Escape")) {
                setSearchText("");
                globalStore.set(model.directorySearchActive, false);
                return;
            }
            if (checkKeyPressed(waveEvent, "ArrowUp")) {
                setFocusIndex((idx) => Math.max(idx - 1, 0));
                return true;
            }
            if (checkKeyPressed(waveEvent, "ArrowDown")) {
                setFocusIndex((idx) => Math.min(idx + 1, filteredData.length - 1));
                return true;
            }
            if (checkKeyPressed(waveEvent, "PageUp")) {
                setFocusIndex((idx) => Math.max(idx - PageJumpSize, 0));
                return true;
            }
            if (checkKeyPressed(waveEvent, "PageDown")) {
                setFocusIndex((idx) => Math.min(idx + PageJumpSize, filteredData.length - 1));
                return true;
            }
            if (checkKeyPressed(waveEvent, "Enter")) {
                if (filteredData.length == 0) {
                    return;
                }
                model.goHistory(selectedPath);
                if (!isExplorerView) {
                    setSearchText("");
                    globalStore.set(model.directorySearchActive, false);
                }
                return true;
            }
            if (!isExplorerView && checkKeyPressed(waveEvent, "Backspace")) {
                if (searchText.length == 0) {
                    return true;
                }
                setSearchText((current) => current.slice(0, -1));
                return true;
            }
            if (
                checkKeyPressed(waveEvent, "Space") &&
                effectiveSearchText == "" &&
                PLATFORM == PlatformMacOS &&
                !blockData?.meta?.connection
            ) {
                getApi().onQuicklook(selectedPath);
                return true;
            }
            if (!isExplorerView && isCharacterKeyEvent(waveEvent)) {
                setSearchText((current) => current + waveEvent.key.toLowerCase());
                return true;
            }
            return false;
        };
        return () => {
            model.directoryKeyDownHandler = null;
        };
    }, [blockData?.meta?.connection, effectiveSearchText, filteredData, isExplorerView, model, searchText, selectedPath, setSearchText]);

    useEffect(() => {
        if (filteredData.length != 0 && focusIndex > filteredData.length - 1) {
            setFocusIndex(filteredData.length - 1);
        }
    }, [filteredData]);

    const entryManagerPropsAtom = useState(
        atom<EntryManagerOverlayProps>(null) as PrimitiveAtom<EntryManagerOverlayProps>
    )[0];
    const [entryManagerProps, setEntryManagerProps] = useAtom(entryManagerPropsAtom);

    const { refs, floatingStyles, context } = useFloating({
        open: !!entryManagerProps,
        onOpenChange: () => setEntryManagerProps(undefined),
        middleware: [offset(({ rects }) => -rects.reference.height / 2 - rects.floating.height / 2)],
    });

    const handleDropOperation = useCallback(
        async (operation: DragDropOperation, data: CommandFileCopyData, isDir: boolean) => {
            try {
                if (isDir) {
                    data.opts.recursive = true;
                }
                if (operation === "move") {
                    await RpcApi.FileMoveCommand(TabRpcClient, data, { timeout: data.opts.timeout });
                } else {
                    await RpcApi.FileCopyCommand(TabRpcClient, data, { timeout: data.opts.timeout });
                }
            } catch (e) {
                console.warn(`${operation} failed:`, e);
                const opError = `${e}`;
                const allowRetry = opError.includes(overwriteError) || opError.includes(mergeError);
                let errorMsg: ErrorMsg;
                if (allowRetry) {
                    const overwriteTextKey =
                        operation === "move" ? "explorer.confirmOverwrite.moveText" : "explorer.confirmOverwrite.copyText";
                    errorMsg = {
                        status: i18next.t("explorer.confirmOverwrite.title"),
                        text: i18next.t(overwriteTextKey),
                        level: "warning",
                        buttons: [
                            {
                                text:
                                    operation === "move"
                                        ? i18next.t("explorer.confirmOverwrite.deleteThenMove")
                                        : i18next.t("explorer.confirmOverwrite.deleteThenCopy"),
                                onClick: () => {
                                    fireAndForget(async () => {
                                        data.opts.overwrite = true;
                                        await handleDropOperation(operation, data, isDir);
                                    });
                                },
                            },
                            {
                                text: i18next.t("explorer.confirmOverwrite.sync"),
                                onClick: () => {
                                    fireAndForget(async () => {
                                        data.opts.merge = true;
                                        await handleDropOperation(operation, data, isDir);
                                    });
                                },
                            },
                        ],
                    };
                } else {
                    errorMsg = {
                        status:
                            operation === "move"
                                ? i18next.t("explorer.operationFailed.moveTitle")
                                : i18next.t("explorer.operationFailed.copyTitle"),
                        text: opError,
                        level: "error",
                    };
                }
                setErrorMsg(errorMsg);
            }
            model.refreshCallback();
        },
        [model.refreshCallback, setErrorMsg]
    );

    const [, drop] = useDrop(
        () => ({
            accept: "FILE_ITEM", //a name of file drop type
            canDrop: (_, monitor) => {
                const dragItem = monitor.getItem<DraggedFile>();
                // drop if not current dir is the parent directory of the dragged item
                // requires absolute path
                if (monitor.isOver({ shallow: false }) && dragItem.absParent !== dirPath) {
                    return true;
                }
                return false;
            },
            drop: async (draggedFile: DraggedFile, monitor) => {
                if (!monitor.didDrop()) {
                    const timeoutYear = 31536000000; // one year
                    const opts: FileCopyOpts = {
                        timeout: timeoutYear,
                    };
                    const desturi = await model.formatRemoteUri(dirPath, globalStore.get);
                    const data: CommandFileCopyData = {
                        srcuri: draggedFile.uri,
                        desturi,
                        opts,
                    };
                    if (draggedFile.isDir) {
                        data.opts.recursive = true;
                    }

                    const operation = determineDragDropOperation(data.srcuri, data.desturi);
                    const srcInfo = parseWshUri(data.srcuri);
                    const destInfo = parseWshUri(data.desturi);
                    if (draggedFile.isDir && srcInfo && destInfo && isPathEqualOrDescendant(srcInfo.path, destInfo.path)) {
                        setErrorMsg({
                            status: i18next.t("explorer.dnd.invalidTarget.title"),
                            text: i18next.t("explorer.dnd.invalidTarget.text"),
                            level: "error",
                        });
                        return;
                    }

                    const confirmTitleKey =
                        operation === "move" ? "explorer.confirm.move.title" : "explorer.confirm.copy.title";
                    const confirmTextKey =
                        operation === "move" ? "explorer.confirm.move.text" : "explorer.confirm.copy.text";
                    setErrorMsg({
                        status: i18next.t(confirmTitleKey),
                        text: i18next.t(confirmTextKey, { name: draggedFile.relName, dest: dirPath }),
                        level: "warning",
                        showDismiss: false,
                        buttons: [
                            {
                                text: i18next.t("common.cancel"),
                                onClick: () => {},
                            },
                            {
                                text: i18next.t("common.ok"),
                                onClick: () => {
                                    fireAndForget(async () => {
                                        await handleDropOperation(operation, data, draggedFile.isDir);
                                    });
                                },
                            },
                        ],
                    });
                }
            },
            // TODO: mabe add a hover option?
        }),
        [dirPath, handleDropOperation, model.formatRemoteUri, setErrorMsg]
    );

    useEffect(() => {
        drop(refs.reference);
    }, [refs.reference]);

    const dismiss = useDismiss(context);
    const { getReferenceProps, getFloatingProps } = useInteractions([dismiss]);

    const newFile = useCallback(() => {
        setEntryManagerProps({
            entryManagerType: EntryManagerType.NewFile,
            onSave: (newName: string) => {
                console.log(`newFile: ${newName}`);
                fireAndForget(async () => {
                    await RpcApi.FileCreateCommand(
                        TabRpcClient,
                        {
                            info: {
                                path: await model.formatRemoteUri(`${dirPath}/${newName}`, globalStore.get),
                            },
                        },
                        null
                    );
                    model.refreshCallback();
                });
                setEntryManagerProps(undefined);
            },
        });
    }, [dirPath]);
    const newDirectory = useCallback(() => {
        setEntryManagerProps({
            entryManagerType: EntryManagerType.NewDirectory,
            onSave: (newName: string) => {
                console.log(`newDirectory: ${newName}`);
                fireAndForget(async () => {
                    await RpcApi.FileMkdirCommand(TabRpcClient, {
                        info: {
                            path: await model.formatRemoteUri(`${dirPath}/${newName}`, globalStore.get),
                        },
                    });
                    model.refreshCallback();
                });
                setEntryManagerProps(undefined);
            },
        });
    }, [dirPath]);

    const handleFileContextMenu = useCallback(
        (e: any) => {
            e.preventDefault();
            e.stopPropagation();
            const sortId = sorting?.[0]?.id ?? "name";
            const sortDesc = sorting?.[0]?.desc ?? false;
            const menu: ContextMenuItem[] = [
                {
                    label: i18next.t("explorer.context.view"),
                    submenu: [
                        {
                            label: i18next.t("explorer.view.details"),
                            type: "radio",
                            checked: viewMode === "details",
                            click: () => setViewMode("details"),
                        },
                        {
                            label: i18next.t("explorer.view.list"),
                            type: "radio",
                            checked: viewMode === "list",
                            click: () => setViewMode("list"),
                        },
                        {
                            type: "separator",
                        },
                        {
                            label: i18next.t("explorer.view.smallIcons"),
                            type: "radio",
                            checked: viewMode === "smallIcons",
                            click: () => setViewMode("smallIcons"),
                        },
                        {
                            label: i18next.t("explorer.view.mediumIcons"),
                            type: "radio",
                            checked: viewMode === "mediumIcons",
                            click: () => setViewMode("mediumIcons"),
                        },
                        {
                            label: i18next.t("explorer.view.largeIcons"),
                            type: "radio",
                            checked: viewMode === "largeIcons",
                            click: () => setViewMode("largeIcons"),
                        },
                    ],
                },
                {
                    label: i18next.t("explorer.context.sortBy"),
                    submenu: [
                        {
                            label: i18next.t("explorer.sort.name"),
                            type: "radio",
                            checked: sortId === "name",
                            click: () => setSorting([{ id: "name", desc: sortDesc }]),
                        },
                        {
                            label: i18next.t("explorer.sort.dateModified"),
                            type: "radio",
                            checked: sortId === "modtime",
                            click: () => setSorting([{ id: "modtime", desc: sortDesc }]),
                        },
                        {
                            label: i18next.t("explorer.sort.type"),
                            type: "radio",
                            checked: sortId === "mimetype",
                            click: () => setSorting([{ id: "mimetype", desc: sortDesc }]),
                        },
                        {
                            label: i18next.t("explorer.sort.size"),
                            type: "radio",
                            checked: sortId === "size",
                            click: () => setSorting([{ id: "size", desc: sortDesc }]),
                        },
                        {
                            type: "separator",
                        },
                        {
                            label: i18next.t("explorer.sort.ascending"),
                            type: "radio",
                            checked: !sortDesc,
                            click: () => setSorting([{ id: sortId, desc: false }]),
                        },
                        {
                            label: i18next.t("explorer.sort.descending"),
                            type: "radio",
                            checked: sortDesc,
                            click: () => setSorting([{ id: sortId, desc: true }]),
                        },
                    ],
                },
                {
                    type: "separator",
                },
                {
                    label: i18next.t("preview.entryManager.newFile"),
                    click: () => {
                        newFile();
                    },
                },
                {
                    label: i18next.t("preview.entryManager.newFolder"),
                    click: () => {
                        newDirectory();
                    },
                },
            ];
            addOpenMenuItems(menu, conn, finfo);

            if (dirPath) {
                const dirName = dirPath.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1);
                menu.push(
                    {
                        type: "separator",
                    },
                    {
                        label: i18next.t("favorites.addCurrentFolder"),
                        click: () => {
                            const favoritesModel = FavoritesModel.getInstance();
                            favoritesModel.addFavorite(dirPath, dirName, undefined, conn);
                            window.dispatchEvent(new Event("favorites-updated"));
                        },
                    },
                );
            }

            ContextMenuModel.showContextMenu(menu, e);
        },
        [blockData?.meta, conn, dirPath, newDirectory, newFile, setSorting, sorting, viewMode]
    );

    return (
        <Fragment>
            <div
                ref={refs.setReference}
                className={clsx(
                    "dir-table-container relative",
                    viewMode === "list" && "dir-view-list",
                    viewMode === "smallIcons" && "dir-view-icons dir-view-icons-sm",
                    viewMode === "mediumIcons" && "dir-view-icons dir-view-icons-md",
                    viewMode === "largeIcons" && "dir-view-icons dir-view-icons-lg"
                )}
                onChangeCapture={(e) => {
                    if (isExplorerView) {
                        return;
                    }
                    const event = e as React.ChangeEvent<HTMLInputElement>;
                    if (!entryManagerProps) {
                        setSearchText(event.target.value.toLowerCase());
                    }
                }}
                {...getReferenceProps()}
                onContextMenu={(e) => handleFileContextMenu(e)}
                onClick={() => setEntryManagerProps(undefined)}
            >
                <DirectoryTable
                    model={model}
                    data={filteredData}
                    search={effectiveSearchText}
                    viewMode={viewMode}
                    sorting={sorting}
                    setSorting={setSorting}
                    focusIndex={focusIndex}
                    setFocusIndex={setFocusIndex}
                    setSearch={setSearchText}
                    setSelectedPath={(path, isDir) => {
                        setSelectedPath(path);
                        setSelectedPathIsDir(isDir);
                    }}
                    setRefreshVersion={setRefreshVersion}
                    entryManagerOverlayPropsAtom={entryManagerPropsAtom}
                    newFile={newFile}
                    newDirectory={newDirectory}
                />
            </div>
            {entryManagerProps && (
                <EntryManagerOverlay
                    {...entryManagerProps}
                    forwardRef={refs.setFloating}
                    style={floatingStyles}
                    getReferenceProps={getFloatingProps}
                    onCancel={() => setEntryManagerProps(undefined)}
                />
            )}
        </Fragment>
    );
}

export { DirectoryPreview };

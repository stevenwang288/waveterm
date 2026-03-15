// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { computeConnColorNum } from "@/app/block/blockutil";
import {
    getTerminalConnectionDisplayLabel,
    getTerminalConnectionLabelPresentation,
} from "@/app/block/connectionbutton-label";
import { buildTerminalLabelContextMenu } from "@/app/block/connectionbutton-menu";
import { ContextMenuModel } from "@/app/store/contextmenu";
import { createBlock, getConnStatusAtom, getLocalHostDisplayNameAtom, pushNotification, recordTEvent } from "@/app/store/global";
import { IconButton } from "@/element/iconbutton";
import * as util from "@/util/util";
import * as jotai from "jotai";
import * as React from "react";
import { useTranslation } from "react-i18next";
import DotsSvg from "../asset/dots-anim-4.svg";

interface ConnectionButtonProps {
    connection: string;
    changeConnModalAtom: jotai.PrimitiveAtom<boolean>;
    isTerminalBlock?: boolean;
    compact?: boolean;
    terminalLabel?: string;
    terminalCwd?: string;
    unread?: boolean;
    onTerminalLabelDoubleClick?: () => void;
}

export const ConnectionButton = React.memo(
    React.forwardRef<HTMLDivElement, ConnectionButtonProps>(
        ({
            connection,
            changeConnModalAtom,
            isTerminalBlock,
            compact,
            terminalLabel,
            terminalCwd,
            unread,
            onTerminalLabelDoubleClick,
        }: ConnectionButtonProps, ref) => {
            const { t } = useTranslation();
            const [, setConnModalOpen] = jotai.useAtom(changeConnModalAtom);
            const clickTimeoutRef = React.useRef<number | null>(null);
            const isLocal = util.isLocalConnName(connection);
            const connStatusAtom = getConnStatusAtom(connection);
            const connStatus = jotai.useAtomValue(connStatusAtom);
            const localName = jotai.useAtomValue(getLocalHostDisplayNameAtom());
            const terminalLabelTrimmed = isTerminalBlock && typeof terminalLabel === "string" ? terminalLabel.trim() : "";
            const terminalCwdTrimmed = isTerminalBlock && typeof terminalCwd === "string" ? terminalCwd.trim() : "";
            const terminalLabelPresentation = isTerminalBlock ? getTerminalConnectionLabelPresentation(isLocal) : null;
            let showDisconnectedSlash = false;
            let connIconElem: React.ReactNode = null;
            const connColorNum = computeConnColorNum(connStatus);
            let color = `var(--conn-icon-color-${connColorNum})`;
            const openConnectionMenu = React.useCallback(() => {
                recordTEvent("action:other", { "action:type": "conndropdown", "action:initiator": "mouse" });
                setConnModalOpen(true);
            }, [setConnModalOpen]);
            const copyTerminalLabel = React.useCallback(async () => {
                if (!isTerminalBlock || util.isBlank(terminalLabelTrimmed)) {
                    return;
                }
                await navigator.clipboard.writeText(terminalLabelTrimmed);
                const now = Date.now();
                pushNotification({
                    icon: "copy",
                    title: t("common.copied"),
                    message: "",
                    timestamp: new Date(now).toISOString(),
                    expiration: now + 1200,
                    type: "info",
                });
            }, [isTerminalBlock, t, terminalLabelTrimmed]);
            const clickHandler = React.useCallback(() => {
                if (isTerminalBlock && onTerminalLabelDoubleClick) {
                    if (clickTimeoutRef.current != null) {
                        window.clearTimeout(clickTimeoutRef.current);
                    }
                    clickTimeoutRef.current = window.setTimeout(() => {
                        clickTimeoutRef.current = null;
                        openConnectionMenu();
                    }, 220);
                    return;
                }
                openConnectionMenu();
            }, [isTerminalBlock, onTerminalLabelDoubleClick, openConnectionMenu]);
            const handleContainerDoubleClick = React.useCallback(
                (e: React.MouseEvent<HTMLDivElement>) => {
                    if (!isTerminalBlock || !onTerminalLabelDoubleClick) {
                        return;
                    }
                    if (clickTimeoutRef.current != null) {
                        window.clearTimeout(clickTimeoutRef.current);
                        clickTimeoutRef.current = null;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    onTerminalLabelDoubleClick();
                },
                [isTerminalBlock, onTerminalLabelDoubleClick]
            );
            const handleTerminalLabelClick = React.useCallback(
                (e: React.MouseEvent<HTMLDivElement>) => {
                    if (!isTerminalBlock || util.isBlank(terminalLabelTrimmed)) {
                        return;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    if (clickTimeoutRef.current != null) {
                        window.clearTimeout(clickTimeoutRef.current);
                    }
                    clickTimeoutRef.current = window.setTimeout(() => {
                        clickTimeoutRef.current = null;
                        util.fireAndForget(copyTerminalLabel());
                    }, onTerminalLabelDoubleClick ? 220 : 0);
                },
                [copyTerminalLabel, isTerminalBlock, onTerminalLabelDoubleClick, terminalLabelTrimmed]
            );
            React.useEffect(() => {
                return () => {
                    if (clickTimeoutRef.current != null) {
                        window.clearTimeout(clickTimeoutRef.current);
                        clickTimeoutRef.current = null;
                    }
                };
            }, []);
            let titleText = null;
            let shouldSpin = false;
            let connDisplayName: string = null;
            let extraDisplayNameClassName = "";
            if (isLocal) {
                color = "var(--color-secondary)";
                const localDefaultName = connection === "local:gitbash" ? "Git Bash" : localName;
                if (connection === "local:gitbash") {
                    titleText = t("connection.connectedToGitBash");
                } else {
                    titleText = localName
                        ? t("connection.connectedToLocalMachineWithName", { name: localName })
                        : t("connection.connectedToLocalMachine");
                }
                connDisplayName = localDefaultName;

                connIconElem = (
                    <i
                        className={util.cn(util.makeIconClass("laptop", false), "fa-stack-1x mr-[2px]")}
                        style={{ color: color }}
                    />
                );
            } else {
                titleText = t("connection.connectedTo", { conn: connection });
                let iconName = "arrow-right-arrow-left";
                let iconSvg = null;
                if (connStatus?.status == "connecting") {
                    color = "var(--warning-color)";
                    titleText = t("connection.connectingTo", { conn: connection });
                    shouldSpin = false;
                    iconSvg = (
                        <div className="relative top-[5px] left-[9px] [&_svg]:fill-warning">
                            <DotsSvg />
                        </div>
                    );
                } else if (connStatus?.status == "error") {
                    color = "var(--error-color)";
                    if (connStatus?.error != null) {
                        titleText = t("connection.errorConnectingToWithError", {
                            conn: connection,
                            error: connStatus.error,
                        });
                    } else {
                        titleText = t("connection.errorConnectingTo", { conn: connection });
                    }
                    showDisconnectedSlash = true;
                } else if (!connStatus?.connected) {
                    color = "var(--grey-text-color)";
                    titleText = t("connection.disconnectedFrom", { conn: connection });
                    showDisconnectedSlash = true;
                } else if (connStatus?.connhealthstatus === "degraded" || connStatus?.connhealthstatus === "stalled") {
                    color = "var(--warning-color)";
                    iconName = "signal-bars-slash";
                    if (connStatus.connhealthstatus === "degraded") {
                        titleText = "Connection degraded: " + connection;
                    } else {
                        titleText = "Connection stalled: " + connection;
                    }
                }
                if (iconSvg != null) {
                    connIconElem = iconSvg;
                } else {
                    connIconElem = (
                        <i
                            className={util.cn(util.makeIconClass(iconName, false), "fa-stack-1x mr-[2px]")}
                            style={{ color: color }}
                        />
                    );
                }

            }

            if (isTerminalBlock) {
                const terminalDisplayLabel = getTerminalConnectionDisplayLabel({
                    isLocal,
                    connection,
                    connectionDisplayName: connDisplayName || connection,
                    terminalLabel: terminalLabelTrimmed,
                });
                titleText = terminalDisplayLabel || titleText;
                connDisplayName = terminalDisplayLabel;
                extraDisplayNameClassName = terminalLabelPresentation?.className ?? "";
            }

            const wshProblem = connection && !connStatus?.wshenabled && connStatus?.status == "connected";
            const showNoWshButton = wshProblem && !isLocal && !isTerminalBlock;

            const handleTerminalLabelContextMenu = React.useCallback(
                (e: React.MouseEvent) => {
                    if (!isTerminalBlock || util.isBlank(terminalLabelTrimmed)) {
                        return;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    const menu = buildTerminalLabelContextMenu({
                        connection,
                        terminalCwd: terminalCwdTrimmed,
                        terminalLabel: terminalLabelTrimmed,
                        t,
                        createTermBlock: createBlock,
                        copyText: (text) => util.fireAndForget(() => navigator.clipboard.writeText(text)),
                    });
                    ContextMenuModel.showContextMenu(menu, e);
                },
                [connection, isTerminalBlock, t, terminalCwdTrimmed, terminalLabelTrimmed]
            );

            return (
                <>
                    <div
                        ref={ref}
                        className={util.cn(
                            "group flex items-center flex-nowrap overflow-hidden text-ellipsis min-w-0 font-normal text-primary rounded-sm",
                            "hover:bg-highlightbg cursor-pointer",
                            unread && "connection-unread",
                            isTerminalBlock && !compact && "flex-1",
                            compact && "w-7 h-7 justify-center"
                        )}
                        onClick={clickHandler}
                        onDoubleClick={handleContainerDoubleClick}
                        title={titleText}
                    >
                        {connIconElem != null && (
                            <span
                                className={util.cn(
                                    "fa-stack shrink-0 overflow-hidden",
                                    shouldSpin ? "fa-spin" : null
                                )}
                            >
                                {connIconElem}
                                <i
                                    className={util.cn(
                                        "fa-slash fa-solid fa-stack-1x mr-[2px] [text-shadow:0_1px_black,0_1.5px_black]",
                                        showDisconnectedSlash ? "opacity-100" : "opacity-0"
                                    )}
                                    style={{ color: color }}
                                />
                            </span>
                        )}
                        {!compact &&
                            (connDisplayName ? (
                                isTerminalBlock && terminalLabelPresentation?.align === "right" ? (
                                    <div
                                        className={util.cn(
                                            "flex flex-1 min-w-0 justify-end pr-1",
                                            extraDisplayNameClassName
                                        )}
                                    >
                                        <div
                                            className="connection-terminal-label ellipsis max-w-full cursor-copy"
                                            onClick={handleTerminalLabelClick}
                                            onDoubleClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                onTerminalLabelDoubleClick?.();
                                            }}
                                            onContextMenu={handleTerminalLabelContextMenu}
                                        >
                                            {connDisplayName}
                                        </div>
                                    </div>
                                ) : isTerminalBlock ? (
                                    <div
                                        className={util.cn(
                                            "flex-1 min-w-0 overflow-hidden pr-1 ellipsis cursor-copy",
                                            extraDisplayNameClassName
                                        )}
                                        onClick={handleTerminalLabelClick}
                                        onDoubleClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            onTerminalLabelDoubleClick?.();
                                        }}
                                        onContextMenu={handleTerminalLabelContextMenu}
                                    >
                                        {connDisplayName}
                                    </div>
                                ) : (
                                    <div
                                        className={util.cn(
                                            "flex-1 min-w-0 overflow-hidden pr-1 ellipsis",
                                            extraDisplayNameClassName
                                        )}
                                    >
                                        {connDisplayName}
                                    </div>
                                )
                            ) : isLocal || isTerminalBlock ? null : (
                                <div
                                    className={util.cn(
                                        "flex-1 min-w-0 overflow-hidden pr-1 ellipsis",
                                        isTerminalBlock && "connection-terminal-label cursor-copy"
                                    )}
                                    onClick={isTerminalBlock ? handleTerminalLabelClick : undefined}
                                    onDoubleClick={
                                        isTerminalBlock
                                            ? (e) => {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  onTerminalLabelDoubleClick?.();
                                              }
                                            : undefined
                                    }
                                >
                                    {connection}
                                </div>
                            ))}
                    </div>
                    {showNoWshButton && (
                        <IconButton
                            decl={{
                                elemtype: "iconbutton",
                                icon: "link-slash",
                                title: t("connection.wshNotInstalled"),
                            }}
                        />
                    )}
                </>
            );
        }
    )
);
ConnectionButton.displayName = "ConnectionButton";

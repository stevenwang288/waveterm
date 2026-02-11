// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { computeConnColorNum } from "@/app/block/blockutil";
import { getConnStatusAtom, getLocalHostDisplayNameAtom, recordTEvent } from "@/app/store/global";
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
            let showDisconnectedSlash = false;
            let connIconElem: React.ReactNode = null;
            const connColorNum = computeConnColorNum(connStatus);
            let color = `var(--conn-icon-color-${connColorNum})`;
            const openConnectionMenu = React.useCallback(() => {
                recordTEvent("action:other", { "action:type": "conndropdown", "action:initiator": "mouse" });
                setConnModalOpen(true);
            }, [setConnModalOpen]);
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
                if (isTerminalBlock) {
                    const labelOverride = typeof terminalLabel === "string" ? terminalLabel.trim() : "";
                    connDisplayName = util.isBlank(labelOverride) ? localDefaultName : labelOverride;
                    if (!util.isBlank(labelOverride)) {
                        titleText = labelOverride;
                    }
                    extraDisplayNameClassName = "text-muted group-hover:text-secondary";
                }
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

            const wshProblem = connection && !connStatus?.wshenabled && connStatus?.status == "connected";
            const showNoWshButton = wshProblem && !isLocal;

            return (
                <>
                    <div
                        ref={ref}
                        className={util.cn(
                            "group flex items-center flex-nowrap overflow-hidden text-ellipsis min-w-0 font-normal text-primary rounded-sm hover:bg-highlightbg cursor-pointer",
                            unread && "connection-unread",
                            compact && "w-7 h-7 justify-center"
                        )}
                        onClick={clickHandler}
                        onDoubleClick={handleContainerDoubleClick}
                        title={titleText}
                    >
                        <span
                            className={util.cn(
                                "fa-stack flex-[1_1_auto] overflow-hidden",
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
                        {!compact &&
                            (connDisplayName ? (
                                <div
                                    className={util.cn(
                                        "flex-[1_2_auto] overflow-hidden pr-1 ellipsis",
                                        extraDisplayNameClassName,
                                        isTerminalBlock && "connection-terminal-label"
                                    )}
                                    onClick={
                                        isTerminalBlock
                                            ? (e) => {
                                                  e.stopPropagation();
                                              }
                                            : undefined
                                    }
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
                                    {connDisplayName}
                                </div>
                            ) : isLocal ? null : (
                                <div
                                    className={util.cn(
                                        "flex-[1_2_auto] overflow-hidden pr-1 ellipsis",
                                        isTerminalBlock && "connection-terminal-label"
                                    )}
                                    onClick={
                                        isTerminalBlock
                                            ? (e) => {
                                                  e.stopPropagation();
                                              }
                                            : undefined
                                    }
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

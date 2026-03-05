// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { ClientModel } from "@/app/store/client-model";
import { GlobalModel } from "@/app/store/global-model";
import { getTabModelByTabId, TabModelContext } from "@/app/store/tab-model";
import { Workspace } from "@/app/workspace/workspace";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { ContextMenuModel } from "@/store/contextmenu";
import { modalsModel } from "@/store/modalmodel";
import {
    atoms,
    createBlock,
    getApi,
    getSettingsPrefixAtom,
    globalStore,
    isDev,
    removeFlashError,
} from "@/store/global";
import { openCliLayoutInNewTab, openWallInNewTab } from "@/util/clilayout";
import { getEnv } from "@/util/getenv";
import { appHandleKeyDown, keyboardMouseDownHandler } from "@/store/keymodel";
import * as services from "@/store/services";
import { getElemAsStr } from "@/util/focusutil";
import * as keyutil from "@/util/keyutil";
import { PLATFORM } from "@/util/platformutil";
import * as util from "@/util/util";
import clsx from "clsx";
import debug from "debug";
import { Provider, useAtomValue, useSetAtom } from "jotai";
import "overlayscrollbars/overlayscrollbars.css";
import { Fragment, useEffect, useState } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { AppBackground } from "./app-bg";
import { initAccentColorFromStorage } from "./element/accent-color";
import { initLogoColorFromStorage } from "./element/logo-color";
import { CenteredDiv } from "./element/quickelems";
import { NotificationBubbles } from "./notification/notificationbubbles";
import { useTranslation } from "react-i18next";
import "./i18n"; // Import i18n config

import "./app.scss";

// tailwindsetup.css should come *after* app.scss (don't remove the newline above otherwise prettier will reorder these imports)
import "../tailwindsetup.css";

const dlog = debug("wave:app");
const focusLog = debug("wave:focus");

const App = ({ onFirstRender }: { onFirstRender: () => void }) => {
    const tabId = useAtomValue(atoms.staticTabId);
    useEffect(() => {
        initAccentColorFromStorage();
        initLogoColorFromStorage();
        onFirstRender();
    }, []);
    return (
        <Provider store={globalStore}>
            <TabModelContext.Provider value={getTabModelByTabId(tabId)}>
                <AppInner />
            </TabModelContext.Provider>
        </Provider>
    );
};

function isContentEditableBeingEdited(): boolean {
    const activeElement = document.activeElement;
    return (
        activeElement &&
        activeElement.getAttribute("contenteditable") !== null &&
        activeElement.getAttribute("contenteditable") !== "false"
    );
}

function canEnablePaste(): boolean {
    const activeElement = document.activeElement;
    return activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA" || isContentEditableBeingEdited();
}

function canEnableCopy(): boolean {
    const sel = window.getSelection();
    return !util.isBlank(sel?.toString());
}

function canEnableCut(): boolean {
    const sel = window.getSelection();
    if (document.activeElement?.classList.contains("xterm-helper-textarea")) {
        return false;
    }
    return !util.isBlank(sel?.toString()) && canEnablePaste();
}

async function getClipboardURL(): Promise<URL> {
    try {
        const clipboardText = await navigator.clipboard.readText();
        if (clipboardText == null) {
            return null;
        }
        const url = new URL(clipboardText);
        if (!url.protocol.startsWith("http")) {
            return null;
        }
        return url;
    } catch (e) {
        return null;
    }
}

async function handleContextMenu(e: React.MouseEvent<HTMLDivElement>, t: any) {
    e.preventDefault();
    const canPaste = canEnablePaste();
    const canCopy = canEnableCopy();
    const canCut = canEnableCut();
    const clipboardURL = await getClipboardURL();
    if (!canPaste && !canCopy && !canCut && !clipboardURL) {
        return;
    }
    let menu: ContextMenuItem[] = [];
    if (canCut) {
        menu.push({ label: t("ctx.cut"), role: "cut" });
    }
    if (canCopy) {
        menu.push({ label: t("ctx.copy"), role: "copy" });
    }
    if (canPaste) {
        menu.push({ label: t("ctx.paste"), role: "paste" });
    }
    if (clipboardURL) {
        menu.push({ type: "separator" });
        menu.push({
            label: t("ctx.openClipboardUrl", { host: clipboardURL.hostname }),
            click: () => {
                createBlock({
                    meta: {
                        view: "web",
                        url: clipboardURL.toString(),
                    },
                });
            },
        });
    }
    ContextMenuModel.showContextMenu(menu, e);
}

function shouldRunDevActionOncePerAppRun(actionKey: string): boolean {
    const winKey = `__waveDevActionOnce__:${actionKey}`;
    if ((window as any)?.[winKey]) {
        return false;
    }

    try {
        const api = (window as any)?.api as Partial<ElectronApi> | undefined;
        const runId = typeof (api as any)?.getAppRunId === "function" ? String((api as any).getAppRunId() || "") : "";
        if (runId) {
            const storageKey = `waveterm:dev:action-once:${actionKey}`;
            const prev = localStorage.getItem(storageKey);
            if (prev === runId) {
                return false;
            }
            localStorage.setItem(storageKey, runId);
        }
    } catch {
        // ignore localStorage errors; fall back to per-tab guard
    }

    (window as any)[winKey] = true;
    return true;
}

function AppSettingsUpdater() {
    const windowSettingsAtom = getSettingsPrefixAtom("window");
    const windowSettings = useAtomValue(windowSettingsAtom);
    useEffect(() => {
        const isTransparentOrBlur =
            (windowSettings?.["window:transparent"] || windowSettings?.["window:blur"]) ?? false;
        const opacity = util.boundNumber(windowSettings?.["window:opacity"] ?? 0.8, 0, 1);
        const baseBgColor = windowSettings?.["window:bgcolor"];
        const mainDiv = document.getElementById("main");
        // console.log("window settings", windowSettings, isTransparentOrBlur, opacity, baseBgColor, mainDiv);
        if (isTransparentOrBlur) {
            mainDiv.classList.add("is-transparent");
            if (opacity != null) {
                document.body.style.setProperty("--window-opacity", `${opacity}`);
            } else {
                document.body.style.removeProperty("--window-opacity");
            }
        } else {
            mainDiv.classList.remove("is-transparent");
            document.body.style.removeProperty("--window-opacity");
        }
        if (baseBgColor != null) {
            document.body.style.setProperty("--main-bg-color", baseBgColor);
        } else {
            document.body.style.removeProperty("--main-bg-color");
        }
    }, [windowSettings]);
    return null;
}

function appFocusIn(e: FocusEvent) {
    focusLog("focusin", getElemAsStr(e.target), "<=", getElemAsStr(e.relatedTarget));
}

function appFocusOut(e: FocusEvent) {
    focusLog("focusout", getElemAsStr(e.target), "=>", getElemAsStr(e.relatedTarget));
}

function appSelectionChange(e: Event) {
    const selection = document.getSelection();
    focusLog("selectionchange", getElemAsStr(selection.anchorNode));
}

function AppFocusHandler() {
    return null;

    // for debugging
    useEffect(() => {
        document.addEventListener("focusin", appFocusIn);
        document.addEventListener("focusout", appFocusOut);
        document.addEventListener("selectionchange", appSelectionChange);
        const ivId = setInterval(() => {
            const activeElement = document.activeElement;
            if (activeElement instanceof HTMLElement) {
                focusLog("activeElement", getElemAsStr(activeElement));
            }
        }, 2000);
        return () => {
            document.removeEventListener("focusin", appFocusIn);
            document.removeEventListener("focusout", appFocusOut);
            document.removeEventListener("selectionchange", appSelectionChange);
            clearInterval(ivId);
        };
    });
    return null;
}

const AppKeyHandlers = () => {
    useEffect(() => {
        const staticKeyDownHandler = keyutil.keydownWrapper(appHandleKeyDown);
        document.addEventListener("keydown", staticKeyDownHandler);
        document.addEventListener("mousedown", keyboardMouseDownHandler);

        return () => {
            document.removeEventListener("keydown", staticKeyDownHandler);
            document.removeEventListener("mousedown", keyboardMouseDownHandler);
        };
    }, []);
    return null;
};

const AppRuntimeErrorLogger = () => {
    useEffect(() => {
        const sendRendererLog = (eventType: string, payload: Record<string, unknown>) => {
            const logPayload = {
                eventType,
                ts: new Date().toISOString(),
                ...payload,
            };
            console.error("[renderer-runtime]", logPayload);
            try {
                getApi().sendLog(`[renderer-runtime] ${JSON.stringify(logPayload)}`);
            } catch {
                // ignore bridge errors
            }
        };

        const onWindowError = (event: ErrorEvent) => {
            const runtimeError = event.error as { name?: string; message?: string; stack?: string } | undefined;
            sendRendererLog("window.error", {
                message: event.message ?? runtimeError?.message ?? "",
                filename: event.filename ?? "",
                line: event.lineno ?? 0,
                column: event.colno ?? 0,
                errorName: runtimeError?.name ?? "",
                stack: runtimeError?.stack ?? "",
            });
        };

        const onUnhandledRejection = (event: PromiseRejectionEvent) => {
            const reason = event.reason as { name?: string; message?: string; stack?: string } | unknown;
            if (reason instanceof Error) {
                sendRendererLog("window.unhandledrejection", {
                    message: reason.message,
                    errorName: reason.name,
                    stack: reason.stack ?? "",
                });
                return;
            }
            let fallbackMessage = "";
            try {
                fallbackMessage = typeof reason === "string" ? reason : JSON.stringify(reason ?? {});
            } catch {
                fallbackMessage = String(reason ?? "");
            }
            sendRendererLog("window.unhandledrejection", {
                message: fallbackMessage,
            });
        };

        window.addEventListener("error", onWindowError);
        window.addEventListener("unhandledrejection", onUnhandledRejection);

        return () => {
            window.removeEventListener("error", onWindowError);
            window.removeEventListener("unhandledrejection", onUnhandledRejection);
        };
    }, []);

    return null;
};

const TabIndicatorAutoClearing = () => {
    return null;
};

const FlashError = () => {
    const flashErrors = useAtomValue(atoms.flashErrors);
    const [hoveredId, setHoveredId] = useState<string>(null);
    const [ticker, setTicker] = useState<number>(0);
    const { t } = useTranslation();

    useEffect(() => {
        if (flashErrors.length == 0 || hoveredId != null) {
            return;
        }
        const now = Date.now();
        for (let ferr of flashErrors) {
            if (ferr.expiration == null || ferr.expiration < now) {
                removeFlashError(ferr.id);
            }
        }
        setTimeout(() => setTicker(ticker + 1), 1000);
    }, [flashErrors, ticker, hoveredId]);

    if (flashErrors.length == 0) {
        return null;
    }

    function copyError(id: string) {
        const ferr = flashErrors.find((f) => f.id === id);
        if (ferr == null) {
            return;
        }
        let text = "";
        if (ferr.title != null) {
            text += ferr.title;
        }
        if (ferr.message != null) {
            if (text.length > 0) {
                text += "\n";
            }
            text += ferr.message;
        }
        navigator.clipboard.writeText(text);
    }

    function convertNewlinesToBreaks(text) {
        return text.split("\n").map((part, index) => (
            <Fragment key={index}>
                {part}
                <br />
            </Fragment>
        ));
    }

    return (
        <div className="flash-error-container">
            {flashErrors.map((err, idx) => (
                <div
                    key={idx}
                    className={clsx("flash-error", { hovered: hoveredId === err.id })}
                    onClick={() => copyError(err.id)}
                    onMouseEnter={() => setHoveredId(err.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    title={t("common.clickToCopyErrorMessage")}
                >
                    <div className="flash-error-scroll">
                        {err.title != null ? <div className="flash-error-title">{err.title}</div> : null}
                        {err.message != null ? (
                            <div className="flash-error-message">{convertNewlinesToBreaks(err.message)}</div>
                        ) : null}
                    </div>
                </div>
            ))}
        </div>
    );
};

const AppInner = () => {
    const prefersReducedMotion = useAtomValue(atoms.prefersReducedMotionAtom);
    const client = useAtomValue(ClientModel.getInstance().clientAtom);
    const windowData = useAtomValue(GlobalModel.getInstance().windowDataAtom);
    const isFullScreen = useAtomValue(atoms.isFullScreen);
    const setNewInstallOnboardingOpen = useSetAtom(modalsModel.newInstallOnboardingOpen);
    const { t } = useTranslation();

    useEffect(() => {
        if (!isDev()) {
            return;
        }
        const raw = getEnv("WAVETERM_DEV_SKIP_ONBOARDING");
        const enabled = String(raw ?? "")
            .trim()
            .toLowerCase();
        if (!enabled || (enabled !== "1" && enabled !== "true" && enabled !== "yes" && enabled !== "on")) {
            return;
        }
        if (client == null) {
            return;
        }
        if (!client.tosagreed) {
            services.ClientService.AgreeTos().catch(() => {});
        }
        setNewInstallOnboardingOpen(false);
    }, [client?.tosagreed]);

    useEffect(() => {
        if (!isDev()) {
            return;
        }
        if (client == null || windowData == null) {
            return;
        }
        const raw = getEnv("WAVETERM_DEV_OPEN_SERVERS_PANEL");
        const enabled = String(raw ?? "")
            .trim()
            .toLowerCase();
        if (!enabled || (enabled !== "1" && enabled !== "true" && enabled !== "yes" && enabled !== "on")) {
            return;
        }
        if (!shouldRunDevActionOncePerAppRun("open-servers-panel")) {
            return;
        }
        setTimeout(() => {
            try {
                WorkspaceLayoutModel.getInstance().setSidePanelView("servers", { nofocus: true });
            } catch {
                // ignore
            }
        }, 600);
    }, [client, windowData]);

    useEffect(() => {
        if (!isDev()) {
            return;
        }
        if (client == null || windowData == null) {
            return;
        }
        const raw = getEnv("WAVETERM_DEV_AUTO_OPEN_WALL");
        const enabled = String(raw ?? "")
            .trim()
            .toLowerCase();
        if (!enabled || (enabled !== "1" && enabled !== "true" && enabled !== "yes" && enabled !== "on")) {
            return;
        }
        if (!shouldRunDevActionOncePerAppRun("auto-open-wall")) {
            return;
        }
        const tryOpenWall = async (attempt: number) => {
            try {
                await openWallInNewTab();
            } catch {
                if (attempt >= 15) {
                    return;
                }
                setTimeout(() => void tryOpenWall(attempt + 1), 1000);
            }
        };
        setTimeout(() => void tryOpenWall(0), 2000);
    }, [client, windowData]);

    useEffect(() => {
        if (!isDev()) {
            return;
        }
        if (client == null || windowData == null) {
            return;
        }
        const demoConn = String(getEnv("WAVETERM_DEV_DEMO_GUI_CONN") ?? "").trim();
        if (!demoConn) {
            return;
        }
        if (!shouldRunDevActionOncePerAppRun(`demo-gui-conn:${demoConn}`)) {
            return;
        }
        setTimeout(() => {
            openCliLayoutInNewTab(
                {
                    rows: 1,
                    cols: 1,
                    paths: ["~"],
                    commands: [""],
                    connection: demoConn,
                    slots: [
                        {
                            type: "term",
                            path: "~",
                            command: "",
                            connection: demoConn,
                        },
                    ],
                    updatedTs: Date.now(),
                },
                `GUI ${demoConn}`,
                "dev-gui-demo"
            ).catch(() => {});
        }, 300);
    }, [client, windowData]);

    useEffect(() => {
        if (!isDev()) {
            return;
        }
        if (client == null || windowData == null) {
            return;
        }
        const raw = getEnv("WAVETERM_DEV_CAPTURE_PAGE");
        const enabled = String(raw ?? "")
            .trim()
            .toLowerCase();
        if (!enabled || (enabled !== "1" && enabled !== "true" && enabled !== "yes" && enabled !== "on")) {
            return;
        }
        if (!shouldRunDevActionOncePerAppRun("capture-page")) {
            return;
        }
        const api = (window as any)?.api;
        setTimeout(() => {
            api?.devCapturePageToFile?.("gui-toggle-demo").catch(() => {});
        }, 5000);
        setTimeout(() => {
            api?.devCapturePageToFile?.("gui-toggle-demo-late").catch(() => {});
        }, 12000);
    }, [client, windowData]);

    if (client == null || windowData == null) {
        return (
            <div className="flex flex-col w-full h-full">
                <AppBackground />
                <CenteredDiv>{t("common.invalidConfigurationClientOrWindowNotLoaded")}</CenteredDiv>
            </div>
        );
    }

    return (
        <div
            className={clsx("flex flex-col w-full h-full", PLATFORM, {
                fullscreen: isFullScreen,
                "prefers-reduced-motion": prefersReducedMotion,
            })}
            onContextMenu={(e) => handleContextMenu(e, t)}
        >
            <AppBackground />
            <AppKeyHandlers />
            <AppRuntimeErrorLogger />
            <AppFocusHandler />
            <AppSettingsUpdater />
            <TabIndicatorAutoClearing />
            <DndProvider backend={HTML5Backend}>
                <Workspace />
            </DndProvider>
            <FlashError />
            {isDev() ? <NotificationBubbles></NotificationBubbles> : null}
        </div>
    );
};

export { App };

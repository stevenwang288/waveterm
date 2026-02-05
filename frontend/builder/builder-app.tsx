// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import "@/app/i18n";
import { AppSelectionModal } from "@/builder/app-selection-modal";
import { BuilderWorkspace } from "@/builder/builder-workspace";
import { ModalsRenderer } from "@/app/modals/modalsrenderer";
import { atoms, globalStore, isDev } from "@/store/global";
import { appHandleKeyDown } from "@/store/keymodel";
import * as keyutil from "@/util/keyutil";
import { isBlank } from "@/util/util";
import { Provider, useAtomValue } from "jotai";
import { useEffect } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { useTranslation } from "react-i18next";

type BuilderAppProps = {
    initOpts: BuilderInitOpts;
    onFirstRender: () => void;
};

const BuilderKeyHandlers = () => {
    useEffect(() => {
        const staticKeyDownHandler = keyutil.keydownWrapper(appHandleKeyDown);
        document.addEventListener("keydown", staticKeyDownHandler);

        return () => {
            document.removeEventListener("keydown", staticKeyDownHandler);
        };
    }, []);
    return null;
};

function BuilderAppInner() {
    const builderAppId = useAtomValue(atoms.builderAppId);
    const hasDraftApp = !isBlank(builderAppId) && builderAppId.startsWith("draft/");
    const { t } = useTranslation();

    return (
        <div className="w-full h-full flex flex-col bg-main-bg text-main-text">
            <BuilderKeyHandlers />
            <div
                className="h-9 shrink-0 border-b border-b-border flex items-center justify-center gap-2"
                style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
            >
                {isDev() ? (
                    <div className="text-accent text-xl" title={t("workspace.runningDevBuild")}>
                        <i className="fa fa-brands fa-dev fa-fw" />
                    </div>
                ) : null}
                <div className="text-sm font-medium">
                    {t("builder.title")}
                    {!isBlank(builderAppId) && ` (${builderAppId})`}
                </div>
            </div>
            <DndProvider backend={HTML5Backend}>
                {hasDraftApp ? <BuilderWorkspace /> : <AppSelectionModal />}
            </DndProvider>
            <ModalsRenderer />
        </div>
    );
}

export function BuilderApp({ initOpts, onFirstRender }: BuilderAppProps) {
    useEffect(() => {
        onFirstRender();
    }, []);

    return (
        <Provider store={globalStore}>
            <BuilderAppInner />
        </Provider>
    );
}

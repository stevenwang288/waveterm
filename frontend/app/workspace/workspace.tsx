// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { AIPanel } from "@/app/aipanel/aipanel";
import { ErrorBoundary } from "@/app/element/errorboundary";
import { CenteredDiv } from "@/app/element/quickelems";
import { ModalsRenderer } from "@/app/modals/modalsrenderer";
import { TabBar } from "@/app/tab/tabbar";
import { TabContent } from "@/app/tab/tabcontent";
import { FavoritesPanel } from "@/app/workspace/favorites";
import { GitPanel } from "@/app/workspace/git-panel";
import { LayoutsPanel } from "@/app/workspace/layouts-panel";
import { ServersPanel } from "@/app/workspace/servers-panel";
import { Widgets } from "@/app/workspace/widgets";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { atoms, getApi } from "@/store/global";
import { useAtomValue } from "jotai";
import { memo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
    ImperativePanelGroupHandle,
    ImperativePanelHandle,
    Panel,
    PanelGroup,
    PanelResizeHandle,
} from "react-resizable-panels";

const WorkspaceElem = memo(() => {
    const { t } = useTranslation();
    const workspaceLayoutModel = WorkspaceLayoutModel.getInstance();
    const tabId = useAtomValue(atoms.staticTabId);
    const ws = useAtomValue(atoms.workspace);
    const sidePanelView = useAtomValue(workspaceLayoutModel.panelViewAtom);
    const initialAiPanelPercentage = workspaceLayoutModel.getAIPanelPercentage(window.innerWidth);
    const panelGroupRef = useRef<ImperativePanelGroupHandle>(null);
    const aiPanelRef = useRef<ImperativePanelHandle>(null);
    const panelContainerRef = useRef<HTMLDivElement>(null);
    const aiPanelWrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (aiPanelRef.current && panelGroupRef.current && panelContainerRef.current && aiPanelWrapperRef.current) {
            workspaceLayoutModel.registerRefs(
                aiPanelRef.current,
                panelGroupRef.current,
                panelContainerRef.current,
                aiPanelWrapperRef.current
            );
        }
    }, []);

    useEffect(() => {
        const isVisible = workspaceLayoutModel.getAIPanelVisible();
        getApi().setWaveAIOpen(isVisible && sidePanelView === "ai");
    }, [sidePanelView]);

    useEffect(() => {
        window.addEventListener("resize", workspaceLayoutModel.handleWindowResize);
        return () => window.removeEventListener("resize", workspaceLayoutModel.handleWindowResize);
    }, []);

    return (
        <div className="flex flex-col w-full flex-grow overflow-hidden">
            <TabBar key={ws.oid} workspace={ws} />
            <div ref={panelContainerRef} className="flex flex-row flex-grow overflow-hidden">
                <ErrorBoundary key={tabId}>
                    <PanelGroup
                        direction="horizontal"
                        onLayout={workspaceLayoutModel.handlePanelLayout}
                        ref={panelGroupRef}
                    >
                        <Panel
                            ref={aiPanelRef}
                            collapsible
                            defaultSize={initialAiPanelPercentage}
                            order={1}
                            className="overflow-hidden"
                        >
                            <div ref={aiPanelWrapperRef} className="w-full h-full">
                                {tabId !== "" &&
                                    (sidePanelView === "ai" ? (
                                        <AIPanel />
                                    ) : sidePanelView === "favorites" ? (
                                        <FavoritesPanel />
                                    ) : sidePanelView === "servers" ? (
                                        <ServersPanel />
                                    ) : sidePanelView === "layouts" ? (
                                        <LayoutsPanel />
                                    ) : (
                                        <GitPanel />
                                    ))}
                            </div>
                        </Panel>
                        <PanelResizeHandle className="w-0.5 bg-transparent hover:bg-zinc-500/20 transition-colors" />
                        <Panel order={2} defaultSize={100 - initialAiPanelPercentage}>
                            {tabId === "" ? (
                                <CenteredDiv>{t("workspace.noActiveTab")}</CenteredDiv>
                            ) : (
                                <div className="flex flex-row h-full">
                                    <div className="bg-zinc-950 border-r border-zinc-800">
                                        <Widgets />
                                    </div>
                                    <TabContent key={tabId} tabId={tabId} />
                                </div>
                            )}
                        </Panel>
                    </PanelGroup>
                    <ModalsRenderer />
                </ErrorBoundary>
            </div>
        </div>
    );
});

WorkspaceElem.displayName = "WorkspaceElem";

export { WorkspaceElem as Workspace };

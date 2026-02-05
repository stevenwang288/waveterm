// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import clsx from "clsx";
import { memo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Widgets } from "./widgets";
import { FavoritesPanel } from "./favorites";

type SidebarTab = "widgets" | "favorites";

const RightSidebar = memo(() => {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<SidebarTab>("widgets");

    const handleTabChange = useCallback((tab: SidebarTab) => {
        setActiveTab(tab);
    }, []);

    return (
        <div className="flex flex-row h-full bg-zinc-950 border-l border-zinc-800">
            {/* Tab Navigation */}
            <div className="flex flex-col items-center py-2 px-1.5 border-r border-zinc-800 gap-2">
                <Tooltip
                    content={t("workspace.widgets") || "Widgets"}
                    placement="left"
                    divClassName={clsx(
                        "flex items-center justify-center w-8 h-8 rounded cursor-pointer transition-colors",
                        activeTab === "widgets"
                            ? "bg-blue-600 text-white"
                            : "text-secondary hover:bg-zinc-800"
                    )}
                    divOnClick={() => handleTabChange("widgets")}
                >
                    <i className="fas fa-th-large text-base"></i>
                </Tooltip>

                <Tooltip
                    content={t("sidebar.favorites") || "收藏夹"}
                    placement="left"
                    divClassName={clsx(
                        "flex items-center justify-center w-8 h-8 rounded cursor-pointer transition-colors",
                        activeTab === "favorites"
                            ? "bg-blue-600 text-white"
                            : "text-secondary hover:bg-zinc-800"
                    )}
                    divOnClick={() => handleTabChange("favorites")}
                >
                    <i className="fas fa-star text-base"></i>
                </Tooltip>
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-hidden">
                {activeTab === "widgets" && <Widgets />}
                {activeTab === "favorites" && <FavoritesPanel />}
            </div>
        </div>
    );
});

RightSidebar.displayName = "RightSidebar";

export { RightSidebar };

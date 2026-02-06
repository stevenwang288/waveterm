// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Tooltip } from "@/app/element/tooltip";
import clsx from "clsx";
import { memo, useCallback, useState } from "react";
import { FavoritesPanel } from "./favorites";
import { Widgets } from "./widgets";

type SidebarTab = "widgets" | "favorites";

const RightSidebar = memo(() => {
    const [activeTab, setActiveTab] = useState<SidebarTab>("widgets");

    const handleTabChange = useCallback((tab: SidebarTab) => {
        setActiveTab(tab);
    }, []);

    return (
        <div className="flex flex-row h-full bg-zinc-950 border-l border-zinc-800">
            <div className="flex flex-col items-center py-2 px-1.5 border-r border-zinc-800 gap-2">
                <Tooltip
                    content="Widgets"
                    placement="left"
                    divClassName={clsx(
                        "flex items-center justify-center w-8 h-8 rounded cursor-pointer transition-colors",
                        activeTab === "widgets" ? "bg-blue-600 text-white" : "text-secondary hover:bg-zinc-800"
                    )}
                    divOnClick={() => handleTabChange("widgets")}
                >
                    <i className="fas fa-th-large text-base"></i>
                </Tooltip>

                <Tooltip
                    content="Favorites"
                    placement="left"
                    divClassName={clsx(
                        "flex items-center justify-center w-8 h-8 rounded cursor-pointer transition-colors",
                        activeTab === "favorites" ? "bg-blue-600 text-white" : "text-secondary hover:bg-zinc-800"
                    )}
                    divOnClick={() => handleTabChange("favorites")}
                >
                    <i className="fas fa-star text-base"></i>
                </Tooltip>
            </div>

            <div className="flex-1 overflow-hidden">
                {activeTab === "widgets" && <Widgets />}
                {activeTab === "favorites" && <FavoritesPanel />}
            </div>
        </div>
    );
});

RightSidebar.displayName = "RightSidebar";

export { RightSidebar };

// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { memo } from "react";
import { Widgets } from "./widgets";

const RightSidebar = memo(() => {
    return (
        <div className="flex flex-row h-full bg-zinc-950 border-l border-zinc-800">
            <div className="flex-1 overflow-hidden">
                <Widgets />
            </div>
        </div>
    );
});

RightSidebar.displayName = "RightSidebar";

export { RightSidebar };

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import type { TabModel } from "@/app/store/tab-model";
import { getApi, globalStore } from "@/app/store/global";
import { WebView, WebViewModel } from "@/app/view/webview/webview";
import { type Atom, atom, type PrimitiveAtom, useAtomValue } from "jotai";
import { memo } from "react";

const DefaultDeerFlowFrontendUrl = "http://127.0.0.1:3300";

class DeerFlowViewModel extends WebViewModel {
    frontendUrl: Atom<string>;
    syncingCcSwitch: PrimitiveAtom<boolean>;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        super(blockId, nodeModel, tabModel);
        this.viewType = "deerflow";
        this.viewIcon = atom("diagram-project");
        this.viewName = atom("DeerFlow");
        this.hideViewName = atom(false);
        this.hideNav = atom(true);
        this.partitionOverride = atom("persist:deerflow");
        this.syncingCcSwitch = atom(false);
        this.frontendUrl = atom(() => getApi().getEnv("WAVE_DEERFLOW_FRONTEND_URL") || DefaultDeerFlowFrontendUrl);
        this.endIconButtons = atom((get) => [
            {
                elemtype: "iconbutton",
                icon: "rotate-right",
                title: get(this.syncingCcSwitch) ? "正在同步 CCSwitch" : "同步 CCSwitch",
                iconSpin: get(this.syncingCcSwitch),
                disabled: get(this.syncingCcSwitch),
                click: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    void this.syncFromCcSwitch();
                },
            },
        ]);
    }

    get viewComponent(): ViewComponent {
        return DeerFlowView;
    }

    handleNavigate(url: string) {
        globalStore.set(this.url, url);
        if (this.searchAtoms) {
            globalStore.set(this.searchAtoms.isOpen, false);
        }
    }

    async syncFromCcSwitch() {
        if (globalStore.get(this.syncingCcSwitch)) {
            return;
        }
        globalStore.set(this.syncingCcSwitch, true);
        try {
            await getApi().syncCcSwitchConfig("deerflow");
            this.webviewRef.current?.reload();
        } catch (error) {
            console.error("[deerflow] failed to sync CCSwitch config", error);
        } finally {
            globalStore.set(this.syncingCcSwitch, false);
        }
    }
}

const DeerFlowView = memo((props: ViewComponentProps<DeerFlowViewModel>) => {
    const frontendUrl = useAtomValue(props.model.frontendUrl);
    if (!frontendUrl) {
        return <div className="w-full h-full flex items-center justify-center text-sm">未配置 DeerFlow 地址。</div>;
    }
    return (
        <div className="w-full h-full">
            <WebView {...props} initialSrc={frontendUrl} />
        </div>
    );
});

DeerFlowView.displayName = "DeerFlowView";

export { DeerFlowViewModel };

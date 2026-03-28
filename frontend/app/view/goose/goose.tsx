// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { BlockNodeModel } from "@/app/block/blocktypes";
import type { TabModel } from "@/app/store/tab-model";
import { getApi, globalStore } from "@/app/store/global";
import { WebView, WebViewModel } from "@/app/view/webview/webview";
import { type Atom, atom, type PrimitiveAtom, useAtomValue } from "jotai";
import { memo } from "react";

const DefaultGooseFrontendUrl = "http://127.0.0.1:5180/#/";

class GooseViewModel extends WebViewModel {
    frontendUrl: Atom<string>;
    syncingCcSwitch: PrimitiveAtom<boolean>;

    constructor(blockId: string, nodeModel: BlockNodeModel, tabModel: TabModel) {
        super(blockId, nodeModel, tabModel);
        this.viewType = "goose";
        this.viewIcon = atom("feather-pointed");
        this.viewName = atom("Goose");
        this.hideViewName = atom(false);
        this.hideNav = atom(true);
        this.partitionOverride = atom("persist:goose");
        this.webviewPreloadOverride = atom(getApi().getGooseWebviewPreload());
        this.syncingCcSwitch = atom(false);
        this.frontendUrl = atom((get) => {
            const metaUrl = get(this.blockAtom)?.meta?.["goose:url"];
            return metaUrl || getApi().getGooseFrontendUrl() || DefaultGooseFrontendUrl;
        });
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
        return GooseView;
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
            await getApi().syncCcSwitchConfig("goose");
            this.webviewRef.current?.reload();
        } catch (error) {
            console.error("[goose] failed to sync CCSwitch config", error);
        } finally {
            globalStore.set(this.syncingCcSwitch, false);
        }
    }
}

const GooseView = memo((props: ViewComponentProps<GooseViewModel>) => {
    const frontendUrl = useAtomValue(props.model.frontendUrl);
    if (!frontendUrl) {
        return <div className="w-full h-full flex items-center justify-center text-sm">未配置 Goose 地址。</div>;
    }
    return (
        <div className="w-full h-full">
            <WebView {...props} initialSrc={frontendUrl} />
        </div>
    );
});

GooseView.displayName = "GooseView";

export { GooseViewModel };

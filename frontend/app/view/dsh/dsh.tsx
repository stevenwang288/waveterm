// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { type Atom, atom, useAtomValue } from "jotai";
import { memo } from "react";
import { WebView, WebViewModel } from "@/app/view/webview/webview";
import type { BlockNodeModel } from "@/app/block/blocktypes";
import type { TabModel } from "@/app/store/tab-model";
import { getApi, globalStore } from "@/app/store/global";

const DefaultDshFrontendUrl = "http://127.0.0.1:3300";

class DshViewModel extends WebViewModel {
    frontendUrl: Atom<string>;

    constructor(params: ViewModelInitType) {
        super(params);
        this.viewType = "dsh";
        this.viewIcon = atom("microchip");
        this.viewName = atom("DeepSeek Harness");
        this.hideViewName = atom(false);
        this.hideNav = atom(true);
        this.partitionOverride = atom("persist:dsh");
        this.frontendUrl = atom((get) => {
            const metaUrl = get(this.blockAtom)?.meta?.["dsh:url"];
            return metaUrl || DefaultDshFrontendUrl;
        });
    }

    get viewComponent(): ViewComponent {
        return DshView;
    }

    handleNavigate(url: string) {
        globalStore.set(this.url, url);
        if (this.searchAtoms) {
            globalStore.set(this.searchAtoms.isOpen, false);
        }
    }
}

const DshView = memo((props: ViewComponentProps<DshViewModel>) => {
    const frontendUrl = useAtomValue(props.model.frontendUrl);
    if (!frontendUrl) {
        return <div className="w-full h-full flex items-center justify-center text-sm">DeepSeek Harness 地址未配置</div>;
    }
    return (
        <div className="w-full h-full">
            <WebView {...props} initialSrc={frontendUrl} />
        </div>
    );
});

DshView.displayName = "DshView";

export { DshViewModel };
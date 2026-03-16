// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, getApi, globalStore } from "./global";

class ContextMenuModelType {
    handlers: Map<string, () => void> = new Map(); // id -> handler
    private registered = false;

    constructor() {
        this.ensureRegistered();
    }

    private ensureRegistered(): void {
        if (this.registered) {
            return;
        }
        const api = getApi();
        if (api == null || typeof api.onContextMenuClick !== "function") {
            return;
        }
        api.onContextMenuClick(this.handleContextMenuClick.bind(this));
        this.registered = true;
    }

    handleContextMenuClick(id: string): void {
        const handler = this.handlers.get(id);
        if (handler) {
            handler();
        }
    }

    _convertAndRegisterMenu(menu: ContextMenuItem[]): ElectronContextMenuItem[] {
        const electronMenuItems: ElectronContextMenuItem[] = [];
        for (const item of menu) {
            const electronItem: ElectronContextMenuItem = {
                role: item.role,
                type: item.type,
                label: item.label,
                sublabel: item.sublabel,
                id: crypto.randomUUID(),
                checked: item.checked,
            };
            if (item.visible === false) {
                electronItem.visible = false;
            }
            if (item.enabled === false) {
                electronItem.enabled = false;
            }
            if (item.click) {
                this.handlers.set(electronItem.id, item.click);
            }
            if (item.submenu) {
                electronItem.submenu = this._convertAndRegisterMenu(item.submenu);
            }
            electronMenuItems.push(electronItem);
        }
        return electronMenuItems;
    }

    showContextMenu(menu: ContextMenuItem[], ev: React.MouseEvent<any>): void {
        ev.stopPropagation();
        this.ensureRegistered();
        this.handlers.clear();
        const electronMenuItems = this._convertAndRegisterMenu(menu);
        
        const workspace = globalStore.get(atoms.workspace);
        let oid: string;
        
        if (workspace != null) {
            oid = workspace.oid;
        } else {
            oid = globalStore.get(atoms.builderId);
        }
        
        const api = getApi();
        if (api == null || typeof api.showContextMenu !== "function") {
            return;
        }
        api.showContextMenu(oid, electronMenuItems);
    }
}

const ContextMenuModel = new ContextMenuModelType();

export { ContextMenuModel, ContextMenuModelType };

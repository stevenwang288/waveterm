// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { atoms, isDev, pushNotification } from "@/store/global";
import { useAtomValue } from "jotai";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

export const useUpdateNotifier = () => {
    const appUpdateStatus = useAtomValue(atoms.updaterStatusAtom);
    const { t } = useTranslation();

    useEffect(() => {
        let notification: NotificationType | null = null;

        switch (appUpdateStatus) {
            case "ready":
                notification = {
                    id: "update-notification",
                    icon: "arrows-rotate",
                    title: t("update.availableTitle"),
                    message: t("update.availableMessage"),
                    timestamp: new Date().toLocaleString(),
                    type: "update",
                    actions: [
                        {
                            label: t("update.installNow"),
                            actionKey: "installUpdate",
                            color: "green",
                            disabled: false,
                        },
                    ],
                };
                break;

            case "downloading":
                notification = {
                    id: "update-notification",
                    icon: "arrows-rotate",
                    title: t("update.downloadingTitle"),
                    message: t("update.downloadingMessage"),
                    timestamp: new Date().toLocaleString(),
                    type: "update",
                    actions: [
                        {
                            label: t("update.downloadingAction"),
                            actionKey: "",
                            color: "green",
                            disabled: true,
                        },
                    ],
                };
                break;

            case "installing":
                notification = {
                    id: "update-notification",
                    icon: "arrows-rotate",
                    title: t("update.installingTitle"),
                    message: t("update.installingMessage"),
                    timestamp: new Date().toLocaleString(),
                    type: "update",
                    actions: [
                        {
                            label: t("update.installingAction"),
                            actionKey: "",
                            color: "green",
                            disabled: true,
                        },
                    ],
                };
                break;

            case "error":
                notification = {
                    id: "update-notification",
                    icon: "circle-exclamation",
                    title: t("update.errorTitle"),
                    message: t("update.errorMessage"),
                    timestamp: new Date().toLocaleString(),
                    type: "update",
                    actions: [
                        {
                            label: t("update.retryUpdate"),
                            actionKey: "retryUpdate",
                            color: "green",
                            disabled: false,
                        },
                    ],
                };
                break;
        }

        if (!isDev()) return;

        if (notification) {
            pushNotification(notification);
        }
    }, [appUpdateStatus, t]);
};

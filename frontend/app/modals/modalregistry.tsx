// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";

const modalRegistry = {
    NewInstallOnboardingModal: lazy(async () => ({
        default: (await import("@/app/onboarding/onboarding")).NewInstallOnboardingModal,
    })),
    UpgradeOnboardingModal: lazy(async () => ({
        default: (await import("@/app/onboarding/onboarding-upgrade")).UpgradeOnboardingModal,
    })),
    UserInputModal: lazy(async () => ({
        default: (await import("./userinputmodal")).UserInputModal,
    })),
    AboutModal: lazy(async () => ({
        default: (await import("./about")).AboutModal,
    })),
    MessageModal: lazy(async () => ({
        default: (await import("@/app/modals/messagemodal")).MessageModal,
    })),
    CodexTranslateModal: lazy(async () => ({
        default: (await import("./codextranslatemodal")).CodexTranslateModal,
    })),
    PublishAppModal: lazy(async () => ({
        default: (await import("@/builder/builder-apppanel")).PublishAppModal,
    })),
    RenameFileModal: lazy(async () => ({
        default: (await import("@/builder/builder-apppanel")).RenameFileModal,
    })),
    DeleteFileModal: lazy(async () => ({
        default: (await import("@/builder/builder-apppanel")).DeleteFileModal,
    })),
    SetSecretDialog: lazy(async () => ({
        default: (await import("@/builder/tabs/builder-secrettab")).SetSecretDialog,
    })),
} satisfies Record<string, LazyExoticComponent<ComponentType<any>>>;

export const getModalComponent = (key: string): LazyExoticComponent<ComponentType<any>> | undefined => {
    return modalRegistry[key];
};

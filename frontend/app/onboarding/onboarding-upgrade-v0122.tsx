// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Trans, useTranslation } from "react-i18next";

const UpgradeOnboardingModal_v0_12_2_Content = () => {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col items-start gap-6 w-full mb-4 unselectable">
            <div className="text-secondary leading-relaxed">
                <p className="mb-0">{t("onboarding.upgrade.v0122.summary")}</p>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-file-pen"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding.upgrade.v0122.fileEditing.title")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <Trans
                                    i18nKey="onboarding.upgrade.v0122.fileEditing.bullet1"
                                    components={[<strong />]}
                                />
                            </li>
                            <li>
                                <Trans
                                    i18nKey="onboarding.upgrade.v0122.fileEditing.bullet2"
                                    components={[<strong />]}
                                />
                            </li>
                            <li>
                                <Trans
                                    i18nKey="onboarding.upgrade.v0122.fileEditing.bullet3"
                                    components={[<strong />]}
                                />
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-sparkles"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding.upgrade.v0122.aiImprovements.title")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>{t("onboarding.upgrade.v0122.aiImprovements.bullet1")}</li>
                            <li>
                                <Trans
                                    i18nKey="onboarding.upgrade.v0122.aiImprovements.bullet2"
                                    components={[<span className="font-mono" />]}
                                />
                            </li>
                            <li>{t("onboarding.upgrade.v0122.aiImprovements.bullet3")}</li>
                            <li>{t("onboarding.upgrade.v0122.aiImprovements.bullet4")}</li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-wrench"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding.upgrade.v0122.bugFixes.title")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>{t("onboarding.upgrade.v0122.bugFixes.bullet1")}</li>
                            <li>{t("onboarding.upgrade.v0122.bugFixes.bullet2")}</li>
                            <li>{t("onboarding.upgrade.v0122.bugFixes.bullet3")}</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_12_2_Content.displayName = "UpgradeOnboardingModal_v0_12_2_Content";

export { UpgradeOnboardingModal_v0_12_2_Content };

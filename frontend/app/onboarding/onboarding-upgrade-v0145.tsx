// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Trans, useTranslation } from "react-i18next";

const UpgradeOnboardingModal_v0_14_5_Content = () => {
    const { t } = useTranslation();
    return (
        <div className="flex flex-col items-start gap-6 w-full mb-4 unselectable">
            <div className="text-secondary leading-relaxed">
                <p className="mb-0">{t("onboarding.upgrade.v0145.summary")}</p>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-list-tree"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding.upgrade.v0145.processViewer.title")}
                    </div>
                    <div className="text-secondary leading-5">
                        {t("onboarding.upgrade.v0145.processViewer.desc")}
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-wrench"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding.upgrade.v0145.other.title")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <Trans i18nKey="onboarding.upgrade.v0145.other.bullet1">
                                    <strong>Quake Mode</strong> &mdash; global hotkey (
                                    <code>app:globalhotkey</code>) now toggles a Wave window visible and invisible
                                </Trans>
                            </li>
                            <li>
                                <Trans i18nKey="onboarding.upgrade.v0145.other.bullet2">
                                    <strong>Drag &amp; Drop Files into Terminal</strong>
                                    to paste their quoted path
                                </Trans>
                            </li>
                            <li>
                                <Trans i18nKey="onboarding.upgrade.v0145.other.bullet3">
                                    New <code>app:showsplitbuttons</code> setting adds split buttons to block headers
                                </Trans>
                            </li>
                            <li>{t("onboarding.upgrade.v0145.other.bullet4")}</li>
                            <li>{t("onboarding.upgrade.v0145.other.bullet5")}</li>
                            <li>{t("onboarding.upgrade.v0145.other.bullet6")}</li>
                            <li>{t("onboarding.upgrade.v0145.other.bullet7")}</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_14_5_Content.displayName = "UpgradeOnboardingModal_v0_14_5_Content";

export { UpgradeOnboardingModal_v0_14_5_Content };
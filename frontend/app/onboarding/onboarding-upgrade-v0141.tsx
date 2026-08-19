// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useTranslation, Trans } from "react-i18next";

const UpgradeOnboardingModal_v0_14_1_Content = () => {
    const { t } = useTranslation();
    return (
        <div className="flex flex-col items-start w-full mb-2 unselectable">
            <div className="text-secondary leading-relaxed mb-4">
                <p className="mb-0">{t("onboarding.upgrade.v0141.summary")}</p>
            </div>

            <div className="flex w-full items-start gap-4 mb-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-terminal"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding.upgrade.v0141.terminalFixes.title")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <Trans
                                    i18nKey="onboarding.upgrade.v0141.terminalFixes.bullet1"
                                    components={{ 0: <strong /> }}
                                />
                            </li>
                            <li>
                                <Trans
                                    i18nKey="onboarding.upgrade.v0141.terminalFixes.bullet2"
                                    components={{ 0: <strong /> }}
                                />
                            </li>
                            <li>
                                <Trans
                                    i18nKey="onboarding.upgrade.v0141.terminalFixes.bullet3"
                                    components={{ 0: <strong /> }}
                                />
                            </li>
                            <li>
                                <Trans
                                    i18nKey="onboarding.upgrade.v0141.terminalFixes.bullet4"
                                    components={{ 0: <strong />, 1: <code /> }}
                                />
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-sliders"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding.upgrade.v0141.newConfig.title")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <Trans
                                    i18nKey="onboarding.upgrade.v0141.newConfig.bullet1"
                                    components={{ 0: <strong />, 1: <code /> }}
                                />
                            </li>
                            <li>
                                <Trans
                                    i18nKey="onboarding.upgrade.v0141.newConfig.bullet2"
                                    components={{ 0: <strong /> }}
                                />
                            </li>
                            <li>
                                <Trans
                                    i18nKey="onboarding.upgrade.v0141.newConfig.bullet3"
                                    components={{ 0: <strong /> }}
                                />
                            </li>
                            <li>
                                <Trans
                                    i18nKey="onboarding.upgrade.v0141.newConfig.bullet4"
                                    components={{ 0: <strong /> }}
                                />
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_14_1_Content.displayName = "UpgradeOnboardingModal_v0_14_1_Content";

export { UpgradeOnboardingModal_v0_14_1_Content };
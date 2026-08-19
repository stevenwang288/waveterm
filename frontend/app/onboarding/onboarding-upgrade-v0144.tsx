// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Trans, useTranslation } from "react-i18next";

const UpgradeOnboardingModal_v0_14_4_Content = () => {
    const { t } = useTranslation();
    return (
        <div className="flex flex-col items-start gap-6 w-full mb-4 unselectable">
            <div className="text-secondary leading-relaxed">
                <p className="mb-0">{t("onboarding.upgrade.v0144.summary")}</p>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-table-columns"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding.upgrade.v0144.verticalTabs.title")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <Trans i18nKey="onboarding.upgrade.v0144.verticalTabs.bullet1">
                                    <strong>New Vertical Tab Bar Option</strong> - Tabs can now be displayed vertically
                                    along the side of the window for more horizontal space. Toggle between horizontal and
                                    vertical layouts in settings.
                                </Trans>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-terminal"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding.upgrade.v0144.terminal.title")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <Trans i18nKey="onboarding.upgrade.v0144.terminal.bullet1">
                                    <strong>xterm.js v6.0.0 Upgrade</strong> - Improved terminal compatibility and
                                    rendering, resolving quirks with tools like Claude Code
                                </Trans>
                            </li>
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
                        {t("onboarding.upgrade.v0144.other.title")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <Trans i18nKey="onboarding.upgrade.v0144.other.bullet1">
                                    <strong>macOS First Click</strong> - First click now focuses the clicked widget
                                </Trans>
                            </li>
                            <li>
                                <Trans i18nKey="onboarding.upgrade.v0144.other.bullet2">
                                    <strong><code>backgrounds.json</code></strong>{" "}
                                    - Renamed <code>presets/bg.json</code> to <code>backgrounds.json</code>
                                </Trans>
                            </li>
                            <li>
                                <Trans i18nKey="onboarding.upgrade.v0144.other.bullet3">
                                    <strong>Config Errors Moved</strong> - Config errors to the WaveConfig view for less
                                    clutter
                                </Trans>
                            </li>
                            <li>{t("onboarding.upgrade.v0144.other.bullet4")}</li>
                            <li>{t("onboarding.upgrade.v0144.other.bullet5")}</li>
                            <li>{t("onboarding.upgrade.v0144.other.bullet6")}</li>
                            <li>{t("onboarding.upgrade.v0144.other.bullet7")}</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_14_4_Content.displayName = "UpgradeOnboardingModal_v0_14_4_Content";

export { UpgradeOnboardingModal_v0_14_4_Content };
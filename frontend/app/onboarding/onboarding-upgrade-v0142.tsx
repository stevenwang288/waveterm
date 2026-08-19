// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useWaveEnv } from "@/app/waveenv/waveenv";
import { Trans, useTranslation } from "react-i18next";

const UpgradeOnboardingModal_v0_14_2_Content = () => {
    const { t } = useTranslation();
    const waveEnv = useWaveEnv();
    return (
        <div className="flex flex-col items-start w-full mb-2 unselectable">
            <div className="text-secondary leading-relaxed mb-4">
                <p className="mb-0">{t("onboarding.upgrade.v0142.summary")}</p>
            </div>

            <div className="flex w-full items-start gap-4 mb-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-bell"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding.upgrade.v0142.badges.title")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <Trans i18nKey="onboarding.upgrade.v0142.badges.bullet1">
                                    <strong>Block Badges Roll Up to Tabs</strong> - Blocks can display icon badges (with
                                    color and priority) that are visible in the tab bar for at-a-glance status
                                </Trans>
                            </li>
                            <li>
                                <Trans i18nKey="onboarding.upgrade.v0142.badges.bullet2">
                                    <strong>Bell Indicator On by Default</strong> - Terminal bell badge now lights up the
                                    block and tab when your terminal rings (controlled by <code>term:bellindicator</code>)
                                </Trans>
                            </li>
                            <li>
                                <Trans i18nKey="onboarding.upgrade.v0142.badges.bullet3">
                                    <strong><code>wsh badge</code></strong>{" "}
                                    - New command to set or clear badges from the CLI. Supports icons, colors, priorities,
                                    and PID-linked badges
                                </Trans>
                            </li>
                            <li>
                                <Trans i18nKey="onboarding.upgrade.v0142.badges.bullet4">
                                    <strong>Claude Code Integration</strong> - Use <code>wsh badge</code> with Claude Code
                                    hooks to surface AI task status as tab bar notifications{" "}
                                </Trans>
                                <button
                                    onClick={() =>
                                        waveEnv.electron.openExternal("https://docs.waveterm.dev/claude-code")
                                    }
                                    className="text-accent text-sm font-normal cursor-pointer hover:underline"
                                >
                                    {t("onboarding.upgrade.v0142.badges.seeDocs")}
                                </button>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-folder-open"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding.upgrade.v0142.other.title")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>{t("onboarding.upgrade.v0142.other.bullet1")}</li>
                            <li>
                                <Trans i18nKey="onboarding.upgrade.v0142.other.bullet2">
                                    <strong>Directory Preview</strong> - Improved mod time formatting, zebra-striped rows,
                                    better default sort, and YAML file support
                                </Trans>
                            </li>
                            <li>
                                <Trans i18nKey="onboarding.upgrade.v0142.other.bullet3">
                                    <strong>Search Bar</strong> - Clipboard and focus improvements
                                </Trans>
                            </li>
                            <li>{t("onboarding.upgrade.v0142.other.bullet4")}</li>
                            <li>{t("onboarding.upgrade.v0142.other.bullet5")}</li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
};

UpgradeOnboardingModal_v0_14_2_Content.displayName = "UpgradeOnboardingModal_v0_14_2_Content";

export { UpgradeOnboardingModal_v0_14_2_Content };
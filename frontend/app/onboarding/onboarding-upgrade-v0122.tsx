// Copyright 2025, Command Line Inc.
import { useTranslation } from "react-i18next";
// SPDX-License-Identifier: Apache-2.0

const UpgradeOnboardingModal_v0_12_2_Content = () => {
    const { t } = useTranslation();
    return (
        <div className="flex flex-col items-start gap-6 w-full mb-4 unselectable">
            <div className="text-secondary leading-relaxed">
                <p className="mb-0">
                    Wave AI can now create and modify files with visual diff previews and easy rollback capabilities.
                    Plus performance improvements and bug fixes.
                </p>
            </div>

            <div className="flex w-full items-start gap-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-file-pen"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">{t("onboarding.upgrade.v0122.fileEditing.title")}</div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <strong>File Write Tool</strong> - Wave AI can now create and modify files with your
                                approval
                            </li>
                            <li>
                                <strong>Visual Diff Preview</strong> - See exactly what will change before approving
                                edits
                            </li>
                            <li>
                                <strong>Easy Rollback</strong> - Revert file changes with a simple "Revert File" button
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
                                Directory listings support in <span className="font-mono">`wsh ai`</span> commands
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

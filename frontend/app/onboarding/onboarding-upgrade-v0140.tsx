// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { useWaveEnv } from "@/app/waveenv/waveenv";
import { useTranslation, Trans } from "react-i18next";

const UpgradeOnboardingModal_v0_14_0_Content = () => {
    const { t } = useTranslation();
    const waveEnv = useWaveEnv();
    return (
        <div className="flex flex-col items-start w-full mb-2 unselectable">
            <div className="text-secondary leading-relaxed mb-4">
                <p className="mb-0">{t("onboarding.upgrade.v0140.summary")}</p>
            </div>

            <div className="flex w-full items-start gap-4 mb-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-sky-500 fa-sharp fa-solid fa-shield"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding.upgrade.v0140.durableSessions.title")}{" "}
                        <button
                            onClick={() => waveEnv.electron.openExternal("https://docs.waveterm.dev/durable-sessions")}
                            className="text-accent text-sm font-normal cursor-pointer hover:underline"
                        >
                            {t("onboarding.upgrade.v0140.durableSessions.seeDocs")}
                        </button>
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <Trans
                                    i18nKey="onboarding.upgrade.v0140.durableSessions.bullet1"
                                    components={{ 0: <strong /> }}
                                />
                            </li>
                            <li>
                                <Trans
                                    i18nKey="onboarding.upgrade.v0140.durableSessions.bullet2"
                                    components={{ 0: <strong /> }}
                                />
                            </li>
                            <li>
                                <Trans
                                    i18nKey="onboarding.upgrade.v0140.durableSessions.bullet3"
                                    components={{ 0: <strong /> }}
                                />
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4 mb-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-network-wired"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">
                        {t("onboarding.upgrade.v0140.connectionMonitoring.title")}
                    </div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <Trans
                                    i18nKey="onboarding.upgrade.v0140.connectionMonitoring.bullet1"
                                    components={{ 0: <strong /> }}
                                />
                            </li>
                            <li>
                                <Trans
                                    i18nKey="onboarding.upgrade.v0140.connectionMonitoring.bullet2"
                                    components={{ 0: <strong /> }}
                                />
                            </li>
                        </ul>
                    </div>
                </div>
            </div>

            <div className="flex w-full items-start gap-4 mb-4">
                <div className="flex-shrink-0">
                    <i className="text-[24px] text-accent fa-solid fa-sparkles"></i>
                </div>
                <div className="flex flex-col items-start gap-2 flex-1">
                    <div className="text-foreground text-base font-semibold leading-[18px]">{t("onboarding.upgrade.v0140.waveAi.title")}</div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <Trans
                                    i18nKey="onboarding.upgrade.v0140.waveAi.bullet1"
                                    components={{ 0: <strong /> }}
                                />
                            </li>
                            <li>
                                <Trans
                                    i18nKey="onboarding.upgrade.v0140.waveAi.bullet2"
                                    components={{ 0: <strong /> }}
                                />
                            </li>
                            <li>
                                <Trans
                                    i18nKey="onboarding.upgrade.v0140.waveAi.bullet3"
                                    components={{ 0: <strong /> }}
                                />
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
                    <div className="text-foreground text-base font-semibold leading-[18px]">{t("onboarding.upgrade.v0140.terminal.title")}</div>
                    <div className="text-secondary leading-5">
                        <ul className="list-disc list-outside space-y-1 pl-5">
                            <li>
                                <Trans
                                    i18nKey="onboarding.upgrade.v0140.terminal.bullet1"
                                    components={{ 0: <strong /> }}
                                />
                            </li>
                            <li>
                                <Trans
                                    i18nKey="onboarding.upgrade.v0140.terminal.bullet2"
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

UpgradeOnboardingModal_v0_14_0_Content.displayName = "UpgradeOnboardingModal_v0_14_0_Content";

export { UpgradeOnboardingModal_v0_14_0_Content };
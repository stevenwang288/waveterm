// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo.svg";
import {
    ACCENT_COLOR_PRESETS,
    DEFAULT_ACCENT_COLOR,
    getStoredAccentColor,
    setStoredAccentColor,
} from "@/app/element/accent-color";
import { DEFAULT_LOGO_COLOR, LOGO_COLOR_PRESETS, getStoredLogoColor, setStoredLogoColor } from "@/app/element/logo-color";
import { modalsModel } from "@/app/store/modalmodel";
import { Modal } from "./modal";

import { isDev } from "@/util/isdev";
import { useState } from "react";
import { getApi } from "../store/global";
import { useTranslation, Trans } from "react-i18next";

interface AboutModalProps {}

const AboutModal = ({}: AboutModalProps) => {
    const currentDate = new Date();
    const [details] = useState(() => getApi().getAboutModalDetails());
    const [updaterChannel] = useState(() => getApi().getUpdaterChannel());
    const [accentColor, setAccentColor] = useState(() => getStoredAccentColor() ?? DEFAULT_ACCENT_COLOR);
    const [logoColor, setLogoColor] = useState(() => getStoredLogoColor() ?? DEFAULT_LOGO_COLOR);
    const { t } = useTranslation();

    const applyLogoColor = (color: string) => {
        const appliedColor = setStoredLogoColor(color);
        setLogoColor(appliedColor);
    };

    const applyAccentColor = (color: string) => {
        const appliedColor = setStoredAccentColor(color);
        setAccentColor(appliedColor);
    };

    const resetLogoColor = () => {
        const appliedColor = setStoredLogoColor(null);
        setLogoColor(appliedColor);
    };

    const resetAccentColor = () => {
        const appliedColor = setStoredAccentColor(null);
        setAccentColor(appliedColor);
    };

    return (
        <Modal className="pt-[34px] pb-[34px]" onClose={() => modalsModel.popModal()}>
            <div className="flex flex-col gap-[26px] w-full">
                <div className="flex flex-col items-center justify-center gap-4 self-stretch w-full text-center">
                    <Logo />
                    <div className="text-[25px]">{t("about.title")}</div>
                    <div className="leading-5">
                        <Trans i18nKey="about.description" components={[<br key="br" />]} />
                    </div>
                </div>
                <div className="flex flex-col items-center gap-2 self-stretch w-full">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-secondary">{t("about.accentColor")}</div>
                    <div className="flex items-center gap-3">
                        <input
                            type="color"
                            value={accentColor}
                            onChange={(e) => applyAccentColor(e.target.value)}
                            aria-label={t("about.accentColor")}
                            className="h-8 w-10 p-0 border border-border rounded cursor-pointer bg-transparent"
                        />
                        <span className="text-xs uppercase text-secondary">{accentColor}</span>
                        <button
                            type="button"
                            onClick={resetAccentColor}
                            className="px-2 py-1 text-xs rounded border border-border hover:bg-hoverbg transition-colors"
                        >
                            {t("common.reset")}
                        </button>
                    </div>
                    <div className="flex items-center gap-2">
                        {ACCENT_COLOR_PRESETS.map((preset) => (
                            <button
                                key={`accent-${preset.label}`}
                                type="button"
                                title={preset.label}
                                aria-label={preset.label}
                                onClick={() => applyAccentColor(preset.value)}
                                className="h-6 w-6 rounded border border-border hover:scale-105 transition-transform"
                                style={{ backgroundColor: preset.value }}
                            />
                        ))}
                    </div>
                </div>
                <div className="flex flex-col items-center gap-2 self-stretch w-full">
                    <div className="text-[11px] uppercase tracking-[0.12em] text-secondary">{t("about.logoColor")}</div>
                    <div className="flex items-center gap-3">
                        <input
                            type="color"
                            value={logoColor}
                            onChange={(e) => applyLogoColor(e.target.value)}
                            aria-label={t("about.logoColor")}
                            className="h-8 w-10 p-0 border border-border rounded cursor-pointer bg-transparent"
                        />
                        <span className="text-xs uppercase text-secondary">{logoColor}</span>
                        <button
                            type="button"
                            onClick={resetLogoColor}
                            className="px-2 py-1 text-xs rounded border border-border hover:bg-hoverbg transition-colors"
                        >
                            {t("common.reset")}
                        </button>
                    </div>
                    <div className="flex items-center gap-2">
                        {LOGO_COLOR_PRESETS.map((preset) => (
                            <button
                                key={preset.label}
                                type="button"
                                title={preset.label}
                                aria-label={preset.label}
                                onClick={() => applyLogoColor(preset.value)}
                                className="h-6 w-6 rounded border border-border hover:scale-105 transition-transform"
                                style={{ backgroundColor: preset.value }}
                            />
                        ))}
                    </div>
                </div>
                <div className="items-center gap-4 self-stretch w-full text-center">
                    {t("about.clientVersion", {
                        version: details.version,
                        dev: isDev() ? "dev-" : "",
                        buildTime: details.buildTime,
                    })}
                    <br />
                    {t("about.updateChannel", { channel: updaterChannel })}
                </div>
                <div className="flex items-start gap-[10px] self-stretch w-full text-center">
                    <a
                        href="https://github.com/wavetermdev/waveterm?ref=about"
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center px-4 py-2 rounded border border-border hover:bg-hoverbg transition-colors duration-200"
                    >
                        <i className="fa-brands fa-github mr-2"></i>{t("about.github")}
                    </a>
                    <a
                        href="https://www.waveterm.dev/?ref=about"
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center px-4 py-2 rounded border border-border hover:bg-hoverbg transition-colors duration-200"
                    >
                        <i className="fa-sharp fa-light fa-globe mr-2"></i>{t("about.website")}
                    </a>
                    <a
                        href="https://github.com/wavetermdev/waveterm/blob/main/ACKNOWLEDGEMENTS.md"
                        target="_blank"
                        rel="noopener"
                        className="inline-flex items-center px-4 py-2 rounded border border-border hover:bg-hoverbg transition-colors duration-200"
                    >
                        <i className="fa-sharp fa-light fa-heart mr-2"></i>{t("about.acknowledgements")}
                    </a>
                </div>
                <div className="items-center gap-4 self-stretch w-full text-center">
                     <Trans i18nKey="about.copyright" values={{ year: currentDate.getFullYear() }} />
                </div>
            </div>
        </Modal>
    );
};

AboutModal.displayName = "AboutModal";

export { AboutModal };

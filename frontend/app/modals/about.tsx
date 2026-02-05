// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo.svg";
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
    const { t } = useTranslation();

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
                <div className="items-center gap-4 self-stretch w-full text-center">
                    {t("about.clientVersion", { 
                        version: details.version, 
                        dev: isDev() ? "dev-" : "", 
                        buildTime: details.buildTime 
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

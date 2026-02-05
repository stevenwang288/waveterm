// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { cn } from "@/util/util";
import { useState } from "react";
import { WaveAIModel } from "./waveai-model";
import { useTranslation, Trans } from "react-i18next";

interface TelemetryRequiredMessageProps {
    className?: string;
}

const TelemetryRequiredMessage = ({ className }: TelemetryRequiredMessageProps) => {
    const [isEnabling, setIsEnabling] = useState(false);
    const { t } = useTranslation();

    const handleEnableTelemetry = async () => {
        setIsEnabling(true);
        try {
            await RpcApi.WaveAIEnableTelemetryCommand(TabRpcClient);
            setTimeout(() => {
                WaveAIModel.getInstance().focusInput();
            }, 100);
        } catch (error) {
            console.error("Failed to enable telemetry:", error);
            setIsEnabling(false);
        }
    };

    return (
        <div className={cn("flex flex-col h-full", className)}>
            <div className="flex-grow"></div>
            <div className="flex items-center justify-center p-8 text-center">
                <div className="max-w-md space-y-6">
                    <div className="space-y-4">
                        <i className="fa fa-sparkles text-accent text-5xl"></i>
                        <h2 className="text-2xl font-semibold text-foreground">{t("aipanel.telemetryRequiredTitle")}</h2>
                        <p className="text-secondary leading-relaxed">
                            {t("aipanel.telemetryRequiredDesc")}
                        </p>
                    </div>

                    <div className="bg-blue-900/20 border border-blue-500 rounded-lg p-4">
                        <div className="flex items-start gap-3">
                            <i className="fa fa-info-circle text-blue-400 text-lg mt-0.5"></i>
                            <div className="text-left">
                                <div className="text-blue-400 font-medium mb-1">{t("aipanel.telemetryTitle")}</div>
                                <div className="text-secondary text-sm mb-3">
                                    <p className="mb-2">
                                        <Trans i18nKey="aipanel.telemetryDesc1" components={{ i: <i /> }} />
                                    </p>
                                    <p className="mb-2">
                                        {t("aipanel.telemetryDesc2")}
                                    </p>
                                    <p className="mb-2">
                                        {t("aipanel.telemetryDesc3")}
                                    </p>
                                    <p>
                                        {t("aipanel.telemetryDesc4")}{" "}
                                        <a
                                            href="https://docs.waveterm.dev/waveai-modes"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="!text-secondary hover:!text-accent/80 cursor-pointer"
                                        >
                                            https://docs.waveterm.dev/waveai-modes
                                        </a>
                                        .
                                    </p>
                                </div>
                                <button
                                    onClick={handleEnableTelemetry}
                                    disabled={isEnabling}
                                    className="bg-accent/80 hover:bg-accent disabled:bg-accent/50 text-background px-4 py-2 rounded-lg font-medium cursor-pointer disabled:cursor-not-allowed"
                                >
                                    {isEnabling ? t("aipanel.enablingTelemetry") : t("aipanel.enableTelemetry")}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="text-xs text-secondary">
                        <a
                            href="https://waveterm.dev/privacy"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="!text-secondary hover:!text-accent/80 cursor-pointer"
                        >
                            {t("aipanel.privacyPolicy")}
                        </a>
                    </div>
                </div>
            </div>
            <div className="flex-grow-[2]"></div>
        </div>
    );
};

TelemetryRequiredMessage.displayName = "TelemetryRequiredMessage";

export { TelemetryRequiredMessage };

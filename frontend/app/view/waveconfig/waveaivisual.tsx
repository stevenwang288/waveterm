// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import type { WaveConfigViewModel } from "@/app/view/waveconfig/waveconfig-model";
import { memo } from "react";
import { useTranslation } from "react-i18next";

interface WaveAIVisualContentProps {
    model: WaveConfigViewModel;
}

export const WaveAIVisualContent = memo(({ model }: WaveAIVisualContentProps) => {
    const { t } = useTranslation();
    return (
        <div className="flex flex-col gap-4 p-6 h-full">
            <div className="text-lg font-semibold">{t("waveconfig.waveAiVisual.title")}</div>
            <div className="text-muted-foreground">{t("waveconfig.waveAiVisual.comingSoon")}</div>
        </div>
    );
});

WaveAIVisualContent.displayName = "WaveAIVisualContent";

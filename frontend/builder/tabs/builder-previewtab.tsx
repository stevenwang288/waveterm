// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveAIModel } from "@/app/aipanel/waveai-model";
import { BuilderAppPanelModel } from "@/builder/store/builder-apppanel-model";
import { BuilderBuildPanelModel } from "@/builder/store/builder-buildpanel-model";
import { atoms } from "@/store/global";
import { useAtomValue } from "jotai";
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";

const EmptyStateView = memo(() => {
    const { t } = useTranslation();
    return (
        <div className="w-full h-full flex items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-6 max-w-[500px] text-center px-8">
                <div className="text-6xl">🏗️</div>
                <div className="flex flex-col gap-3">
                    <h2 className="text-2xl font-semibold text-primary">{t("builder.previewTab.emptyState.title")}</h2>
                    <p className="text-base text-secondary leading-relaxed">
                        {t("builder.previewTab.emptyState.desc")}
                    </p>
                </div>
                <div className="text-base text-secondary mt-2">
                    {t("builder.previewTab.emptyState.hintPrefix")} <span className="font-mono">app.go</span>{" "}
                    {t("builder.previewTab.emptyState.hintSuffix")}
                </div>
            </div>
        </div>
    );
});

EmptyStateView.displayName = "EmptyStateView";

const ErrorStateView = memo(({ errorMsg }: { errorMsg: string }) => {
    const { t } = useTranslation();
    const displayMsg = errorMsg && errorMsg.trim() ? errorMsg : t("builder.previewTab.error.unknownError");
    const waveAIModel = WaveAIModel.getInstance();
    const buildPanelModel = BuilderBuildPanelModel.getInstance();
    const appPanelModel = BuilderAppPanelModel.getInstance();
    const outputLines = useAtomValue(buildPanelModel.outputLines);
    const isStreaming = useAtomValue(waveAIModel.isAIStreaming);

    const isSecretError = displayMsg.includes("ERR-SECRET");

    const getBuildContext = () => {
        const filteredLines = outputLines.filter((line) => !line.startsWith("[debug]"));
        const buildOutput = filteredLines.join("\n").trim();
        return `${t("builder.previewTab.ai.buildError")}\n\`\`\`\n${displayMsg}\n\`\`\`\n\n${t("builder.previewTab.ai.buildOutput")}\n\`\`\`\n${buildOutput}\n\`\`\``;
    };

    const handleAddToContext = () => {
        const context = getBuildContext();
        waveAIModel.appendText(context, true);
        waveAIModel.focusInput();
    };

    const handleAskAIToFix = async () => {
        const context = getBuildContext();
        waveAIModel.appendText(t("builder.previewTab.ai.fixPrompt") + "\n\n" + context, true);
        await waveAIModel.handleSubmit();
    };

    const handleGoToSecrets = () => {
        appPanelModel.setActiveTab("secrets");
    };

    if (isSecretError) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-6 max-w-2xl text-center px-8">
                    <div className="text-6xl">🔐</div>
                    <div className="flex flex-col gap-3">
                        <h2 className="text-2xl font-semibold text-error">{t("builder.previewTab.secretError.title")}</h2>
                        <p className="text-base text-secondary leading-relaxed">
                            {t("builder.previewTab.secretError.desc")}
                        </p>
                        <div className="text-left bg-panel border border-error/30 rounded-lg p-4 max-h-96 overflow-auto mt-2">
                            <pre className="text-sm text-secondary whitespace-pre-wrap font-mono">{displayMsg}</pre>
                        </div>
                        <button
                            onClick={handleGoToSecrets}
                            className="px-6 py-2 mt-2 bg-accent/80 text-primary font-semibold rounded hover:bg-accent transition-colors cursor-pointer"
                        >
                            {t("builder.previewTab.secretError.goToSecretsTab")}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="w-full h-full flex items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-6 max-w-2xl text-center px-8">
                <div className="flex flex-col gap-3">
                    <h2 className="text-2xl font-semibold text-error">{t("builder.previewTab.error.title")}</h2>
                    <div className="text-left bg-panel border border-error/30 rounded-lg p-4 max-h-96 overflow-auto">
                        <pre className="text-sm text-secondary whitespace-pre-wrap font-mono">{displayMsg}</pre>
                    </div>
                    {!isStreaming && (
                        <div className="flex gap-3 mt-2 justify-center">
                            <button
                                onClick={handleAddToContext}
                                className="px-4 py-2 bg-panel text-primary border border-border rounded hover:bg-panel/80 transition-colors cursor-pointer"
                            >
                                {t("builder.actions.addErrorToAiContext")}
                            </button>
                            <button
                                onClick={handleAskAIToFix}
                                className="px-4 py-2 bg-accent/80 text-primary font-semibold rounded hover:bg-accent transition-colors cursor-pointer"
                            >
                                {t("builder.actions.askAiToFix")}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});

ErrorStateView.displayName = "ErrorStateView";

const BuildingStateView = memo(() => {
    const { t } = useTranslation();
    return (
        <div className="w-full h-full flex items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-6 max-w-[500px] text-center px-8">
                <div className="text-6xl">⚙️</div>
                <div className="flex flex-col gap-3">
                    <h2 className="text-2xl font-semibold text-primary">{t("builder.previewTab.building.title")}</h2>
                    <p className="text-base text-secondary leading-relaxed">
                        {t("builder.previewTab.building.desc")}
                    </p>
                </div>
            </div>
        </div>
    );
});

BuildingStateView.displayName = "BuildingStateView";

const StoppedStateView = memo(({ onStart }: { onStart: () => void }) => {
    const [isStarting, setIsStarting] = useState(false);
    const { t } = useTranslation();

    const handleStart = () => {
        setIsStarting(true);
        onStart();
        setTimeout(() => setIsStarting(false), 2000);
    };

    return (
        <div className="w-full h-full flex items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-6 max-w-[500px] text-center px-8">
                <div className="flex flex-col gap-3">
                    <h2 className="text-2xl font-semibold text-primary">{t("builder.previewTab.stopped.title")}</h2>
                    <p className="text-base text-secondary leading-relaxed">
                        {t("builder.previewTab.stopped.desc")}
                    </p>
                </div>
                {!isStarting && (
                    <button
                        onClick={handleStart}
                        className="px-6 py-2 bg-accent text-primary font-semibold rounded hover:bg-accent/80 transition-colors cursor-pointer"
                    >
                        {t("builder.actions.startApp")}
                    </button>
                )}
                {isStarting && <div className="text-base text-success">{t("builder.previewTab.stopped.starting")}</div>}
            </div>
        </div>
    );
});

StoppedStateView.displayName = "StoppedStateView";

const BuilderPreviewTab = memo(() => {
    const model = BuilderAppPanelModel.getInstance();
    const isLoading = useAtomValue(model.isLoadingAtom);
    const originalContent = useAtomValue(model.originalContentAtom);
    const builderStatus = useAtomValue(model.builderStatusAtom);
    const builderId = useAtomValue(atoms.builderId);

    const fileExists = originalContent.length > 0;

    if (isLoading) {
        return null;
    }

    if (builderStatus?.status === "error") {
        return <ErrorStateView errorMsg={builderStatus?.errormsg || ""} />;
    }

    if (!fileExists) {
        return <EmptyStateView />;
    }

    const status = builderStatus?.status || "init";

    if (status === "init") {
        return null;
    }

    if (status === "building") {
        return <BuildingStateView />;
    }

    if (status === "stopped") {
        return <StoppedStateView onStart={() => model.startBuilder()} />;
    }

    const shouldShowWebView = status === "running" && builderStatus?.port && builderStatus.port !== 0;

    if (shouldShowWebView) {
        const previewUrl = `http://localhost:${builderStatus.port}/?clientid=wave:${builderId}`;
        return (
            <div className="w-full h-full">
                <webview src={previewUrl} className="w-full h-full" />
            </div>
        );
    }

    return null;
});

BuilderPreviewTab.displayName = "BuilderPreviewTab";

export { BuilderPreviewTab };

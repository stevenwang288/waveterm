// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import Logo from "@/app/asset/logo.svg";
import { Button } from "@/app/element/button";
import { EmojiButton } from "@/app/element/emojibutton";
import { MagnifyIcon } from "@/app/element/magnify";
import { ClientModel } from "@/app/store/client-model";
import * as WOS from "@/app/store/wos";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { isMacOS } from "@/util/platformutil";
import { useEffect, useState } from "react";
import { FakeChat } from "./fakechat";
import { EditBashrcCommand, ViewLogoCommand, ViewShortcutsCommand } from "./onboarding-command";
import { CurrentOnboardingVersion } from "./onboarding-common";
import { DurableSessionPage } from "./onboarding-durable";
import { FakeLayout } from "./onboarding-layout";
import { useTranslation, Trans } from "react-i18next";

type FeaturePageName = "waveai" | "magnify" | "files" | "durable";

const WaveAIHeaderButton = () => (
    <span className="inline-flex h-[26px] px-1.5 items-center rounded-md box-border bg-hover text-accent text-[12px] align-middle">
        <i className="fa fa-sparkles" />
        <span className="font-bold ml-1 font-mono">AI</span>
    </span>
);

const MagnifyInlineIcon = () => (
    <span className="inline-block align-middle [&_svg_path]:!fill-foreground">
        <MagnifyIcon enabled={false} />
    </span>
);

const WshViewCommand = () => {
    const { t } = useTranslation();
    return <span className="font-mono font-semibold text-foreground">{t("onboarding.commands.wshView")}</span>;
};

const WshEditCommand = () => {
    const { t } = useTranslation();
    return <span className="font-mono font-semibold text-foreground">{t("onboarding.commands.wshEdit")}</span>;
};

const OnboardingFooter = ({
    currentStep,
    totalSteps,
    onNext,
    onPrev,
    onSkip,
}: {
    currentStep: number;
    totalSteps: number;
    onNext: () => void;
    onPrev?: () => void;
    onSkip?: () => void;
}) => {
    const isLastStep = currentStep === totalSteps;
    const { t } = useTranslation();
    const buttonText = isLastStep ? t("onboarding.getStarted") : t("onboarding.next");

    return (
        <footer className="unselectable flex-shrink-0 mt-5 relative">
            <div className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-2">
                {currentStep > 1 && onPrev && (
                    <button className="text-muted cursor-pointer hover:text-foreground text-[13px]" onClick={onPrev}>
                        &lt; {t("onboarding.prev")}
                    </button>
                )}
                <span className="text-muted text-[13px]">
                    {t("onboarding.stepOf", { currentStep, totalSteps })}
                </span>
            </div>
            <div className="flex flex-row items-center justify-center [&>button]:!px-5 [&>button]:!py-2 [&>button]:text-sm">
                <Button className="font-[600]" onClick={onNext}>
                    {buttonText}
                </Button>
            </div>
            {!isLastStep && onSkip && (
                <button
                    className="absolute right-0 top-1/2 -translate-y-1/2 text-muted cursor-pointer hover:text-muted-hover text-[13px]"
                    onClick={onSkip}
                >
                    {t("onboarding.skipTour")}
                </button>
            )}
        </footer>
    );
};

const WaveAIPage = ({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) => {
    const isMac = isMacOS();
    const shortcutKey = isMac ? "⌘-Shift-A" : "Alt-Shift-A";
    const [fireClicked, setFireClicked] = useState(false);
    const { t } = useTranslation();

    const handleFireClick = () => {
        setFireClicked(!fireClicked);
        if (!fireClicked) {
            RpcApi.RecordTEventCommand(TabRpcClient, {
                event: "onboarding:fire",
                props: {
                    "onboarding:feature": "waveai",
                    "onboarding:version": CurrentOnboardingVersion,
                },
            });
        }
    };

    return (
        <div className="flex flex-col h-full">
            <header className="flex items-center gap-4 mb-6 w-full unselectable flex-shrink-0">
                <div>
                    <Logo />
                </div>
                <div className="text-[25px] font-normal text-foreground">{t("onboarding.waveAiTitle")}</div>
            </header>
            <div className="flex-1 flex flex-row gap-0 min-h-0">
                <div className="flex-1 flex flex-col items-center justify-center gap-8 pr-6 unselectable">
                    <div className="flex flex-col items-start gap-6 max-w-md">
                        <div className="flex h-[52px] px-3 items-center rounded-lg bg-hover text-accent text-[24px]">
                            <i className="fa fa-sparkles" />
                            <span className="font-bold ml-2 font-mono">AI</span>
                        </div>

                        <div className="flex flex-col items-start gap-4 text-secondary">
                            <p>
                                {t("onboarding.waveAiDesc")}
                            </p>

                            <div className="flex items-start gap-3 w-full">
                                <i className="fa fa-sparkles text-accent text-lg mt-1 flex-shrink-0" />
                                <p>
                                    <Trans
                                        i18nKey="onboarding.waveAiToggleWithHeaderButton"
                                        components={[<WaveAIHeaderButton />]}
                                    />
                                </p>
                            </div>

                            <div className="flex items-start gap-3 w-full">
                                <i className="fa fa-keyboard text-accent text-lg mt-1 flex-shrink-0" />
                                <p>
                                    <Trans
                                        i18nKey="onboarding.waveAiToggleWithShortcut"
                                        values={{ shortcutKey }}
                                        components={[
                                            <span className="font-mono font-semibold text-foreground whitespace-nowrap" />,
                                        ]}
                                    />
                                </p>
                            </div>

                            <div className="flex items-start gap-3 w-full">
                                <i className="fa fa-key text-accent text-lg mt-1 flex-shrink-0" />
                                <p>
                                    {t("onboarding.waveAiByokDesc")}
                                </p>
                            </div>

                            <EmojiButton emoji="🔥" isClicked={fireClicked} onClick={handleFireClick} />
                        </div>
                    </div>
                </div>
                <div className="w-[2px] bg-border flex-shrink-0"></div>
                <div className="flex items-center justify-center pl-6 flex-shrink-0 w-[400px]">
                    <div className="w-full h-[400px] bg-background rounded border border-border/50 overflow-hidden">
                        <FakeChat />
                    </div>
                </div>
            </div>
            <OnboardingFooter currentStep={1} totalSteps={4} onNext={onNext} onSkip={onSkip} />
        </div>
    );
};

const MagnifyBlocksPage = ({
    onNext,
    onSkip,
    onPrev,
}: {
    onNext: () => void;
    onSkip: () => void;
    onPrev?: () => void;
}) => {
    const isMac = isMacOS();
    const shortcutKey = isMac ? "⌘" : "Alt";
    const [fireClicked, setFireClicked] = useState(false);
    const { t } = useTranslation();

    const handleFireClick = () => {
        setFireClicked(!fireClicked);
        if (!fireClicked) {
            RpcApi.RecordTEventCommand(TabRpcClient, {
                event: "onboarding:fire",
                props: {
                    "onboarding:feature": "magnify",
                    "onboarding:version": CurrentOnboardingVersion,
                },
            });
        }
    };

    return (
        <div className="flex flex-col h-full">
            <header className="flex items-center gap-4 mb-6 w-full unselectable flex-shrink-0">
                <div>
                    <Logo />
                </div>
                <div className="text-[25px] font-normal text-foreground">{t("onboarding.magnifyTitle")}</div>
            </header>
                <div className="flex-1 flex flex-row gap-0 min-h-0">
                    <div className="flex-1 flex flex-col items-center justify-center gap-8 pr-6 unselectable">
                    <div className="text-6xl font-semibold text-foreground">
                        {t("onboarding.magnifyShortcut", { shortcutKey })}
                    </div>
                    <div className="flex flex-col items-start gap-4 text-secondary max-w-md">
                        <p>
                            {t("onboarding.magnifyDesc1")}
                        </p>
                        <p>{t("onboarding.magnifyDesc2")}</p>
                        <p>
                            <Trans i18nKey="onboarding.magnifyClickIcon" components={[<MagnifyInlineIcon />]} />
                        </p>
                        <p>
                            {t("onboarding.magnifyQuickToggle", { shortcutKey })}
                        </p>
                        <EmojiButton emoji="🔥" isClicked={fireClicked} onClick={handleFireClick} />
                    </div>
                </div>
                <div className="w-[2px] bg-border flex-shrink-0"></div>
                <div className="flex items-center justify-center pl-6 flex-shrink-0 w-[400px]">
                    <FakeLayout />
                </div>
            </div>
            <OnboardingFooter currentStep={3} totalSteps={4} onNext={onNext} onPrev={onPrev} onSkip={onSkip} />
        </div>
    );
};

const FilesPage = ({ onFinish, onPrev }: { onFinish: () => void; onPrev?: () => void }) => {
    const [fireClicked, setFireClicked] = useState(false);
    const isMac = isMacOS();
    const [commandIndex, setCommandIndex] = useState(0);
    const [key, setKey] = useState(0);
    const { t } = useTranslation();

    const handleFireClick = () => {
        setFireClicked(!fireClicked);
        if (!fireClicked) {
            RpcApi.RecordTEventCommand(TabRpcClient, {
                event: "onboarding:fire",
                props: {
                    "onboarding:feature": "wsh",
                    "onboarding:version": CurrentOnboardingVersion,
                },
            });
        }
    };

    const commands = [
        (onComplete: () => void) => <EditBashrcCommand onComplete={onComplete} />,
        (onComplete: () => void) => <ViewShortcutsCommand isMac={isMac} onComplete={onComplete} />,
        (onComplete: () => void) => <ViewLogoCommand onComplete={onComplete} />,
    ];

    const handleCommandComplete = () => {
        setTimeout(() => {
            setCommandIndex((prev) => (prev + 1) % commands.length);
            setKey((prev) => prev + 1);
        }, 2500);
    };

    return (
        <div className="flex flex-col h-full">
            <header className="flex items-center gap-4 mb-6 w-full unselectable flex-shrink-0">
                <div>
                    <Logo />
                </div>
                <div className="text-[25px] font-normal text-foreground">{t("onboarding.filesTitle")}</div>
            </header>
            <div className="flex-1 flex flex-row gap-0 min-h-0">
                <div className="flex-1 flex flex-col items-center justify-center gap-8 pr-6 unselectable">
                    <div className="flex flex-col items-start gap-6 max-w-md">
                        <div className="flex flex-col items-start gap-4 text-secondary">
                            <p>
                                <Trans i18nKey="onboarding.filesDesc" />
                            </p>

                            <div className="flex items-start gap-3 w-full">
                                <i className="fa fa-eye text-accent text-lg mt-1 flex-shrink-0" />
                                <div>
                                    <p className="mb-2">
                                        <Trans
                                            i18nKey="onboarding.filesUseWshView"
                                            components={[<WshViewCommand />]}
                                        />
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-start gap-3 w-full">
                                <i className="fa fa-pen-to-square text-accent text-lg mt-1 flex-shrink-0" />
                                <div>
                                    <p className="mb-2">
                                        <Trans
                                            i18nKey="onboarding.filesUseWshEdit"
                                            components={[<WshEditCommand />]}
                                        />
                                    </p>
                                </div>
                            </div>

                            <p>
                                {t("onboarding.filesCommandsWorkLocallyAndRemotely")}
                            </p>

                            <EmojiButton emoji="🔥" isClicked={fireClicked} onClick={handleFireClick} />
                        </div>
                    </div>
                </div>
                <div className="w-[2px] bg-border flex-shrink-0"></div>
                <div className="flex items-center justify-center pl-6 flex-shrink-0 w-[400px]">
                    {commands[commandIndex](handleCommandComplete)}
                </div>
            </div>
            <OnboardingFooter currentStep={4} totalSteps={4} onNext={onFinish} onPrev={onPrev} />
        </div>
    );
};

export const OnboardingFeatures = ({ onComplete }: { onComplete: () => void }) => {
    const [currentPage, setCurrentPage] = useState<FeaturePageName>("waveai");

    useEffect(() => {
        const clientId = ClientModel.getInstance().clientId;
        RpcApi.SetMetaCommand(TabRpcClient, {
            oref: WOS.makeORef("client", clientId),
            meta: { "onboarding:lastversion": CurrentOnboardingVersion },
        });
        RpcApi.RecordTEventCommand(TabRpcClient, {
            event: "onboarding:start",
            props: {
                "onboarding:version": CurrentOnboardingVersion,
            },
        });
    }, []);

    const handleNext = () => {
        if (currentPage === "waveai") {
            setCurrentPage("durable");
        } else if (currentPage === "durable") {
            setCurrentPage("magnify");
        } else if (currentPage === "magnify") {
            setCurrentPage("files");
        }
    };

    const handlePrev = () => {
        if (currentPage === "durable") {
            setCurrentPage("waveai");
        } else if (currentPage === "magnify") {
            setCurrentPage("durable");
        } else if (currentPage === "files") {
            setCurrentPage("magnify");
        }
    };

    const handleSkip = () => {
        RpcApi.RecordTEventCommand(TabRpcClient, {
            event: "onboarding:skip",
            props: {},
        });
        onComplete();
    };

    const handleFinish = () => {
        onComplete();
    };

    let pageComp: React.JSX.Element = null;
    switch (currentPage) {
        case "waveai":
            pageComp = <WaveAIPage onNext={handleNext} onSkip={handleSkip} />;
            break;
        case "durable":
            pageComp = <DurableSessionPage onNext={handleNext} onSkip={handleSkip} onPrev={handlePrev} />;
            break;
        case "magnify":
            pageComp = <MagnifyBlocksPage onNext={handleNext} onSkip={handleSkip} onPrev={handlePrev} />;
            break;
        case "files":
            pageComp = <FilesPage onFinish={handleFinish} onPrev={handlePrev} />;
            break;
    }

    return <div className="flex flex-col w-full h-full">{pageComp}</div>;
};

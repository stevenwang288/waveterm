// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { getApi } from "@/store/global";
import { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

interface CodexTranslateModalProps {
    text: string;
}

const CodexTranslateModal = memo(({ text }: CodexTranslateModalProps) => {
    const { t } = useTranslation();
    const [isLoading, setIsLoading] = useState(true);
    const [translated, setTranslated] = useState<string>("");
    const [error, setError] = useState<string>("");

    const trimmedText = useMemo(() => (typeof text === "string" ? text.trim() : ""), [text]);

    useEffect(() => {
        let cancelled = false;
        setIsLoading(true);
        setTranslated("");
        setError("");
        (async () => {
            if (!trimmedText) {
                setIsLoading(false);
                setError(t("term.translationFailed"));
                return;
            }
            try {
                const res = await getApi().codexTranslate(trimmedText);
                if (cancelled) return;
                setTranslated(res ?? "");
            } catch (e: any) {
                if (cancelled) return;
                const msg = typeof e?.message === "string" ? e.message : String(e);
                setError(msg || t("term.translationFailed"));
            } finally {
                if (cancelled) return;
                setIsLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [trimmedText, t]);

    const closeModal = () => modalsModel.popModal();

    const copyAndClose = async () => {
        if (!translated) return;
        await navigator.clipboard.writeText(translated);
        closeModal();
    };

    return (
        <Modal
            className="min-w-[640px] max-w-[860px]"
            onClose={closeModal}
            onCancel={closeModal}
            cancelLabel={t("common.close")}
            onOk={translated ? copyAndClose : undefined}
            okLabel={t("common.copy")}
            okDisabled={isLoading || !translated}
        >
            <div className="flex flex-col gap-3">
                <div className="text-lg font-semibold">{t("term.translateSelectionTitle")}</div>
                {isLoading ? (
                    <div className="text-secondary">{t("term.translating")}</div>
                ) : error ? (
                    <div className="text-red-500">
                        {t("term.translationFailed")}: {error}
                    </div>
                ) : (
                    <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded bg-black/20 p-3 text-sm">
                        {translated}
                    </pre>
                )}
            </div>
        </Modal>
    );
});

CodexTranslateModal.displayName = "CodexTranslateModal";

export { CodexTranslateModal };


// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import { getApi } from "@/store/global";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

interface PveCredentialsModalProps {
    host: string;
    origin: string;
    partition: string;
    lang?: string;
    initialUsername?: string;
    initialError?: string;
    onSuccess?: () => void;
    onCancel?: () => void;
}

const PveCredentialsModal = memo(
    ({ host, origin, partition, lang, initialUsername, initialError, onSuccess, onCancel }: PveCredentialsModalProps) => {
        const { t } = useTranslation();
        const [username, setUsername] = useState(initialUsername ?? "");
        const [password, setPassword] = useState("");
        const [error, setError] = useState(initialError ?? "");
        const [isSaving, setIsSaving] = useState(false);

        const trimmedUsername = useMemo(() => (typeof username === "string" ? username.trim() : ""), [username]);

        const closeModal = useCallback(() => {
            modalsModel.popModal();
        }, []);

        const handleCancel = useCallback(() => {
            closeModal();
            onCancel?.();
        }, [closeModal, onCancel]);

        const handleSaveAndLogin = useCallback(async () => {
            if (!trimmedUsername || !password) {
                setError(t("pve.credentials.errors.required"));
                return;
            }

            setIsSaving(true);
            setError("");
            try {
                const storeRes = await getApi().pveStoreCredentials({ host, username: trimmedUsername, password });
                if (!storeRes?.ok) {
                    setError(storeRes?.error || t("pve.credentials.errors.saveFailed"));
                    return;
                }

                const ensureRes = await getApi().pveEnsureAuth({
                    partition,
                    origin,
                    lang,
                    timeoutMs: 8000,
                });
                if (!ensureRes?.ok) {
                    setError(ensureRes?.error || t("pve.credentials.errors.autologinFailed"));
                    return;
                }

                closeModal();
                onSuccess?.();
            } catch (e: any) {
                const msg = typeof e?.message === "string" ? e.message : String(e);
                setError(msg || t("pve.credentials.errors.saveFailed"));
            } finally {
                setIsSaving(false);
            }
        }, [closeModal, host, lang, onSuccess, origin, partition, password, t, trimmedUsername]);

        useEffect(() => {
            const handleKeyDown = (e: KeyboardEvent) => {
                if (e.key === "Escape") {
                    e.preventDefault();
                    handleCancel();
                }
            };
            document.addEventListener("keydown", handleKeyDown);
            return () => document.removeEventListener("keydown", handleKeyDown);
        }, [handleCancel]);

        return (
            <Modal
                className="p-4 min-w-[540px]"
                onClose={handleCancel}
                onCancel={handleCancel}
                cancelLabel={t("common.cancel")}
                onOk={handleSaveAndLogin}
                okLabel={t("pve.credentials.saveAndLogin")}
                okDisabled={isSaving || !trimmedUsername || !password}
            >
                <div className="flex flex-col gap-4">
                    <h2 className="text-xl font-semibold">{t("pve.credentials.title")}</h2>
                    <div className="text-sm text-secondary">{t("pve.credentials.desc")}</div>

                    <div className="text-sm text-secondary">
                        {t("pve.credentials.host")}: <span className="font-medium text-primary">{host}</span>
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-sm text-secondary">{t("pve.credentials.username")}</label>
                        <input
                            type="text"
                            value={username}
                            onChange={(e) => {
                                setUsername(e.target.value);
                                setError("");
                            }}
                            className="px-3 py-2 bg-panel border border-border rounded focus:outline-none focus:border-accent"
                            autoFocus
                            disabled={isSaving}
                            spellCheck={false}
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="text-sm text-secondary">{t("pve.credentials.password")}</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => {
                                setPassword(e.target.value);
                                setError("");
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.nativeEvent.isComposing && trimmedUsername && password) {
                                    void handleSaveAndLogin();
                                }
                            }}
                            className="px-3 py-2 bg-panel border border-border rounded focus:outline-none focus:border-accent"
                            disabled={isSaving}
                            spellCheck={false}
                        />
                    </div>

                    {error && <div className="text-sm text-error whitespace-pre-wrap break-words">{error}</div>}
                </div>
            </Modal>
        );
    }
);

PveCredentialsModal.displayName = "PveCredentialsModal";

export { PveCredentialsModal };


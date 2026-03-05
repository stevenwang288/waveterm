// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getWebServerEndpoint } from "@/util/endpoints";

type WaveEnvelope<T> = {
    success?: boolean;
    error?: string;
    data?: T;
};

export async function waveFetchJson<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers || {});
    const authKey = (window as any)?.api?.getAuthKey?.();
    if (authKey && !headers.has("X-AuthKey")) {
        headers.set("X-AuthKey", String(authKey));
    }
    if (init?.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }
    const resp = await fetch(getWebServerEndpoint() + path, { ...init, headers });
    const text = await resp.text();
    const json = text ? (JSON.parse(text) as WaveEnvelope<T>) : ({} as WaveEnvelope<T>);
    if (json?.error) {
        throw new Error(String(json.error));
    }
    if (json?.success) {
        return json.data as T;
    }
    return json as T;
}


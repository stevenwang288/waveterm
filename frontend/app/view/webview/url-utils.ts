// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export function normalizeWebUrl(rawUrl: string, searchTemplate: string): string {
    let url = rawUrl;
    if (url == null) {
        url = "";
    }

    if (/^(http|https|file):/.test(url)) {
        return url;
    }

    const hostname = url.split("/")[0];
    const isLocal = /^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?$/i.test(hostname);
    if (isLocal) {
        return `http://${url}`;
    }

    const isDomain = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(hostname);
    if (isDomain) {
        return `https://${url}`;
    }

    if (searchTemplate == null) {
        return `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    }
    return searchTemplate.replace("{query}", encodeURIComponent(url));
}

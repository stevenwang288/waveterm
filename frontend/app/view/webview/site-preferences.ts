// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

type PreferredExternalSiteRule = {
    label: string;
    hostSuffixes: string[];
};

const PREFERRED_EXTERNAL_SITE_RULES: PreferredExternalSiteRule[] = [
    {
        label: "Douyin",
        hostSuffixes: ["douyin.com", "iesdouyin.com"],
    },
];

function parseWebUrl(url: string): URL | null {
    if (!url) {
        return null;
    }
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

export function getPreferredExternalSiteLabel(url: string): string | null {
    const parsed = parseWebUrl(url);
    if (parsed == null) {
        return null;
    }
    const hostname = parsed.hostname.toLowerCase();
    const matchedRule = PREFERRED_EXTERNAL_SITE_RULES.find((rule) =>
        rule.hostSuffixes.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`))
    );
    return matchedRule?.label ?? null;
}

export function shouldSuggestExternalBrowser(url: string): boolean {
    return getPreferredExternalSiteLabel(url) != null;
}

export function formatCwdForDisplay(path: string): string {
    if (!path) {
        return "";
    }

    const trimmed = path.trim();
    if (!trimmed) {
        return "";
    }
    if (trimmed === "~" || trimmed === "/" || trimmed === "\\") {
        return trimmed;
    }

    const normalized = trimmed.replace(/[\\/]+$/, "");
    if (!normalized) {
        return trimmed;
    }
    if (/^[A-Za-z]:$/.test(normalized)) {
        return `${normalized}\\`;
    }

    return normalized;
}

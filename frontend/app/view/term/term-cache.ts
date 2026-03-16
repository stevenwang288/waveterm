export const TerminalCacheMetaVersion = 2;

export type TerminalCacheMeta = {
    cacheversion?: number;
    buffertype?: string;
};

export function shouldSaveTerminalCache(bufferType: string | null | undefined): boolean {
    return bufferType !== "alternate";
}

export function createTerminalCacheMeta(bufferType: string | null | undefined): TerminalCacheMeta {
    return {
        cacheversion: TerminalCacheMetaVersion,
        buffertype: bufferType ?? "normal",
    };
}

export function shouldRestoreTerminalCache(cacheMeta: TerminalCacheMeta | null | undefined): boolean {
    if (cacheMeta?.cacheversion !== TerminalCacheMetaVersion) {
        return false;
    }
    return cacheMeta.buffertype !== "alternate";
}

const { Arch } = require("electron-builder");
const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const pkg = require("./package.json");

function getWavesrvArchTag(arch) {
    if (arch === Arch.x64) {
        return "x64";
    }
    if (arch === Arch.arm64) {
        return "arm64";
    }
    if (arch === Arch.ia32) {
        return "x86";
    }
    return String(arch);
}

function runTool(cwd, cmd, args) {
    const result = childProcess.spawnSync(cmd, args, {
        cwd,
        encoding: "utf8",
        windowsHide: true,
    });
    if (result.error || result.status !== 0) {
        return null;
    }
    return String(result.stdout || "").trim();
}

function getDirtyPaths(cwd, roots) {
    const out = runTool(cwd, "git", ["status", "--porcelain=v1", "--", ...roots]);
    if (!out) {
        return [];
    }
    return out
        .split(/\r?\n/g)
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => line.slice(3).trim())
        .filter(Boolean);
}

function assertRequiredFrontendBuild(context) {
    const appDir = context.appDir || context.packager?.projectDir || process.cwd();
    const required = [
        path.join(appDir, "dist", "main", "index.js"),
        path.join(appDir, "dist", "preload", "index.cjs"),
        path.join(appDir, "dist", "frontend", "index.html"),
    ];
    const missing = required.filter((p) => !fs.existsSync(p));
    if (missing.length > 0) {
        throw new Error(
            ["Missing Electron build output under dist/.", ...missing.map((p) => `- ${p}`), "", "Run: npm run build:prod"].join(
                "\n"
            )
        );
    }

    const allowDirty = process.env.WAVETERM_ALLOW_DIRTY_PACKAGE === "1";
    const roots = ["emain", "frontend", "public", "electron.vite.config.ts", "package.json", "package-lock.json"];
    const dirty = getDirtyPaths(appDir, roots);
    if (dirty.length > 0) {
        const sample = dirty.slice(0, 12).join("\n- ");
        const msg = [
            "Detected uncommitted Electron UI/main-process changes. If you package without rebuilding,",
            "the installer may not match the code you just edited.",
            "",
            `Dirty paths (${dirty.length}):`,
            `- ${sample}`,
            dirty.length > 12 ? `- ... (+${dirty.length - 12})` : null,
            "",
            "Fix:",
            "- Run: npm run build:prod",
            "",
            "Override (not recommended): set WAVETERM_ALLOW_DIRTY_PACKAGE=1",
        ]
            .filter(Boolean)
            .join("\n");

        if (!allowDirty) {
            throw new Error(msg);
        }
        console.warn(`[electron-builder] WARNING: ${msg}`);
    }

    if (process.env.WAVETERM_VALIDATE_BUILD_FRESHNESS === "0") {
        return;
    }

    const latestCommitUnixStr = runTool(appDir, "git", ["log", "-1", "--format=%ct", "--", ...roots]);
    const latestCommitUnix = latestCommitUnixStr && /^\d+$/.test(latestCommitUnixStr) ? Number(latestCommitUnixStr) : null;
    if (latestCommitUnix == null) {
        return;
    }
    const outputMtimes = required.map((p) => Math.floor(fs.statSync(p).mtimeMs / 1000));
    const oldestOutput = Math.min(...outputMtimes);
    if (Number.isFinite(oldestOutput) && oldestOutput < latestCommitUnix) {
        throw new Error(
            [
                "Electron build output looks stale (dist/ older than latest commit).",
                `- dist oldest mtime (unix): ${oldestOutput}`,
                `- latest commit (unix):     ${latestCommitUnix}`,
                "",
                "Run: npm run build:prod",
                "",
                "Override: set WAVETERM_VALIDATE_BUILD_FRESHNESS=0",
            ].join("\n")
        );
    }
}

function assertRequiredBackendBinary(context) {
    const archTag = getWavesrvArchTag(context.arch);
    const exeSuffix = context.electronPlatformName === "win32" ? ".exe" : "";
    const appDir = context.appDir || context.packager?.projectDir || process.cwd();
    const wavesrvPath = path.join(appDir, "dist", "bin", `wavesrv.${archTag}${exeSuffix}`);

    if (!fs.existsSync(wavesrvPath)) {
        throw new Error(
            [
                `Missing backend binary: ${wavesrvPath}`,
                "Build the backend first, then package:",
                "- Windows: npm run build:backend:windows",
                "- Standard flow: task package",
            ].join("\n")
        );
    }

    const allowDirty = process.env.WAVETERM_ALLOW_DIRTY_PACKAGE === "1";
    const backendRoots = ["go.mod", "go.sum", "cmd", "pkg", "tsunami"];

    const dirtyPaths = getDirtyPaths(appDir, backendRoots);
    if (dirtyPaths.length > 0) {
        const sample = dirtyPaths.slice(0, 12).join("\n- ");
        const msg = [
            "Detected uncommitted backend changes. Packaging can easily include an old `wavesrv` binary, causing",
            "the installed app to behave differently than your current code.",
            "",
            `Backend changes (${dirtyPaths.length}):`,
            `- ${sample}`,
            dirtyPaths.length > 12 ? `- ... (+${dirtyPaths.length - 12})` : null,
            "",
            "Fix:",
            "- Rebuild backend: npm run build:backend:windows",
            "- Then package again",
            "",
            "Override (not recommended): set WAVETERM_ALLOW_DIRTY_PACKAGE=1",
        ]
            .filter(Boolean)
            .join("\n");

        if (!allowDirty) {
            throw new Error(msg);
        }
        console.warn(`[electron-builder] WARNING: ${msg}`);
        return;
    }

    const latestBackendCommitTimeStr = runTool(appDir, "git", [
        "log",
        "-1",
        "--format=%cd",
        "--date=format:%Y%m%d%H%M",
        "--",
        ...backendRoots,
    ]);
    const latestBackendCommitTime =
        latestBackendCommitTimeStr && /^\d{12}$/.test(latestBackendCommitTimeStr) ? Number(latestBackendCommitTimeStr) : null;

    const goMeta = runTool(appDir, "go", ["version", "-m", wavesrvPath]);
    const match = goMeta ? goMeta.match(/-X\s+main\.BuildTime=(\d{12})/) : null;
    const wavesrvBuildTime = match ? Number(match[1]) : null;

    if (latestBackendCommitTime != null && wavesrvBuildTime != null && wavesrvBuildTime < latestBackendCommitTime) {
        const msg = [
            `Backend binary looks stale: ${wavesrvPath}`,
            `- wavesrv BuildTime: ${wavesrvBuildTime}`,
            `- latest backend commit: ${latestBackendCommitTime}`,
            "",
            "Rebuild backend and package again:",
            "- Windows: npm run build:backend:windows",
            "- Standard flow: task package",
        ].join("\n");

        if (!allowDirty) {
            throw new Error(msg);
        }
        console.warn(`[electron-builder] WARNING: ${msg}`);
    }
}

/** @type {import('electron-builder').Configuration} */
const config = {
    appId: pkg.build.appId,
    productName: pkg.productName,
    executableName: pkg.productName,
    artifactName: "${productName}-${platform}-${arch}-${version}.${ext}",
    npmRebuild: false,
    nodeGypRebuild: false,
    electronCompile: false,
    directories: {
        output: path.join("make", pkg.version),
    },
    files: [
        {
            from: "dist",
            to: "dist",
            filter: [
                "**/*",
                "!win-unpacked/**/*",
                "!builder-debug.yml",
                "!builder-effective-config.yaml",
                "!bin/*",
                "bin/wavesrv.${arch}*",
                "bin/wsh*",
                "!tsunamiscaffold/**/*",
            ],
        },
        "package.json",
    ],
    extraResources: [
        {
            from: "dist/tsunamiscaffold",
            to: "tsunamiscaffold",
        },
    ],
    asarUnpack: ["dist/bin/**/*", "dist/schema/**/*"],
    win: {
        target: ["nsis"],
        icon: "build/icon.ico",
    },
    nsis: {
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        installerIcon: "build/icon.ico",
        uninstallerIcon: "build/icon.ico",
        installerHeaderIcon: "build/icon.ico",
    },
    publish: null,
    beforePack: (context) => {
        assertRequiredFrontendBuild(context);
        assertRequiredBackendBinary(context);
    },
    afterPack: (_context) => {
        // Workaround logic adapted for new path if needed, but mostly for macOS
    },
};

module.exports = config;

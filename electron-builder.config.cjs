const { Arch } = require("electron-builder");
const pkg = require("./package.json");
const fs = require("fs");
const path = require("path");

const windowsShouldSign = !!process.env.SM_CODE_SIGNING_CERT_SHA1_HASH;

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

function assertRequiredBackendBinary(context) {
    const archTag = getWavesrvArchTag(context.arch);
    const exeSuffix = context.electronPlatformName === "win32" ? ".exe" : "";
    const appDir = context.appDir || context.packager?.projectDir || process.cwd();
    const wavesrvPath = path.join(appDir, "dist", "bin", `wavesrv.${archTag}${exeSuffix}`);
    if (!fs.existsSync(wavesrvPath)) {
        throw new Error(
            [
                `缺少后端二进制: ${wavesrvPath}`,
                "请先执行后端构建后再打包：",
                "- Windows: npm run build:backend:windows",
                "- 跨平台标准流程: task package",
            ].join("\n")
        );
    }
}

const config = {
    appId: pkg.build.appId,
    productName: pkg.productName,
    executableName: pkg.productName,
    artifactName: "${productName}-${platform}-${arch}-${version}.${ext}",
    npmRebuild: false,
    nodeGypRebuild: false,
    electronCompile: false,
    directories: {
        output: "make",
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
        "package.json"
    ],
    extraResources: [
        {
            from: "dist/tsunamiscaffold",
            to: "tsunamiscaffold",
        },
    ],
    asarUnpack: [
        "dist/bin/**/*",
        "dist/schema/**/*",
    ],
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
        assertRequiredBackendBinary(context);
    },
    afterPack: (context) => {
         // Workaround logic adapted for new path if needed, but mostly for macOS
    },
};

module.exports = config;

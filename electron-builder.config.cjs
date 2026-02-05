const { Arch } = require("electron-builder");
const pkg = require("./package.json");
const fs = require("fs");
const path = require("path");

const windowsShouldSign = !!process.env.SM_CODE_SIGNING_CERT_SHA1_HASH;

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
    },
    nsis: {
        oneClick: false,
        allowToChangeInstallationDirectory: true
    },
    publish: null,
    afterPack: (context) => {
         // Workaround logic adapted for new path if needed, but mostly for macOS
    },
};

module.exports = config;

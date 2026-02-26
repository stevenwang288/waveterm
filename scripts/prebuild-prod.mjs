import { spawnSync } from "node:child_process";
import path from "node:path";

function commandExists(command) {
    const result = spawnSync("cmd.exe", ["/c", `where ${command}`], { stdio: "ignore" });
    return result.status === 0;
}

function runTool(cmd, args, opts = {}) {
    const result = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, ...opts });
    if (result.error || result.status !== 0) {
        return null;
    }
    return String(result.stdout || "").trim();
}

function getWavesrvArchTag() {
    if (process.arch === "x64") {
        return "x64";
    }
    if (process.arch === "arm64") {
        return "arm64";
    }
    if (process.arch === "ia32") {
        return "x86";
    }
    return String(process.arch);
}

function getWavesrvBuildTime(wavesrvPath) {
    const out = runTool("go", ["version", "-m", wavesrvPath]);
    if (!out) {
        return null;
    }
    const match = out.match(/-X\\s+main\\.BuildTime=(\\d{12})/);
    if (!match) {
        return null;
    }
    return Number(match[1]);
}

function getLatestBackendCommitTime() {
    const backendRoots = ["go.mod", "go.sum", "cmd", "pkg", "tsunami"];
    const out = runTool("git", ["log", "-1", "--format=%cd", "--date=format:%Y%m%d%H%M", "--", ...backendRoots]);
    if (!out || !/^\\d{12}$/.test(out)) {
        return null;
    }
    return Number(out);
}

function shouldRebuildBackend() {
    const archTag = getWavesrvArchTag();
    const exeSuffix = process.platform === "win32" ? ".exe" : "";
    const wavesrvPath = path.join(process.cwd(), "dist", "bin", `wavesrv.${archTag}${exeSuffix}`);

    const latestBackendCommitTime = getLatestBackendCommitTime();
    const wavesrvBuildTime = getWavesrvBuildTime(wavesrvPath);

    if (latestBackendCommitTime == null || wavesrvBuildTime == null) {
        return false;
    }
    return wavesrvBuildTime < latestBackendCommitTime;
}

if (!shouldRebuildBackend()) {
    process.exit(0);
}

if (!commandExists("task")) {
    if (process.platform === "win32") {
        console.log("[prebuild:prod] backend binary looks stale; rebuilding via scripts/build-backend-windows.ps1...");
        const psResult = spawnSync(
            "powershell.exe",
            ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/build-backend-windows.ps1"],
            { stdio: "inherit" }
        );
        process.exit(psResult.status ?? 1);
    }
    console.log("[prebuild:prod] backend binary looks stale, but 'task' not found. (Packaging will validate backend binaries.)");
    process.exit(0);
}

const result = spawnSync("task", ["build:backend"], { stdio: "inherit" });
process.exit(result.status ?? 1);

import { spawnSync } from "node:child_process";

function commandExists(command) {
    const result = spawnSync("cmd.exe", ["/c", `where ${command}`], { stdio: "ignore", windowsHide: true });
    return result.status === 0;
}

if (commandExists("task")) {
    const result = spawnSync("task", ["build:backend:quickdev:windows"], { stdio: "inherit", windowsHide: true });
    process.exit(result.status ?? 1);
}

const psResult = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/build-backend-windows.ps1"],
    { stdio: "inherit", windowsHide: true }
);
process.exit(psResult.status ?? 1);


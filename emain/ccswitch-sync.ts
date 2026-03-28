import * as child_process from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { getGooseAppConfig, getGooseBaseUrl, getGooseSecretKey } from "./goose-runtime";

const execFileAsync = promisify(child_process.execFile);
const ccSwitchSyncFilename = fileURLToPath(import.meta.url);
const ccSwitchSyncDirname = path.dirname(ccSwitchSyncFilename);
const CcSwitchHomeDir = path.join(os.homedir(), ".cc-switch");
const CcSwitchSettingsPath = path.join(CcSwitchHomeDir, "settings.json");
const CcSwitchDbPath = path.join(CcSwitchHomeDir, "cc-switch.db");
const GooseCcSwitchProviderId = "custom_ccswitch_codex";
const GooseCcSwitchProviderDisplayName = "CCSwitch Codex";

type CcSwitchSyncTarget = "deerflow" | "goose" | "promptoptimizer" | "all";

type CcSwitchDbPayload = {
    provider_id: string;
    provider_name: string;
    settings_config: string;
    website_url?: string;
    endpoint_url?: string;
};

type CcSwitchProviderProfile = {
    providerId: string;
    providerName: string;
    model: string;
    apiKey: string;
    baseUrl: string;
    apiBaseUrl: string;
    wireApi: string;
    gooseApiUrl: string;
    gooseBasePath: string;
};

type CcSwitchSyncResult = {
    target: CcSwitchSyncTarget;
    providerId: string;
    providerName: string;
    model: string;
    baseUrl: string;
    apiBaseUrl: string;
    updatedFiles: string[];
};

const PythonSqliteQuery = `
import json
import sqlite3
import sys

db_path = sys.argv[1]
provider_id = sys.argv[2]

conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cur = conn.cursor()
provider = cur.execute("select * from providers where id = ?", (provider_id,)).fetchone()
endpoint = cur.execute(
    "select url from provider_endpoints where provider_id = ? order by id desc limit 1",
    (provider_id,),
).fetchone()

if provider is None:
    raise SystemExit(f"provider not found: {provider_id}")

payload = {
    "provider_id": provider_id,
    "provider_name": provider["name"],
    "settings_config": provider["settings_config"],
    "website_url": provider["website_url"],
    "endpoint_url": endpoint["url"] if endpoint else "",
}

print(json.dumps(payload, ensure_ascii=False))
`;

function isWorkspaceRoot(candidate: string): boolean {
    return fs.existsSync(path.join(candidate, "deer-flow-main")) && fs.existsSync(path.join(candidate, "prompt-optimizer"));
}

function getWorkspaceRoot() {
    const envRoot = process.env.WAVE_GOOSE_WORKING_DIR?.trim();
    if (envRoot && isWorkspaceRoot(envRoot)) {
        return envRoot;
    }

    const candidates = [
        path.resolve(ccSwitchSyncDirname, "..", "..", ".."),
        path.resolve(ccSwitchSyncDirname, "..", ".."),
    ];

    for (const candidate of candidates) {
        if (isWorkspaceRoot(candidate)) {
            return candidate;
        }
    }

    return path.resolve(ccSwitchSyncDirname, "..", "..");
}

function normalizeOpenAiBaseUrl(rawUrl: string): string {
    const normalizedUrl = (rawUrl ?? "").trim();
    if (!normalizedUrl) {
        throw new Error("CCSwitch 当前 provider 没有 base_url。");
    }

    const parsed = new URL(normalizedUrl);
    let pathname = parsed.pathname.replace(/\/+$/, "");
    if (pathname.endsWith("/chat/completions")) {
        pathname = pathname.slice(0, -"/chat/completions".length);
    }
    if (pathname.endsWith("/responses")) {
        pathname = pathname.slice(0, -"/responses".length);
    }
    if (pathname === "") {
        pathname = "/v1";
    }
    parsed.pathname = pathname;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
}

function normalizeGooseApiUrl(rawUrl: string): string {
    const parsed = new URL((rawUrl ?? "").trim());
    parsed.pathname = "/";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
}

function isResponsesModel(model: string): boolean {
    const normalizedModel = (model ?? "").trim().toLowerCase();
    return (
        (normalizedModel.startsWith("gpt-5") && normalizedModel.includes("codex")) ||
        normalizedModel.startsWith("gpt-5.2-pro") ||
        normalizedModel.startsWith("gpt-5.4")
    );
}

function buildGooseBasePath(rawUrl: string, wireApi: string, model: string): string {
    const parsed = new URL((rawUrl ?? "").trim());
    let pathname = parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!pathname) {
        pathname = "v1";
    }
    if (pathname.endsWith("chat/completions") || pathname.endsWith("responses")) {
        return pathname;
    }

    const normalizedWireApi = wireApi.trim().toLowerCase().replace(/_/g, "/");
    const suffix =
        normalizedWireApi === "chat/completions"
            ? "chat/completions"
            : normalizedWireApi === "responses" || isResponsesModel(model)
              ? "responses"
              : "chat/completions";
    return `${pathname}/${suffix}`;
}

function extractTomlStringValue(configText: string, key: string, section?: string): string {
    const lines = configText.split(/\r?\n/);
    let currentSection = "";

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (line === "" || line.startsWith("#")) {
            continue;
        }
        const sectionMatch = line.match(/^\[(.+)\]$/);
        if (sectionMatch) {
            currentSection = sectionMatch[1];
            continue;
        }
        const keyMatch = rawLine.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*"([^"]*)"\s*$/);
        if (!keyMatch) {
            continue;
        }
        if (keyMatch[1] !== key) {
            continue;
        }
        if ((section ?? "") !== currentSection) {
            continue;
        }
        return keyMatch[2];
    }

    return "";
}

async function runPythonQuery(script: string, args: string[]): Promise<string> {
    const candidates: Array<{ cmd: string; extraArgs: string[] }> = [
        { cmd: process.env.PYTHON || "python", extraArgs: [] },
        { cmd: "py", extraArgs: ["-3"] },
    ];

    let lastError: unknown = null;
    for (const candidate of candidates) {
        try {
            const { stdout } = await execFileAsync(candidate.cmd, [...candidate.extraArgs, "-c", script, ...args], {
                windowsHide: true,
                maxBuffer: 1024 * 1024,
            });
            return stdout.trim();
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError instanceof Error ? lastError : new Error("无法调用 Python 读取 CCSwitch 数据。");
}

async function loadCurrentCodexProviderProfile(): Promise<CcSwitchProviderProfile> {
    const settingsRaw = await fs.promises.readFile(CcSwitchSettingsPath, "utf8");
    const settings = JSON.parse(settingsRaw) as { currentProviderCodex?: string };
    const providerId = settings.currentProviderCodex?.trim();
    if (!providerId) {
        throw new Error("CCSwitch 没有 currentProviderCodex。");
    }

    const payloadRaw = await runPythonQuery(PythonSqliteQuery, [CcSwitchDbPath, providerId]);
    const payload = JSON.parse(payloadRaw) as CcSwitchDbPayload;
    const settingsConfig = JSON.parse(payload.settings_config ?? "{}") as {
        auth?: Record<string, string>;
        config?: string;
    };
    const configText = settingsConfig.config ?? "";
    const providerKey = extractTomlStringValue(configText, "model_provider") || "custom";
    const model = extractTomlStringValue(configText, "model");
    const wireApi = extractTomlStringValue(configText, "wire_api", `model_providers.${providerKey}`);
    const rawBaseUrl =
        extractTomlStringValue(configText, "base_url", `model_providers.${providerKey}`) ||
        payload.endpoint_url ||
        payload.website_url ||
        "";
    const apiKey = settingsConfig.auth?.OPENAI_API_KEY?.trim() || "";

    if (!model) {
        throw new Error("CCSwitch 当前 provider 缺少 model。");
    }
    if (!apiKey) {
        throw new Error("CCSwitch 当前 provider 缺少 OPENAI_API_KEY。");
    }

    return {
        providerId,
        providerName: payload.provider_name || providerId,
        model,
        apiKey,
        baseUrl: rawBaseUrl.trim(),
        apiBaseUrl: normalizeOpenAiBaseUrl(rawBaseUrl),
        wireApi,
        gooseApiUrl: normalizeGooseApiUrl(rawBaseUrl),
        gooseBasePath: buildGooseBasePath(rawBaseUrl, wireApi, model),
    };
}

function updateFirstDeerFlowModelBlock(content: string, profile: CcSwitchProviderProfile): string {
    const lines = content.split(/\r?\n/);
    let inModelsSection = false;
    let firstModelStarted = false;
    let firstModelEnded = false;

    const displayName = profile.model.toUpperCase().startsWith("GPT")
        ? profile.model.toUpperCase()
        : profile.model;

    for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (!inModelsSection) {
            if (line.trim() === "models:") {
                inModelsSection = true;
            }
            continue;
        }

        if (!firstModelStarted) {
            if (/^\S/.test(line) && line.trim() !== "models:") {
                break;
            }
            if (/^\s{2}-\s+name:/.test(line)) {
                firstModelStarted = true;
                lines[index] = `  - name: ${profile.model}`;
            }
            continue;
        }

        if (/^\s{2}-\s+/.test(line)) {
            firstModelEnded = true;
        }
        if (/^\S/.test(line)) {
            firstModelEnded = true;
        }
        if (firstModelEnded) {
            break;
        }

        if (/^\s{4}display_name:/.test(line)) {
            lines[index] = `    display_name: ${displayName}`;
            continue;
        }
        if (/^\s{4}model:/.test(line)) {
            lines[index] = `    model: ${profile.model}`;
            continue;
        }
        if (/^\s{4}api_key:/.test(line)) {
            lines[index] = `    api_key: "${profile.apiKey}"`;
            continue;
        }
        if (/^\s{4}base_url:/.test(line)) {
            lines[index] = `    base_url: ${profile.apiBaseUrl}`;
        }
    }

    if (!firstModelStarted) {
        throw new Error("DeerFlow config.yaml 中没有找到首个 models 配置块。");
    }

    return lines.join("\n");
}

function updateEnvFile(content: string, key: string, value: string): string {
    const pattern = new RegExp(`^${key}=.*$`, "m");
    if (pattern.test(content)) {
        return content.replace(pattern, `${key}=${value}`);
    }
    const suffix = content.endsWith("\n") ? "" : "\n";
    return `${content}${suffix}${key}=${value}\n`;
}

function buildPromptOptimizerRuntimeConfig(profile: CcSwitchProviderProfile): string {
    const runtimeConfig = {
        CUSTOM_API_KEY: profile.apiKey,
        CUSTOM_API_BASE_URL: profile.apiBaseUrl,
        CUSTOM_API_MODEL: profile.model,
        PREFERRED_OPTIMIZE_MODEL: "custom",
        PREFERRED_TEST_MODEL: "custom",
        PREFERRED_IMAGE_TEXT_MODEL: "custom",
        PREFERRED_EVALUATION_MODEL: "custom",
        PREFERRED_IMAGE_RECOGNITION_MODEL: "custom",
    };

    return [
        "// 由 Wave 按当前 CCSwitch provider 自动生成",
        `window.runtime_config = ${JSON.stringify(runtimeConfig, null, 2)};`,
        'console.log("使用 CCSwitch 运行时配置");',
        "",
    ].join("\n");
}

async function writeIfChanged(filePath: string, nextContent: string): Promise<boolean> {
    const currentContent = await fs.promises.readFile(filePath, "utf8");
    if (currentContent === nextContent) {
        return false;
    }
    await fs.promises.writeFile(filePath, nextContent, "utf8");
    return true;
}

async function readOptionalFile(filePath: string): Promise<string | null> {
    try {
        return await fs.promises.readFile(filePath, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

async function diffTrackedFiles(filePaths: string[], beforeContents: Array<string | null>): Promise<string[]> {
    const updatedFiles: string[] = [];
    for (let index = 0; index < filePaths.length; index++) {
        const afterContent = await readOptionalFile(filePaths[index]);
        if (beforeContents[index] !== afterContent) {
            updatedFiles.push(filePaths[index]);
        }
    }
    return updatedFiles;
}

async function fetchGooseConfig(
    baseUrl: string,
    secretKey: string,
    pathname: string,
    init?: RequestInit
): Promise<Response> {
    return fetch(`${baseUrl}${pathname}`, {
        ...init,
        headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Secret-Key": secretKey,
            ...(init?.headers ?? {}),
        },
    });
}

async function throwGooseSyncError(action: string, response: Response): Promise<never> {
    const body = (await response.text()).trim();
    throw new Error(
        `[Goose] ${action}失败: ${response.status} ${response.statusText}${body ? ` - ${body}` : ""}`
    );
}

async function syncDeerFlow(profile: CcSwitchProviderProfile): Promise<string[]> {
    const workspaceRoot = getWorkspaceRoot();
    const deerFlowDir = path.join(workspaceRoot, "deer-flow-main");
    const configPath = path.join(deerFlowDir, "config.yaml");
    const envPath = path.join(deerFlowDir, ".env");

    const updatedFiles: string[] = [];
    const configContent = await fs.promises.readFile(configPath, "utf8");
    const nextConfigContent = updateFirstDeerFlowModelBlock(configContent, profile);
    if (await writeIfChanged(configPath, nextConfigContent)) {
        updatedFiles.push(configPath);
    }

    const envContent = await fs.promises.readFile(envPath, "utf8");
    const nextEnvContent = updateEnvFile(envContent, "OPENAI_API_KEY", profile.apiKey);
    if (await writeIfChanged(envPath, nextEnvContent)) {
        updatedFiles.push(envPath);
    }

    return updatedFiles;
}

async function syncPromptOptimizer(profile: CcSwitchProviderProfile): Promise<string[]> {
    const workspaceRoot = getWorkspaceRoot();
    const promptOptimizerDir = path.join(workspaceRoot, "prompt-optimizer");
    const runtimeConfigPath = path.join(promptOptimizerDir, "packages", "web", "public", "config.js");
    const nextRuntimeConfig = buildPromptOptimizerRuntimeConfig(profile);
    const updatedFiles: string[] = [];

    if (await writeIfChanged(runtimeConfigPath, nextRuntimeConfig)) {
        updatedFiles.push(runtimeConfigPath);
    }

    return updatedFiles;
}

async function syncGoose(profile: CcSwitchProviderProfile): Promise<string[]> {
    const gooseAppConfig = getGooseAppConfig() as { GOOSE_CONFIG_DIR?: string };
    const configDir = gooseAppConfig.GOOSE_CONFIG_DIR;
    if (!configDir) {
        throw new Error("Goose runtime config 目录不可用。");
    }

    const trackedFiles = [
        path.join(configDir, "config.yaml"),
        path.join(configDir, "secrets.yaml"),
        path.join(configDir, "custom_providers", `${GooseCcSwitchProviderId}.json`),
    ];
    const beforeContents = await Promise.all(trackedFiles.map((filePath) => readOptionalFile(filePath)));
    const [baseUrl, secretKey] = await Promise.all([getGooseBaseUrl(), getGooseSecretKey()]);
    const providerPayload = {
        engine: "openai_compatible",
        display_name: GooseCcSwitchProviderDisplayName,
        api_url: profile.gooseApiUrl,
        api_key: profile.apiKey,
        models: [profile.model],
        supports_streaming: false,
        requires_auth: true,
        base_path: profile.gooseBasePath,
    };

    const existingProviderResponse = await fetchGooseConfig(
        baseUrl,
        secretKey,
        `/config/custom-providers/${GooseCcSwitchProviderId}`
    );

    let activeProvider = GooseCcSwitchProviderId;
    if (existingProviderResponse.status === 404) {
        const createResponse = await fetchGooseConfig(baseUrl, secretKey, "/config/custom-providers", {
            method: "POST",
            body: JSON.stringify(providerPayload),
        });
        if (!createResponse.ok) {
            await throwGooseSyncError("创建自定义 provider", createResponse);
        }
        const createResult = (await createResponse.json()) as { provider_name?: string };
        activeProvider = createResult.provider_name?.trim() || GooseCcSwitchProviderId;
    } else {
        if (!existingProviderResponse.ok) {
            await throwGooseSyncError("读取自定义 provider", existingProviderResponse);
        }
        const updateResponse = await fetchGooseConfig(
            baseUrl,
            secretKey,
            `/config/custom-providers/${GooseCcSwitchProviderId}`,
            {
                method: "PUT",
                body: JSON.stringify(providerPayload),
            }
        );
        if (!updateResponse.ok) {
            await throwGooseSyncError("更新自定义 provider", updateResponse);
        }
    }

    const setProviderResponse = await fetchGooseConfig(baseUrl, secretKey, "/config/set_provider", {
        method: "POST",
        body: JSON.stringify({
            provider: activeProvider,
            model: profile.model,
        }),
    });
    if (!setProviderResponse.ok) {
        await throwGooseSyncError("切换当前 provider", setProviderResponse);
    }

    return diffTrackedFiles(trackedFiles, beforeContents);
}

export async function syncCcSwitchTarget(target: CcSwitchSyncTarget): Promise<CcSwitchSyncResult> {
    const normalizedTarget: CcSwitchSyncTarget =
        target === "deerflow" || target === "goose" || target === "promptoptimizer" ? target : "all";
    const profile = await loadCurrentCodexProviderProfile();
    const updatedFiles: string[] = [];

    if (normalizedTarget === "deerflow" || normalizedTarget === "all") {
        updatedFiles.push(...(await syncDeerFlow(profile)));
    }
    if (normalizedTarget === "goose" || normalizedTarget === "all") {
        updatedFiles.push(...(await syncGoose(profile)));
    }
    if (normalizedTarget === "promptoptimizer" || normalizedTarget === "all") {
        updatedFiles.push(...(await syncPromptOptimizer(profile)));
    }

    return {
        target: normalizedTarget,
        providerId: profile.providerId,
        providerName: profile.providerName,
        model: profile.model,
        baseUrl: profile.baseUrl,
        apiBaseUrl: profile.apiBaseUrl,
        updatedFiles,
    };
}

export type { CcSwitchSyncResult, CcSwitchSyncTarget };

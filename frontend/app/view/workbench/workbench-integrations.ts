type TomlMultilineDelimiter = '"""' | "'''";

export type WorkbenchMcpServerType = "stdio" | "streamable_http" | "sse";

export type WorkbenchMcpServerConfig = {
    name: string;
    type: WorkbenchMcpServerType;
    command: string;
    args: string[];
    url: string;
    bearerTokenEnvVar: string;
    envVars: string[];
    startupTimeoutSec: string;
};

export type WorkbenchSkillConfig = {
    path: string;
    enabled: boolean;
};

export type WorkbenchIntegrationsConfig = {
    codex: {
        modelProvider: string;
        model: string;
        modelReasoningEffort: string;
        planModeReasoningEffort: string;
        approvalPolicy: string;
        sandboxMode: string;
        disableResponseStorage: boolean;
        suppressUnstableFeaturesWarning: boolean;
    };
    provider: {
        providerName: string;
        baseUrl: string;
        wireApi: string;
        requiresOpenAIAuth: boolean;
    };
    mcpServers: WorkbenchMcpServerConfig[];
    skills: {
        bundledEnabled: boolean;
        configs: WorkbenchSkillConfig[];
    };
};

type TomlSectionRange = {
    name: string;
    start: number;
    end: number;
};

const DEFAULT_WORKBENCH_INTEGRATIONS_CONFIG: WorkbenchIntegrationsConfig = {
    codex: {
        modelProvider: "",
        model: "",
        modelReasoningEffort: "xhigh",
        planModeReasoningEffort: "xhigh",
        approvalPolicy: "never",
        sandboxMode: "danger-full-access",
        disableResponseStorage: true,
        suppressUnstableFeaturesWarning: true,
    },
    provider: {
        providerName: "",
        baseUrl: "",
        wireApi: "responses",
        requiresOpenAIAuth: true,
    },
    mcpServers: [],
    skills: {
        bundledEnabled: true,
        configs: [],
    },
};

export function createDefaultWorkbenchIntegrationsConfig(): WorkbenchIntegrationsConfig {
    return {
        codex: { ...DEFAULT_WORKBENCH_INTEGRATIONS_CONFIG.codex },
        provider: { ...DEFAULT_WORKBENCH_INTEGRATIONS_CONFIG.provider },
        mcpServers: [],
        skills: {
            bundledEnabled: DEFAULT_WORKBENCH_INTEGRATIONS_CONFIG.skills.bundledEnabled,
            configs: [],
        },
    };
}

export function parseWorkbenchIntegrationsConfig(content: string): WorkbenchIntegrationsConfig {
    const nextConfig = createDefaultWorkbenchIntegrationsConfig();
    const providerConfigs = new Map<string, Partial<WorkbenchIntegrationsConfig["provider"]>>();
    let currentSection = "";
    let currentMcpServer: WorkbenchMcpServerConfig | null = null;
    let currentSkillConfig: WorkbenchSkillConfig | null = null;
    let activeProviderName = "";
    let multilineDelimiter: TomlMultilineDelimiter | null = null;
    const lines = content.replace(/\r\n/g, "\n").split("\n");

    for (const rawLine of lines) {
        multilineDelimiter = updateTomlMultilineDelimiter(rawLine, multilineDelimiter);
        if (multilineDelimiter != null) {
            continue;
        }

        const line = stripTomlComment(rawLine).trim();
        if (line === "") {
            continue;
        }

        const arraySectionMatch = line.match(/^\[\[(.+)\]\]$/);
        if (arraySectionMatch) {
            currentSection = arraySectionMatch[1]?.trim() ?? "";
            currentMcpServer = null;
            activeProviderName = "";
            if (currentSection === "skills.config") {
                currentSkillConfig = { path: "", enabled: true };
                nextConfig.skills.configs.push(currentSkillConfig);
            } else {
                currentSkillConfig = null;
            }
            continue;
        }

        const sectionMatch = line.match(/^\[(.+)\]$/);
        if (sectionMatch) {
            currentSection = sectionMatch[1]?.trim() ?? "";
            currentSkillConfig = null;
            currentMcpServer = null;
            activeProviderName = "";

            if (currentSection.startsWith("mcp_servers.")) {
                const serverName = parseDottedSectionTail(currentSection, "mcp_servers");
                currentMcpServer = {
                    name: serverName,
                    type: "stdio",
                    command: "",
                    args: [],
                    url: "",
                    bearerTokenEnvVar: "",
                    envVars: [],
                    startupTimeoutSec: "",
                };
                nextConfig.mcpServers.push(currentMcpServer);
            } else if (currentSection.startsWith("model_providers.")) {
                activeProviderName = parseDottedSectionTail(currentSection, "model_providers");
            }
            continue;
        }

        const assignmentMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
        if (assignmentMatch == null) {
            continue;
        }

        const [, key, rawValue] = assignmentMatch;
        if (currentSection === "") {
            if (key === "model_provider") {
                nextConfig.codex.modelProvider = parseTomlStringValue(rawValue) ?? nextConfig.codex.modelProvider;
            } else if (key === "model") {
                nextConfig.codex.model = parseTomlStringValue(rawValue) ?? nextConfig.codex.model;
            } else if (key === "model_reasoning_effort") {
                nextConfig.codex.modelReasoningEffort =
                    parseTomlStringValue(rawValue) ?? nextConfig.codex.modelReasoningEffort;
            } else if (key === "plan_mode_reasoning_effort") {
                nextConfig.codex.planModeReasoningEffort =
                    parseTomlStringValue(rawValue) ?? nextConfig.codex.planModeReasoningEffort;
            } else if (key === "approval_policy") {
                nextConfig.codex.approvalPolicy = parseTomlStringValue(rawValue) ?? nextConfig.codex.approvalPolicy;
            } else if (key === "sandbox_mode") {
                nextConfig.codex.sandboxMode = parseTomlStringValue(rawValue) ?? nextConfig.codex.sandboxMode;
            } else if (key === "disable_response_storage") {
                nextConfig.codex.disableResponseStorage =
                    parseTomlBooleanValue(rawValue) ?? nextConfig.codex.disableResponseStorage;
            } else if (key === "suppress_unstable_features_warning") {
                nextConfig.codex.suppressUnstableFeaturesWarning =
                    parseTomlBooleanValue(rawValue) ?? nextConfig.codex.suppressUnstableFeaturesWarning;
            }
            continue;
        }

        if (currentSkillConfig != null && currentSection === "skills.config") {
            if (key === "path") {
                currentSkillConfig.path = parseTomlStringValue(rawValue) ?? currentSkillConfig.path;
            } else if (key === "enabled") {
                currentSkillConfig.enabled = parseTomlBooleanValue(rawValue) ?? currentSkillConfig.enabled;
            }
            continue;
        }

        if (currentSection === "skills.bundled" && key === "enabled") {
            nextConfig.skills.bundledEnabled = parseTomlBooleanValue(rawValue) ?? nextConfig.skills.bundledEnabled;
            continue;
        }

        if (currentMcpServer != null) {
            if (key === "type") {
                const parsedType = parseTomlStringValue(rawValue);
                if (parsedType === "stdio" || parsedType === "streamable_http" || parsedType === "sse") {
                    currentMcpServer.type = parsedType;
                }
            } else if (key === "command") {
                currentMcpServer.command = parseTomlStringValue(rawValue) ?? currentMcpServer.command;
            } else if (key === "args") {
                currentMcpServer.args = parseTomlStringArray(rawValue);
            } else if (key === "url") {
                currentMcpServer.url = parseTomlStringValue(rawValue) ?? currentMcpServer.url;
            } else if (key === "bearer_token_env_var") {
                currentMcpServer.bearerTokenEnvVar =
                    parseTomlStringValue(rawValue) ?? currentMcpServer.bearerTokenEnvVar;
            } else if (key === "env_vars") {
                currentMcpServer.envVars = parseTomlStringArray(rawValue);
            } else if (key === "startup_timeout_sec") {
                currentMcpServer.startupTimeoutSec = parseTomlNumberText(rawValue) ?? currentMcpServer.startupTimeoutSec;
            }
            continue;
        }

        if (activeProviderName !== "") {
            const providerConfig = providerConfigs.get(activeProviderName) ?? { providerName: activeProviderName };
            if (key === "base_url") {
                providerConfig.baseUrl = parseTomlStringValue(rawValue) ?? providerConfig.baseUrl;
            } else if (key === "wire_api") {
                providerConfig.wireApi = parseTomlStringValue(rawValue) ?? providerConfig.wireApi;
            } else if (key === "requires_openai_auth") {
                providerConfig.requiresOpenAIAuth =
                    parseTomlBooleanValue(rawValue) ?? providerConfig.requiresOpenAIAuth;
            }
            providerConfigs.set(activeProviderName, providerConfig);
        }
    }

    nextConfig.skills.configs = nextConfig.skills.configs.filter((item) => item.path.trim() !== "");
    nextConfig.provider.providerName = nextConfig.codex.modelProvider || nextConfig.provider.providerName;
    const activeProviderConfig = providerConfigs.get(nextConfig.codex.modelProvider);
    if (activeProviderConfig != null) {
        nextConfig.provider.providerName = nextConfig.codex.modelProvider;
        nextConfig.provider.baseUrl = String(activeProviderConfig.baseUrl ?? "").trim();
        nextConfig.provider.wireApi = String(
            activeProviderConfig.wireApi ?? DEFAULT_WORKBENCH_INTEGRATIONS_CONFIG.provider.wireApi
        ).trim();
        nextConfig.provider.requiresOpenAIAuth = activeProviderConfig.requiresOpenAIAuth === true;
    }

    if (nextConfig.provider.providerName === "") {
        nextConfig.provider.providerName = nextConfig.codex.modelProvider;
    }
    return nextConfig;
}

export function updateWorkbenchIntegrationsConfigText(
    content: string,
    config: WorkbenchIntegrationsConfig
): string {
    const normalizedConfig = normalizeWorkbenchIntegrationsConfig(config);
    let nextContent = content;

    nextContent = updateTopLevelTomlValue(nextContent, "model_provider", quoteTomlBasicString(normalizedConfig.codex.modelProvider));
    nextContent = updateTopLevelTomlValue(nextContent, "model", quoteTomlBasicString(normalizedConfig.codex.model));
    nextContent = updateTopLevelTomlValue(
        nextContent,
        "model_reasoning_effort",
        quoteTomlBasicString(normalizedConfig.codex.modelReasoningEffort)
    );
    nextContent = updateTopLevelTomlValue(
        nextContent,
        "plan_mode_reasoning_effort",
        quoteTomlBasicString(normalizedConfig.codex.planModeReasoningEffort)
    );
    nextContent = updateTopLevelTomlValue(
        nextContent,
        "approval_policy",
        quoteTomlBasicString(normalizedConfig.codex.approvalPolicy)
    );
    nextContent = updateTopLevelTomlValue(
        nextContent,
        "sandbox_mode",
        quoteTomlBasicString(normalizedConfig.codex.sandboxMode)
    );
    nextContent = updateTopLevelTomlValue(
        nextContent,
        "disable_response_storage",
        encodeTomlBoolean(normalizedConfig.codex.disableResponseStorage)
    );
    nextContent = updateTopLevelTomlValue(
        nextContent,
        "suppress_unstable_features_warning",
        encodeTomlBoolean(normalizedConfig.codex.suppressUnstableFeaturesWarning)
    );

    nextContent = replaceTomlSectionGroup(
        nextContent,
        (name) => name === joinDottedSectionName("model_providers", normalizedConfig.provider.providerName),
        buildProviderSectionLines(normalizedConfig.provider),
        [/^projects(\.|$)/, /^features(\.|$)/, /^agents(\.|$)/]
    );
    nextContent = replaceTomlSectionGroup(
        nextContent,
        (name) => name === "mcp_servers" || name.startsWith("mcp_servers."),
        buildMcpServerSectionLines(normalizedConfig.mcpServers),
        [/^projects(\.|$)/, /^features(\.|$)/, /^agents(\.|$)/]
    );
    nextContent = replaceTomlSectionGroup(
        nextContent,
        (name) => name === "skills.bundled" || name === "skills.config",
        buildSkillsSectionLines(normalizedConfig.skills),
        [/^features(\.|$)/, /^agents(\.|$)/]
    );

    return nextContent;
}

function normalizeWorkbenchIntegrationsConfig(config: WorkbenchIntegrationsConfig): WorkbenchIntegrationsConfig {
    return {
        codex: {
            modelProvider: config.codex.modelProvider.trim(),
            model: config.codex.model.trim(),
            modelReasoningEffort: config.codex.modelReasoningEffort.trim() || "xhigh",
            planModeReasoningEffort: config.codex.planModeReasoningEffort.trim() || "xhigh",
            approvalPolicy: config.codex.approvalPolicy.trim() || "never",
            sandboxMode: config.codex.sandboxMode.trim() || "danger-full-access",
            disableResponseStorage: config.codex.disableResponseStorage,
            suppressUnstableFeaturesWarning: config.codex.suppressUnstableFeaturesWarning,
        },
        provider: {
            providerName: config.provider.providerName.trim() || config.codex.modelProvider.trim(),
            baseUrl: config.provider.baseUrl.trim(),
            wireApi: config.provider.wireApi.trim() || "responses",
            requiresOpenAIAuth: config.provider.requiresOpenAIAuth,
        },
        mcpServers: config.mcpServers
            .map((server) => ({
                ...server,
                name: server.name.trim(),
                command: server.command.trim(),
                url: server.url.trim(),
                bearerTokenEnvVar: server.bearerTokenEnvVar.trim(),
                startupTimeoutSec: server.startupTimeoutSec.trim(),
                args: server.args.map((item) => item.trim()).filter((item) => item !== ""),
                envVars: server.envVars.map((item) => item.trim()).filter((item) => item !== ""),
            }))
            .filter((server) => server.name !== ""),
        skills: {
            bundledEnabled: config.skills.bundledEnabled,
            configs: config.skills.configs
                .map((item) => ({
                    path: item.path.trim(),
                    enabled: item.enabled,
                }))
                .filter((item) => item.path !== ""),
        },
    };
}

function buildProviderSectionLines(provider: WorkbenchIntegrationsConfig["provider"]): string[] {
    const providerName = provider.providerName.trim();
    if (providerName === "") {
        return [];
    }
    return [
        `[${joinDottedSectionName("model_providers", providerName)}]`,
        `base_url = ${quoteTomlBasicString(provider.baseUrl)}`,
        `wire_api = ${quoteTomlBasicString(provider.wireApi)}`,
        `requires_openai_auth = ${encodeTomlBoolean(provider.requiresOpenAIAuth)}`,
    ];
}

function buildMcpServerSectionLines(servers: WorkbenchMcpServerConfig[]): string[] {
    const lines = ["[mcp_servers]"];
    for (const server of servers) {
        lines.push("");
        lines.push(`[${joinDottedSectionName("mcp_servers", server.name)}]`);
        lines.push(`type = ${quoteTomlBasicString(server.type)}`);
        if (server.type === "stdio") {
            lines.push(`command = ${quoteTomlBasicString(server.command)}`);
            lines.push(`args = ${encodeTomlStringArray(server.args)}`);
            if (server.envVars.length > 0) {
                lines.push(`env_vars = ${encodeTomlStringArray(server.envVars)}`);
            }
        } else {
            lines.push(`url = ${quoteTomlBasicString(server.url)}`);
            if (server.bearerTokenEnvVar !== "") {
                lines.push(`bearer_token_env_var = ${quoteTomlBasicString(server.bearerTokenEnvVar)}`);
            }
        }
        if (server.startupTimeoutSec !== "") {
            lines.push(`startup_timeout_sec = ${server.startupTimeoutSec}`);
        }
    }
    return lines;
}

function buildSkillsSectionLines(skills: WorkbenchIntegrationsConfig["skills"]): string[] {
    const lines = ["[skills.bundled]", `enabled = ${encodeTomlBoolean(skills.bundledEnabled)}`];
    for (const item of skills.configs) {
        lines.push("");
        lines.push("[[skills.config]]");
        lines.push(`path = ${quoteTomlBasicString(item.path)}`);
        lines.push(`enabled = ${encodeTomlBoolean(item.enabled)}`);
    }
    return lines;
}

function replaceTomlSectionGroup(
    content: string,
    matcher: (sectionName: string) => boolean,
    nextBlockLines: string[],
    insertBeforeMatchers: RegExp[]
): string {
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    const hasTrailingNewline = content.endsWith("\r\n") || content.endsWith("\n");
    const lines = content.length === 0 ? [] : content.replace(/\r\n/g, "\n").split("\n");
    if (hasTrailingNewline && lines[lines.length - 1] === "") {
        lines.pop();
    }

    const sectionRanges = collectTopLevelTomlSectionRanges(lines);
    const matchedRanges = sectionRanges.filter((range) => matcher(range.name));
    const replacementLines = [...nextBlockLines];

    if (matchedRanges.length === 0) {
        const insertAt = findSectionInsertionIndex(lines, sectionRanges, insertBeforeMatchers);
        return spliceTomlBlock(lines, insertAt, insertAt, replacementLines, newline, hasTrailingNewline);
    }

    const start = matchedRanges[0].start;
    const end = matchedRanges[matchedRanges.length - 1].end;
    return spliceTomlBlock(lines, start, end, replacementLines, newline, hasTrailingNewline);
}

function spliceTomlBlock(
    lines: string[],
    start: number,
    end: number,
    replacementLines: string[],
    newline: string,
    hasTrailingNewline: boolean
): string {
    const before = lines.slice(0, start);
    const after = lines.slice(end);
    const nextLines = [...before];

    if (replacementLines.length > 0) {
        if (nextLines.length > 0 && nextLines[nextLines.length - 1].trim() !== "") {
            nextLines.push("");
        }
        nextLines.push(...replacementLines);
        if (after.length > 0 && after[0].trim() !== "") {
            nextLines.push("");
        }
    }

    nextLines.push(...after);
    return nextLines.join(newline) + (hasTrailingNewline ? newline : "");
}

function findSectionInsertionIndex(lines: string[], sections: TomlSectionRange[], matchers: RegExp[]): number {
    for (const matcher of matchers) {
        const section = sections.find((item) => matcher.test(item.name));
        if (section != null) {
            return section.start;
        }
    }
    return lines.length;
}

function collectTopLevelTomlSectionRanges(lines: string[]): TomlSectionRange[] {
    const sections: TomlSectionRange[] = [];
    let multilineDelimiter: TomlMultilineDelimiter | null = null;

    for (let index = 0; index < lines.length; index++) {
        const rawLine = lines[index] ?? "";
        multilineDelimiter = updateTomlMultilineDelimiter(rawLine, multilineDelimiter);
        if (multilineDelimiter != null) {
            continue;
        }

        const line = stripTomlComment(rawLine).trim();
        const arrayMatch = line.match(/^\[\[(.+)\]\]$/);
        if (arrayMatch) {
            sections.push({ name: arrayMatch[1]?.trim() ?? "", start: index, end: lines.length });
            continue;
        }
        const sectionMatch = line.match(/^\[(.+)\]$/);
        if (sectionMatch) {
            sections.push({ name: sectionMatch[1]?.trim() ?? "", start: index, end: lines.length });
        }
    }

    for (let index = 0; index < sections.length; index++) {
        sections[index].end = index + 1 < sections.length ? sections[index + 1].start : lines.length;
    }

    return sections;
}

function updateTopLevelTomlValue(content: string, key: string, encodedValue: string): string {
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    const hasTrailingNewline = content.endsWith("\r\n") || content.endsWith("\n");
    const lines = content.length === 0 ? [] : content.replace(/\r\n/g, "\n").split("\n");
    if (hasTrailingNewline && lines[lines.length - 1] === "") {
        lines.pop();
    }

    const assignmentPattern = new RegExp(`^(\\s*)${escapeRegExp(key)}\\s*=`);
    const firstSectionIndex = findFirstTopLevelTomlSectionIndex(lines);
    const scanLimit = firstSectionIndex === -1 ? lines.length : firstSectionIndex;
    const nextAssignment = `${key} = ${encodedValue}`;

    for (let index = 0; index < scanLimit; index++) {
        const match = lines[index]?.match(assignmentPattern);
        if (match) {
            lines[index] = `${match[1] ?? ""}${nextAssignment}`;
            return lines.join(newline) + (hasTrailingNewline ? newline : "");
        }
    }

    let insertAt = scanLimit;
    while (insertAt > 0 && lines[insertAt - 1].trim() === "") {
        insertAt--;
    }
    lines.splice(insertAt, 0, nextAssignment);
    return lines.join(newline) + (hasTrailingNewline ? newline : "");
}

function findFirstTopLevelTomlSectionIndex(lines: string[]): number {
    let multilineDelimiter: TomlMultilineDelimiter | null = null;
    for (let index = 0; index < lines.length; index++) {
        const rawLine = lines[index] ?? "";
        multilineDelimiter = updateTomlMultilineDelimiter(rawLine, multilineDelimiter);
        if (multilineDelimiter != null) {
            continue;
        }
        if (/^\s*(\[\[?.+\]?\])\s*$/.test(stripTomlComment(rawLine).trim())) {
            return index;
        }
    }
    return -1;
}

function updateTomlMultilineDelimiter(
    line: string,
    currentDelimiter: TomlMultilineDelimiter | null
): TomlMultilineDelimiter | null {
    if (currentDelimiter != null) {
        return countTripleDelimiterOccurrences(line, currentDelimiter) % 2 === 1 ? null : currentDelimiter;
    }
    const doubleQuoteIndex = findTripleDelimiterIndex(line, '"""');
    const singleQuoteIndex = findTripleDelimiterIndex(line, "'''");
    const nextDelimiter =
        doubleQuoteIndex === -1
            ? singleQuoteIndex === -1
                ? null
                : "'''"
            : singleQuoteIndex === -1 || doubleQuoteIndex < singleQuoteIndex
              ? '"""'
              : "'''";
    if (nextDelimiter == null) {
        return null;
    }
    return countTripleDelimiterOccurrences(line, nextDelimiter) % 2 === 1 ? nextDelimiter : null;
}

function countTripleDelimiterOccurrences(line: string, delimiter: TomlMultilineDelimiter): number {
    let count = 0;
    for (let index = 0; index <= line.length - delimiter.length; index++) {
        if (!line.startsWith(delimiter, index)) {
            continue;
        }
        if (delimiter === '"""' && index > 0 && line[index - 1] === "\\") {
            continue;
        }
        count++;
        index += delimiter.length - 1;
    }
    return count;
}

function findTripleDelimiterIndex(line: string, delimiter: TomlMultilineDelimiter): number {
    for (let index = 0; index <= line.length - delimiter.length; index++) {
        if (!line.startsWith(delimiter, index)) {
            continue;
        }
        if (delimiter === '"""' && index > 0 && line[index - 1] === "\\") {
            continue;
        }
        return index;
    }
    return -1;
}

function stripTomlComment(line: string): string {
    let inString = false;
    let escaped = false;
    let result = "";
    for (const char of line) {
        if (escaped) {
            result += char;
            escaped = false;
            continue;
        }
        if (char === "\\" && inString) {
            result += char;
            escaped = true;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            result += char;
            continue;
        }
        if (char === "#" && !inString) {
            break;
        }
        result += char;
    }
    return result;
}

function parseTomlStringValue(rawValue: string): string | null {
    const trimmedValue = rawValue.trim();
    if (!trimmedValue.startsWith('"') || !trimmedValue.endsWith('"')) {
        return null;
    }
    try {
        return JSON.parse(trimmedValue) as string;
    } catch {
        return trimmedValue.slice(1, -1);
    }
}

function parseTomlBooleanValue(rawValue: string): boolean | null {
    const trimmed = rawValue.trim().toLowerCase();
    if (trimmed === "true") {
        return true;
    }
    if (trimmed === "false") {
        return false;
    }
    return null;
}

function parseTomlNumberText(rawValue: string): string | null {
    const trimmed = rawValue.trim();
    return /^-?\d+(?:\.\d+)?$/.test(trimmed) ? trimmed : null;
}

function parseTomlStringArray(rawValue: string): string[] {
    const trimmed = rawValue.trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
        return [];
    }
    const inner = trimmed.slice(1, -1).trim();
    if (inner === "") {
        return [];
    }

    const items: string[] = [];
    let current = "";
    let inString = false;
    let escaped = false;

    for (const char of inner) {
        if (escaped) {
            current += char;
            escaped = false;
            continue;
        }
        if (char === "\\" && inString) {
            current += char;
            escaped = true;
            continue;
        }
        if (char === '"') {
            inString = !inString;
            current += char;
            continue;
        }
        if (char === "," && !inString) {
            const parsed = parseTomlStringValue(current.trim());
            if (parsed != null) {
                items.push(parsed);
            }
            current = "";
            continue;
        }
        current += char;
    }

    const parsed = parseTomlStringValue(current.trim());
    if (parsed != null) {
        items.push(parsed);
    }
    return items;
}

function parseDottedSectionTail(sectionName: string, prefix: string): string {
    const dottedPrefix = `${prefix}.`;
    if (!sectionName.startsWith(dottedPrefix)) {
        return "";
    }
    const rawTail = sectionName.slice(dottedPrefix.length).trim();
    return parseTomlKeySegment(rawTail);
}

function parseTomlKeySegment(value: string): string {
    if (value.startsWith('"') && value.endsWith('"')) {
        return parseTomlStringValue(value) ?? "";
    }
    return value;
}

function joinDottedSectionName(prefix: string, key: string): string {
    return `${prefix}.${encodeTomlKeySegment(key)}`;
}

function encodeTomlKeySegment(value: string): string {
    return /^[A-Za-z0-9_-]+$/.test(value) ? value : quoteTomlBasicString(value);
}

function quoteTomlBasicString(value: string): string {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function encodeTomlStringArray(values: string[]): string {
    return `[${values.map((item) => quoteTomlBasicString(item)).join(", ")}]`;
}

function encodeTomlBoolean(value: boolean): string {
    return value ? "true" : "false";
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

import { describe, expect, it } from "vitest";
import {
    createDefaultWorkbenchIntegrationsConfig,
    parseWorkbenchIntegrationsConfig,
    updateWorkbenchIntegrationsConfigText,
} from "../workbench-integrations";

describe("workbench integrations parser", () => {
    it("parses codex, provider, mcp, and skills blocks from config.toml", () => {
        const content = [
            'model = "gpt-5.4"',
            'model_provider = "custom"',
            'model_reasoning_effort = "xhigh"',
            'plan_mode_reasoning_effort = "high"',
            'approval_policy = "never"',
            'sandbox_mode = "danger-full-access"',
            "disable_response_storage = true",
            "suppress_unstable_features_warning = true",
            "",
            "[model_providers.custom]",
            'base_url = "http://127.0.0.1:8080/v1"',
            'wire_api = "responses"',
            "requires_openai_auth = true",
            "",
            "[mcp_servers]",
            "",
            "[mcp_servers.context7]",
            'type = "streamable_http"',
            'url = "https://mcp.context7.com/mcp"',
            'bearer_token_env_var = "CONTEXT7_API_KEY"',
            "startup_timeout_sec = 120",
            "",
            "[mcp_servers.filesystem]",
            'type = "stdio"',
            'command = "cmd"',
            'args = ["/c", "npx.cmd", "-y", "@modelcontextprotocol/server-filesystem"]',
            'env_vars = ["FS_TOKEN"]',
            "",
            "[skills.bundled]",
            "enabled = false",
            "",
            "[[skills.config]]",
            'path = "C:/Users/baba1/.codex/skills/custom-dev"',
            "enabled = true",
        ].join("\n");

        expect(parseWorkbenchIntegrationsConfig(content)).toEqual({
            codex: {
                modelProvider: "custom",
                model: "gpt-5.4",
                modelReasoningEffort: "xhigh",
                planModeReasoningEffort: "high",
                approvalPolicy: "never",
                sandboxMode: "danger-full-access",
                disableResponseStorage: true,
                suppressUnstableFeaturesWarning: true,
            },
            provider: {
                providerName: "custom",
                baseUrl: "http://127.0.0.1:8080/v1",
                wireApi: "responses",
                requiresOpenAIAuth: true,
            },
            mcpServers: [
                {
                    name: "context7",
                    type: "streamable_http",
                    command: "",
                    args: [],
                    url: "https://mcp.context7.com/mcp",
                    bearerTokenEnvVar: "CONTEXT7_API_KEY",
                    envVars: [],
                    startupTimeoutSec: "120",
                },
                {
                    name: "filesystem",
                    type: "stdio",
                    command: "cmd",
                    args: ["/c", "npx.cmd", "-y", "@modelcontextprotocol/server-filesystem"],
                    url: "",
                    bearerTokenEnvVar: "",
                    envVars: ["FS_TOKEN"],
                    startupTimeoutSec: "",
                },
            ],
            skills: {
                bundledEnabled: false,
                configs: [{ path: "C:/Users/baba1/.codex/skills/custom-dev", enabled: true }],
            },
        });
    });
});

describe("workbench integrations writer", () => {
    it("updates owned top-level codex keys without touching multiline strings", () => {
        const config = createDefaultWorkbenchIntegrationsConfig();
        config.codex.modelProvider = "custom";
        config.codex.model = "gpt-5.4";
        config.codex.modelReasoningEffort = "xhigh";
        config.codex.planModeReasoningEffort = "xhigh";
        config.provider.providerName = "custom";
        config.provider.baseUrl = "http://127.0.0.1:8080/v1";
        config.provider.wireApi = "responses";
        config.provider.requiresOpenAIAuth = true;

        const content = [
            'developer_instructions = """',
            "keep this",
            '"""',
            'model = "old-model"',
            "[features]",
            "multi_agent = true",
        ].join("\n");

        expect(updateWorkbenchIntegrationsConfigText(content, config)).toContain('developer_instructions = """');
        expect(updateWorkbenchIntegrationsConfigText(content, config)).toContain('model = "gpt-5.4"');
    });

    it("replaces mcp and skills section groups in place", () => {
        const config = createDefaultWorkbenchIntegrationsConfig();
        config.codex.modelProvider = "custom";
        config.codex.model = "gpt-5.4";
        config.provider.providerName = "custom";
        config.provider.baseUrl = "http://127.0.0.1:8080/v1";
        config.mcpServers = [
            {
                name: "filesystem",
                type: "stdio",
                command: "cmd",
                args: ["/c", "npx.cmd"],
                url: "",
                bearerTokenEnvVar: "",
                envVars: ["FS_TOKEN"],
                startupTimeoutSec: "120",
            },
        ];
        config.skills = {
            bundledEnabled: true,
            configs: [{ path: "C:/Users/baba1/.codex/skills/custom-dev", enabled: false }],
        };

        const content = [
            'model = "gpt-5.3"',
            'model_provider = "old"',
            "",
            "[mcp_servers]",
            "",
            "[mcp_servers.old]",
            'type = "stdio"',
            'command = "legacy"',
            "",
            "[skills.bundled]",
            "enabled = false",
            "",
            "[[skills.config]]",
            'path = "legacy"',
            "enabled = true",
            "",
            "[features]",
            "multi_agent = true",
        ].join("\n");

        const next = updateWorkbenchIntegrationsConfigText(content, config);
        expect(next).toContain('[mcp_servers.filesystem]');
        expect(next).toContain('command = "cmd"');
        expect(next).not.toContain('[mcp_servers.old]');
        expect(next).toContain("[skills.bundled]");
        expect(next).toContain('path = "C:/Users/baba1/.codex/skills/custom-dev"');
        expect(next).not.toContain('path = "legacy"');
        expect(next).toContain("[features]");
    });

    it("inserts missing skills block before features when absent", () => {
        const config = createDefaultWorkbenchIntegrationsConfig();
        config.codex.modelProvider = "custom";
        config.codex.model = "gpt-5.4";
        config.provider.providerName = "custom";
        config.skills = {
            bundledEnabled: true,
            configs: [{ path: "C:/Users/baba1/.codex/skills/custom-dev", enabled: true }],
        };

        const content = ['model_provider = "custom"', "", "[features]", "multi_agent = true"].join("\n");
        const next = updateWorkbenchIntegrationsConfigText(content, config);
        expect(next.indexOf("[skills.bundled]")).toBeGreaterThan(-1);
        expect(next.indexOf("[skills.bundled]")).toBeLessThan(next.indexOf("[features]"));
    });
});

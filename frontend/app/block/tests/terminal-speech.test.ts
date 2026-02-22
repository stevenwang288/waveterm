import { describe, expect, it } from "vitest";
import { extractLatestTerminalFormalReply } from "../terminal-speech";

describe("extractLatestTerminalFormalReply", () => {
    it("extracts the latest assistant bullet reply", () => {
        const lines = [
            "› 我们来做个测试，今天是几号？",
            "• 今天是 2026 年 2 月 19 日，星期四。",
            "",
        ];
        expect(extractLatestTerminalFormalReply(lines)).toBe("今天是 2026 年 2 月 19 日，星期四。");
    });

    it("ignores prompt/status noise under the assistant reply segment", () => {
        const lines = [
            "› question",
            "• 正式回复第一行",
            "",
            "› Run /review on my current changes",
            "? for shortcuts",
            "67% context left",
        ];
        expect(extractLatestTerminalFormalReply(lines)).toBe("正式回复第一行");
    });

    it("filters shell prompt noise in codex reply segment", () => {
        const lines = [
            "› question",
            "• 正式回复第一行",
            "PS D:\\repo>",
            "(node:12345) [DEP0040] warning",
            "",
        ];
        expect(extractLatestTerminalFormalReply(lines)).toBe("正式回复第一行");
    });

    it("selects the newest assistant reply when there are multiple turns", () => {
        const lines = [
            "› Q1",
            "• A1",
            "",
            "› Q2",
            "• A2",
            "A2-2",
        ];
        expect(extractLatestTerminalFormalReply(lines)).toBe("A2\nA2-2");
    });

    it("ignores codex tool-call bullet and keeps the latest final assistant reply", () => {
        const lines = [
            "› 你是谁",
            "• 先按你的工作流要求读取当前项目记忆上下文，再直接回答你这个问题。",
            "",
            "• Called",
            "└ mem0-oss.memory_get_context({\"query\":\"你是谁\"})",
            "{\"text\":\"Memory context ...\"}",
            "",
            "• 我是 Codex，你的 AI 编程助手。",
            "  我在你这台机器的终端环境里协作，能帮你查问题、改代码、跑命令和落地实现。",
        ];
        expect(extractLatestTerminalFormalReply(lines)).toBe(
            "我是 Codex，你的 AI 编程助手。\n  我在你这台机器的终端环境里协作，能帮你查问题、改代码、跑命令和落地实现。"
        );
    });

    it("drops codex tool-call-only bullet segments", () => {
        const lines = [
            "› 你是谁",
            "• Called",
            "└ mem0-oss.memory_get_context({\"query\":\"你是谁\"})",
            "{\"text\":\"Memory context ...\"}",
        ];
        expect(extractLatestTerminalFormalReply(lines)).toBe("");
    });

    it("does not fall back to older codex bullet when latest bullet is tool-call noise", () => {
        const lines = [
            "› Q1",
            "• old final reply",
            "",
            "› Q2",
            "• Called",
            "└ mem0-oss.memory_get_context({\"query\":\"Q2\"})",
        ];
        expect(extractLatestTerminalFormalReply(lines)).toBe("");
    });

    it("returns empty when no assistant bullet reply exists", () => {
        const lines = ["› only user prompt", "random output"];
        expect(extractLatestTerminalFormalReply(lines)).toBe("");
    });

    it("returns empty for non-bullet output (strict formal-reply mode)", () => {
        const lines = [
            "2026年2月19日",
            "(node:30780) [DEP0040] DeprecationWarning: The `punycode` module is deprecated.",
            "(Use `node --trace-deprecation ...` to show where the warning was created)",
            "",
            "<Execution Info>",
            "{",
            '  "session-id": "session-1"',
            '  "assistantRounds": 1',
            "}",
            "</Execution Info>",
            "PS D:\\repo>",
        ];
        expect(extractLatestTerminalFormalReply(lines)).toBe("");
    });

    it("does not extract plain replies even when prompt boundaries exist", () => {
        const lines = [
            "› 今天是几号？",
            "今天是 2026 年 2 月 20 日，星期五。",
            "",
        ];
        expect(extractLatestTerminalFormalReply(lines)).toBe("");
    });

    it("filters codex startup box and model lines as non-reply noise", () => {
        const lines = [
            "╭──────────────────────────────────────────╮",
            "│ >_ OpenAI Codex (v0.0.0)                 │",
            "│ 模型： gpt-5.3-codex xhigh   /model 切换 │",
            "│ 目录： ~                                 │",
            "╰──────────────────────────────────────────╯",
        ];
        expect(extractLatestTerminalFormalReply(lines)).toBe("");
    });

    it("requires a prompt boundary when configured for codex final reply extraction", () => {
        const linesWithoutBoundary = ["› 你好", "• 这是还在生成中的回复片段"];
        expect(extractLatestTerminalFormalReply(linesWithoutBoundary, { requirePromptAfterCodexReply: true })).toBe("");
        const linesWithBoundary = ["› 你好", "• 最终正式回复", "› "];
        expect(extractLatestTerminalFormalReply(linesWithBoundary, { requirePromptAfterCodexReply: true })).toBe(
            "最终正式回复"
        );
    });

    it("does not fall back to codex startup/status plain lines in strict mode", () => {
        const lines = [
            "│ >_ OpenAI Codex (v0.0.0) │",
            "模型： gpt-5.3-codex xhigh /model 切换",
            "目录： ~",
            "› ",
        ];
        expect(extractLatestTerminalFormalReply(lines, { requirePromptAfterCodexReply: true })).toBe("");
    });

    it("ignores codex working status bullets", () => {
        const lines = ["› 你好", "• Working (0s • esc to interrupt)", "› "];
        expect(extractLatestTerminalFormalReply(lines, { requirePromptAfterCodexReply: true })).toBe("");
    });

    it("ignores codex working status lines with spinner prefixes", () => {
        const lines = ["› 你好", "⠋ Working (20s  esc 中断)", "› "];
        expect(extractLatestTerminalFormalReply(lines, { requirePromptAfterCodexReply: true })).toBe("");
    });

    it("ignores Codex MCP server startup status lines", () => {
        const lines = ["› 你好", "Starting MCP servers (1/3): mcp-deepwiki, sequential-thinking", "› "];
        expect(extractLatestTerminalFormalReply(lines, { requirePromptAfterCodexReply: true })).toBe("");
    });

    it("ignores codex inference/streams footer telemetry lines", () => {
        const lines = [
            "› 你好",
            "• 这是最终正式回复",
            "─ Inference: 1 call (4.5s) • Streams: 191 events (8.2s) ─",
            "› ",
        ];
        expect(extractLatestTerminalFormalReply(lines, { requirePromptAfterCodexReply: true })).toBe(
            "这是最终正式回复"
        );
    });

    it("ignores codex bottom status row lines", () => {
        const lines = ["› 你好", "• 这是最终正式回复", "gpt-5.2 high • 95% left • ~", "› "];
        expect(extractLatestTerminalFormalReply(lines, { requirePromptAfterCodexReply: true })).toBe(
            "这是最终正式回复"
        );
    });

    it("ignores ctrl+c multi-press status lines", () => {
        const lines = ["› 你好", "• Ctrl+C 第一次（1/4）：再按一次退出", "› "];
        expect(extractLatestTerminalFormalReply(lines, { requirePromptAfterCodexReply: true })).toBe("");
    });

    it("does not treat a normal assistant mention of Ctrl+C as noise", () => {
        const lines = ["› 怎么停掉服务？", "• 你可以按 Ctrl+C 停止服务。", "› "];
        expect(extractLatestTerminalFormalReply(lines, { requirePromptAfterCodexReply: true })).toBe(
            "你可以按 Ctrl+C 停止服务。"
        );
    });
});

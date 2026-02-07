// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { FocusManager } from "@/app/store/focusManager";
import { WOS, getApi } from "@/store/global";
import clsx from "clsx";
import { useAtomValue } from "jotai";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

type GitSection = "unstaged" | "staged";
type AiMode = "auto" | "manual";
type AiLanguage = "zh" | "en";
type PreviewMode = "working" | "commit";

type GitFileStatus = {
    path: string;
    staged: string;
    unstaged: string;
    untracked: boolean;
};

type GitSelection = {
    section: GitSection;
    path: string;
};

type GitCommitItem = {
    hash: string;
    author: string;
    relative: string;
    subject: string;
};

type GitPanelState = {
    cwd: string;
    branch: string;
    files: GitFileStatus[];
    selection: GitSelection | null;
    diffText: string;
    loading: boolean;
    actionLoading: boolean;
    historyLoading: boolean;
    error: string;
    actionError: string;
    commitMessage: string;
    aiMode: AiMode;
    aiLanguage: AiLanguage;
    commitHistory: GitCommitItem[];
    previewMode: PreviewMode;
    previewCommitHash: string;
};

const initialState: GitPanelState = {
    cwd: "",
    branch: "",
    files: [],
    selection: null,
    diffText: "",
    loading: false,
    actionLoading: false,
    historyLoading: false,
    error: "",
    actionError: "",
    commitMessage: "",
    aiMode: "auto",
    aiLanguage: "zh",
    commitHistory: [],
    previewMode: "working",
    previewCommitHash: "",
};

function normalizeCwd(path: string): string {
    return (path ?? "").trim();
}

function parseStatusPorcelain(output: string): GitFileStatus[] {
    const lines = output
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter(Boolean);

    const items: GitFileStatus[] = [];
    for (const line of lines) {
        if (line.length < 4) {
            continue;
        }
        const code = line.slice(0, 2);
        const staged = code[0] ?? " ";
        const unstaged = code[1] ?? " ";
        const untracked = code === "??";
        const path = line.slice(3).trim();

        if (!path) {
            continue;
        }

        items.push({
            path,
            staged,
            unstaged,
            untracked,
        });
    }
    return items;
}

function parseGitLog(output: string): GitCommitItem[] {
    const lines = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    return lines
        .map((line) => {
            const [hash = "", author = "", relative = "", ...subjectParts] = line.split("\t");
            const subject = subjectParts.join("\t").trim();
            if (!hash || !subject) {
                return null;
            }
            return {
                hash,
                author,
                relative,
                subject,
            } as GitCommitItem;
        })
        .filter((item): item is GitCommitItem => item !== null);
}

function hasStagedChange(item: GitFileStatus): boolean {
    return item.staged !== " " && item.staged !== "?";
}

function hasUnstagedChange(item: GitFileStatus): boolean {
    return item.untracked || item.unstaged !== " ";
}

function hasSelection(items: GitFileStatus[], selection: GitSelection | null): boolean {
    if (!selection) {
        return false;
    }
    const item = items.find((candidate) => candidate.path === selection.path);
    if (!item) {
        return false;
    }
    return selection.section === "staged" ? hasStagedChange(item) : hasUnstagedChange(item);
}

function getDefaultSelection(items: GitFileStatus[]): GitSelection | null {
    const firstUnstaged = items.find((item) => hasUnstagedChange(item));
    if (firstUnstaged) {
        return { section: "unstaged", path: firstUnstaged.path };
    }

    const firstStaged = items.find((item) => hasStagedChange(item));
    if (firstStaged) {
        return { section: "staged", path: firstStaged.path };
    }

    return null;
}

function isDocLikePath(path: string): boolean {
    const lowered = path.toLowerCase();
    return (
        lowered.endsWith(".md") ||
        lowered.endsWith(".txt") ||
        lowered.endsWith(".rst") ||
        lowered.startsWith("docs/") ||
        lowered.includes("/docs/")
    );
}

function isConfigLikePath(path: string): boolean {
    const lowered = path.toLowerCase();
    return (
        lowered === "package.json" ||
        lowered === "package-lock.json" ||
        lowered === "pnpm-lock.yaml" ||
        lowered === "yarn.lock" ||
        lowered.endsWith(".config.js") ||
        lowered.endsWith(".config.ts") ||
        lowered.endsWith(".toml") ||
        lowered.endsWith(".yaml") ||
        lowered.endsWith(".yml")
    );
}

function buildAiCommitMessage(files: GitFileStatus[], language: AiLanguage): string {
    const changedFiles = files.map((item) => item.path);
    if (changedFiles.length === 0) {
        return language === "zh" ? "chore: \u540c\u6b65\u6539\u52a8" : "chore: sync changes";
    }

    const onlyDocs = changedFiles.every((path) => isDocLikePath(path));
    const hasConfig = changedFiles.some((path) => isConfigLikePath(path));
    const hasNew = files.some((item) => item.untracked || item.staged === "A");
    const hasDelete = files.some((item) => item.staged === "D" || item.unstaged === "D");

    let type = "chore";
    if (onlyDocs) {
        type = "docs";
    } else if (hasDelete) {
        type = "refactor";
    } else if (hasNew) {
        type = "feat";
    } else if (hasConfig) {
        type = "chore";
    } else {
        type = "fix";
    }

    const shortNames = changedFiles
        .slice(0, 3)
        .map((path) => path.split("/").pop() ?? path)
        .join(", ");
    const moreCount = Math.max(changedFiles.length - 3, 0);

    if (language === "zh") {
        const tail = moreCount > 0 ? ` ${changedFiles.length}\u4e2a\u6587\u4ef6` : ` ${shortNames}`;
        return `${type}: \u66f4\u65b0${tail}`.trim();
    }

    const tail = moreCount > 0 ? `${changedFiles.length} files` : shortNames;
    return `${type}: update ${tail}`.trim();
}

function normalizeGitError(stderr: string): string {
    const text = (stderr || "").trim();
    if (!text) {
        return "Git 命令执行失败";
    }

    const lowered = text.toLowerCase();
    if (lowered.includes("no upstream branch") || lowered.includes("set upstream")) {
        return "推送失败：未设置上游分支。先执行一次：git push --set-upstream origin <branch>";
    }
    if (lowered.includes("no configured push destination")) {
        return "推送失败：未配置远程仓库地址";
    }
    if (lowered.includes("nothing to commit")) {
        return "没有可提交的变更";
    }

    return text;
}

const GitPanel = memo(() => {
    const focusedBlockId = useAtomValue(FocusManager.getInstance().blockFocusAtom);
    const [state, setState] = useState<GitPanelState>(initialState);

    const focusedBlockData = WOS.useWaveObjectValue<Block>(
        focusedBlockId ? WOS.makeORef("block", focusedBlockId) : null,
        [focusedBlockId]
    )[0];

    const cwd = useMemo(() => normalizeCwd(focusedBlockData?.meta?.["cmd:cwd"] ?? ""), [focusedBlockData?.meta]);

    const stagedFiles = useMemo(() => state.files.filter(hasStagedChange), [state.files]);
    const unstagedFiles = useMemo(() => state.files.filter(hasUnstagedChange), [state.files]);

    const selectedFile = useMemo(() => {
        if (!state.selection) {
            return null;
        }
        return state.files.find((item) => item.path === state.selection.path) ?? null;
    }, [state.files, state.selection]);

    const runGit = useCallback(
        async (args: string[]) => {
            if (!cwd) {
                return { code: 2, stdout: "", stderr: "未找到工作目录" } as GitRunResult;
            }
            try {
                return await getApi().runGit(cwd, args);
            } catch (error) {
                return { code: 1, stdout: "", stderr: String(error) } as GitRunResult;
            }
        },
        [cwd]
    );

    const refresh = useCallback(async () => {
        if (!cwd) {
            setState((prev) => ({
                ...prev,
                cwd: "",
                branch: "",
                files: [],
                selection: null,
                diffText: "",
                commitHistory: [],
                historyLoading: false,
                previewMode: "working",
                previewCommitHash: "",
                error: "当前焦点不在终端块，无法识别工作目录",
                loading: false,
            }));
            return;
        }

        setState((prev) => ({ ...prev, loading: true, historyLoading: true, error: "", cwd }));

        const [branchResult, statusResult, logResult] = await Promise.all([
            runGit(["rev-parse", "--abbrev-ref", "HEAD"]),
            runGit(["status", "--porcelain", "-u"]),
            runGit(["log", "--max-count=40", "--pretty=format:%h%x09%an%x09%ar%x09%s"]),
        ]);

        if (statusResult.code !== 0) {
            setState((prev) => ({
                ...prev,
                loading: false,
                historyLoading: false,
                branch: "",
                files: [],
                selection: null,
                diffText: "",
                commitHistory: [],
                previewMode: "working",
                previewCommitHash: "",
                error: normalizeGitError(statusResult.stderr || branchResult.stderr || "当前目录不是 Git 仓库"),
            }));
            return;
        }

        const files = parseStatusPorcelain(statusResult.stdout || "");
        const branch = (branchResult.stdout || "").trim();
        const history = logResult.code === 0 ? parseGitLog(logResult.stdout || "") : [];

        setState((prev) => {
            const nextSelection = hasSelection(files, prev.selection) ? prev.selection : getDefaultSelection(files);
            const commitStillExists =
                !!prev.previewCommitHash && history.some((commitItem) => commitItem.hash === prev.previewCommitHash);
            return {
                ...prev,
                loading: false,
                historyLoading: false,
                branch,
                files,
                selection: nextSelection,
                commitHistory: history,
                previewMode: commitStillExists && prev.previewMode === "commit" ? "commit" : "working",
                previewCommitHash: commitStillExists ? prev.previewCommitHash : "",
                error: "",
            };
        });
    }, [cwd, runGit]);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    useEffect(() => {
        if (!cwd || state.previewMode !== "working") {
            return;
        }
        if (!state.selection) {
            setState((prev) => ({ ...prev, diffText: "" }));
            return;
        }

        let cancelled = false;

        (async () => {
            const args =
                state.selection.section === "staged"
                    ? ["diff", "--staged", "--", state.selection.path]
                    : ["diff", "--", state.selection.path];

            const diffResult = await runGit(args);
            if (cancelled) {
                return;
            }

            const fallbackText =
                state.selection.section === "unstaged" && selectedFile?.untracked
                    ? "未跟踪文件暂无 diff 预览"
                    : "";

            setState((prev) => ({
                ...prev,
                diffText: diffResult.stdout || diffResult.stderr || fallbackText,
            }));
        })();

        return () => {
            cancelled = true;
        };
    }, [cwd, runGit, selectedFile?.untracked, state.previewMode, state.selection]);

    useEffect(() => {
        if (!cwd || state.previewMode !== "commit" || !state.previewCommitHash) {
            return;
        }

        let cancelled = false;

        (async () => {
            const showResult = await runGit(["show", "--stat", "--patch", "--no-color", state.previewCommitHash]);
            if (cancelled) {
                return;
            }
            setState((prev) => ({
                ...prev,
                diffText: showResult.stdout || showResult.stderr || "没有提交详情",
            }));
        })();

        return () => {
            cancelled = true;
        };
    }, [cwd, runGit, state.previewCommitHash, state.previewMode]);

    const runMutatingGitCommand = useCallback(
        async (args: string[], successCallback?: () => void) => {
            setState((prev) => ({ ...prev, actionLoading: true, actionError: "" }));

            const result = await runGit(args);
            if (result.code !== 0) {
                setState((prev) => ({
                    ...prev,
                    actionLoading: false,
                    actionError: normalizeGitError(result.stderr),
                }));
                return false;
            }

            if (successCallback) {
                successCallback();
            }

            setState((prev) => ({
                ...prev,
                actionLoading: false,
                actionError: "",
            }));

            await refresh();
            return true;
        },
        [refresh, runGit]
    );

    const stageSelected = useCallback(async () => {
        if (!state.selection) {
            return;
        }
        await runMutatingGitCommand(["add", "--", state.selection.path]);
    }, [runMutatingGitCommand, state.selection]);

    const unstageSelected = useCallback(async () => {
        if (!state.selection) {
            return;
        }
        await runMutatingGitCommand(["restore", "--staged", "--", state.selection.path]);
    }, [runMutatingGitCommand, state.selection]);

    const discardSelected = useCallback(async () => {
        if (!state.selection || !selectedFile) {
            return;
        }

        if (selectedFile.untracked) {
            setState((prev) => ({
                ...prev,
                actionError: "Untracked file discard is not supported in panel yet",
            }));
            return;
        }

        await runMutatingGitCommand(["restore", "--", state.selection.path]);
    }, [runMutatingGitCommand, selectedFile, state.selection]);

    const commitAllStaged = useCallback(async () => {
        const msg = state.commitMessage.trim();
        if (!msg) {
            setState((prev) => ({ ...prev, actionError: "提交信息不能为空" }));
            return;
        }

        const ok = await runMutatingGitCommand(["commit", "-m", msg], () => {
            setState((prev) => ({ ...prev, commitMessage: "" }));
        });
        if (!ok) {
            return;
        }
    }, [runMutatingGitCommand, state.commitMessage]);

    const generateAiMessage = useCallback(() => {
        const sourceFiles = stagedFiles.length > 0 ? stagedFiles : state.files;
        const message = buildAiCommitMessage(sourceFiles, state.aiLanguage);
        setState((prev) => ({ ...prev, commitMessage: message, actionError: "" }));
    }, [stagedFiles, state.aiLanguage, state.files]);

    const syncCurrentBranch = useCallback(async () => {
        await runMutatingGitCommand(["push"]);
    }, [runMutatingGitCommand]);

    const aiCommitAndSync = useCallback(async () => {
        if (state.files.length === 0) {
            setState((prev) => ({ ...prev, actionError: "没有可提交的变更" }));
            return;
        }

        const autoMessage = buildAiCommitMessage(state.files, state.aiLanguage);
        const finalMessage = state.aiMode === "auto" ? autoMessage : state.commitMessage.trim();
        if (!finalMessage) {
            setState((prev) => ({ ...prev, actionError: "手动模式下提交信息不能为空" }));
            return;
        }

        setState((prev) => ({
            ...prev,
            actionLoading: true,
            actionError: "",
            commitMessage: finalMessage,
        }));

        const addResult = await runGit(["add", "."]);
        if (addResult.code !== 0) {
            setState((prev) => ({ ...prev, actionLoading: false, actionError: normalizeGitError(addResult.stderr) }));
            return;
        }

        const commitResult = await runGit(["commit", "-m", finalMessage]);
        if (commitResult.code !== 0) {
            setState((prev) => ({
                ...prev,
                actionLoading: false,
                actionError: normalizeGitError(commitResult.stderr),
            }));
            await refresh();
            return;
        }

        const pushResult = await runGit(["push"]);
        if (pushResult.code !== 0) {
            setState((prev) => ({ ...prev, actionLoading: false, actionError: normalizeGitError(pushResult.stderr) }));
            await refresh();
            return;
        }

        setState((prev) => ({
            ...prev,
            actionLoading: false,
            actionError: "",
            commitMessage: "",
        }));
        await refresh();
    }, [refresh, runGit, state.aiLanguage, state.aiMode, state.commitMessage, state.files]);

    const canStage = !!state.selection && state.selection.section === "unstaged";
    const canUnstage = !!state.selection && state.selection.section === "staged";
    const canDiscard = !!state.selection && state.selection.section === "unstaged";
    const canCommit = stagedFiles.length > 0 && !!state.commitMessage.trim() && !state.actionLoading;
    const canGenerateAiMessage = state.files.length > 0 && !state.actionLoading;
    const canAiCommitAndSync = state.files.length > 0 && !state.actionLoading;
    const canSync = !state.actionLoading;

    const previewLabel =
        state.previewMode === "commit"
            ? `提交 ${state.previewCommitHash}`
            : state.selection
              ? `${state.selection.section === "staged" ? "已暂存" : "未暂存"}: ${state.selection.path}`
              : "工作区";

    return (
        <div className="flex flex-col w-full h-full bg-zinc-950 border border-zinc-800 overflow-hidden rounded-lg">
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
                <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                    <i className="fa fa-code-branch text-zinc-400" />
                    <span>Git</span>
                    {state.branch && <span className="text-xs text-secondary">{state.branch}</span>}
                </div>

                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-secondary">U:{unstagedFiles.length} S:{stagedFiles.length}</span>
                    <button
                        type="button"
                        className="px-2 py-1 rounded text-xs text-secondary hover:text-primary hover:bg-hoverbg"
                        onClick={() => void refresh()}
                    >
                        刷新
                    </button>
                </div>
            </div>

            <div className="px-3 py-2 border-b border-zinc-800 text-[11px] text-secondary truncate" title={state.cwd || ""}>
                {state.cwd || "(no cwd)"}
            </div>

            <div className="px-2 py-2 border-b border-zinc-800 flex items-center gap-1.5">
                <select
                    value={state.aiMode}
                    onChange={(e) => setState((prev) => ({ ...prev, aiMode: e.target.value as AiMode }))}
                    className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-primary"
                >
                    <option value="auto">自动</option>
                    <option value="manual">手动</option>
                </select>

                <select
                    value={state.aiLanguage}
                    onChange={(e) => setState((prev) => ({ ...prev, aiLanguage: e.target.value as AiLanguage }))}
                    className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-primary"
                >
                    <option value="zh">中文</option>
                    <option value="en">英文</option>
                </select>

                <button
                    type="button"
                    disabled={!canGenerateAiMessage}
                    className="px-2 py-1 rounded text-[11px] bg-zinc-900 text-secondary enabled:hover:bg-zinc-800 enabled:hover:text-primary disabled:opacity-40"
                    onClick={generateAiMessage}
                >
                    AI 生成说明
                </button>
            </div>

            <div className="px-2 py-2 border-b border-zinc-800 flex items-center gap-1.5">
                <button
                    type="button"
                    disabled={!canStage || state.actionLoading}
                    className="px-2 py-1 rounded text-[11px] bg-zinc-900 text-secondary enabled:hover:bg-zinc-800 enabled:hover:text-primary disabled:opacity-40"
                    onClick={() => void stageSelected()}
                >
                    暂存
                </button>

                <button
                    type="button"
                    disabled={!canUnstage || state.actionLoading}
                    className="px-2 py-1 rounded text-[11px] bg-zinc-900 text-secondary enabled:hover:bg-zinc-800 enabled:hover:text-primary disabled:opacity-40"
                    onClick={() => void unstageSelected()}
                >
                    取消暂存
                </button>

                <button
                    type="button"
                    disabled={!canDiscard || state.actionLoading}
                    className="px-2 py-1 rounded text-[11px] bg-zinc-900 text-secondary enabled:hover:bg-zinc-800 enabled:hover:text-primary disabled:opacity-40"
                    onClick={() => void discardSelected()}
                >
                    丢弃
                </button>

                <button
                    type="button"
                    disabled={!canSync}
                    className="px-2 py-1 rounded text-[11px] bg-zinc-900 text-secondary enabled:hover:bg-zinc-800 enabled:hover:text-primary disabled:opacity-40"
                    onClick={() => void syncCurrentBranch()}
                >
                    推送
                </button>
            </div>

            <div className="px-2 py-2 border-b border-zinc-800 flex items-center gap-1.5">
                <input
                    value={state.commitMessage}
                    onChange={(e) => setState((prev) => ({ ...prev, commitMessage: e.target.value }))}
                    className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-primary outline-none"
                    placeholder={state.aiMode === "auto" ? "提交信息（自动模式可覆盖）" : "提交信息"}
                />

                <button
                    type="button"
                    disabled={!canCommit}
                    className="px-2 py-1 rounded text-[11px] bg-blue-600/80 text-blue-50 enabled:hover:bg-blue-500 disabled:opacity-40"
                    onClick={() => void commitAllStaged()}
                >
                    提交
                </button>

                <button
                    type="button"
                    disabled={!canAiCommitAndSync}
                    className="px-2 py-1 rounded text-[11px] bg-blue-700/90 text-blue-50 enabled:hover:bg-blue-600 disabled:opacity-40"
                    onClick={() => void aiCommitAndSync()}
                >
                    AI 提交并推送
                </button>
            </div>

            {state.error ? (
                <div className="px-3 py-3 text-xs text-red-300 border-b border-zinc-800 break-words">{state.error}</div>
            ) : null}

            {state.actionError ? (
                <div className="px-3 py-2 text-xs text-red-300 border-b border-zinc-800 break-words">{state.actionError}</div>
            ) : null}

            <div className="flex flex-row min-h-0 flex-1">
                <div className="w-44 border-r border-zinc-800 overflow-auto">
                    {state.loading ? (
                        <div className="px-3 py-2 text-xs text-secondary">加载中...</div>
                    ) : state.files.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-secondary">当前没有变更</div>
                    ) : (
                        <>
                            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-secondary border-b border-zinc-900/70">
                                未暂存
                            </div>
                            {unstagedFiles.length === 0 ? (
                                <div className="px-3 py-2 text-xs text-zinc-500">-</div>
                            ) : (
                                unstagedFiles.map((item) => {
                                    const selected =
                                        state.selection?.section === "unstaged" && state.selection.path === item.path;
                                    const statusCode = item.untracked ? "??" : item.unstaged;
                                    return (
                                        <button
                                            key={`unstaged:${item.path}`}
                                            type="button"
                                            className={clsx(
                                                "w-full text-left px-3 py-2 text-xs border-b border-zinc-900/70",
                                                selected && state.previewMode === "working"
                                                    ? "bg-blue-600/35 text-blue-100"
                                                    : "text-secondary hover:bg-hoverbg hover:text-primary"
                                            )}
                                            onClick={() =>
                                                setState((prev) => ({
                                                    ...prev,
                                                    previewMode: "working",
                                                    previewCommitHash: "",
                                                    selection: { section: "unstaged", path: item.path },
                                                }))
                                            }
                                            title={`${statusCode} ${item.path}`}
                                        >
                                            <div className="font-mono text-[10px] text-zinc-400">{statusCode}</div>
                                            <div className="truncate">{item.path}</div>
                                        </button>
                                    );
                                })
                            )}

                            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-secondary border-b border-zinc-900/70">
                                已暂存
                            </div>
                            {stagedFiles.length === 0 ? (
                                <div className="px-3 py-2 text-xs text-zinc-500">-</div>
                            ) : (
                                stagedFiles.map((item) => {
                                    const selected = state.selection?.section === "staged" && state.selection.path === item.path;
                                    return (
                                        <button
                                            key={`staged:${item.path}`}
                                            type="button"
                                            className={clsx(
                                                "w-full text-left px-3 py-2 text-xs border-b border-zinc-900/70",
                                                selected && state.previewMode === "working"
                                                    ? "bg-blue-600/35 text-blue-100"
                                                    : "text-secondary hover:bg-hoverbg hover:text-primary"
                                            )}
                                            onClick={() =>
                                                setState((prev) => ({
                                                    ...prev,
                                                    previewMode: "working",
                                                    previewCommitHash: "",
                                                    selection: { section: "staged", path: item.path },
                                                }))
                                            }
                                            title={`${item.staged} ${item.path}`}
                                        >
                                            <div className="font-mono text-[10px] text-zinc-400">{item.staged}</div>
                                            <div className="truncate">{item.path}</div>
                                        </button>
                                    );
                                })
                            )}
                        </>
                    )}
                </div>

                <div className="flex-1 overflow-hidden flex flex-col">
                    <div className="px-3 py-1.5 border-b border-zinc-800 flex items-center justify-between gap-2 text-[10px] text-zinc-400">
                        <span className="truncate" title={previewLabel}>
                            {previewLabel}
                        </span>
                        {state.previewMode === "commit" ? (
                            <button
                                type="button"
                                className="px-2 py-0.5 rounded text-[10px] text-secondary hover:text-primary hover:bg-hoverbg"
                                onClick={() => setState((prev) => ({ ...prev, previewMode: "working", previewCommitHash: "" }))}
                            >
                                返回变更
                            </button>
                        ) : null}
                    </div>
                    <div className="flex-1 overflow-auto">
                        <pre className="text-[11px] leading-5 text-zinc-200 px-3 py-2 whitespace-pre-wrap break-words">
                            {state.diffText || "请选择一个变更文件或历史提交进行预览"}
                        </pre>
                    </div>
                </div>
            </div>

            <div className="border-t border-zinc-800 min-h-[120px] max-h-[180px] overflow-auto">
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-secondary border-b border-zinc-900/70">
                    提交历史 ({state.commitHistory.length})
                </div>

                {state.historyLoading ? (
                    <div className="px-3 py-2 text-xs text-secondary">正在加载提交历史...</div>
                ) : state.commitHistory.length === 0 ? (
                    <div className="px-3 py-2 text-xs text-zinc-500">暂无提交历史</div>
                ) : (
                    state.commitHistory.map((item) => {
                        const isActive = state.previewMode === "commit" && state.previewCommitHash === item.hash;
                        return (
                            <button
                                key={`${item.hash}-${item.subject}`}
                                type="button"
                                className={clsx(
                                    "w-full text-left px-3 py-2 text-xs border-b border-zinc-900/60",
                                    isActive
                                        ? "bg-blue-600/35 text-blue-100"
                                        : "text-secondary hover:bg-hoverbg hover:text-primary"
                                )}
                                onClick={() =>
                                    setState((prev) => ({
                                        ...prev,
                                        previewMode: "commit",
                                        previewCommitHash: item.hash,
                                    }))
                                }
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono text-[10px] text-zinc-400">{item.hash}</span>
                                    <span className="text-[10px] text-zinc-500 truncate">{item.relative}</span>
                                </div>
                                <div className="text-zinc-200 truncate" title={item.subject}>
                                    {item.subject}
                                </div>
                                <div className="text-[10px] text-zinc-500 truncate">{item.author}</div>
                            </button>
                        );
                    })
                )}
            </div>
        </div>
    );
});

GitPanel.displayName = "GitPanel";

export { GitPanel };

// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import { getWorkbenchSourceMetaPatch, hasWorkbenchSourceContext, resolveWorkbenchSourceMeta } from "../workbench-source";

test("resolveWorkbenchSourceMeta prefers the focused block when it already has terminal context", () => {
    const blockMetaById: Record<string, MetaType> = {
        focused: {
            view: "term",
            connection: "local",
            "cmd:cwd": "C:/Users/baba1",
        },
        other: {
            view: "term",
            connection: "ssh://baba1@baba",
            "cmd:cwd": "/srv/project",
        },
    };
    const liveDisplayCwdById: Record<string, string> = {
        focused: "E:/code/cx-workbench",
        other: "/srv/project",
    };

    const sourceMeta = resolveWorkbenchSourceMeta({
        activeTabBlockIds: ["focused", "other"],
        focusedBlockId: "focused",
        getBlockMeta: (blockId) => blockMetaById[blockId],
        getDisplayCwd: (blockId) => liveDisplayCwdById[blockId] ?? "",
    });

    assert.deepEqual(sourceMeta, {
        view: "term",
        connection: "local",
        "cmd:cwd": "E:/code/cx-workbench",
        "display:launchcwd": "E:/code/cx-workbench",
        "term:displaycwd": "E:/code/cx-workbench",
        cwd: "E:/code/cx-workbench",
    });
});

test("resolveWorkbenchSourceMeta falls back to the first tab block that still has terminal context", () => {
    const blockMetaById: Record<string, MetaType> = {
        focused: {
            view: "sysinfo",
        },
        terminal: {
            view: "term",
            connection: "local",
            "cmd:cwd": "C:/Users/baba1",
        },
    };
    const liveDisplayCwdById: Record<string, string> = {
        focused: "",
        terminal: "C:/Users/baba1",
    };

    const sourceMeta = resolveWorkbenchSourceMeta({
        activeTabBlockIds: ["focused", "terminal"],
        focusedBlockId: "focused",
        getBlockMeta: (blockId) => blockMetaById[blockId],
        getDisplayCwd: (blockId) => liveDisplayCwdById[blockId] ?? "",
    });

    assert.deepEqual(sourceMeta, {
        view: "term",
        connection: "local",
        "cmd:cwd": "C:/Users/baba1",
        "display:launchcwd": "C:/Users/baba1",
        "term:displaycwd": "C:/Users/baba1",
        cwd: "C:/Users/baba1",
    });
});

test("resolveWorkbenchSourceMeta skips a focused workbench that only carries connection meta when a later block has a real path", () => {
    const blockMetaById: Record<string, MetaType> = {
        focused: {
            view: "workbench",
            connection: "local",
        },
        terminal: {
            view: "term",
            connection: "local",
            "cmd:cwd": "E:/code/waveterm-main",
        },
    };
    const liveDisplayCwdById: Record<string, string> = {
        focused: "",
        terminal: "E:/code/waveterm-main",
    };

    const sourceMeta = resolveWorkbenchSourceMeta({
        activeTabBlockIds: ["focused", "terminal"],
        focusedBlockId: "focused",
        getBlockMeta: (blockId) => blockMetaById[blockId],
        getDisplayCwd: (blockId) => liveDisplayCwdById[blockId] ?? "",
    });

    assert.deepEqual(sourceMeta, {
        view: "term",
        connection: "local",
        "cmd:cwd": "E:/code/waveterm-main",
        "display:launchcwd": "E:/code/waveterm-main",
        "term:displaycwd": "E:/code/waveterm-main",
        cwd: "E:/code/waveterm-main",
    });
});

test("hasWorkbenchSourceContext rejects empty workbench seed meta", () => {
    assert.equal(
        hasWorkbenchSourceContext({
            view: "workbench",
        }),
        false
    );
    assert.equal(
        hasWorkbenchSourceContext({
            view: "workbench",
            connection: "local",
        }),
        true
    );
});

test("getWorkbenchSourceMetaPatch promotes the resolved display path into term:displaycwd", () => {
    assert.deepEqual(
        getWorkbenchSourceMetaPatch(
            {
                view: "term",
                connection: "local",
                "display:launchcwd": "E:/code/waveterm-main",
            },
            ""
        ),
        {
            connection: "local",
            "cmd:cwd": "E:/code/waveterm-main",
            "display:launchcwd": "E:/code/waveterm-main",
            "term:displaycwd": "E:/code/waveterm-main",
            cwd: "E:/code/waveterm-main",
        }
    );
    assert.deepEqual(
        getWorkbenchSourceMetaPatch(
            {
                view: "term",
                connection: "local",
            },
            "E:/code/current-runtime"
        ),
        {
            connection: "local",
            "cmd:cwd": "E:/code/current-runtime",
            "display:launchcwd": "E:/code/current-runtime",
            "term:displaycwd": "E:/code/current-runtime",
            cwd: "E:/code/current-runtime",
        }
    );
});

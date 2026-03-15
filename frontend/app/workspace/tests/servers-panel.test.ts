// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { assert, test } from "vitest";
import { compareServerEntries, reconcilePveConnections } from "../servers-refresh";

test("reconcilePveConnections updates matched managed connections and creates missing ones", async () => {
    const writes: Array<{ host: string; meta: Record<string, any> }> = [];

    const result = await reconcilePveConnections({
        machines: [
            {
                vmid: 166,
                node: "pve",
                type: "qemu",
                name: "GUI-NO-ubuntu24",
                sshHost: "10.20.0.166",
                ipHints: ["10.20.0.166"],
            },
            {
                vmid: 167,
                node: "pve",
                type: "qemu",
                name: "GUI-NO-win11",
                sshHost: "10.20.0.167",
                ipHints: ["10.20.0.167"],
            },
        ],
        fullConfig: ({
            connections: {
                "ubuntu@10.20.0.166": {
                    "display:name": "stale-name",
                    "ssh:hostname": "10.20.0.166",
                    "ssh:user": "ubuntu",
                    "pve:vmid": 166,
                },
            },
        } as unknown) as FullConfigType,
        managedConnectionSet: new Set(["ubuntu@10.20.0.166"]),
        connections: ["ubuntu@10.20.0.166"],
        setConnectionConfig: async (host, meta) => {
            writes.push({ host, meta });
        },
    });

    assert.deepEqual(result, {
        updatedCount: 1,
        createdCount: 1,
        skippedCount: 0,
    });
    assert.deepEqual(
        writes.map((entry) => entry.host),
        ["ubuntu@10.20.0.166", "10.20.0.167"]
    );
    assert.equal(writes[0]?.meta["display:name"], "GUI-NO-ubuntu24");
    assert.equal(writes[0]?.meta["pve:name"], "GUI-NO-ubuntu24");
    assert.equal(writes[1]?.meta["display:name"], "GUI-NO-win11");
    assert.equal(writes[1]?.meta["pve:name"], "GUI-NO-win11");
    assert.equal(writes[1]?.meta["ssh:hostname"], "10.20.0.167");
});

test("reconcilePveConnections prefers the managed connection when multiple candidates match the same machine", async () => {
    const writes: Array<{ host: string; meta: Record<string, any> }> = [];

    await reconcilePveConnections({
        machines: [
            {
                vmid: 166,
                node: "pve",
                type: "qemu",
                name: "GUI-NO-ubuntu24",
                sshHost: "10.20.0.166",
                ipHints: ["10.20.0.166"],
            },
        ],
        fullConfig: ({
            connections: {
                "ubuntu@10.20.0.166": {
                    "display:name": "GUI-NO-ubuntu24",
                    "ssh:hostname": "10.20.0.166",
                    "ssh:user": "ubuntu",
                },
                "10.20.0.166": {
                    "ssh:hostname": "10.20.0.166",
                },
            },
        } as unknown) as FullConfigType,
        managedConnectionSet: new Set(["ubuntu@10.20.0.166"]),
        connections: ["ubuntu@10.20.0.166", "10.20.0.166"],
        setConnectionConfig: async (host, meta) => {
            writes.push({ host, meta });
        },
    });

    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.host, "ubuntu@10.20.0.166");
    assert.equal(writes[0]?.meta["pve:vmid"], 166);
});

test("compareServerEntries sorts display names with numeric ordering", () => {
    const entries = [
        { label: "C1-10.20.0.170-zorin18", connection: "root@10.20.0.170" },
        { label: "C1-10.20.0.99-zorin18", connection: "root@10.20.0.99" },
        { label: "C1-10.20.0.131-zorin18", connection: "root@10.20.0.131" },
    ];

    const sorted = [...entries].sort(compareServerEntries);

    assert.deepEqual(
        sorted.map((entry) => entry.label),
        ["C1-10.20.0.99-zorin18", "C1-10.20.0.131-zorin18", "C1-10.20.0.170-zorin18"]
    );
});

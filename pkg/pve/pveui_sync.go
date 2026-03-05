// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package pve

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"path/filepath"
	"sort"
	"strings"
)

func readActivePveUiServerID(db *sql.DB) (int64, error) {
	query := `
SELECT id
FROM pve_pveserver
WHERE (is_deleted IS NULL OR is_deleted = 0)
  AND (is_active IS NULL OR is_active = 1)
ORDER BY updated_at DESC
LIMIT 1`
	var id sql.NullInt64
	if err := db.QueryRow(query).Scan(&id); err == sql.ErrNoRows {
		return 0, nil
	} else if err != nil {
		return 0, err
	}
	if !id.Valid || id.Int64 <= 0 {
		return 0, nil
	}
	return id.Int64, nil
}

func readExistingVmids(db *sql.DB, serverID int64) (map[int]bool, error) {
	query := `
SELECT vmid
FROM pve_virtualmachine
WHERE (is_deleted IS NULL OR is_deleted = 0)
  AND server_id = ?`
	rows, err := db.Query(query, serverID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[int]bool)
	for rows.Next() {
		var vmid sql.NullInt64
		if err := rows.Scan(&vmid); err != nil {
			return nil, err
		}
		if !vmid.Valid {
			continue
		}
		id := int(vmid.Int64)
		if id <= 0 {
			continue
		}
		out[id] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// SyncPveUiVirtualMachines ensures every VM reported by the PVE cluster resources endpoint exists in the pve-ui sqlite db.
// This allows screenwall toggles and GUI detection to work even when pve-ui is out of date.
//
// Best-effort: if the db isn't present, this is a no-op.
func SyncPveUiVirtualMachines(cfg Config, resources []ClusterResource) (int, error) {
	dbPath := findImportDBPath()
	if dbPath == "" {
		return 0, nil
	}

	connStr := fmt.Sprintf("file:%s?_busy_timeout=2000", filepath.ToSlash(dbPath))
	db, err := sql.Open("sqlite3", connStr)
	if err != nil {
		return 0, err
	}
	defer db.Close()

	serverID, err := readActivePveUiServerID(db)
	if err != nil {
		return 0, err
	}
	if serverID <= 0 {
		return 0, nil
	}

	existing, err := readExistingVmids(db, serverID)
	if err != nil {
		return 0, err
	}

	missing := make([]ClusterResource, 0)
	seen := make(map[int]bool)
	for _, item := range resources {
		vmid := item.VMID
		if vmid <= 0 || seen[vmid] {
			continue
		}
		seen[vmid] = true
		typ := strings.TrimSpace(strings.ToLower(item.Type))
		if typ != "qemu" && typ != "lxc" {
			continue
		}
		if existing[vmid] {
			continue
		}
		missing = append(missing, item)
	}
	if len(missing) == 0 {
		return 0, nil
	}
	sort.SliceStable(missing, func(i, j int) bool {
		if missing[i].Node != missing[j].Node {
			return missing[i].Node < missing[j].Node
		}
		return missing[i].VMID < missing[j].VMID
	})

	tx, err := db.Begin()
	if err != nil {
		return 0, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	stmt, err := tx.Prepare(`
INSERT INTO pve_virtualmachine
    (created_at, updated_at, is_deleted, vmid, name, node, status, pve_config, server_id)
VALUES
    (datetime('now'), datetime('now'), 0, ?, ?, ?, ?, ?, ?)
ON CONFLICT(server_id, vmid) DO UPDATE SET
    updated_at = datetime('now'),
    is_deleted = 0,
    name = excluded.name,
    node = excluded.node,
    status = excluded.status,
    pve_config = excluded.pve_config`)
	if err != nil {
		return 0, err
	}
	defer stmt.Close()

	inserted := 0
	var firstErr error
	for _, item := range missing {
		vmid := item.VMID
		node := strings.TrimSpace(item.Node)
		name := strings.TrimSpace(item.Name)
		status := strings.TrimSpace(item.Status)
		typ := strings.TrimSpace(strings.ToLower(item.Type))

		var pveConfig string
		if typ == "qemu" && node != "" && vmid > 0 {
			cfgMap, err := GetVmConfig(cfg, node, vmid, typ)
			if err != nil {
				if firstErr == nil {
					firstErr = err
				}
				log.Printf("pve: failed to fetch vm config for vmid=%d node=%s: %v\n", vmid, node, err)
			} else if cfgMap != nil {
				if b, err := json.Marshal(cfgMap); err == nil {
					pveConfig = string(b)
				} else {
					if firstErr == nil {
						firstErr = err
					}
					log.Printf("pve: failed to marshal vm config for vmid=%d node=%s: %v\n", vmid, node, err)
				}
			}
		}

		if _, err := stmt.Exec(vmid, name, node, status, pveConfig, serverID); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			log.Printf("pve: failed to upsert vm into pve-ui db (vmid=%d node=%s): %v\n", vmid, node, err)
			continue
		}
		inserted++
	}

	if err := tx.Commit(); err != nil {
		return inserted, err
	}
	if inserted > 0 {
		InvalidatePveUiVmMetaCache()
	}
	return inserted, firstErr
}


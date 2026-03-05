// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package pve

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const pveUiVmMetaTTL = 30 * time.Minute

type PveUiVmMeta struct {
	ScreenwallEnabled bool
	IPAddress         string
	HasGUI            bool
}

type pveUiVmMetaCacheState struct {
	ts       time.Time
	inFlight bool
	data     map[int]PveUiVmMeta
}

var pveUiVmMetaCacheMu sync.Mutex
var pveUiVmMetaCache = pveUiVmMetaCacheState{}

func findImportDBPath() string {
	override := strings.TrimSpace(os.Getenv(EnvImportDB))
	if override != "" {
		if _, err := os.Stat(override); err == nil {
			return override
		}
	}
	for _, candidate := range candidateImportDBPaths() {
		if candidate == "" {
			continue
		}
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return ""
}

func readVmMetaMapFromSQLite(dbPath string) (map[int]PveUiVmMeta, error) {
	connStr := fmt.Sprintf("file:%s?mode=ro&_busy_timeout=2000", filepath.ToSlash(dbPath))
	db, err := sql.Open("sqlite3", connStr)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	query := `
SELECT vmid, screenwall_enabled, ip_address, pve_config
FROM pve_virtualmachine
WHERE is_deleted = 0`
	rows, err := db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[int]PveUiVmMeta)
	for rows.Next() {
		var vmid sql.NullInt64
		var enabled sql.NullInt64
		var ipAddr sql.NullString
		var pveConfig sql.NullString
		if err := rows.Scan(&vmid, &enabled, &ipAddr, &pveConfig); err != nil {
			return nil, err
		}
		if !vmid.Valid {
			continue
		}
		id := int(vmid.Int64)
		if id <= 0 {
			continue
		}
		out[id] = PveUiVmMeta{
			ScreenwallEnabled: enabled.Valid && enabled.Int64 != 0,
			IPAddress:         strings.TrimSpace(ipAddr.String),
			HasGUI:            inferHasGuiFromPveConfig(pveConfig.String),
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func inferHasGuiFromPveConfig(raw string) bool {
	s := strings.TrimSpace(raw)
	if s == "" {
		// When config is missing, assume it has GUI; we can still fall back to runtime errors.
		return true
	}
	var cfg map[string]any
	if err := json.Unmarshal([]byte(s), &cfg); err != nil {
		return true
	}
	rawVga, ok := cfg["vga"]
	if !ok || rawVga == nil {
		return true
	}
	vga := strings.ToLower(strings.TrimSpace(fmt.Sprint(rawVga)))
	if vga == "" || vga == "<nil>" {
		return true
	}
	if strings.HasPrefix(vga, "none") {
		return false
	}
	if strings.HasPrefix(vga, "serial") {
		return false
	}
	return true
}

// InferHasGuiFromVmConfigMap inspects a Proxmox vm config map (from /nodes/<node>/{qemu|lxc}/<vmid>/config)
// and returns whether the VM should be treated as having a GUI.
//
// Best-effort: when config is missing/unparseable, we assume it has a GUI.
func InferHasGuiFromVmConfigMap(cfg map[string]any) bool {
	if cfg == nil {
		return true
	}
	rawVga, ok := cfg["vga"]
	if !ok || rawVga == nil {
		return true
	}
	vga := strings.ToLower(strings.TrimSpace(fmt.Sprint(rawVga)))
	if vga == "" || vga == "<nil>" {
		return true
	}
	if strings.HasPrefix(vga, "none") {
		return false
	}
	if strings.HasPrefix(vga, "serial") {
		return false
	}
	return true
}

// GetPveUiVmMetaMap returns a best-effort map of VMID -> metadata (screenwall_enabled, ip_address)
// sourced from the pve-ui sqlite db (if present). Returns nil when the db is unavailable.
func GetPveUiVmMetaMap() map[int]PveUiVmMeta {
	now := time.Now()

	pveUiVmMetaCacheMu.Lock()
	if !pveUiVmMetaCache.ts.IsZero() && now.Sub(pveUiVmMetaCache.ts) < pveUiVmMetaTTL {
		defer pveUiVmMetaCacheMu.Unlock()
		return pveUiVmMetaCache.data
	}
	if pveUiVmMetaCache.inFlight {
		// Avoid blocking callers; they'll just get the previous data (or nil) this time.
		data := pveUiVmMetaCache.data
		pveUiVmMetaCacheMu.Unlock()
		return data
	}
	pveUiVmMetaCache.inFlight = true
	pveUiVmMetaCacheMu.Unlock()

	var data map[int]PveUiVmMeta
	dbPath := findImportDBPath()
	if dbPath != "" {
		if m, err := readVmMetaMapFromSQLite(dbPath); err != nil {
			log.Printf("pve: failed to read pve-ui vm metadata from %s: %v\n", dbPath, err)
		} else {
			data = m
		}
	}

	pveUiVmMetaCacheMu.Lock()
	pveUiVmMetaCache.ts = time.Now()
	pveUiVmMetaCache.data = data
	pveUiVmMetaCache.inFlight = false
	pveUiVmMetaCacheMu.Unlock()
	return data
}

// GetPveUiVmScreenwallEnabledMap is a compatibility helper returning VMID -> screenwall_enabled.
func GetPveUiVmScreenwallEnabledMap() map[int]bool {
	metaMap := GetPveUiVmMetaMap()
	if len(metaMap) == 0 {
		return nil
	}
	out := make(map[int]bool, len(metaMap))
	for vmid, meta := range metaMap {
		out[vmid] = meta.ScreenwallEnabled
	}
	return out
}

func InvalidatePveUiVmMetaCache() {
	pveUiVmMetaCacheMu.Lock()
	pveUiVmMetaCache.ts = time.Time{}
	pveUiVmMetaCache.data = nil
	pveUiVmMetaCache.inFlight = false
	pveUiVmMetaCacheMu.Unlock()
}

func SetPveUiVmScreenwallEnabled(vmid int, enabled bool) error {
	if vmid <= 0 {
		return fmt.Errorf("invalid vmid")
	}
	dbPath := findImportDBPath()
	if dbPath == "" {
		return fmt.Errorf("pve-ui db not found (set %s or install pve-ui)", EnvImportDB)
	}
	connStr := fmt.Sprintf("file:%s?_busy_timeout=2000", filepath.ToSlash(dbPath))
	db, err := sql.Open("sqlite3", connStr)
	if err != nil {
		return err
	}
	defer db.Close()

	next := 0
	if enabled {
		next = 1
	}
	res, err := db.Exec(
		`UPDATE pve_virtualmachine
SET screenwall_enabled = ?,
    updated_at = datetime('now')
WHERE vmid = ?
  AND is_deleted = 0`,
		next,
		vmid,
	)
	if err != nil {
		return err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return fmt.Errorf("vm not found in pve-ui db (vmid=%d)", vmid)
	}
	InvalidatePveUiVmMetaCache()
	return nil
}

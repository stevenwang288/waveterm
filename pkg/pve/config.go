// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package pve

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"

	_ "github.com/mattn/go-sqlite3"
	"github.com/wavetermdev/waveterm/pkg/secretstore"
)

const (
	EnvOrigin      = "WAVETERM_PVE_ORIGIN"
	EnvTokenID     = "WAVETERM_PVE_TOKEN_ID"
	EnvTokenSecret = "WAVETERM_PVE_TOKEN_SECRET"
	EnvVerifySSL   = "WAVETERM_PVE_VERIFY_SSL"
	EnvImportDB    = "WAVETERM_PVE_IMPORT_DB"
)

const (
	SecretOrigin      = "PVE_ORIGIN"
	SecretTokenID     = "PVE_TOKEN_ID"
	SecretTokenSecret = "PVE_TOKEN_SECRET"
	SecretVerifySSL   = "PVE_VERIFY_SSL"
)

type Config struct {
	Origin      string
	TokenID     string
	TokenSecret string
	VerifySSL   bool
}

func parseVerifySSL(raw string) bool {
	s := strings.TrimSpace(strings.ToLower(raw))
	if s == "" {
		return false
	}
	if s == "1" || s == "true" || s == "yes" || s == "on" {
		return true
	}
	return false
}

func normalizeOrigin(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return ""
	}
	// Accept both "https://host:8006" and "host:8006".
	if strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://") {
		return s
	}
	return "https://" + s
}

func readConfigFromEnv() (Config, bool) {
	origin := normalizeOrigin(os.Getenv(EnvOrigin))
	tokenID := strings.TrimSpace(os.Getenv(EnvTokenID))
	tokenSecret := strings.TrimSpace(os.Getenv(EnvTokenSecret))
	if origin == "" || tokenID == "" || tokenSecret == "" {
		return Config{}, false
	}
	return Config{
		Origin:      origin,
		TokenID:     tokenID,
		TokenSecret: tokenSecret,
		VerifySSL:   parseVerifySSL(os.Getenv(EnvVerifySSL)),
	}, true
}

func readConfigFromSecretStore() (Config, bool, error) {
	origin, okOrigin, err := secretstore.GetSecret(SecretOrigin)
	if err != nil {
		return Config{}, false, err
	}
	tokenID, okID, err := secretstore.GetSecret(SecretTokenID)
	if err != nil {
		return Config{}, false, err
	}
	tokenSecret, okSecret, err := secretstore.GetSecret(SecretTokenSecret)
	if err != nil {
		return Config{}, false, err
	}
	verifySSLRaw, okVerify, err := secretstore.GetSecret(SecretVerifySSL)
	if err != nil {
		return Config{}, false, err
	}
	if !okOrigin || !okID || !okSecret {
		return Config{}, false, nil
	}
	return Config{
		Origin:      normalizeOrigin(origin),
		TokenID:     strings.TrimSpace(tokenID),
		TokenSecret: strings.TrimSpace(tokenSecret),
		VerifySSL:   okVerify && parseVerifySSL(verifySSLRaw),
	}, true, nil
}

type importedPveServerRow struct {
	Host        string
	Port        int
	TokenID     string
	TokenSecret string
	VerifySSL   bool
}

func candidateImportDBPaths() []string {
	if runtime.GOOS != "windows" {
		return nil
	}
	return []string{
		filepath.Join(`E:\code\pve-ui`, "backend", "db.sqlite3"),
		filepath.Join(`E:\code\pveui`, "backend", "db.sqlite3"),
		filepath.Join(`E:\code\pveui-integrated`, "backend", "db.sqlite3"),
	}
}

func readPveServerFromSQLite(dbPath string) (*importedPveServerRow, error) {
	connStr := fmt.Sprintf("file:%s?mode=ro&_busy_timeout=2000", filepath.ToSlash(dbPath))
	db, err := sql.Open("sqlite3", connStr)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	query := `
SELECT host, port, token_id, token_secret, verify_ssl
FROM pve_pveserver
WHERE (is_deleted IS NULL OR is_deleted = 0)
  AND (is_active IS NULL OR is_active = 1)
ORDER BY updated_at DESC
LIMIT 1`
	var host sql.NullString
	var port sql.NullInt64
	var tokenID sql.NullString
	var tokenSecret sql.NullString
	var verifySSL sql.NullBool
	err = db.QueryRow(query).Scan(&host, &port, &tokenID, &tokenSecret, &verifySSL)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	h := strings.TrimSpace(host.String)
	if h == "" {
		return nil, nil
	}
	p := int(port.Int64)
	if p <= 0 {
		p = 8006
	}
	id := strings.TrimSpace(tokenID.String)
	sec := strings.TrimSpace(tokenSecret.String)
	if id == "" || sec == "" {
		return nil, nil
	}
	return &importedPveServerRow{
		Host:        h,
		Port:        p,
		TokenID:     id,
		TokenSecret: sec,
		VerifySSL:   verifySSL.Valid && verifySSL.Bool,
	}, nil
}

func saveImportedConfig(row *importedPveServerRow) (Config, error) {
	origin := normalizeOrigin(fmt.Sprintf("%s:%d", row.Host, row.Port))
	if origin == "" || row.TokenID == "" || row.TokenSecret == "" {
		return Config{}, fmt.Errorf("invalid imported pve server config")
	}

	if err := secretstore.SetSecret(SecretOrigin, origin); err != nil {
		return Config{}, err
	}
	if err := secretstore.SetSecret(SecretTokenID, row.TokenID); err != nil {
		return Config{}, err
	}
	if err := secretstore.SetSecret(SecretTokenSecret, row.TokenSecret); err != nil {
		return Config{}, err
	}
	if err := secretstore.SetSecret(SecretVerifySSL, strconv.FormatBool(row.VerifySSL)); err != nil {
		return Config{}, err
	}

	return Config{
		Origin:      origin,
		TokenID:     row.TokenID,
		TokenSecret: row.TokenSecret,
		VerifySSL:   row.VerifySSL,
	}, nil
}

func importConfigFromPveUI() (Config, bool, error) {
	// User override: allow importing from an explicit db path.
	override := strings.TrimSpace(os.Getenv(EnvImportDB))
	var candidates []string
	if override != "" {
		candidates = []string{override}
	} else {
		candidates = candidateImportDBPaths()
	}
	if len(candidates) == 0 {
		return Config{}, false, nil
	}

	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if _, err := os.Stat(candidate); err != nil {
			continue
		}
		row, err := readPveServerFromSQLite(candidate)
		if err != nil {
			return Config{}, false, err
		}
		if row == nil {
			continue
		}
		cfg, err := saveImportedConfig(row)
		if err != nil {
			return Config{}, false, err
		}
		log.Printf("pve: imported config from %s (host=%s port=%d verify_ssl=%v)\n", candidate, row.Host, row.Port, row.VerifySSL)
		return cfg, true, nil
	}
	return Config{}, false, nil
}

func GetConfig() (Config, error) {
	if cfg, ok := readConfigFromEnv(); ok {
		return cfg, nil
	}
	cfg, ok, err := readConfigFromSecretStore()
	if err != nil {
		return Config{}, err
	}
	if ok {
		return cfg, nil
	}
	cfg, imported, err := importConfigFromPveUI()
	if err != nil {
		return Config{}, err
	}
	if imported {
		return cfg, nil
	}
	return Config{}, fmt.Errorf("missing PVE config (need %s/%s/%s or import from pve-ui)", EnvOrigin, EnvTokenID, EnvTokenSecret)
}


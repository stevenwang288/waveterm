// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package web

import (
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

type connCheckResponse struct {
	Online    bool   `json:"online"`
	LatencyMs int    `json:"latencyMs,omitempty"`
	Error     string `json:"error,omitempty"`
}

func handleConnCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	host := strings.TrimSpace(r.URL.Query().Get("host"))
	host = strings.TrimPrefix(host, "[")
	host = strings.TrimSuffix(host, "]")
	if host == "" {
		http.Error(w, "host is required", http.StatusBadRequest)
		return
	}

	port := 22
	if raw := strings.TrimSpace(r.URL.Query().Get("port")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 && v <= 65535 {
			port = v
		}
	}

	timeout := 900 * time.Millisecond
	if raw := strings.TrimSpace(r.URL.Query().Get("timeoutMs")); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			timeout = time.Duration(v) * time.Millisecond
		}
	}

	start := time.Now()
	addr := net.JoinHostPort(host, strconv.Itoa(port))
	d := net.Dialer{Timeout: timeout}
	c, err := d.DialContext(r.Context(), "tcp", addr)
	latency := int(time.Since(start).Milliseconds())
	if err != nil {
		WriteJsonSuccess(w, connCheckResponse{Online: false, LatencyMs: latency, Error: err.Error()})
		return
	}
	c.Close()
	WriteJsonSuccess(w, connCheckResponse{Online: true, LatencyMs: latency})
}


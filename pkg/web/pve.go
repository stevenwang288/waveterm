// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package web

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/wavetermdev/waveterm/pkg/pve"
)

type pveVmInfo struct {
	VMID              int    `json:"vmid"`
	Node              string `json:"node"`
	Name              string `json:"name"`
	Status            string `json:"status"`
	Type              string `json:"type"`
	Template          bool   `json:"template,omitempty"`
	ScreenwallEnabled bool   `json:"screenwallEnabled,omitempty"`
	IPAddress         string `json:"ipAddress,omitempty"`
	HasGUI            bool   `json:"hasGui"`
	ID                string `json:"id,omitempty"`
}

func parseTruthyQuery(raw string, defaultValue bool) bool {
	if strings.TrimSpace(raw) == "" {
		return defaultValue
	}
	s := strings.TrimSpace(strings.ToLower(raw))
	return s == "1" || s == "true" || s == "yes" || s == "on"
}

func handlePveListVMs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	cfg, err := pve.GetConfig()
	if err != nil {
		WriteJsonError(w, err)
		return
	}
	resources, err := pve.ListClusterVMResources(cfg)
	if err != nil {
		WriteJsonError(w, err)
		return
	}

	if inserted, err := pve.SyncPveUiVirtualMachines(cfg, resources); err != nil {
		log.Printf("pve: sync pve-ui vms warning (inserted=%d): %v\n", inserted, err)
	}

	runningOnly := parseTruthyQuery(r.URL.Query().Get("runningOnly"), true)
	maxTilesRaw := strings.TrimSpace(r.URL.Query().Get("max"))
	maxTiles := 0
	if maxTilesRaw != "" {
		if v, err := strconv.Atoi(maxTilesRaw); err == nil && v > 0 {
			maxTiles = v
		}
	}

	out := make([]pveVmInfo, 0, len(resources))
	for _, item := range resources {
		typ := strings.TrimSpace(item.Type)
		if typ != "qemu" && typ != "lxc" {
			continue
		}
		status := strings.TrimSpace(item.Status)
		if runningOnly && status != "running" {
			continue
		}
		hasGui := true
		if typ == "lxc" {
			hasGui = false
		}
		out = append(out, pveVmInfo{
			VMID:     item.VMID,
			Node:     strings.TrimSpace(item.Node),
			Name:     strings.TrimSpace(item.Name),
			Status:   status,
			Type:     typ,
			Template: item.Template != 0,
			HasGUI:   hasGui,
			ID:       strings.TrimSpace(item.ID),
		})
	}

	metaMap := pve.GetPveUiVmMetaMap()
	if len(metaMap) > 0 {
		for idx := range out {
			meta, ok := metaMap[out[idx].VMID]
			if !ok {
				continue
			}
			out[idx].ScreenwallEnabled = meta.ScreenwallEnabled
			if ip := strings.TrimSpace(meta.IPAddress); ip != "" {
				out[idx].IPAddress = ip
			}
			out[idx].HasGUI = meta.HasGUI
		}
	}

	// Best-effort GUI detection directly from PVE config.
	// This keeps the UI correct even when the optional pve-ui sqlite db is missing/out-of-date.
	type guiProbe struct {
		idx  int
		node string
		vmid int
		typ  string
	}
	probes := make([]guiProbe, 0)
	for idx := range out {
		if out[idx].Template {
			continue
		}
		if strings.TrimSpace(out[idx].Type) != "qemu" {
			continue
		}
		if strings.TrimSpace(out[idx].Node) == "" || out[idx].VMID <= 0 {
			continue
		}
		probes = append(probes, guiProbe{
			idx:  idx,
			node: out[idx].Node,
			vmid: out[idx].VMID,
			typ:  out[idx].Type,
		})
	}
	if len(probes) > 0 {
		sem := make(chan struct{}, 6)
		var wg sync.WaitGroup
		for _, probe := range probes {
			probe := probe
			wg.Add(1)
			go func() {
				defer wg.Done()
				sem <- struct{}{}
				defer func() { <-sem }()

				cfgMap, err := pve.GetVmConfig(cfg, probe.node, probe.vmid, probe.typ)
				if err != nil || cfgMap == nil {
					return
				}
				out[probe.idx].HasGUI = pve.InferHasGuiFromVmConfigMap(cfgMap)
			}()
		}
		wg.Wait()
	}

	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Node != out[j].Node {
			return out[i].Node < out[j].Node
		}
		return out[i].VMID < out[j].VMID
	})
	if maxTiles > 0 && len(out) > maxTiles {
		out = out[:maxTiles]
	}

	WriteJsonSuccess(w, out)
}

type pveConsoleSessionRequest struct {
	Node string `json:"node"`
	VMID int    `json:"vmid"`
}

type pveConsoleSessionResponse struct {
	SessionID string `json:"sessionId"`
	Password  string `json:"password"`
}

func handlePveCreateConsoleSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req pveConsoleSessionRequest
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("invalid json: %v", err), http.StatusBadRequest)
		return
	}
	req.Node = strings.TrimSpace(req.Node)
	if req.Node == "" || req.VMID <= 0 {
		http.Error(w, "node and vmid are required", http.StatusBadRequest)
		return
	}

	sess, err := pve.CreateConsoleSession(req.Node, req.VMID)
	if err != nil {
		WriteJsonError(w, err)
		return
	}
	WriteJsonSuccess(w, pveConsoleSessionResponse{
		SessionID: sess.SessionID,
		Password:  sess.Password,
	})
}

type pveSetScreenwallEnabledRequest struct {
	VMID    int  `json:"vmid"`
	Enabled bool `json:"enabled"`
}

type pveSetScreenwallEnabledResponse struct {
	VMID              int  `json:"vmid"`
	ScreenwallEnabled bool `json:"screenwallEnabled"`
}

func handlePveSetScreenwallEnabled(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req pveSetScreenwallEnabledRequest
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("invalid json: %v", err), http.StatusBadRequest)
		return
	}
	if req.VMID <= 0 {
		http.Error(w, "vmid is required", http.StatusBadRequest)
		return
	}
	if err := pve.SetPveUiVmScreenwallEnabled(req.VMID, req.Enabled); err != nil {
		WriteJsonError(w, err)
		return
	}
	WriteJsonSuccess(w, pveSetScreenwallEnabledResponse{
		VMID:              req.VMID,
		ScreenwallEnabled: req.Enabled,
	})
}

type pveVmActionRequest struct {
	Node   string `json:"node"`
	VMID   int    `json:"vmid"`
	Action string `json:"action"`
	Type   string `json:"type,omitempty"`
}

type pveVmActionResponse struct {
	UPID string `json:"upid,omitempty"`
}

func handlePveVmAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req pveVmActionRequest
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("invalid json: %v", err), http.StatusBadRequest)
		return
	}
	req.Node = strings.TrimSpace(req.Node)
	req.Action = strings.TrimSpace(strings.ToLower(req.Action))
	req.Type = strings.TrimSpace(strings.ToLower(req.Type))
	if req.Type == "" {
		req.Type = "qemu"
	}
	if req.Node == "" || req.VMID <= 0 || req.Action == "" {
		http.Error(w, "node, vmid, and action are required", http.StatusBadRequest)
		return
	}
	if req.Type != "qemu" && req.Type != "lxc" {
		http.Error(w, "type must be qemu or lxc", http.StatusBadRequest)
		return
	}

	cfg, err := pve.GetConfig()
	if err != nil {
		WriteJsonError(w, err)
		return
	}
	upid, err := pve.VmStatusAction(cfg, req.Node, req.VMID, req.Action, req.Type)
	if err != nil {
		WriteJsonError(w, err)
		return
	}
	WriteJsonSuccess(w, pveVmActionResponse{UPID: upid})
}

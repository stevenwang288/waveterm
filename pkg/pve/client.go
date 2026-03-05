// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package pve

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"
)

const requestTimeout = 15 * time.Second

func makeHTTPClient(cfg Config) *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if strings.HasPrefix(strings.ToLower(cfg.Origin), "https://") && !cfg.VerifySSL {
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec
	}
	return &http.Client{
		Timeout:   requestTimeout,
		Transport: transport,
	}
}

func makeAuthHeader(cfg Config) string {
	// Proxmox expects: PVEAPIToken=<tokenid>=<tokensecret>
	return fmt.Sprintf("PVEAPIToken=%s=%s", cfg.TokenID, cfg.TokenSecret)
}

type pveAPIResponse[T any] struct {
	Data T `json:"data"`
}

type ClusterResource struct {
	ID     string `json:"id"`
	Type   string `json:"type"`
	Node   string `json:"node"`
	VMID   int    `json:"vmid"`
	Name   string `json:"name"`
	Status string `json:"status"`
	Template int  `json:"template"`
}

func ListClusterVMResources(cfg Config) ([]ClusterResource, error) {
	u, err := url.Parse(cfg.Origin)
	if err != nil {
		return nil, err
	}
	u.Path = path.Join(u.Path, "/api2/json/cluster/resources")
	q := u.Query()
	q.Set("type", "vm")
	u.RawQuery = q.Encode()

	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", makeAuthHeader(cfg))
	req.Header.Set("Accept", "application/json")

	client := makeHTTPClient(cfg)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	bodyBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("pve list vms failed (%d): %s", resp.StatusCode, strings.TrimSpace(string(bodyBytes)))
	}
	var parsed pveAPIResponse[[]ClusterResource]
	if err := json.Unmarshal(bodyBytes, &parsed); err != nil {
		return nil, err
	}
	sort.SliceStable(parsed.Data, func(i, j int) bool {
		if parsed.Data[i].Node != parsed.Data[j].Node {
			return parsed.Data[i].Node < parsed.Data[j].Node
		}
		return parsed.Data[i].VMID < parsed.Data[j].VMID
	})
	return parsed.Data, nil
}

func GetVmConfig(cfg Config, node string, vmid int, resourceType string) (map[string]any, error) {
	node = strings.TrimSpace(node)
	resourceType = strings.TrimSpace(strings.ToLower(resourceType))
	if resourceType == "" {
		resourceType = "qemu"
	}
	if node == "" || vmid <= 0 {
		return nil, fmt.Errorf("invalid node/vmid")
	}
	switch resourceType {
	case "qemu", "lxc":
	default:
		return nil, fmt.Errorf("unsupported resource type: %s", resourceType)
	}

	u, err := url.Parse(cfg.Origin)
	if err != nil {
		return nil, err
	}
	u.Path = path.Join(u.Path, "/api2/json/nodes", node, resourceType, strconv.Itoa(vmid), "config")

	req, err := http.NewRequest(http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", makeAuthHeader(cfg))
	req.Header.Set("Accept", "application/json")

	client := makeHTTPClient(cfg)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	bodyBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("pve vm config failed (%d): %s", resp.StatusCode, strings.TrimSpace(string(bodyBytes)))
	}
	var parsed pveAPIResponse[map[string]any]
	if err := json.Unmarshal(bodyBytes, &parsed); err != nil {
		return nil, err
	}
	return parsed.Data, nil
}

type VncProxyResponse struct {
	Port     int    `json:"port"`
	Ticket   string `json:"ticket"`
	Password string `json:"password"`
}

func (v *VncProxyResponse) UnmarshalJSON(b []byte) error {
	var raw struct {
		Port     json.RawMessage `json:"port"`
		Ticket   string          `json:"ticket"`
		Password string          `json:"password"`
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	v.Ticket = raw.Ticket
	v.Password = raw.Password

	rawPort := bytes.TrimSpace(raw.Port)
	if len(rawPort) == 0 || string(rawPort) == "null" {
		v.Port = 0
		return nil
	}
	if rawPort[0] == '"' {
		var s string
		if err := json.Unmarshal(rawPort, &s); err != nil {
			return err
		}
		s = strings.TrimSpace(s)
		if s == "" {
			v.Port = 0
			return nil
		}
		port, err := strconv.Atoi(s)
		if err != nil {
			return err
		}
		v.Port = port
		return nil
	}

	var port int
	if err := json.Unmarshal(rawPort, &port); err == nil {
		v.Port = port
		return nil
	}
	var num json.Number
	if err := json.Unmarshal(rawPort, &num); err != nil {
		return err
	}
	port64, err := num.Int64()
	if err != nil {
		return err
	}
	v.Port = int(port64)
	return nil
}

func CreateVncProxy(cfg Config, node string, vmid int) (*VncProxyResponse, error) {
	if strings.TrimSpace(node) == "" || vmid <= 0 {
		return nil, fmt.Errorf("invalid node/vmid")
	}
	u, err := url.Parse(cfg.Origin)
	if err != nil {
		return nil, err
	}
	u.Path = path.Join(u.Path, "/api2/json/nodes", node, "qemu", strconv.Itoa(vmid), "vncproxy")

	form := url.Values{}
	form.Set("websocket", "1")
	form.Set("generate-password", "1")
	body := bytes.NewBufferString(form.Encode())

	req, err := http.NewRequest(http.MethodPost, u.String(), body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", makeAuthHeader(cfg))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	client := makeHTTPClient(cfg)
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	bodyBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("pve vncproxy failed (%d): %s", resp.StatusCode, strings.TrimSpace(string(bodyBytes)))
	}
	var parsed pveAPIResponse[VncProxyResponse]
	if err := json.Unmarshal(bodyBytes, &parsed); err != nil {
		return nil, err
	}
	if parsed.Data.Port <= 0 || parsed.Data.Ticket == "" {
		return nil, fmt.Errorf("pve vncproxy returned invalid data")
	}
	parsed.Data.Password = strings.TrimSpace(parsed.Data.Password)
	return &parsed.Data, nil
}

func VmStatusAction(cfg Config, node string, vmid int, action string, resourceType string) (string, error) {
	node = strings.TrimSpace(node)
	action = strings.TrimSpace(strings.ToLower(action))
	resourceType = strings.TrimSpace(strings.ToLower(resourceType))
	if resourceType == "" {
		resourceType = "qemu"
	}
	if node == "" || vmid <= 0 {
		return "", fmt.Errorf("invalid node/vmid")
	}
	switch action {
	case "start", "shutdown", "stop":
	default:
		return "", fmt.Errorf("unsupported action: %s", action)
	}
	switch resourceType {
	case "qemu", "lxc":
	default:
		return "", fmt.Errorf("unsupported resource type: %s", resourceType)
	}

	u, err := url.Parse(cfg.Origin)
	if err != nil {
		return "", err
	}
	u.Path = path.Join(u.Path, "/api2/json/nodes", node, resourceType, strconv.Itoa(vmid), "status", action)

	req, err := http.NewRequest(http.MethodPost, u.String(), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", makeAuthHeader(cfg))
	req.Header.Set("Accept", "application/json")

	client := makeHTTPClient(cfg)
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	bodyBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("pve status action %s failed (%d): %s", action, resp.StatusCode, strings.TrimSpace(string(bodyBytes)))
	}

	var parsed pveAPIResponse[json.RawMessage]
	if err := json.Unmarshal(bodyBytes, &parsed); err != nil {
		return "", err
	}
	dataBytes := bytes.TrimSpace(parsed.Data)
	if len(dataBytes) == 0 || string(dataBytes) == "null" {
		return "", nil
	}
	var upid string
	if err := json.Unmarshal(dataBytes, &upid); err != nil {
		return "", err
	}
	return strings.TrimSpace(upid), nil
}

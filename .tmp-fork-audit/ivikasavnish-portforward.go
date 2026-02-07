// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

// Package portforward provides SSH port forwarding functionality for Wave Terminal.
// It supports local port forwarding (local -> remote) and remote port forwarding (remote -> local),
// with automatic reconnection, persistence, and auto-detection from terminal output.
package portforward

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wavetermdev/waveterm/pkg/panichandler"
	"github.com/wavetermdev/waveterm/pkg/wps"
	"golang.org/x/crypto/ssh"
)

// ForwardType represents the type of port forwarding
type ForwardType string

const (
	// ForwardTypeLocal represents local port forwarding (local -> remote)
	ForwardTypeLocal ForwardType = "local"
	// ForwardTypeRemote represents remote port forwarding (remote -> local)
	ForwardTypeRemote ForwardType = "remote"
	// ForwardTypeDynamic represents dynamic SOCKS proxy forwarding
	ForwardTypeDynamic ForwardType = "dynamic"
)

// ForwardStatus represents the status of a port forward
type ForwardStatus string

const (
	StatusActive       ForwardStatus = "active"
	StatusConnecting   ForwardStatus = "connecting"
	StatusDisconnected ForwardStatus = "disconnected"
	StatusError        ForwardStatus = "error"
)

// PortForwardConfig represents a port forwarding configuration
type PortForwardConfig struct {
	ID            string      `json:"id"`                      // Unique identifier for this forward
	Type          ForwardType `json:"type"`                    // local, remote, or dynamic
	LocalHost     string      `json:"localhost,omitempty"`     // Local host to bind to (default: localhost)
	LocalPort     int         `json:"localport"`               // Local port number
	RemoteHost    string      `json:"remotehost,omitempty"`    // Remote host to forward to
	RemotePort    int         `json:"remoteport,omitempty"`    // Remote port number
	Description   string      `json:"description,omitempty"`   // User-friendly description
	AutoStart     bool        `json:"autostart,omitempty"`     // Start automatically when connection is established
	Persistent    bool        `json:"persistent,omitempty"`    // Persist this forward across sessions
	ConnectionKey string      `json:"connectionkey,omitempty"` // The SSH connection this forward belongs to
}

// PortForwardState represents the runtime state of a port forward
type PortForwardState struct {
	Config       PortForwardConfig `json:"config"`
	Status       ForwardStatus     `json:"status"`
	Error        string            `json:"error,omitempty"`
	BytesSent    int64             `json:"bytessent"`
	BytesRecv    int64             `json:"bytesrecv"`
	Connections  int32             `json:"connections"`
	StartTime    int64             `json:"starttime,omitempty"`
	LastActivity int64             `json:"lastactivity,omitempty"`
}

// PortForward represents an active port forward
type PortForward struct {
	Config       PortForwardConfig
	Status       ForwardStatus
	Error        string
	listener     net.Listener
	client       *ssh.Client
	stopCh       chan struct{}
	bytesSent    atomic.Int64
	bytesRecv    atomic.Int64
	connections  atomic.Int32
	startTime    int64
	lastActivity atomic.Int64
	lock         sync.Mutex
}

// Manager manages all port forwards for SSH connections
type Manager struct {
	lock     sync.RWMutex
	forwards map[string]*PortForward // key is forward ID
	clients  map[string]*ssh.Client  // key is connection name
}

var globalManager *Manager
var managerOnce sync.Once

// GetManager returns the singleton port forward manager
func GetManager() *Manager {
	managerOnce.Do(func() {
		globalManager = &Manager{
			forwards: make(map[string]*PortForward),
			clients:  make(map[string]*ssh.Client),
		}
	})
	return globalManager
}

// RegisterClient registers an SSH client for a connection
func (m *Manager) RegisterClient(connName string, client *ssh.Client) {
	m.lock.Lock()
	defer m.lock.Unlock()
	m.clients[connName] = client
}

// UnregisterClient unregisters an SSH client and stops all its forwards
func (m *Manager) UnregisterClient(connName string) {
	m.lock.Lock()
	defer m.lock.Unlock()

	// Stop all forwards for this connection
	for id, fwd := range m.forwards {
		if fwd.Config.ConnectionKey == connName {
			fwd.Stop()
			delete(m.forwards, id)
		}
	}
	delete(m.clients, connName)
}

// StartForward starts a new port forward
func (m *Manager) StartForward(config PortForwardConfig) (*PortForwardState, error) {
	m.lock.Lock()
	defer m.lock.Unlock()

	// Check if forward already exists
	if existing, ok := m.forwards[config.ID]; ok {
		if existing.Status == StatusActive {
			return existing.GetState(), nil
		}
		// Remove the old forward
		existing.Stop()
		delete(m.forwards, config.ID)
	}

	// Get the SSH client
	client, ok := m.clients[config.ConnectionKey]
	if !ok {
		return nil, fmt.Errorf("SSH client not found for connection: %s", config.ConnectionKey)
	}

	// Create and start the forward
	fwd := &PortForward{
		Config:    config,
		Status:    StatusConnecting,
		client:    client,
		stopCh:    make(chan struct{}),
		startTime: time.Now().UnixMilli(),
	}

	var err error
	switch config.Type {
	case ForwardTypeLocal:
		err = fwd.startLocalForward()
	case ForwardTypeRemote:
		err = fwd.startRemoteForward()
	case ForwardTypeDynamic:
		err = fwd.startDynamicForward()
	default:
		err = fmt.Errorf("unsupported forward type: %s", config.Type)
	}

	if err != nil {
		fwd.Status = StatusError
		fwd.Error = err.Error()
		return fwd.GetState(), err
	}

	fwd.Status = StatusActive
	m.forwards[config.ID] = fwd

	// Fire event
	m.fireForwardChangeEvent(fwd)

	return fwd.GetState(), nil
}

// StopForward stops a port forward
func (m *Manager) StopForward(forwardID string) error {
	m.lock.Lock()
	defer m.lock.Unlock()

	fwd, ok := m.forwards[forwardID]
	if !ok {
		return fmt.Errorf("forward not found: %s", forwardID)
	}

	fwd.Stop()
	delete(m.forwards, forwardID)

	return nil
}

// GetForward returns the state of a specific forward
func (m *Manager) GetForward(forwardID string) *PortForwardState {
	m.lock.RLock()
	defer m.lock.RUnlock()

	fwd, ok := m.forwards[forwardID]
	if !ok {
		return nil
	}
	return fwd.GetState()
}

// GetForwardsByConnection returns all forwards for a connection
func (m *Manager) GetForwardsByConnection(connName string) []*PortForwardState {
	m.lock.RLock()
	defer m.lock.RUnlock()

	var states []*PortForwardState
	for _, fwd := range m.forwards {
		if fwd.Config.ConnectionKey == connName {
			states = append(states, fwd.GetState())
		}
	}
	return states
}

// GetAllForwards returns all active forwards
func (m *Manager) GetAllForwards() []*PortForwardState {
	m.lock.RLock()
	defer m.lock.RUnlock()

	var states []*PortForwardState
	for _, fwd := range m.forwards {
		states = append(states, fwd.GetState())
	}
	return states
}

func (m *Manager) fireForwardChangeEvent(fwd *PortForward) {
	state := fwd.GetState()
	event := wps.WaveEvent{
		Event: "portforward",
		Scopes: []string{
			fmt.Sprintf("connection:%s", fwd.Config.ConnectionKey),
		},
		Data: state,
	}
	wps.Broker.Publish(event)
}

// GetState returns the current state of the port forward
func (pf *PortForward) GetState() *PortForwardState {
	pf.lock.Lock()
	defer pf.lock.Unlock()

	return &PortForwardState{
		Config:       pf.Config,
		Status:       pf.Status,
		Error:        pf.Error,
		BytesSent:    pf.bytesSent.Load(),
		BytesRecv:    pf.bytesRecv.Load(),
		Connections:  pf.connections.Load(),
		StartTime:    pf.startTime,
		LastActivity: pf.lastActivity.Load(),
	}
}

// Stop stops the port forward
func (pf *PortForward) Stop() {
	pf.lock.Lock()
	defer pf.lock.Unlock()

	if pf.Status == StatusDisconnected {
		return
	}

	close(pf.stopCh)
	if pf.listener != nil {
		pf.listener.Close()
	}
	pf.Status = StatusDisconnected
}

func (pf *PortForward) startLocalForward() error {
	localAddr := fmt.Sprintf("%s:%d", pf.Config.LocalHost, pf.Config.LocalPort)
	if pf.Config.LocalHost == "" {
		localAddr = fmt.Sprintf("localhost:%d", pf.Config.LocalPort)
	}

	listener, err := net.Listen("tcp", localAddr)
	if err != nil {
		return fmt.Errorf("failed to listen on %s: %w", localAddr, err)
	}
	pf.listener = listener

	go func() {
		defer func() {
			panichandler.PanicHandler("portforward:localForward", recover())
		}()
		pf.acceptLoop()
	}()

	return nil
}

func (pf *PortForward) startRemoteForward() error {
	remoteAddr := fmt.Sprintf("%s:%d", pf.Config.RemoteHost, pf.Config.RemotePort)
	if pf.Config.RemoteHost == "" {
		remoteAddr = fmt.Sprintf("localhost:%d", pf.Config.RemotePort)
	}

	listener, err := pf.client.Listen("tcp", remoteAddr)
	if err != nil {
		return fmt.Errorf("failed to request remote forward on %s: %w", remoteAddr, err)
	}
	pf.listener = listener

	go func() {
		defer func() {
			panichandler.PanicHandler("portforward:remoteForward", recover())
		}()
		pf.acceptLoopRemote()
	}()

	return nil
}

func (pf *PortForward) startDynamicForward() error {
	// Note: Dynamic SOCKS5 proxy forwarding is not yet fully implemented.
	// This placeholder accepts connections but doesn't handle SOCKS5 protocol.
	// For now, return an error to inform users this feature is not available.
	return fmt.Errorf("dynamic SOCKS5 proxy forwarding is not yet implemented; use local or remote forwarding instead")
}

func (pf *PortForward) acceptLoop() {
	for {
		select {
		case <-pf.stopCh:
			return
		default:
		}

		conn, err := pf.listener.Accept()
		if err != nil {
			select {
			case <-pf.stopCh:
				return
			default:
				log.Printf("error accepting connection: %v", err)
				continue
			}
		}

		pf.connections.Add(1)
		go func() {
			defer func() {
				panichandler.PanicHandler("portforward:handleConn", recover())
				pf.connections.Add(-1)
			}()
			pf.handleLocalConnection(conn)
		}()
	}
}

func (pf *PortForward) acceptLoopRemote() {
	for {
		select {
		case <-pf.stopCh:
			return
		default:
		}

		conn, err := pf.listener.Accept()
		if err != nil {
			select {
			case <-pf.stopCh:
				return
			default:
				log.Printf("error accepting remote connection: %v", err)
				continue
			}
		}

		pf.connections.Add(1)
		go func() {
			defer func() {
				panichandler.PanicHandler("portforward:handleRemoteConn", recover())
				pf.connections.Add(-1)
			}()
			pf.handleRemoteConnection(conn)
		}()
	}
}

func (pf *PortForward) handleLocalConnection(localConn net.Conn) {
	defer localConn.Close()

	remoteAddr := fmt.Sprintf("%s:%d", pf.Config.RemoteHost, pf.Config.RemotePort)
	if pf.Config.RemoteHost == "" {
		remoteAddr = fmt.Sprintf("localhost:%d", pf.Config.RemotePort)
	}

	remoteConn, err := pf.client.Dial("tcp", remoteAddr)
	if err != nil {
		log.Printf("failed to dial remote %s: %v", remoteAddr, err)
		return
	}
	defer remoteConn.Close()

	pf.lastActivity.Store(time.Now().UnixMilli())
	pf.copyBidirectional(localConn, remoteConn)
}

func (pf *PortForward) handleRemoteConnection(remoteConn net.Conn) {
	defer remoteConn.Close()

	localAddr := fmt.Sprintf("%s:%d", pf.Config.LocalHost, pf.Config.LocalPort)
	if pf.Config.LocalHost == "" {
		localAddr = fmt.Sprintf("localhost:%d", pf.Config.LocalPort)
	}

	localConn, err := net.Dial("tcp", localAddr)
	if err != nil {
		log.Printf("failed to dial local %s: %v", localAddr, err)
		return
	}
	defer localConn.Close()

	pf.lastActivity.Store(time.Now().UnixMilli())
	pf.copyBidirectional(localConn, remoteConn)
}

func (pf *PortForward) copyBidirectional(local, remote net.Conn) {
	var wg sync.WaitGroup
	wg.Add(2)

	// Local to remote
	go func() {
		defer wg.Done()
		n, _ := io.Copy(remote, local)
		pf.bytesSent.Add(n)
		pf.lastActivity.Store(time.Now().UnixMilli())
	}()

	// Remote to local
	go func() {
		defer wg.Done()
		n, _ := io.Copy(local, remote)
		pf.bytesRecv.Add(n)
		pf.lastActivity.Store(time.Now().UnixMilli())
	}()

	wg.Wait()
}

// AutoForwardDetector detects port forwarding patterns in terminal output
type AutoForwardDetector struct {
	patterns []*regexp.Regexp
}

// NewAutoForwardDetector creates a new auto forward detector
func NewAutoForwardDetector() *AutoForwardDetector {
	return &AutoForwardDetector{
		patterns: []*regexp.Regexp{
			// Docker port mappings: "0.0.0.0:8080->80/tcp"
			regexp.MustCompile(`(\d+\.\d+\.\d+\.\d+):(\d+)->(\d+)/(tcp|udp)`),
			// Kubernetes port-forward: "Forwarding from 127.0.0.1:8080 -> 80"
			regexp.MustCompile(`Forwarding from (\d+\.\d+\.\d+\.\d+):(\d+)\s*->\s*(\d+)`),
			// SSH LocalForward output: "Allocated port 8080 for remote forward"
			regexp.MustCompile(`Allocated port (\d+)`),
			// Common service outputs: "Listening on port 3000"
			regexp.MustCompile(`[Ll]istening on (?:port\s+)?(\d+)`),
			// Express/Node: "Server running on http://localhost:3000"
			regexp.MustCompile(`[Ss]erver (?:running|started|listening) on (?:https?://)?(?:localhost|127\.0\.0\.1):(\d+)`),
		},
	}
}

// DetectedForward represents a port forward detected from terminal output
type DetectedForward struct {
	LocalHost  string
	LocalPort  int
	RemoteHost string
	RemotePort int
	Type       ForwardType
	Source     string // What triggered the detection
}

// DetectForwards scans text for port forwarding patterns
func (d *AutoForwardDetector) DetectForwards(text string) []DetectedForward {
	var detected []DetectedForward

	for _, pattern := range d.patterns {
		matches := pattern.FindAllStringSubmatch(text, -1)
		for _, match := range matches {
			fwd := d.parseMatch(pattern, match)
			if fwd != nil {
				detected = append(detected, *fwd)
			}
		}
	}

	return detected
}

func (d *AutoForwardDetector) parseMatch(pattern *regexp.Regexp, match []string) *DetectedForward {
	if len(match) < 2 {
		return nil
	}

	patternStr := pattern.String()

	// Docker pattern
	if strings.Contains(patternStr, "->") && strings.Contains(patternStr, "tcp|udp") {
		if len(match) >= 4 {
			localPort, _ := strconv.Atoi(match[2])
			remotePort, _ := strconv.Atoi(match[3])
			return &DetectedForward{
				LocalHost:  match[1],
				LocalPort:  localPort,
				RemotePort: remotePort,
				Type:       ForwardTypeLocal,
				Source:     "docker",
			}
		}
	}

	// Kubernetes pattern
	if strings.Contains(patternStr, "Forwarding from") {
		if len(match) >= 4 {
			localPort, _ := strconv.Atoi(match[2])
			remotePort, _ := strconv.Atoi(match[3])
			return &DetectedForward{
				LocalHost:  match[1],
				LocalPort:  localPort,
				RemotePort: remotePort,
				Type:       ForwardTypeLocal,
				Source:     "kubernetes",
			}
		}
	}

	// Simple port listening patterns
	if strings.Contains(patternStr, "istening") {
		port, _ := strconv.Atoi(match[1])
		return &DetectedForward{
			LocalHost: "localhost",
			LocalPort: port,
			Type:      ForwardTypeLocal,
			Source:    "service",
		}
	}

	return nil
}

// StartAutoForwards starts port forwards that are configured to auto-start.
// It returns a slice of errors for any forwards that failed to start.
// The function continues trying to start other forwards even if some fail.
func (m *Manager) StartAutoForwards(ctx context.Context, connName string, configs []PortForwardConfig) []error {
	var errors []error
	for _, config := range configs {
		if config.AutoStart && config.ConnectionKey == connName {
			state, err := m.StartForward(config)
			if err != nil {
				log.Printf("failed to auto-start forward %s: %v", config.ID, err)
				errors = append(errors, fmt.Errorf("forward %s: %w", config.ID, err))
				// Fire an event so the UI can show the failure
				m.fireAutoStartFailureEvent(connName, config, err)
			} else if state != nil && state.Status == StatusError {
				log.Printf("auto-start forward %s completed with error: %s", config.ID, state.Error)
				errors = append(errors, fmt.Errorf("forward %s: %s", config.ID, state.Error))
			}
		}
	}
	return errors
}

func (m *Manager) fireAutoStartFailureEvent(connName string, config PortForwardConfig, err error) {
	event := wps.WaveEvent{
		Event: "portforward:autostart:error",
		Scopes: []string{
			fmt.Sprintf("connection:%s", connName),
		},
		Data: map[string]any{
			"forwardid": config.ID,
			"error":     err.Error(),
			"config":    config,
		},
	}
	wps.Broker.Publish(event)
}

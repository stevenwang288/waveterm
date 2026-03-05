// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package pve

import (
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
)

const defaultSessionTTL = 2 * time.Minute

type ConsoleSession struct {
	SessionID string
	Origin    string
	VerifySSL bool
	Node      string
	VMID      int
	Port      int
	Ticket    string
	Password  string
	CreatedAt time.Time
	ExpiresAt time.Time
}

var sessionsMu sync.Mutex
var sessions = map[string]*ConsoleSession{}

func cleanupExpiredLocked(now time.Time) {
	for k, sess := range sessions {
		if sess == nil || now.After(sess.ExpiresAt) {
			delete(sessions, k)
		}
	}
}

func CreateConsoleSession(node string, vmid int) (*ConsoleSession, error) {
	cfg, err := GetConfig()
	if err != nil {
		return nil, err
	}
	vnc, err := CreateVncProxy(cfg, node, vmid)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	ttl := defaultSessionTTL
	sessionID := uuid.NewString()
	sess := &ConsoleSession{
		SessionID: sessionID,
		Origin:    cfg.Origin,
		VerifySSL: cfg.VerifySSL,
		Node:      node,
		VMID:      vmid,
		Port:      vnc.Port,
		Ticket:    vnc.Ticket,
		Password:  vnc.Password,
		CreatedAt: now,
		ExpiresAt: now.Add(ttl),
	}

	sessionsMu.Lock()
	defer sessionsMu.Unlock()
	cleanupExpiredLocked(now)
	sessions[sessionID] = sess
	return sess, nil
}

// ConsumeConsoleSession returns and deletes the session. This keeps VNC tickets from being reused.
func ConsumeConsoleSession(sessionID string) (*ConsoleSession, error) {
	if sessionID == "" {
		return nil, fmt.Errorf("missing session id")
	}
	now := time.Now()
	sessionsMu.Lock()
	defer sessionsMu.Unlock()
	cleanupExpiredLocked(now)
	sess := sessions[sessionID]
	if sess == nil || now.After(sess.ExpiresAt) {
		delete(sessions, sessionID)
		return nil, fmt.Errorf("session not found or expired")
	}
	delete(sessions, sessionID)
	return sess, nil
}


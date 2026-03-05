// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package web

import (
	"crypto/tls"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/wavetermdev/waveterm/pkg/authkey"
	"github.com/wavetermdev/waveterm/pkg/pve"
)

var pveConsoleUpgrader = websocket.Upgrader{
	ReadBufferSize:   4 * 1024,
	WriteBufferSize:  32 * 1024,
	HandshakeTimeout: 3 * time.Second,
	Subprotocols:     []string{"binary"},
	CheckOrigin:      func(r *http.Request) bool { return true },
}

func buildPveVncWebsocketURL(origin string, node string, vmid int, port int, ticket string) (string, error) {
	u, err := url.Parse(origin)
	if err != nil {
		return "", err
	}
	u.Path = path.Join(u.Path, "/api2/json/nodes", node, "qemu", strconv.Itoa(vmid), "vncwebsocket")
	q := u.Query()
	q.Set("port", strconv.Itoa(port))
	q.Set("vncticket", ticket)
	u.RawQuery = q.Encode()

	// Origin is https://...; websocket is wss://...
	if strings.EqualFold(u.Scheme, "https") {
		u.Scheme = "wss"
	} else if strings.EqualFold(u.Scheme, "http") {
		u.Scheme = "ws"
	}
	return u.String(), nil
}

func relayWebsocket(src *websocket.Conn, dst *websocket.Conn, done chan<- struct{}) {
	defer func() {
		select {
		case done <- struct{}{}:
		default:
		}
	}()
	for {
		mt, msg, err := src.ReadMessage()
		if err != nil {
			return
		}
		if err := dst.WriteMessage(mt, msg); err != nil {
			return
		}
	}
}

func HandlePveConsoleWS(w http.ResponseWriter, r *http.Request) {
	err := handlePveConsoleWSInternal(w, r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func handlePveConsoleWSInternal(w http.ResponseWriter, r *http.Request) error {
	if err := authkey.ValidateIncomingRequest(r); err != nil {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(fmt.Sprintf("error validating authkey: %v", err)))
		return err
	}

	sessionID := mux.Vars(r)["sessionid"]
	sess, err := pve.ConsumeConsoleSession(sessionID)
	if err != nil {
		return err
	}

	cfg, err := pve.GetConfig()
	if err != nil {
		return err
	}

	upstreamURL, err := buildPveVncWebsocketURL(sess.Origin, sess.Node, sess.VMID, sess.Port, sess.Ticket)
	if err != nil {
		return err
	}

	clientConn, err := pveConsoleUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return fmt.Errorf("websocket upgrade failed: %w", err)
	}
	defer clientConn.Close()

	headers := http.Header{}
	headers.Set("Origin", sess.Origin)
	headers.Set("Authorization", fmt.Sprintf("PVEAPIToken=%s=%s", cfg.TokenID, cfg.TokenSecret))

	dialer := websocket.Dialer{
		HandshakeTimeout: 5 * time.Second,
		Subprotocols:     []string{"binary"},
	}
	if strings.HasPrefix(strings.ToLower(upstreamURL), "wss://") && !sess.VerifySSL {
		dialer.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec
	}

	upConn, _, err := dialer.Dial(upstreamURL, headers)
	if err != nil {
		return fmt.Errorf("upstream dial failed: %w", err)
	}
	defer upConn.Close()

	log.Printf("pve: console relay connected (node=%s vmid=%d)\n", sess.Node, sess.VMID)

	done := make(chan struct{}, 2)
	go func() {
		relayWebsocket(clientConn, upConn, done)
	}()
	go func() {
		relayWebsocket(upConn, clientConn, done)
	}()
	<-done
	return nil
}

// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wshutil

import (
	"sync"

	"github.com/wavetermdev/waveterm/pkg/baseds"
	"github.com/wavetermdev/waveterm/pkg/wshrpc"
)

type WshRpcProxy struct {
	Lock         *sync.Mutex
	RpcContext   *wshrpc.RpcContext
	ToRemoteCh   chan []byte
	FromRemoteCh chan baseds.RpcInputChType
	PeerInfo     string
}

func MakeRpcProxy(peerInfo string) *WshRpcProxy {
	return MakeRpcProxyWithSize(peerInfo, DefaultInputChSize, DefaultOutputChSize)
}

func MakeRpcProxyWithSize(peerInfo string, inputChSize int, outputChSize int) *WshRpcProxy {
	return &WshRpcProxy{
		Lock:         &sync.Mutex{},
		ToRemoteCh:   make(chan []byte, inputChSize),
		FromRemoteCh: make(chan baseds.RpcInputChType, outputChSize),
		PeerInfo:     peerInfo,
	}
}

func (p *WshRpcProxy) GetPeerInfo() string {
	return p.PeerInfo
}

func (p *WshRpcProxy) SetPeerInfo(peerInfo string) {
	p.Lock.Lock()
	defer p.Lock.Unlock()
	p.PeerInfo = peerInfo
}

func (p *WshRpcProxy) SendRpcMessage(msg []byte, ingressLinkId baseds.LinkId, debugStr string) (sent bool) {
	// This method is called by the router in hot paths.
	// During teardown, the underlying channel may be closed; treat that as a
	// normal "send failed" condition rather than a panic+stack trace spam.
	defer func() {
		if recover() != nil {
			sent = false
		}
	}()
	select {
	case p.ToRemoteCh <- msg:
		return true
	default:
		return false
	}
}

func (p *WshRpcProxy) RecvRpcMessage() ([]byte, bool) {
	inputVal, more := <-p.FromRemoteCh
	return inputVal.MsgBytes, more
}

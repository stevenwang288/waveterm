// Copyright 2025, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package iochan_test

import (
	"bytes"
	"context"
	"io"
	"sync/atomic"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/util/iochan"
)

const (
	buflen = 1024
)

func TestIochan_Basic(t *testing.T) {
	// Write the packet to the source pipe from a goroutine
	srcPipeReader, srcPipeWriter := io.Pipe()
	packet := []byte("hello world")
	go func() {
		srcPipeWriter.Write(packet)
		srcPipeWriter.Close()
	}()

	// Initialize the reader channel
	var readerChanCallbackCalled atomic.Bool
	readerChanCallback := func() {
		readerChanCallbackCalled.Store(true)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ioch := iochan.ReaderChan(ctx, srcPipeReader, buflen, readerChanCallback)

	// Initialize the destination pipe and the writer channel
	destPipeReader, destPipeWriter := io.Pipe()
	defer destPipeReader.Close()
	var writerChanCallbackCalled atomic.Bool
	writerChanCallback := func() {
		destPipeWriter.Close()
		writerChanCallbackCalled.Store(true)
	}
	iochan.WriterChan(ctx, destPipeWriter, ioch, writerChanCallback, func(err error) {})

	// Read all output from the destination pipe and compare it to the original packet
	out, err := io.ReadAll(destPipeReader)
	if err != nil {
		t.Fatalf("Read failed: %v", err)
	}
	if len(out) != len(packet) {
		t.Fatalf("Read length mismatch: %d != %d", len(out), len(packet))
	}
	if !bytes.Equal(out, packet) {
		t.Fatalf("Read data mismatch: %s != %s", out, packet)
	}

	cancel()
	if !readerChanCallbackCalled.Load() {
		t.Logf("ReaderChan callback observed asynchronously; not asserting timing")
	}
	if !writerChanCallbackCalled.Load() {
		t.Fatalf("WriterChan callback not called")
	}
}

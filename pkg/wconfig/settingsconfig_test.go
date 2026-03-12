// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

package wconfig

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"testing"
	"unicode/utf16"
)

func encodeUTF16Bytes(input string, littleEndian bool) []byte {
	u16 := utf16.Encode([]rune(input))
	out := make([]byte, len(u16)*2)
	for i, v := range u16 {
		off := i * 2
		if littleEndian {
			binary.LittleEndian.PutUint16(out[off:off+2], v)
		} else {
			binary.BigEndian.PutUint16(out[off:off+2], v)
		}
	}
	return out
}

func TestNormalizeJSONConfigBytes_StripsUTF8BOM(t *testing.T) {
	input := append([]byte{0xEF, 0xBB, 0xBF}, []byte("{\"a\":1}")...)
	out, err := normalizeJSONConfigBytes(input)
	if err != nil {
		t.Fatalf("normalizeJSONConfigBytes returned error: %v", err)
	}
	if !bytes.Equal(out, []byte("{\"a\":1}")) {
		t.Fatalf("unexpected output: %q", string(out))
	}
	var m map[string]any
	if err := json.Unmarshal(out, &m); err != nil {
		t.Fatalf("json.Unmarshal failed: %v", err)
	}
}

func TestNormalizeJSONConfigBytes_DecodesUTF16LE(t *testing.T) {
	payload := "{\"a\":1}"
	input := append([]byte{0xFF, 0xFE}, encodeUTF16Bytes(payload, true)...)
	out, err := normalizeJSONConfigBytes(input)
	if err != nil {
		t.Fatalf("normalizeJSONConfigBytes returned error: %v", err)
	}
	if !bytes.Equal(out, []byte(payload)) {
		t.Fatalf("unexpected output: %q", string(out))
	}
}

func TestNormalizeJSONConfigBytes_DecodesUTF16BE(t *testing.T) {
	payload := "{\"a\":1}"
	input := append([]byte{0xFE, 0xFF}, encodeUTF16Bytes(payload, false)...)
	out, err := normalizeJSONConfigBytes(input)
	if err != nil {
		t.Fatalf("normalizeJSONConfigBytes returned error: %v", err)
	}
	if !bytes.Equal(out, []byte(payload)) {
		t.Fatalf("unexpected output: %q", string(out))
	}
}

func TestConnKeywords_UnmarshalPreservesPveFields(t *testing.T) {
	var keywords ConnKeywords
	err := json.Unmarshal(
		[]byte(`{
			"pve:vmid": 152,
			"pve:node": "VUModule",
			"pve:type": "qemu",
			"pve:name": "152-win11-magisk----GUI--win11",
			"ssh:hostname": "10.20.0.152"
		}`),
		&keywords,
	)
	if err != nil {
		t.Fatalf("json.Unmarshal returned error: %v", err)
	}
	if keywords.PveVmid != 152 {
		t.Fatalf("expected pve vmid 152, got %d", keywords.PveVmid)
	}
	if keywords.PveNode != "VUModule" {
		t.Fatalf("expected pve node VUModule, got %q", keywords.PveNode)
	}
	if keywords.PveType != "qemu" {
		t.Fatalf("expected pve type qemu, got %q", keywords.PveType)
	}
	if keywords.PveName != "152-win11-magisk----GUI--win11" {
		t.Fatalf("expected pve name to survive unmarshal, got %q", keywords.PveName)
	}
	if keywords.SshHostName == nil || *keywords.SshHostName != "10.20.0.152" {
		t.Fatalf("expected ssh hostname to survive unmarshal, got %#v", keywords.SshHostName)
	}
}

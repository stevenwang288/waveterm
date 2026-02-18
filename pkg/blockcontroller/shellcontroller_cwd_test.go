package blockcontroller

import (
	"runtime"
	"strings"
	"testing"

	"github.com/wavetermdev/waveterm/pkg/util/shellutil"
	"github.com/wavetermdev/waveterm/pkg/wavebase"
)

func TestResolveCmdCwd_RemotePosixKeepsForwardSlashes(t *testing.T) {
	t.Parallel()

	connUnion := ConnUnion{
		ConnType:  ConnType_Ssh,
		ShellType: shellutil.ShellType_bash,
		HomeDir:   "/root",
	}

	got, err := resolveCmdCwd("/root", connUnion)
	if err != nil {
		t.Fatalf("resolveCmdCwd returned error: %v", err)
	}
	if got != "/root" {
		t.Fatalf("expected %q, got %q", "/root", got)
	}
	if strings.Contains(got, `\`) {
		t.Fatalf("expected POSIX cwd without backslashes, got %q", got)
	}

	// The original bug is Windows-specific: filepath.Clean("/root") => "\\root".
	if runtime.GOOS == "windows" {
		bad, err := wavebase.ExpandHomeDir("/root")
		if err != nil {
			t.Fatalf("ExpandHomeDir returned error: %v", err)
		}
		if bad == got {
			t.Fatalf("expected remote cwd normalization to differ from local ExpandHomeDir on Windows; got %q", got)
		}
		if bad != `\root` {
			t.Fatalf("expected ExpandHomeDir(%q) to be %q on Windows, got %q", "/root", `\root`, bad)
		}
	}
}

func TestResolveCmdCwd_RemoteTildeExpandsWithRemoteHome(t *testing.T) {
	t.Parallel()

	connUnion := ConnUnion{
		ConnType:  ConnType_Ssh,
		ShellType: shellutil.ShellType_bash,
		HomeDir:   "/root",
	}

	got, err := resolveCmdCwd("~/workspace", connUnion)
	if err != nil {
		t.Fatalf("resolveCmdCwd returned error: %v", err)
	}
	if got != "/root/workspace" {
		t.Fatalf("expected %q, got %q", "/root/workspace", got)
	}
}

func TestResolveCmdCwd_RemoteBackslashRootIsTreatedAsPosix(t *testing.T) {
	t.Parallel()

	connUnion := ConnUnion{
		ConnType:  ConnType_Ssh,
		ShellType: shellutil.ShellType_bash,
		HomeDir:   "/root",
	}

	got, err := resolveCmdCwd(`\root`, connUnion)
	if err != nil {
		t.Fatalf("resolveCmdCwd returned error: %v", err)
	}
	if got != "/root" {
		t.Fatalf("expected %q, got %q", "/root", got)
	}
}

func TestResolveCmdCwd_RemoteWindowsPathsArePreserved(t *testing.T) {
	t.Parallel()

	connUnion := ConnUnion{
		ConnType:  ConnType_Ssh,
		ShellType: shellutil.ShellType_bash,
	}

	got, err := resolveCmdCwd(`C:\Users\Admin`, connUnion)
	if err != nil {
		t.Fatalf("resolveCmdCwd returned error: %v", err)
	}
	if got != `C:\Users\Admin` {
		t.Fatalf("expected %q, got %q", `C:\Users\Admin`, got)
	}
}


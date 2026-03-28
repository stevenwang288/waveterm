package blockservice

import "testing"

func TestCanSaveWaveAIDataForView(t *testing.T) {
	tests := []struct {
		name     string
		viewName string
		want     bool
	}{
		{name: "waveai view", viewName: "waveai", want: true},
		{name: "workbench view", viewName: "workbench", want: true},
		{name: "term view", viewName: "term", want: false},
		{name: "blank view", viewName: "", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := canSaveWaveAIDataForView(tt.viewName); got != tt.want {
				t.Fatalf("canSaveWaveAIDataForView(%q) = %v, want %v", tt.viewName, got, tt.want)
			}
		})
	}
}

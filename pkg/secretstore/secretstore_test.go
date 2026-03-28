package secretstore

import "testing"

func TestMakeSSHPasswordSecretName(t *testing.T) {
	tests := []struct {
		name       string
		connection string
		want       string
	}{
		{name: "basic host", connection: "prod-box", want: "ssh_password_prod_box"},
		{name: "user host port", connection: "root@example.com:2222", want: "ssh_password_root_example_com_2222"},
		{name: "blank", connection: "   ", want: "ssh_password_connection"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := MakeSSHPasswordSecretName(tt.connection)
			if got != tt.want {
				t.Fatalf("MakeSSHPasswordSecretName(%q) = %q, want %q", tt.connection, got, tt.want)
			}
		})
	}
}

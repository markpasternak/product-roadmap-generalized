package main

import "testing"

func TestLoadConfig(t *testing.T) {
	env := map[string]string{
		"GITHUB_APP_ID": "4223213", "GITHUB_APP_CLIENT_ID": "cid", "GITHUB_APP_CLIENT_SECRET": "sec",
		"GITHUB_APP_INSTALLATION_ID": "144599065", "GITHUB_APP_PRIVATE_KEY_FILE": "deploy/github-app.pem",
		"REPO": "markpasternak/product-roadmap-generalized", "ALLOWED_ORIGIN": "https://x", "API_ORIGIN": "https://y",
		"SESSION_SECRET": "s", "LISTEN_ADDR": "127.0.0.1:8790",
	}
	c, err := LoadConfig(func(k string) string { return env[k] })
	if err != nil {
		t.Fatal(err)
	}
	if c.AppID != "4223213" || c.Repo != "markpasternak/product-roadmap-generalized" || c.ListenAddr != "127.0.0.1:8790" {
		t.Fatalf("bad config: %+v", c)
	}
	if _, err := LoadConfig(func(string) string { return "" }); err == nil {
		t.Fatal("expected error on missing required env")
	}
}

package main

import "testing"

func TestLoadConfig(t *testing.T) {
	env := map[string]string{
		"GITHUB_APP_ID": "4223213", "GITHUB_APP_CLIENT_ID": "cid", "GITHUB_APP_CLIENT_SECRET": "sec",
		"GITHUB_APP_INSTALLATION_ID": "144599065", "GITHUB_APP_PRIVATE_KEY_FILE": "deploy/github-app.pem",
		"REPO": "markpasternak/product-roadmap-generalized", "ALLOWED_ORIGIN": "https://x", "API_ORIGIN": "https://y",
		"SESSION_SECRET": "s", "LISTEN_ADDR": "127.0.0.1:8790",
		"ROADMAP_PUBLICATION_PAUSED": "true",
	}
	c, err := LoadConfig(func(k string) string { return env[k] })
	if err != nil {
		t.Fatal(err)
	}
	if c.AppID != "4223213" || c.Repo != "markpasternak/product-roadmap-generalized" || c.ListenAddr != "127.0.0.1:8790" || !c.LocalBuild.PublicationPaused {
		t.Fatalf("bad config: %+v", c)
	}
	if _, err := LoadConfig(func(string) string { return "" }); err == nil {
		t.Fatal("expected error on missing required env")
	}
	for _, value := range []string{"4", "8"} {
		env["ROADMAP_UPLOAD_CONCURRENCY"] = value
		if _, err := LoadConfig(func(k string) string { return env[k] }); err != nil {
			t.Fatal(err)
		}
	}
	env["ROADMAP_UPLOAD_CONCURRENCY"] = "100"
	if _, err := LoadConfig(func(k string) string { return env[k] }); err == nil {
		t.Fatal("unbounded uploads accepted")
	}
}

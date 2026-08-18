package main

import (
	"fmt"
	"os"
	"path/filepath"
)

type Config struct {
	AppID, ClientID, ClientSecret, InstallationID, PrivateKeyFile string
	Repo, AllowedOrigin, APIOrigin, SessionSecret, ListenAddr     string
	RepoCacheDir                                                  string
}

func LoadConfig(getenv func(string) string) (Config, error) {
	c := Config{
		AppID: getenv("GITHUB_APP_ID"), ClientID: getenv("GITHUB_APP_CLIENT_ID"),
		ClientSecret: getenv("GITHUB_APP_CLIENT_SECRET"), InstallationID: getenv("GITHUB_APP_INSTALLATION_ID"),
		PrivateKeyFile: getenv("GITHUB_APP_PRIVATE_KEY_FILE"), Repo: getenv("REPO"),
		AllowedOrigin: getenv("ALLOWED_ORIGIN"), APIOrigin: getenv("API_ORIGIN"),
		SessionSecret: getenv("SESSION_SECRET"), ListenAddr: getenv("LISTEN_ADDR"),
		RepoCacheDir: getenv("REPO_CACHE_DIR"),
	}
	if c.RepoCacheDir == "" {
		c.RepoCacheDir = filepath.Join(os.TempDir(), "roadmap-editor", "repo")
	}
	for k, v := range map[string]string{
		"GITHUB_APP_ID": c.AppID, "GITHUB_APP_CLIENT_ID": c.ClientID, "GITHUB_APP_CLIENT_SECRET": c.ClientSecret,
		"GITHUB_APP_INSTALLATION_ID": c.InstallationID, "GITHUB_APP_PRIVATE_KEY_FILE": c.PrivateKeyFile,
		"REPO": c.Repo, "ALLOWED_ORIGIN": c.AllowedOrigin, "API_ORIGIN": c.APIOrigin,
		"SESSION_SECRET": c.SessionSecret, "LISTEN_ADDR": c.ListenAddr,
	} {
		if v == "" {
			return Config{}, fmt.Errorf("missing required env %s", k)
		}
	}
	return c, nil
}

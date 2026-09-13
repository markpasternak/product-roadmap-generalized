package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func approvedPackageFixture(t *testing.T) (localBuildConfig, string) {
	t.Helper()
	root := t.TempDir()
	profile := buildProfile{SiteURL: "https://example.test", Base: "/", Audience: "internal", EditAPI: "https://edit.example.test", CanvasBackend: "true"}
	files := []map[string]any{}
	for _, path := range []string{"private/renderer.mjs", "private/template.html", "private/template-docs.html", "public/.vite/manifest.json", "private/commands/prepare-content.mjs", "private/commands/coordinate.mjs", "private/commands/staged.mjs", "private/commands/application-package.mjs", "private/commands/client-assets.mjs", "private/commands/content-output.mjs", "private/commands/build-item-history.mjs", "private/commands/check-demo.mjs", "private/commands/check-document-links.mjs", "private/commands/check-item-history.mjs", "private/commands/validate_items.py"} {
		if err := writeConfined(root, path, []byte("fixture")); err != nil {
			t.Fatal(err)
		}
		hash := sha256.Sum256([]byte("fixture"))
		files = append(files, map[string]any{"path": path, "hash": hex.EncodeToString(hash[:]), "size": 7})
	}
	source := strings.Repeat("a", 40)
	manifest := map[string]any{"type": "module", "protocol": 1, "source": source, "nodeMajor": 24, "profile": profile, "files": files, "base": "/", "audience": "internal", "dependencyDigest": strings.Repeat("b", 64)}
	bytes, _ := json.Marshal(manifest)
	os.WriteFile(filepath.Join(root, "package.json"), bytes, 0600)
	sum := sha256.Sum256(bytes)
	pointer := filepath.Join(t.TempDir(), "approved.json")
	if err := writeJSONAtomic(pointer, map[string]any{"directory": root, "digest": hex.EncodeToString(sum[:]), "source": source, "repo": "example/roadmap", "workflowRunId": 123}); err != nil {
		t.Fatal(err)
	}
	return localBuildConfig{ApplicationPointer: pointer, Profile: profile}, root
}

func TestApprovedApplicationPackage(t *testing.T) {
	for _, scenario := range []string{"valid", "tampered", "wrong-repo", "wrong-profile", "symlink", "unlisted", "missing"} {
		t.Run(scenario, func(t *testing.T) {
			cfg, root := approvedPackageFixture(t)
			repo := "example/roadmap"
			switch scenario {
			case "tampered":
				os.WriteFile(filepath.Join(root, "private/renderer.mjs"), []byte("changed"), 0600)
			case "wrong-repo":
				repo = "other/roadmap"
			case "wrong-profile":
				cfg.Profile.Audience = "public"
			case "symlink":
				os.Remove(filepath.Join(root, "private/renderer.mjs"))
				os.Symlink("commands/coordinate.mjs", filepath.Join(root, "private/renderer.mjs"))
			case "unlisted":
				os.WriteFile(filepath.Join(root, "private/extra.mjs"), []byte("extra"), 0600)
			case "missing":
				os.Remove(cfg.ApplicationPointer)
			}
			app, err := loadApprovedApplication(cfg, repo)
			if scenario == "valid" {
				if err != nil || app.Source != strings.Repeat("a", 40) {
					t.Fatalf("valid package: %v", err)
				}
			} else if err == nil {
				t.Fatal("untrusted package accepted")
			}
		})
	}
	t.Run("missing-required-demo-check", func(t *testing.T) {
		cfg, root := approvedPackageFixture(t)
		var manifest map[string]any
		if err := readJSON(filepath.Join(root, "package.json"), &manifest); err != nil {
			t.Fatal(err)
		}
		files := manifest["files"].([]any)
		filtered := files[:0]
		for _, value := range files {
			if value.(map[string]any)["path"] != "private/commands/check-demo.mjs" {
				filtered = append(filtered, value)
			}
		}
		manifest["files"] = filtered
		bytes, _ := json.Marshal(manifest)
		if err := os.WriteFile(filepath.Join(root, "package.json"), bytes, 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Remove(filepath.Join(root, "private/commands/check-demo.mjs")); err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(bytes)
		if err := writeJSONAtomic(cfg.ApplicationPointer, approvedApplication{Directory: root, Digest: hex.EncodeToString(sum[:]), Source: strings.Repeat("a", 40), Repo: "example/roadmap", WorkflowRunID: 123}); err != nil {
			t.Fatal(err)
		}
		if _, err := loadApprovedApplication(cfg, "example/roadmap"); err == nil || !strings.Contains(err.Error(), "incomplete") {
			t.Fatalf("package without demo checker accepted: %v", err)
		}
	})
}

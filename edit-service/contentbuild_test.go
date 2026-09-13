package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestContentWorkerPreparation(t *testing.T) {
	for _, scenario := range []string{"shadow", "untrusted", "code-change", "command-failure", "wrong-version", "superseded"} {
		t.Run(scenario, func(t *testing.T) {
			g, head := buildFixture(t)
			cfg, appRoot := approvedPackageFixture(t)
			// Approve exactly the fixture baseline; content may advance beyond it.
			b, _ := os.ReadFile(filepath.Join(appRoot, "package.json"))
			b = []byte(strings.ReplaceAll(string(b), strings.Repeat("a", 40), head))
			if err := os.WriteFile(filepath.Join(appRoot, "package.json"), b, 0600); err != nil {
				t.Fatal(err)
			}
			hash := sha256.Sum256(b)
			digest := hex.EncodeToString(hash[:])
			if err := writeJSONAtomic(cfg.ApplicationPointer, approvedApplication{Directory: appRoot, Digest: digest, Source: head, Repo: g.cfg.Repo, WorkflowRunID: 123}); err != nil {
				t.Fatal(err)
			}
			cfg.Mode = "shadow"
			g.cfg.LocalBuild = cfg
			g.cfg.CanvasDropToken = "never-pass-to-renderer"
			g.localBuild = &localBuildWorker{wake: make(chan time.Time, 1), done: make(chan struct{})}
			if scenario == "untrusted" {
				os.WriteFile(filepath.Join(appRoot, "private/renderer.mjs"), []byte("tampered"), 0600)
			}
			if scenario == "code-change" {
				os.WriteFile(filepath.Join(g.repoRoot(), "site/package.json"), []byte("changed"), 0600)
				gitTest(t, g.repoRoot(), "add", ".")
				gitTest(t, g.repoRoot(), "commit", "-m", "code change")
				head = gitTest(t, g.repoRoot(), "rev-parse", "HEAD")
			}
			reads, runs := 0, 0
			latest := func(context.Context) (string, error) {
				reads++
				if scenario == "superseded" && reads > 1 {
					return strings.Repeat("b", 40), nil
				}
				return head, nil
			}
			run := func(ctx context.Context, root string, env, args []string) error {
				runs++
				if !strings.HasPrefix(args[1], filepath.Join(appRoot, "private/commands")+"/") {
					t.Fatalf("untrusted command %v", args)
				}
				if strings.Contains(strings.Join(env, "\n"), "never-pass") || strings.Contains(strings.Join(env, "\n"), "GH_TOKEN=") {
					t.Fatal("credentials in renderer")
				}
				if filepath.Base(args[1]) == "coordinate.mjs" {
					t.Fatal("shadow contacted Canvas")
				}
				if scenario == "command-failure" {
					return errors.New("failed")
				}
				if filepath.Base(args[1]) == "prepare-content.mjs" {
					commit := head
					if scenario == "wrong-version" {
						commit = strings.Repeat("c", 40)
					}
					data, _ := json.Marshal(map[string]string{"commit": commit, "applicationCommit": head, "applicationPackage": digest})
					return writeConfined(args[4], "public/version.json", data)
				}
				return nil
			}
			err := g.prepareContent(context.Background(), latest, run)
			if scenario == "shadow" {
				if err != nil {
					t.Fatal(err)
				}
				if runs != 5 {
					t.Fatalf("commands %d", runs)
				}
			} else if err == nil {
				t.Fatal("unsafe preparation accepted")
			}
			if (scenario == "untrusted" || scenario == "code-change") && runs != 0 {
				t.Fatal("executed before trust/eligibility checks")
			}
			if scenario == "superseded" && len(g.localBuild.wake) != 1 {
				t.Fatal("new main not queued")
			}
			entries, _ := os.ReadDir(filepath.Join(g.cfg.StateDir, "local-build"))
			for _, entry := range entries {
				if localBuildAttemptName.MatchString(entry.Name()) {
					t.Fatal("attempt leaked")
				}
			}
		})
	}
}

func TestReconciliationStartupTimerAndCancellation(t *testing.T) {
	runs := make(chan struct{}, 10)
	w := newReconcilingBuildWorker(func(context.Context) error { runs <- struct{}{}; return nil }, 20*time.Millisecond)
	for i := 0; i < 2; i++ {
		select {
		case <-runs:
		case <-time.After(time.Second):
			t.Fatal("missing startup or timer reconciliation")
		}
	}
	w.close()
	select {
	case <-w.done:
	default:
		t.Fatal("worker not closed")
	}
}

// Opt-in actual immutable worktree -> trusted Node/Python commands -> full
// content output -> link/date/identity checks. It cannot contact Canvas or push.
func TestContentWorkerRealPackage(t *testing.T) {
	directory, digest := os.Getenv("CONTENT_TEST_APPLICATION"), os.Getenv("CONTENT_TEST_PACKAGE_DIGEST")
	if directory == "" || digest == "" {
		t.Skip("requires a locally compiled proof package")
	}
	directory, err := filepath.Abs(directory)
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Source  string       `json:"source"`
		Profile buildProfile `json:"profile"`
	}
	if err := readJSON(filepath.Join(directory, "package.json"), &manifest); err != nil {
		t.Fatal(err)
	}
	repoRoot := gitTest(t, ".", "rev-parse", "--show-toplevel")
	state := t.TempDir()
	pointer := filepath.Join(state, "approved.json")
	if err := writeJSONAtomic(pointer, approvedApplication{Directory: directory, Digest: digest, Source: manifest.Source, Repo: "example/roadmap", WorkflowRunID: 1}); err != nil {
		t.Fatal(err)
	}
	g := &GitHub{cfg: Config{Repo: "example/roadmap", RepoCacheDir: repoRoot, StateDir: state, LocalBuild: localBuildConfig{Mode: "shadow", ApplicationPointer: pointer, Profile: manifest.Profile}}}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if err := g.prepareContent(ctx, func(context.Context) (string, error) { return manifest.Source, nil }, runBuildCommand); err != nil {
		t.Fatal(err)
	}
	var receipt map[string]any
	if err := readJSON(filepath.Join(state, "local-build/last-shadow.json"), &receipt); err != nil {
		t.Fatal(err)
	}
	if receipt["commit"] != manifest.Source || receipt["state"] != "shadow-prepared-not-deployed" {
		t.Fatal("invalid shadow receipt")
	}
}

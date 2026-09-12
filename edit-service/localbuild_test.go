package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func buildFixture(t *testing.T) (*GitHub, string) {
	t.Helper()
	root := t.TempDir()
	gitTest(t, root, "init", "-b", "main")
	gitTest(t, root, "config", "user.name", "Test")
	gitTest(t, root, "config", "user.email", "test@example.test")
	for _, name := range []string{"site/package.json", "site/package-lock.json", "content/items/test.md"} {
		if err := writeConfined(root, name, []byte("{}")); err != nil {
			t.Fatal(err)
		}
	}
	gitTest(t, root, "add", ".")
	gitTest(t, root, "commit", "-m", "baseline")
	head := gitTest(t, root, "rev-parse", "HEAD")
	if err := os.Mkdir(filepath.Join(root, "site/node_modules"), 0700); err != nil {
		t.Fatal(err)
	}
	return &GitHub{cfg: Config{Repo: "example/roadmap", RepoCacheDir: root, StateDir: t.TempDir(), LocalBuild: localBuildConfig{BaseSHA: head, DependenciesDir: filepath.Join(root, "site"), Profile: buildProfile{Audience: "internal", Base: "/", SiteURL: "https://example.test"}}}}, head
}

func TestLocalBuildPreparation(t *testing.T) {
	for _, scenario := range []string{"success", "superseded", "lookup-failure", "build-failure", "version-mismatch", "dependency-mismatch", "canceled", "output-symlink"} {
		t.Run(scenario, func(t *testing.T) {
			g, head := buildFixture(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			reads, runs := 0, 0
			latest := func(context.Context) (string, error) {
				reads++
				if reads > 1 && scenario == "superseded" {
					return strings.Repeat("b", 40), nil
				}
				if reads > 1 && scenario == "lookup-failure" {
					return "", errors.New("offline")
				}
				return head, nil
			}
			if scenario == "dependency-mismatch" {
				os.WriteFile(filepath.Join(g.cfg.LocalBuild.DependenciesDir, "package-lock.json"), []byte("different"), 0600)
			}
			run := func(ctx context.Context, root string, env []string) error {
				runs++
				// A real immutable worktree, with the source checkout left untouched.
				if got := gitTest(t, root, "rev-parse", "HEAD"); got != head {
					t.Fatalf("wrong snapshot %s", got)
				}
				if scenario == "build-failure" {
					return errors.New("Astro failed")
				}
				if scenario == "canceled" {
					cancel()
					return ctx.Err()
				}
				commit := head
				if scenario == "version-mismatch" {
					commit = "wrong"
				}
				if err := writeConfined(root, "site/dist/index.html", []byte("<html>built</html>")); err != nil {
					return err
				}
				if err := writeConfined(root, "site/dist/.nojekyll", nil); err != nil {
					return err
				}
				if scenario == "output-symlink" {
					if err := os.Symlink("../package.json", filepath.Join(root, "site/dist/leak.json")); err != nil {
						return err
					}
				}
				return writeJSONAtomic(filepath.Join(root, "site/dist/version.json"), map[string]string{"commit": commit})
			}
			err := g.prepareBuild(ctx, latest, run)
			prepared := filepath.Join(g.cfg.StateDir, "local-build/prepared")
			if scenario != "success" {
				if err == nil {
					t.Fatal("unsafe/failed build accepted")
				}
				if _, err := os.Stat(prepared); !os.IsNotExist(err) {
					t.Fatal("failed attempt retained prepared output")
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				var receipt preparedBuild
				if err := readJSON(filepath.Join(prepared, "receipt.json"), &receipt); err != nil {
					t.Fatal(err)
				}
				if receipt.Commit != head || receipt.State != "prepared-not-deployed" {
					t.Fatalf("bad receipt %+v", receipt)
				}
				archive, err := os.ReadFile(filepath.Join(prepared, "site.zip"))
				if err != nil {
					t.Fatal(err)
				}
				hash := sha256.Sum256(archive)
				if receipt.ArchiveSHA256 != hex.EncodeToString(hash[:]) {
					t.Fatal("archive digest mismatch")
				}
				z, err := zip.OpenReader(filepath.Join(prepared, "site.zip"))
				if err != nil {
					t.Fatal(err)
				}
				defer z.Close()
				names := []string{}
				for _, file := range z.File {
					names = append(names, file.Name)
				}
				if strings.Join(names, ",") != "index.html,version.json" {
					t.Fatalf("wrong ZIP root/files %v", names)
				}
				if err := g.prepareBuild(ctx, latest, run); err != nil {
					t.Fatal(err)
				}
				if runs != 1 {
					t.Fatal("same version rebuilt")
				}
			}
			attempts, _ := filepath.Glob(filepath.Join(g.cfg.StateDir, "local-build/attempt-*"))
			if len(attempts) > 0 {
				t.Fatal("orphaned build directories", attempts)
			}
			if got := gitTest(t, g.repoRoot(), "worktree", "list", "--porcelain"); strings.Contains(got, "attempt-") {
				t.Fatal("orphaned git worktree", got)
			}
		})
	}
}

// Opt-in integration proof with the real local Astro toolchain. No network
// remote, server config, push or upload is used. Output lives in t.TempDir.
func TestLocalBuildRealAstro(t *testing.T) {
	if os.Getenv("ROADMAP_TEST_REAL_BUILD") != "1" {
		t.Skip("set ROADMAP_TEST_REAL_BUILD=1 for the real local build")
	}
	root, err := filepath.Abs("..")
	if err != nil {
		t.Fatal(err)
	}
	head := gitTest(t, root, "rev-parse", "HEAD")
	g := &GitHub{cfg: Config{Repo: "local/integration", RepoCacheDir: root, StateDir: t.TempDir(), LocalBuild: localBuildConfig{BaseSHA: head, DependenciesDir: filepath.Join(root, "site"), Profile: buildProfile{SiteURL: "https://example.test", Base: "/", Audience: "internal", EditAPI: "https://api.example.test", CanvasBackend: "true"}}}}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	started := time.Now()
	if err := g.prepareBuild(ctx, func(context.Context) (string, error) { return head, nil }, runLocalBuildCommands); err != nil {
		t.Fatal(err)
	}
	t.Logf("Real Astro preparation, checks and ZIP: %s", time.Since(started))
	// Removing only the test-owned prepared artifact forces a second build
	// while keeping the private dependency cache from the first preparation.
	if err := os.RemoveAll(filepath.Join(g.cfg.StateDir, "local-build/prepared")); err != nil {
		t.Fatal(err)
	}
	started = time.Now()
	if err := g.prepareBuild(ctx, func(context.Context) (string, error) { return head, nil }, runLocalBuildCommands); err != nil {
		t.Fatal(err)
	}
	t.Logf("Warm dependency-cache preparation, checks and ZIP: %s", time.Since(started))
}

func TestLocalBuildQueueCoalescesAndStops(t *testing.T) {
	started := make(chan struct{}, 3)
	release := make(chan struct{})
	var calls atomic.Int32
	w := newLocalBuildWorker(func(ctx context.Context) {
		calls.Add(1)
		started <- struct{}{}
		select {
		case <-release:
		case <-ctx.Done():
		}
	})
	t.Cleanup(w.close)
	w.enqueue()
	awaitBuild(t, started)
	for range 100 {
		w.enqueue()
	}
	release <- struct{}{}
	awaitBuild(t, started)
	w.close() // Cancels the active job and drops the pending slot.
	w.enqueue()
	if calls.Load() != 2 {
		t.Fatalf("got %d builds, want active + latest pending", calls.Load())
	}
}

func awaitBuild(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(5 * time.Second):
		t.Fatal("background build did not progress")
	}
}

func TestLocalBuildEnvironmentContainsNoCredentials(t *testing.T) {
	t.Setenv("CANVAS_DROP_TOKEN", "secret-canvas")
	t.Setenv("GITHUB_APP_CLIENT_SECRET", "secret-github")
	t.Setenv("NODE_OPTIONS", "--require=/evil.js")
	env := strings.Join((buildProfile{SiteURL: "https://example.test", Audience: "internal", Base: "/"}).environment(strings.Repeat("a", 40)), "\n")
	for _, forbidden := range []string{"secret-", "NODE_OPTIONS", "GITHUB_APP_", "CANVAS_DROP_TOKEN"} {
		if strings.Contains(env, forbidden) {
			t.Fatalf("build inherited %s", forbidden)
		}
	}
	if !strings.Contains(env, "GITHUB_SHA="+strings.Repeat("a", 40)) {
		t.Fatal("missing exact build SHA")
	}
	g := &GitHub{cfg: Config{RepoCacheDir: t.TempDir()}}
	if strings.Contains(strings.Join(g.gitEnv(""), "\n"), "secret-canvas") {
		t.Fatal("Git subprocess inherited the Canvas credential")
	}
}

func TestLocalBuildEligibility(t *testing.T) {
	root := t.TempDir()
	gitTest(t, root, "init", "-b", "main")
	gitTest(t, root, "config", "user.name", "Test")
	gitTest(t, root, "config", "user.email", "test@example.test")
	write := func(p, text string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(filepath.Join(root, p)), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, p), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	commit := func() string {
		gitTest(t, root, "add", ".")
		gitTest(t, root, "commit", "-m", "test")
		return gitTest(t, root, "rev-parse", "HEAD")
	}
	write("site/package.json", "{}")
	write("content/items/test.md", "one")
	base := commit()
	g := &GitHub{cfg: Config{RepoCacheDir: root}}
	write("content/items/test.md", "two")
	head := commit()
	if err := g.checkLocalBuildTree(context.Background(), base, head); err != nil {
		t.Fatal(err)
	}
	write("site/app.js", "new code")
	head = commit()
	if err := g.checkLocalBuildTree(context.Background(), base, head); err == nil {
		t.Fatal("unapproved inherited code accepted")
	}
	base = head
	if err := os.Symlink("../../site/app.js", filepath.Join(root, "content/items/link.md")); err != nil {
		t.Fatal(err)
	}
	head = commit()
	if err := g.checkLocalBuildTree(context.Background(), base, head); err == nil {
		t.Fatal("content symlink accepted")
	}
	if err := g.checkLocalBuildTree(context.Background(), head, base); err == nil {
		t.Fatal("non-ancestor baseline accepted")
	}
}

func TestLocalBuildOptIn(t *testing.T) {
	valid := localBuildConfig{Mode: "prepare", HasToken: true, BaseSHA: strings.Repeat("a", 40), DependenciesDir: t.TempDir(), Profile: buildProfile{SiteURL: "https://example.test", Base: "/", Audience: "internal", EditAPI: "https://api.example.test", CanvasBackend: "true"}}
	if err := valid.validate(); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*localBuildConfig){
		func(c *localBuildConfig) { c.HasToken = false },
		func(c *localBuildConfig) { c.Mode = "deploy" },
		func(c *localBuildConfig) { c.BaseSHA = "main" },
		func(c *localBuildConfig) { c.DependenciesDir = "relative" },
		func(c *localBuildConfig) { c.Profile.Audience = "" },
	} {
		c := valid
		change(&c)
		if err := c.validate(); err == nil {
			t.Fatal("unsafe/incomplete configuration accepted")
		}
	}
	for _, c := range []localBuildConfig{{}, {Mode: "prepare"}, {HasToken: true}, {Mode: "deploy", HasToken: true}} {
		g := &GitHub{cfg: Config{LocalBuild: c}}
		g.startLocalBuild()
		if g.localBuild != nil {
			g.localBuild.close()
			t.Fatal("disabled configuration started a worker")
		}
	}
}

func TestLocalDeployOptIn(t *testing.T) {
	c := localBuildConfig{Mode: "deploy", HasToken: true, CanvasAPIURL: "https://example.test/v1/canvases/test", BaseSHA: strings.Repeat("a", 40), DependenciesDir: t.TempDir(), Profile: buildProfile{SiteURL: "https://example.test", Base: "/", Audience: "internal", EditAPI: "https://api.example.test", CanvasBackend: "true"}}
	if err := c.validate(); err != nil {
		t.Fatal(err)
	}
	for _, address := range []string{"", "http://example.test/v1/canvases/test", "https://secret@example.test/v1/canvases/test", "https://example.test/v1/canvases/test?token=secret"} {
		c.CanvasAPIURL = address
		if c.validate() == nil {
			t.Fatal("unsafe Canvas endpoint accepted")
		}
	}
}

// Real Go snapshot -> Node coordinator -> HTTP contract -> ZIP -> authenticated
// file-hash readback. Only GitHub's latest-ref read is replaced with fixture SHA.
func TestLocalDeployIntegration(t *testing.T) {
	for _, scenario := range []string{"published", "already-current", "conflict", "superseded", "security-failure"} {
		t.Run(scenario, func(t *testing.T) {
			g, _ := buildFixture(t)
			protocol, err := os.ReadFile("../tooling/deploy/coordinate.mjs")
			if err != nil {
				t.Fatal(err)
			}
			if err := writeConfined(g.repoRoot(), "tooling/deploy/protocol.mjs", protocol); err != nil {
				t.Fatal(err)
			}
			wrapper := `import {runCLI, configFromEnv} from './protocol.mjs';
const config = configFromEnv();
config.latest = async () => process.env.GITHUB_SHA;
await runCLI(config);`
			if err := writeConfined(g.repoRoot(), "tooling/deploy/coordinate.mjs", []byte(wrapper)); err != nil {
				t.Fatal(err)
			}
			if scenario == "security-failure" {
				if err := writeConfined(g.repoRoot(), "site/scripts/check-demo.mjs", []byte("// demo security gate")); err != nil {
					t.Fatal(err)
				}
				bin := t.TempDir()
				if err := os.WriteFile(filepath.Join(bin, "gitleaks"), []byte("#!/bin/sh\nexit 1\n"), 0700); err != nil {
					t.Fatal(err)
				}
				t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
			}
			gitTest(t, g.repoRoot(), "add", "tooling", "site")
			gitTest(t, g.repoRoot(), "commit", "-m", "trusted coordinator")
			head := gitTest(t, g.repoRoot(), "rev-parse", "HEAD")
			g.cfg.LocalBuild.BaseSHA, g.cfg.LocalBuild.Mode = head, "deploy"
			g.cfg.LocalBuild.Profile.EditAPI = "https://api.example.test"
			g.cfg.LocalBuild.Profile.CanvasBackend = "true"
			g.cfg.CanvasDropToken = "fixture-canvas-token"
			g.instTok, g.instExp = "fixture-github-token", time.Now().Add(time.Hour)
			p := g.cfg.LocalBuild.Profile
			sum := sha256.Sum256([]byte(strings.Join([]string{"roadmap-v1", g.cfg.Repo, head, p.SiteURL, p.Base, p.Audience, p.EditAPI, p.CanvasBackend}, "\x00")))
			releaseID := "roadmap-v1-" + hex.EncodeToString(sum[:])
			var puts atomic.Int32
			files := map[string][]byte{"version.json": []byte(`{"commit":"` + head + `"}`)}
			live := scenario == "already-current"
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer fixture-canvas-token" {
					w.WriteHeader(401)
					return
				}
				w.Header().Set("Content-Type", "application/json")
				if r.Method == "PUT" {
					puts.Add(1)
					if r.URL.Query().Get("releaseId") != releaseID || r.URL.Query().Get("expectedPublicationToken") != "before" {
						w.WriteHeader(400)
						return
					}
					if scenario == "conflict" {
						w.WriteHeader(409)
						io.WriteString(w, `{"code":"PUBLICATION_CHANGED"}`)
						return
					}
					body, _ := io.ReadAll(r.Body)
					archive, err := zip.NewReader(bytes.NewReader(body), int64(len(body)))
					if err != nil {
						w.WriteHeader(400)
						return
					}
					files = make(map[string][]byte)
					for _, entry := range archive.File {
						f, _ := entry.Open()
						files[entry.Name], _ = io.ReadAll(f)
						f.Close()
					}
					live = true
					json.NewEncoder(w).Encode(map[string]string{"outcome": "published", "releaseId": releaseID, "versionId": "v2", "publicationToken": "after"})
				} else if r.URL.Query().Get("path") != "" {
					w.Write(files[r.URL.Query().Get("path")])
				} else if strings.HasSuffix(r.URL.Path, "/files") {
					manifest := []map[string]any{}
					for path, data := range files {
						hash := sha256.Sum256(data)
						manifest = append(manifest, map[string]any{"path": path, "size": len(data), "hash": hex.EncodeToString(hash[:])})
					}
					json.NewEncoder(w).Encode(map[string]any{"version": 2, "fileCount": len(files), "files": manifest})
				} else {
					token, id := "before", "old"
					if live {
						token, id = "after", releaseID
					}
					json.NewEncoder(w).Encode(map[string]any{"publicationState": "published", "publicationToken": token, "currentVersionId": "v2", "currentVersion": map[string]any{"id": "v2", "number": 2, "releaseId": id}})
				}
			}))
			defer server.Close()
			g.cfg.LocalBuild.CanvasAPIURL = server.URL + "/v1/canvases/test"
			reads, builds := 0, 0
			latest := func(context.Context) (string, error) {
				reads++
				if scenario == "superseded" && reads > 1 {
					return strings.Repeat("b", 40), nil
				}
				return head, nil
			}
			run := func(ctx context.Context, root string, env []string) error {
				builds++
				if strings.Contains(strings.Join(env, "\n"), "fixture-") {
					t.Fatal("build received deployment credentials")
				}
				if err := writeConfined(root, "site/dist/index.html", []byte("<html>checked</html>")); err != nil {
					return err
				}
				return writeJSONAtomic(filepath.Join(root, "site/dist/version.json"), map[string]string{"commit": head})
			}
			err = g.prepareBuild(context.Background(), latest, run)
			failed := scenario == "conflict" || scenario == "superseded" || scenario == "security-failure"
			if (err != nil) != failed {
				t.Fatalf("unexpected result: %v", err)
			}
			proofPath := filepath.Join(g.cfg.StateDir, "local-build/last-deployment.json")
			if failed {
				if _, err := os.Stat(proofPath); !os.IsNotExist(err) {
					t.Fatal("failed attempt reported live")
				}
			} else {
				var proof struct {
					ReleaseID    string `json:"releaseId"`
					Verification string `json:"verification"`
				}
				if err := readJSON(proofPath, &proof); err != nil {
					t.Fatal(err)
				}
				if proof.ReleaseID != releaseID {
					t.Fatal("wrong release proof")
				}
				if scenario == "published" && proof.Verification != "all-local-files" {
					t.Fatal("fresh deployment lacks hash proof")
				}
			}
			wantPuts := int32(1)
			if scenario == "already-current" || scenario == "superseded" || scenario == "security-failure" {
				wantPuts = 0
			}
			if puts.Load() != wantPuts {
				t.Fatalf("unexpected uploads: %d", puts.Load())
			}
			if scenario == "already-current" && builds != 0 {
				t.Fatal("rebuilt a live release")
			}
			if scenario == "security-failure" && (builds != 0 || !strings.Contains(err.Error(), "secret history check")) {
				t.Fatal("failed secret scan did not stop the fast path before building")
			}
		})
	}
}

func TestLocalBuildRestartCleansOnlyOwnedAttempts(t *testing.T) {
	g, head := buildFixture(t)
	root := filepath.Join(g.cfg.StateDir, "local-build")
	abandoned := filepath.Join(root, "attempt-123", "source")
	gitTest(t, g.repoRoot(), "worktree", "add", "--detach", abandoned, head)
	if err := writeConfined(root, "keep-me/source", []byte("untouched")); err != nil {
		t.Fatal(err)
	}
	if err := g.cleanLocalBuildAttempts(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Dir(abandoned)); !os.IsNotExist(err) {
		t.Fatal("orphaned attempt retained")
	}
	if _, err := os.Stat(filepath.Join(root, "keep-me/source")); err != nil {
		t.Fatal("unowned path touched", err)
	}
	if strings.Contains(gitTest(t, g.repoRoot(), "worktree", "list", "--porcelain"), "attempt-123") {
		t.Fatal("orphaned worktree registration")
	}
	started := make(chan struct{}, 1)
	w := newLocalBuildWorker(func(context.Context) { started <- struct{}{} })
	w.close()
	if len(started) != 0 {
		t.Fatal("restart replayed an unconfirmed old build")
	}
}

func TestLocalBuildCommandCancellationAndCredentials(t *testing.T) {
	t.Setenv("SESSION_SECRET", "must-not-leak")
	t.Setenv("NODE_OPTIONS", "--require=/untrusted")
	env := (buildProfile{}).environment("")
	if err := runBuildCommand(context.Background(), t.TempDir(), env, []string{"sh", "-c", `test -z "$SESSION_SECRET" && test -z "$NODE_OPTIONS"`}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	start := time.Now()
	if err := runBuildCommand(ctx, t.TempDir(), env, []string{"sh", "-c", "sleep 30 & wait"}); err == nil {
		t.Fatal("timeout ignored")
	}
	if time.Since(start) > 2*time.Second {
		t.Fatal("child process kept timeout alive")
	}
}

func TestLocalBuildDependencyCacheDoesNotModifySource(t *testing.T) {
	g, _ := buildFixture(t)
	source := g.cfg.LocalBuild.DependenciesDir
	if err := os.WriteFile(filepath.Join(source, "node_modules/example"), []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	for _, name := range []string{"package.json", "package-lock.json"} {
		if err := writeConfined(root, "site/"+name, []byte("{}")); err != nil {
			t.Fatal(err)
		}
	}
	cache := filepath.Join(t.TempDir(), "dependencies")
	restore, err := prepareBuildDependencies(context.Background(), root, source, cache)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "site/node_modules/example"), []byte("private"), 0600); err != nil {
		t.Fatal(err)
	}
	restore()
	got, err := os.ReadFile(filepath.Join(source, "node_modules/example"))
	if err != nil || string(got) != "original" {
		t.Fatal("source dependency tree was modified", err)
	}
	restore, err = prepareBuildDependencies(context.Background(), root, source, cache)
	if err != nil {
		t.Fatal(err)
	}
	defer restore()
	got, err = os.ReadFile(filepath.Join(root, "site/node_modules/example"))
	if err != nil || string(got) != "private" {
		t.Fatal("private warm dependency cache was not reused", err)
	}
}

func TestLocalBuildNotificationRequiresSuccessfulPush(t *testing.T) {
	g, head := buildFixture(t) // Deliberately has no remote: a push must fail locally.
	wake := make(chan struct{}, 1)
	g.localBuild = &localBuildWorker{wake: wake, done: make(chan struct{})}
	out, _, pushErr, err := g.applyCommitPush(context.Background(), "", g.repoRoot(), Changeset{}, "No-op", "alice", head)
	if err != nil || pushErr != nil || !out.NoChanges {
		t.Fatal("expected no-op", out, pushErr, err)
	}
	if len(wake) != 0 {
		t.Fatal("no-op notified builder")
	}
	product := ""
	for _, file := range cur() {
		product = ParseDoc(file.Content).FM["product"]
		break
	}
	cs := Changeset{Created: []ItemNew{{ID: "new-localbuild-test", Product: product, Title: "A draft", Frontmatter: map[string]string{"owner": "Alice", "horizon": "Next", "stage": "Discovery", "visibility": "Internal"}}}}
	out, _, pushErr, err = g.applyCommitPush(context.Background(), "", g.repoRoot(), cs, "Will not push", "alice", head)
	if err != nil || pushErr == nil || len(out.Errors) > 0 {
		t.Fatal("expected genuine push failure", out, pushErr, err)
	}
	if len(wake) != 0 {
		t.Fatal("failed push notified builder")
	}
}

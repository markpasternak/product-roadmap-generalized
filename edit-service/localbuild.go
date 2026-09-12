package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"
)

type localBuildConfig struct {
	Mode, BaseSHA, DependenciesDir string
	HasToken                       bool
	CanvasAPIURL                   string
	Profile                        buildProfile
}

type buildProfile struct {
	SiteURL       string `json:"siteUrl"`
	Base          string `json:"base"`
	Audience      string `json:"audience"`
	EditAPI       string `json:"editApi"`
	CanvasBackend string `json:"canvasBackend"`
}

func (c localBuildConfig) validate() error {
	if (c.Mode != "prepare" && c.Mode != "deploy") || !c.HasToken {
		return errors.New("requires prepare/deploy mode and CANVAS_DROP_TOKEN")
	}
	if c.Mode == "deploy" {
		u, err := url.Parse(c.CanvasAPIURL)
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || !regexp.MustCompile(`^/v1/canvases/[A-Za-z0-9_-]+$`).MatchString(u.Path) {
			return errors.New("requires explicit HTTPS CANVAS_API_URL without credentials or query")
		}
	}
	if !gitSHA.MatchString(c.BaseSHA) || !filepath.IsAbs(c.DependenciesDir) {
		return errors.New("requires an approved full base SHA and absolute dependency checkout path")
	}
	if c.Profile.Audience != "internal" && c.Profile.Audience != "public" {
		return errors.New("SITE_AUDIENCE must be internal or public")
	}
	if c.Profile.Base != "/" {
		return errors.New("local preparation currently requires SITE_BASE=/")
	}
	if c.Profile.CanvasBackend != "true" && c.Profile.CanvasBackend != "false" {
		return errors.New("PUBLIC_CANVAS_BACKEND must be true or false")
	}
	for _, value := range []string{c.Profile.SiteURL, c.Profile.EditAPI} {
		u, err := url.Parse(value)
		if err != nil || u.Host == "" || u.User != nil || (u.Scheme != "https" && u.Scheme != "http") {
			return errors.New("explicit SITE_URL and PUBLIC_EDIT_API URLs are required")
		}
	}
	return nil
}

func (p buildProfile) environment(sha string) []string {
	// Never inherit OAuth, Canvas, session secrets, Git config or Node injection
	// options. This is credential hygiene, not an OS sandbox: use trusted code.
	return []string{
		"PATH=" + os.Getenv("PATH"), "LANG=C.UTF-8", "CI=true", "ASTRO_TELEMETRY_DISABLED=1",
		"GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null", "GIT_TERMINAL_PROMPT=0",
		"GITHUB_SHA=" + sha, "SITE_URL=" + p.SiteURL, "SITE_BASE=" + p.Base,
		"SITE_AUDIENCE=" + p.Audience, "PUBLIC_EDIT_API=" + p.EditAPI, "PUBLIC_CANVAS_BACKEND=" + p.CanvasBackend,
	}
}

// The slot represents "look at latest main", not a FIFO of old commits. Even a
// delayed notification cannot replace a newer pending SHA with an older one.
type localBuildWorker struct {
	wake   chan struct{}
	cancel context.CancelFunc
	done   chan struct{}
}

func newLocalBuildWorker(run func(context.Context)) *localBuildWorker {
	ctx, cancel := context.WithCancel(context.Background())
	w := &localBuildWorker{wake: make(chan struct{}, 1), cancel: cancel, done: make(chan struct{})}
	go func() {
		defer close(w.done)
		for {
			select {
			case <-ctx.Done():
				return
			case <-w.wake:
			}
			if ctx.Err() != nil {
				return
			}
			job, cancelJob := context.WithTimeout(ctx, 2*time.Minute)
			run(job)
			cancelJob()
		}
	}()
	return w
}

func (w *localBuildWorker) enqueue() {
	if w == nil {
		return
	}
	select {
	case <-w.done:
		return
	default:
	}
	select {
	case w.wake <- struct{}{}:
	default:
	}
}

func (w *localBuildWorker) close() {
	if w == nil {
		return
	}
	w.cancel()
	<-w.done
}

func (g *GitHub) startLocalBuild() {
	c := g.cfg.LocalBuild
	if c.Mode == "" || !c.HasToken {
		return
	}
	if err := c.validate(); err != nil {
		log.Printf("local build disabled: %v; GitHub Actions unchanged", err)
		return
	}
	g.localBuild = newLocalBuildWorker(func(ctx context.Context) {
		started := time.Now()
		if err := g.cleanLocalBuildAttempts(ctx); err != nil {
			log.Printf("local preparation cleanup failed; GitHub Actions unchanged")
			return
		}
		if err := g.prepareBuild(ctx, g.latestBuildHead, runLocalBuildCommands); err != nil {
			// Git commands may include auth diagnostics; never log raw subprocess output.
			stage := "preparation"
			var failure *localBuildFailure
			if errors.As(err, &failure) {
				stage = failure.stage
			}
			log.Printf("local preparation skipped/failed at %s, duration=%s; GitHub Actions unchanged", stage, time.Since(started))
		} else {
			log.Printf("local build completed, mode=%s, duration=%s", c.Mode, time.Since(started))
		}
	})
}

// Only one editor instance owns this state directory. A crash can leave a
// disposable attempt; never replay it or treat its output as published.
var localBuildAttemptName = regexp.MustCompile(`^attempt-[0-9]+$`)

func (g *GitHub) cleanLocalBuildAttempts(ctx context.Context) error {
	root := filepath.Join(g.cfg.StateDir, "local-build")
	entries, err := os.ReadDir(root)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.IsDir() || !localBuildAttemptName.MatchString(entry.Name()) {
			continue
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		job := filepath.Join(root, entry.Name())
		g.repoMu.Lock()
		g.removeWorktree(ctx, "", filepath.Join(job, "source"))
		g.repoMu.Unlock()
		if err := os.RemoveAll(job); err != nil {
			return err
		}
	}
	return nil
}

// This is intentionally conservative and matches the CI content-only boundary.
var localContentPath = regexp.MustCompile(`^(content/(items|prds|technical-design|research)/.+\.md|content/assets/ast_[a-z0-9_-]+/asset\.json|content/assets/ast_[a-z0-9_-]+/rev_[a-z0-9_-]+/[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?i:png|jpe?g|gif|webp|pdf|mp4|webm|txt|csv|md|json|zip|docx|pptx|xlsx)|\.roadmap/publications/[a-f0-9]+\.json)$`)

func (g *GitHub) checkLocalBuildTree(ctx context.Context, base, head string) error {
	if !gitSHA.MatchString(base) || !gitSHA.MatchString(head) {
		return errors.New("invalid build commit")
	}
	if _, err := g.runGit(ctx, "", g.repoRoot(), "merge-base", "--is-ancestor", base, head); err != nil {
		return errors.New("approved baseline is not an ancestor")
	}
	paths, err := g.runGit(ctx, "", g.repoRoot(), "diff", "--no-renames", "--name-only", "-z", base, head, "--")
	if err != nil {
		return err
	}
	for _, p := range strings.Split(string(paths), "\x00") {
		if p == "" {
			continue
		}
		if !localContentPath.MatchString(p) {
			return errors.New("application changes require Actions")
		}
		for _, part := range strings.Split(p, "/") {
			if part == "" || part == "." || part == ".." {
				return errors.New("unsafe content path")
			}
		}
	}
	// A .md symlink is not content. Do not let a changed asset or document read
	// arbitrary files on the editor host through its apparently safe filename.
	tree, err := g.runGit(ctx, "", g.repoRoot(), "ls-tree", "-r", "-z", head, "--", "content", ".roadmap/publications")
	if err != nil {
		return err
	}
	for _, entry := range strings.Split(string(tree), "\x00") {
		if entry != "" && !strings.HasPrefix(entry, "100644 blob ") {
			return errors.New("content contains non-regular files")
		}
	}
	return nil
}

func (g *GitHub) latestBuildHead(ctx context.Context) (string, error) {
	token, err := g.installationToken(ctx)
	if err != nil {
		return "", err
	}
	g.repoMu.Lock()
	defer g.repoMu.Unlock()
	if err := g.fetchMainLocked(ctx, token); err != nil {
		return "", err
	}
	return g.headSHALocked(ctx, token)
}

type preparedBuild struct {
	State         string       `json:"state"`
	Commit        string       `json:"commit"`
	BuildID       string       `json:"buildId"`
	ArchiveSHA256 string       `json:"archiveSha256"`
	Profile       buildProfile `json:"profile"`
	PreparedAt    time.Time    `json:"preparedAt"`
}

// Inject the remote read and command runner for deterministic race/failure tests;
// snapshotting, eligibility, dependencies, version proof and ZIP remain real.
func (g *GitHub) prepareBuild(ctx context.Context, latest func(context.Context) (string, error), run func(context.Context, string, []string) error) (result error) {
	stage := "latest-main lookup"
	defer func() {
		if result != nil {
			result = &localBuildFailure{stage: stage, cause: result}
		}
	}()
	head, err := latest(ctx)
	if err != nil {
		return err
	}
	c := g.cfg.LocalBuild
	stage = "approved content baseline"
	if err := g.checkLocalBuildTree(ctx, c.BaseSHA, head); err != nil {
		return err
	}
	profile, _ := json.Marshal(c.Profile)
	id := stateKey("roadmap-build-v1", g.cfg.Repo, head, string(profile))
	root := filepath.Join(g.cfg.StateDir, "local-build")
	var previous preparedBuild
	if c.Mode != "deploy" && readJSON(filepath.Join(root, "prepared", "receipt.json"), &previous) == nil && previous.BuildID == id {
		archive, err := os.Open(filepath.Join(root, "prepared", "site.zip"))
		if err == nil {
			hash := sha256.New()
			_, copyErr := io.Copy(hash, archive)
			closeErr := archive.Close()
			if copyErr == nil && closeErr == nil && hex.EncodeToString(hash.Sum(nil)) == previous.ArchiveSHA256 {
				return nil
			}
		}
	}
	stage = "immutable checkout"
	if err := os.MkdirAll(root, 0700); err != nil {
		return err
	}
	job, err := os.MkdirTemp(root, "attempt-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(job)
	wt := filepath.Join(job, "source")
	g.repoMu.Lock()
	_, err = g.runGit(ctx, "", g.repoRoot(), "worktree", "add", "--detach", wt, head)
	g.repoMu.Unlock()
	if err != nil {
		return err
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		g.repoMu.Lock()
		defer g.repoMu.Unlock()
		g.removeWorktree(cleanup, "", wt)
	}()
	intentPath := filepath.Join(job, "intent.json")
	proofPath := filepath.Join(root, "last-deployment.json")
	if c.Mode == "deploy" {
		stage = "Canvas coordination preflight"
		if err := g.coordinateBuild(ctx, wt, head, "preflight", intentPath, "", proofPath); err != nil {
			return err
		}
		var intent struct {
			AlreadyCurrent bool `json:"alreadyCurrent"`
		}
		if err := readJSON(intentPath, &intent); err != nil {
			return err
		}
		if intent.AlreadyCurrent {
			// The helper verifies the live identity again. A cached local receipt
			// alone must never suppress a deploy after rollback or unpublish.
			return g.coordinateBuild(ctx, wt, head, "publish", intentPath, "", proofPath)
		}
		stage = "secret history check"
		if _, err := os.Stat(filepath.Join(wt, "site/scripts/check-demo.mjs")); err == nil {
			if err := runBuildCommand(ctx, wt, c.Profile.environment(head), []string{"gitleaks", "git", ".", "--redact=100", "--log-opts=--all"}); err != nil {
				return err
			}
		}
	}
	stage = "warm dependencies"
	restoreDependencies, err := prepareBuildDependencies(ctx, wt, c.DependenciesDir, filepath.Join(root, "dependencies"))
	if err != nil {
		return err
	}
	defer restoreDependencies()
	stage = "content/build/link/date checks"
	if err := run(ctx, wt, c.Profile.environment(head)); err != nil {
		return err
	}
	var version struct {
		Commit string `json:"commit"`
	}
	stage = "build version proof"
	if err := readJSON(filepath.Join(wt, "site/dist/version.json"), &version); err != nil {
		return err
	}
	if version.Commit != head {
		return errors.New("built version does not match selected commit")
	}
	artifact := filepath.Join(job, "artifact")
	stage = "ZIP packaging"
	if err := os.Mkdir(artifact, 0700); err != nil {
		return err
	}
	digest, err := packageLocalBuild(filepath.Join(wt, "site/dist"), filepath.Join(artifact, "site.zip"))
	if err != nil {
		return err
	}
	stage = "final freshness check"
	current, err := latest(ctx)
	if err != nil {
		return err
	}
	if current != head {
		return errors.New("build superseded by newer main")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	receipt := preparedBuild{State: "prepared-not-deployed", Commit: head, BuildID: id, ArchiveSHA256: digest, Profile: c.Profile, PreparedAt: time.Now().UTC()}
	if c.Mode == "deploy" {
		stage = "conditional Canvas publication and verification"
		if err := g.coordinateBuild(ctx, wt, head, "publish", intentPath, filepath.Join(artifact, "site.zip"), proofPath); err != nil {
			return err
		}
		receipt.State = "deployment-verified"
	}
	stage = "prepared receipt"
	if err := writeJSONAtomic(filepath.Join(artifact, "receipt.json"), receipt); err != nil {
		return err
	}
	// Owned, disposable preparation directory only. Never touch a live site.
	if err := os.RemoveAll(filepath.Join(root, "prepared")); err != nil {
		return err
	}
	return os.Rename(artifact, filepath.Join(root, "prepared"))
}

func (g *GitHub) coordinateBuild(ctx context.Context, root, head, action, intent, archive, report string) error {
	token, err := g.installationToken(ctx)
	if err != nil {
		return err
	}
	// Only this reviewed helper gets credentials. Build/validation commands and
	// Git children continue to use their separate credential-stripped environments.
	env := append(g.cfg.LocalBuild.Profile.environment(head),
		"GITHUB_REPOSITORY="+g.cfg.Repo, "GH_TOKEN="+token,
		"CANVAS_API_URL="+g.cfg.LocalBuild.CanvasAPIURL, "CANVAS_DROP_TOKEN="+g.cfg.CanvasDropToken)
	return runBuildCommand(ctx, root, env, []string{"node", "tooling/deploy/coordinate.mjs", action, intent, archive, report})
}

type localBuildFailure struct {
	stage string
	cause error
}

func (e *localBuildFailure) Error() string { return e.stage + ": " + e.cause.Error() }
func (e *localBuildFailure) Unwrap() error { return e.cause }

func prepareBuildDependencies(ctx context.Context, root, source, cache string) (func(), error) {
	var manifests []string
	for _, name := range []string{"package.json", "package-lock.json"} {
		a, err := os.ReadFile(filepath.Join(root, "site", name))
		if err != nil {
			return nil, err
		}
		b, err := os.ReadFile(filepath.Join(source, name))
		if err != nil {
			return nil, err
		}
		if !bytes.Equal(a, b) {
			return nil, errors.New("warm dependencies do not match build manifest/lockfile")
		}
		manifests = append(manifests, string(a))
	}
	key := stateKey(manifests...)
	var cachedKey string
	_ = readJSON(filepath.Join(cache, "key.json"), &cachedKey)
	modulesInBuild := filepath.Join(root, "site/node_modules")
	if cachedKey != key {
		if err := os.RemoveAll(cache); err != nil {
			return nil, err
		}
	}
	if err := os.MkdirAll(cache, 0700); err != nil {
		return nil, err
	}
	restore := func() {
		if err := os.Rename(modulesInBuild, filepath.Join(cache, "node_modules")); err == nil {
			_ = writeJSONAtomic(filepath.Join(cache, "key.json"), key)
		}
	}
	if cachedKey == key {
		if err := os.Rename(filepath.Join(cache, "node_modules"), modulesInBuild); err == nil {
			return restore, nil
		}
	}
	modules := filepath.Join(source, "node_modules")
	info, err := os.Stat(modules)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, errors.New("missing warm node_modules")
	}
	// Astro's virtual CSS modules require dependencies inside the build root.
	// A directory symlink fails real builds; hardlinks would share mutable caches.
	if err := runBuildCommand(ctx, root, (buildProfile{}).environment(""), []string{"cp", "-R", modules, modulesInBuild}); err != nil {
		return nil, err
	}
	return restore, nil
}

func runLocalBuildCommands(ctx context.Context, root string, env []string) error {
	commands := [][]string{
		{"python3", "tooling/validate_items.py"},
		{"npm", "--prefix", "site", "run", "build"},
		{"node", "site/scripts/check-document-links.mjs"},
		{"node", "site/scripts/check-item-history.mjs"},
	}
	if _, err := os.Stat(filepath.Join(root, "site/scripts/check-demo.mjs")); err == nil {
		commands = append(commands, []string{"node", "site/scripts/check-demo.mjs"})
	}
	for _, args := range commands {
		if err := runBuildCommand(ctx, root, env, args); err != nil {
			return err
		}
	}
	return nil
}

func runBuildCommand(ctx context.Context, root string, env, args []string) error {
	cmd := exec.CommandContext(ctx, args[0], args[1:]...)
	cmd.Dir, cmd.Env = root, env
	// npm spawns Astro: cancel the process group, not just its parent shell.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	cmd.WaitDelay = 2 * time.Second
	var output buildOutput
	cmd.Stdout, cmd.Stderr = &output, &output
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("local check %s failed: %w\n%s", strings.Join(args, " "), err, output.data)
	}
	return nil
}

// Keep only a bounded diagnostic tail. The service never logs this raw output;
// local integration tests can display it when the actual toolchain fails.
type buildOutput struct{ data []byte }

func (b *buildOutput) Write(p []byte) (int, error) {
	const limit = 16 << 10
	n := len(p)
	if len(p) > limit {
		p = p[len(p)-limit:]
	}
	b.data = append(b.data, p...)
	if len(b.data) > limit {
		b.data = b.data[len(b.data)-limit:]
	}
	return n, nil
}

func packageLocalBuild(dist, target string) (string, error) {
	if info, err := os.Lstat(filepath.Join(dist, "index.html")); err != nil || !info.Mode().IsRegular() {
		return "", errors.New("missing regular index.html")
	}
	f, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	hash := sha256.New()
	z := zip.NewWriter(io.MultiWriter(f, hash))
	err = filepath.WalkDir(dist, func(p string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if p == dist {
			return nil
		}
		if strings.HasPrefix(d.Name(), ".") {
			if d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return errors.New("non-regular build output")
		}
		rel, err := filepath.Rel(dist, p)
		if err != nil {
			return err
		}
		entry, err := z.Create(filepath.ToSlash(rel))
		if err != nil {
			return err
		}
		src, err := os.Open(p)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(entry, src)
		closeErr := src.Close()
		return errors.Join(copyErr, closeErr)
	})
	err = errors.Join(err, z.Close(), f.Close())
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

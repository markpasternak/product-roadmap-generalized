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
	ApplicationPointer             string
	RaceBarrier                    bool
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
	content := c.Mode == "content" || c.Mode == "shadow"
	if (!content && c.Mode != "prepare" && c.Mode != "deploy") || (c.Mode != "shadow" && !c.HasToken) {
		return errors.New("requires an enabled build mode and publication credentials (except shadow)")
	}
	if c.Mode == "deploy" || c.Mode == "content" {
		u, err := url.Parse(c.CanvasAPIURL)
		if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || !regexp.MustCompile(`^/v1/canvases/[A-Za-z0-9_-]+$`).MatchString(u.Path) {
			return errors.New("requires explicit HTTPS CANVAS_API_URL without credentials or query")
		}
	}
	if content && !filepath.IsAbs(c.ApplicationPointer) {
		return errors.New("requires an absolute approved application pointer")
	}
	if !content && (!gitSHA.MatchString(c.BaseSHA) || !filepath.IsAbs(c.DependenciesDir)) {
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
	wake   chan time.Time
	cancel context.CancelFunc
	done   chan struct{}
}

func newLocalBuildWorker(run func(context.Context)) *localBuildWorker {
	return newReconcilingBuildWorker(func(ctx context.Context) error { run(ctx); return nil }, 0, 2*time.Minute)
}

func (c localBuildConfig) jobTimeout() time.Duration {
	if c.Mode == "content" {
		return 17 * time.Minute // Preparation plus Canvas's bounded 15-minute session.
	}
	return 2 * time.Minute
}

// A notification is just a wake-up hint. Startup/timer runs cover missed
// webhooks, and bounded backoff avoids hammering a broken remote dependency.
func newReconcilingBuildWorker(run func(context.Context) error, interval, timeout time.Duration) *localBuildWorker {
	ctx, cancel := context.WithCancel(context.Background())
	w := &localBuildWorker{wake: make(chan time.Time, 1), cancel: cancel, done: make(chan struct{})}
	go func() {
		defer close(w.done)
		var timer *time.Timer
		var tick <-chan time.Time
		delay := interval
		if interval > 0 {
			timer = time.NewTimer(interval)
			tick = timer.C
			defer timer.Stop()
		}
		for {
			var queued time.Time
			select {
			case <-ctx.Done():
				return
			case queued = <-w.wake:
			case queued = <-tick:
			}
			if ctx.Err() != nil {
				return
			}
			job, cancelJob := context.WithTimeout(ctx, timeout)
			err := run(context.WithValue(job, buildQueuedAtKey{}, queued))
			cancelJob()
			if errors.Is(err, errContentSuperseded) {
				w.enqueue()
			}
			if timer != nil {
				if err == nil {
					delay = interval
				} else {
					delay = min(delay*2, 5*interval)
				}
				timer.Reset(delay)
			}
		}
	}()
	if interval > 0 {
		w.enqueue()
	}
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
	case w.wake <- time.Now():
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
	if c.Mode == "" || c.Mode == "disabled" || (c.Mode != "shadow" && !c.HasToken) {
		return
	}
	if err := c.validate(); err != nil {
		log.Printf("local build disabled: %v; GitHub Actions unchanged", err)
		return
	}
	interval := time.Duration(0)
	if c.Mode == "content" || c.Mode == "shadow" {
		interval = time.Minute
	}
	g.localBuild = newReconcilingBuildWorker(func(ctx context.Context) error {
		ctx, trace, _ := ensureBuildTiming(ctx)
		var result error
		defer func() { trace.finish(ctx, result) }()
		started := time.Now()
		cleanupDone := trace.step(ctx, "cleanup abandoned attempts")
		result = g.cleanLocalBuildAttempts(ctx)
		cleanupDone(result)
		if result != nil {
			log.Printf("local preparation cleanup failed; GitHub Actions unchanged")
			return result
		}
		if c.Mode == "content" || c.Mode == "shadow" {
			result = g.prepareContent(ctx, g.latestBuildHead, runBuildCommand)
		} else {
			result = g.prepareBuild(ctx, g.latestBuildHead, runLocalBuildCommands)
		}
		if result != nil {
			// Git commands may include auth diagnostics; never log raw subprocess output.
			stage := "preparation"
			var failure *localBuildFailure
			if errors.As(result, &failure) {
				stage = failure.stage
			}
			log.Printf("local preparation skipped/failed at %s, duration=%s; GitHub Actions unchanged", stage, time.Since(started))
		} else {
			log.Printf("local build completed, mode=%s, duration=%s", c.Mode, time.Since(started))
		}
		return result
	}, interval, c.jobTimeout())
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
	ctx, trace, ownsTrace := ensureBuildTiming(ctx)
	if ownsTrace {
		defer func() { trace.finish(ctx, result) }()
	}
	stage := "latest-main lookup"
	trace.nextPhase(ctx, stage)
	setStage := func(name string) { stage = name; trace.nextPhase(ctx, name) }
	defer func() {
		trace.endPhase(ctx, result)
		if result != nil {
			result = &localBuildFailure{stage: stage, cause: result}
		}
	}()
	head, err := latest(ctx)
	if err != nil {
		return err
	}
	if gitSHA.MatchString(head) {
		trace.commit = head
	}
	c := g.cfg.LocalBuild
	setStage("approved content baseline")
	if err := g.checkLocalBuildTree(ctx, c.BaseSHA, head); err != nil {
		return err
	}
	profile, _ := json.Marshal(c.Profile)
	id := stateKey("roadmap-build-v1", g.cfg.Repo, head, string(profile))
	setStage("prepared artifact cache")
	root := filepath.Join(g.cfg.StateDir, "local-build")
	var previous preparedBuild
	if c.Mode != "deploy" && readJSON(filepath.Join(root, "prepared", "receipt.json"), &previous) == nil && previous.BuildID == id {
		archive, err := os.Open(filepath.Join(root, "prepared", "site.zip"))
		if err == nil {
			hash := sha256.New()
			_, copyErr := io.Copy(hash, archive)
			closeErr := archive.Close()
			if copyErr == nil && closeErr == nil && hex.EncodeToString(hash.Sum(nil)) == previous.ArchiveSHA256 {
				trace.outcome = "skipped"
				trace.emit(buildTimingRecord{Stage: "prepared artifact cache", Outcome: "success", Cache: "hit"})
				return nil
			}
		}
	}
	setStage("immutable checkout")
	if err := os.MkdirAll(root, 0700); err != nil {
		return err
	}
	job, err := os.MkdirTemp(root, "attempt-")
	if err != nil {
		return err
	}
	defer func() {
		trace.endPhase(ctx, result)
		done := trace.step(context.Background(), "cleanup attempt")
		done(os.RemoveAll(job))
	}()
	trace.installProbe(job)
	wt := filepath.Join(job, "source")
	g.repoMu.Lock()
	_, err = g.runGit(ctx, "", g.repoRoot(), "worktree", "add", "--detach", wt, head)
	g.repoMu.Unlock()
	if err != nil {
		return err
	}
	defer func() {
		trace.endPhase(ctx, result)
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		done := trace.step(cleanup, "cleanup worktree")
		g.repoMu.Lock()
		defer g.repoMu.Unlock()
		done(g.removeWorktree(cleanup, "", wt))
	}()
	intentPath := filepath.Join(job, "intent.json")
	proofPath := filepath.Join(root, "last-deployment.json")
	if c.Mode == "deploy" {
		setStage("Canvas coordination preflight")
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
			setStage("verify already current")
			err := g.coordinateBuild(ctx, wt, head, "publish", intentPath, "", proofPath)
			if err == nil {
				trace.outcome = "already_current"
			}
			return err
		}
		if _, err := os.Stat(filepath.Join(wt, "site/scripts/check-demo.mjs")); err == nil {
			setStage("secret history check")
			if err := runBuildCommand(ctx, wt, c.Profile.environment(head), []string{"gitleaks", "git", ".", "--redact=100", "--log-opts=--all"}); err != nil {
				return err
			}
		} else {
			trace.emit(buildTimingRecord{Stage: "secret history check", Outcome: "skipped"})
		}
	}
	setStage("warm dependencies")
	restoreDependencies, err := prepareBuildDependencies(ctx, wt, c.DependenciesDir, filepath.Join(root, "dependencies"))
	if err != nil {
		return err
	}
	defer func() {
		trace.endPhase(ctx, result)
		done := trace.step(context.Background(), "cleanup dependencies")
		done(restoreDependencies())
	}()
	restoreHistory := prepareBuildHistory(ctx, wt, filepath.Join(root, "history"))
	defer func() {
		trace.endPhase(ctx, result)
		done := trace.step(context.Background(), "cleanup history cache")
		done(restoreHistory())
	}()
	setStage("content/build/link/date checks")
	if err := run(ctx, wt, c.Profile.environment(head)); err != nil {
		return err
	}
	var version struct {
		Commit string `json:"commit"`
	}
	setStage("build version proof")
	if err := readJSON(filepath.Join(wt, "site/dist/version.json"), &version); err != nil {
		return err
	}
	if version.Commit != head {
		return errors.New("built version does not match selected commit")
	}
	artifact := filepath.Join(job, "artifact")
	setStage("ZIP packaging")
	if err := os.Mkdir(artifact, 0700); err != nil {
		return err
	}
	digest, err := packageLocalBuild(filepath.Join(wt, "site/dist"), filepath.Join(artifact, "site.zip"))
	if err != nil {
		return err
	}
	setStage("final freshness check")
	current, err := latest(ctx)
	if err != nil {
		return err
	}
	if current != head {
		trace.outcome = "superseded"
		return errors.New("build superseded by newer main")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	receipt := preparedBuild{State: "prepared-not-deployed", Commit: head, BuildID: id, ArchiveSHA256: digest, Profile: c.Profile, PreparedAt: time.Now().UTC()}
	if c.Mode == "deploy" {
		setStage("conditional Canvas publication and verification")
		if err := g.coordinateBuild(ctx, wt, head, "publish", intentPath, filepath.Join(artifact, "site.zip"), proofPath); err != nil {
			return err
		}
		trace.outcome = "verified"
		var proof struct {
			Commit  string `json:"commit"`
			Outcome string `json:"outcome"`
		}
		if readJSON(proofPath, &proof) == nil && proof.Commit == head && (proof.Outcome == "published" || proof.Outcome == "already_current") {
			trace.outcome = proof.Outcome
		}
		receipt.State = "deployment-verified"
	}
	setStage("prepared receipt")
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
	done := buildTimingFrom(ctx).step(ctx, "coordinator installation token")
	token, err := g.installationToken(ctx)
	done(err)
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

func prepareBuildDependencies(ctx context.Context, root, source, cache string) (func() error, error) {
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
	restore := func() error {
		if err := os.Rename(modulesInBuild, filepath.Join(cache, "node_modules")); err != nil {
			return err
		}
		return writeJSONAtomic(filepath.Join(cache, "key.json"), key)
	}
	if cachedKey == key {
		if err := os.Rename(filepath.Join(cache, "node_modules"), modulesInBuild); err == nil {
			buildTimingFrom(ctx).emit(buildTimingRecord{Stage: "dependency cache", Outcome: "success", Cache: "hit"})
			return restore, nil
		}
	}
	buildTimingFrom(ctx).emit(buildTimingRecord{Stage: "dependency cache", Outcome: "success", Cache: "miss"})
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

// Preserve only the history builder's private input cache, never generated site
// output. The builder validates ancestry and refreshes changed/renamed paths;
// changing its implementation invalidates this cache independently of npm.
func prepareBuildHistory(ctx context.Context, root, cache string) func() error {
	noop := func() error { return nil }
	trace := buildTimingFrom(ctx)
	script, err := os.ReadFile(filepath.Join(root, "site/scripts/build-item-history.mjs"))
	if err != nil {
		return noop
	}
	key := stateKey(string(script))
	var cachedKey string
	_ = readJSON(filepath.Join(cache, "key.json"), &cachedKey)
	directory := filepath.Join(root, "site/.cache")
	for _, dir := range []string{directory, cache} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			trace.emit(buildTimingRecord{Stage: "history cache", Outcome: "unavailable"})
			return noop
		}
		if info, err := os.Lstat(dir); err != nil || !info.IsDir() {
			trace.emit(buildTimingRecord{Stage: "history cache", Outcome: "unavailable"})
			return noop
		}
	}
	stored := filepath.Join(cache, "item-history.json")
	inBuild := filepath.Join(directory, "item-history.json")
	state := "miss"
	if cachedKey == key {
		if info, err := os.Lstat(stored); err == nil && info.Mode().IsRegular() {
			if os.Rename(stored, inBuild) == nil {
				state = "hit"
			}
		}
	}
	trace.emit(buildTimingRecord{Stage: "history cache", Outcome: "success", Cache: state})
	return func() error {
		info, err := os.Lstat(inBuild)
		if os.IsNotExist(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return errors.New("history cache must be a regular file")
		}
		if err := os.Rename(inBuild, stored); err != nil {
			return err
		}
		return writeJSONAtomic(filepath.Join(cache, "key.json"), key)
	}
}

func runLocalBuildCommands(ctx context.Context, root string, env []string) error {
	type buildCheck struct {
		stage string
		args  []string
	}
	commands := []buildCheck{
		{"content validation", []string{"python3", "tooling/validate_items.py"}},
		{"npm build", []string{"npm", "--prefix", "site", "run", "build"}},
		{"document link checks", []string{"node", "site/scripts/check-document-links.mjs"}},
		{"item date checks", []string{"node", "site/scripts/check-item-history.mjs"}},
	}
	if _, err := os.Stat(filepath.Join(root, "site/scripts/check-demo.mjs")); err == nil {
		commands = append(commands, buildCheck{"demo checks", []string{"node", "site/scripts/check-demo.mjs"}})
	}
	for _, check := range commands {
		done := buildTimingFrom(ctx).step(ctx, check.stage)
		err := runBuildCommand(ctx, root, env, check.args)
		done(err)
		if err != nil {
			return err
		}
	}
	return nil
}

func runBuildCommand(ctx context.Context, root string, env, args []string) error {
	trace := buildTimingFrom(ctx)
	if trace != nil && trace.probe != "" && (args[0] == "node" || args[0] == "npm") {
		// Only our embedded probe can set NODE_OPTIONS; never inherit a caller's.
		clean := make([]string, 0, len(env)+1)
		for _, value := range env {
			if !strings.HasPrefix(value, "NODE_OPTIONS=") {
				clean = append(clean, value)
			}
		}
		env = append(clean, "NODE_OPTIONS=--import="+trace.probe)
	}
	cmd := exec.CommandContext(ctx, args[0], args[1:]...)
	cmd.Dir, cmd.Env = root, env
	// npm spawns Astro: cancel the process group, not just its parent shell.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	cmd.WaitDelay = 2 * time.Second
	output := buildOutput{trace: trace}
	if trace != nil {
		output.parent = trace.phase
	}
	cmd.Stdout, cmd.Stderr = &output, &output
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("local check %s failed: %w\n%s", strings.Join(args, " "), err, output.data)
	}
	return nil
}

// Keep only a bounded diagnostic tail. The service never logs this raw output;
// local integration tests can display it when the actual toolchain fails.
type buildOutput struct {
	data, line  []byte
	trace       *buildTiming
	parent      string
	records     int
	discardLine bool
}

func (b *buildOutput) Write(p []byte) (int, error) {
	if b.trace != nil && b.records < 256 {
		for _, value := range p {
			if b.records >= 256 {
				break
			}
			if value == '\n' {
				if !b.discardLine {
					b.trace.nodeRecord(b.line, b.parent)
				}
				if bytes.HasPrefix(b.line, []byte("ROADMAP_BUILD_TIMING ")) {
					b.records++
				}
				b.line, b.discardLine = b.line[:0], false
			} else if len(b.line) < 2048 {
				b.line = append(b.line, value)
			} else {
				b.discardLine = true
			}
		}
	}
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

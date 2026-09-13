package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"time"
)

var errContentSuperseded = errors.New("content superseded by newer main")

// Content is data. All subprocess entrypoints below come from the explicitly
// approved package, never from the candidate checkout. No npm, Astro or Vite.
func (g *GitHub) prepareContent(ctx context.Context, latest func(context.Context) (string, error), run func(context.Context, string, []string, []string) error) (result error) {
	ctx, trace, ownsTrace := ensureBuildTiming(ctx)
	if ownsTrace {
		defer func() { trace.finish(ctx, result) }()
	}
	stage := "approved application package"
	trace.nextPhase(ctx, stage)
	setStage := func(name string) { stage = name; trace.nextPhase(ctx, name) }
	defer func() {
		trace.endPhase(ctx, result)
		if result != nil {
			result = &localBuildFailure{stage: stage, cause: result}
		}
	}()
	c := g.cfg.LocalBuild
	app, err := loadApprovedApplication(c, g.cfg.Repo)
	if err != nil {
		return err
	}
	setStage("latest-main lookup")
	head, err := latest(ctx)
	if err != nil {
		return err
	}
	trace.commit = head
	setStage("approved content baseline")
	if err := g.checkLocalBuildTree(ctx, app.Source, head); err != nil {
		return err
	}
	setStage("immutable checkout")
	root := filepath.Join(g.cfg.StateDir, "local-build")
	if err := os.MkdirAll(root, 0700); err != nil {
		return err
	}
	job, err := os.MkdirTemp(root, "attempt-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(job) // Only this invocation's owned, disposable attempt.
	trace.installProbe(job)
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
	commands := filepath.Join(app.Directory, "private/commands")
	intent := filepath.Join(job, "intent.json")
	candidate := filepath.Join(job, "candidate")
	proof := filepath.Join(root, "last-deployment.json")
	coordinate := func(action string) error {
		token, err := g.installationToken(ctx)
		if err != nil {
			return err
		}
		env := append(c.Profile.environment(head), "GITHUB_REPOSITORY="+g.cfg.Repo, "GH_TOKEN="+token,
			"CANVAS_API_URL="+c.CanvasAPIURL, "CANVAS_DROP_TOKEN="+g.cfg.CanvasDropToken,
			"ROADMAP_APPLICATION_COMMIT="+app.Source, "ROADMAP_APPLICATION_DIGEST="+app.Digest,
			"ROADMAP_REUSE_APPLICATION=true", "ROADMAP_UPLOAD_CONCURRENCY="+c.UploadConcurrency, "ROADMAP_CONTENT_OUTPUT="+filepath.Join(candidate, "public"))
		return run(ctx, wt, env, []string{"node", filepath.Join(commands, "coordinate.mjs"), action, intent, filepath.Join(candidate, "candidate.json"), proof})
	}
	if c.Mode == "content" {
		setStage("Canvas coordination preflight")
		if err := coordinate("preflight"); err != nil {
			return err
		}
		var selected struct {
			AlreadyCurrent bool `json:"alreadyCurrent"`
		}
		if err := readJSON(intent, &selected); err != nil {
			return err
		}
		if selected.AlreadyCurrent {
			setStage("verify already current")
			if err := coordinate("publish-staged"); err != nil {
				return err
			}
			trace.outcome = "already_current"
			return nil
		}
	}
	restoreHistory := prepareBuildHistory(ctx, wt, filepath.Join(root, "history"))
	defer restoreHistory()
	steps := []struct {
		name string
		args []string
	}{
		{"validate content", []string{"python3", filepath.Join(commands, "validate_items.py"), wt}},
		{"verify demo isolation", []string{"node", filepath.Join(commands, "check-demo.mjs"), wt}},
		{"item history", []string{"node", filepath.Join(commands, "build-item-history.mjs")}},
		{"prepare content", []string{"node", filepath.Join(commands, "prepare-content.mjs"), app.Directory, wt, candidate, app.Digest, filepath.Join(root, "content-cache")}},
		{"document link check", []string{"node", filepath.Join(commands, "check-document-links.mjs"), filepath.Join(candidate, "public")}},
		{"item date check", []string{"node", filepath.Join(commands, "check-item-history.mjs"), filepath.Join(candidate, "public")}},
	}
	preparation, stopMonitor := monitorContentHead(ctx, head, latest)
	var preparationError error
	for _, step := range steps {
		setStage(step.name)
		if err := run(preparation, wt, c.Profile.environment(head), step.args); err != nil {
			preparationError = err
			break
		}
	}
	if stopMonitor() {
		trace.outcome = "superseded"
		return errContentSuperseded
	}
	if preparationError != nil {
		return preparationError
	}
	setStage("candidate identity")
	var version struct {
		Commit             string `json:"commit"`
		ApplicationCommit  string `json:"applicationCommit"`
		ApplicationPackage string `json:"applicationPackage"`
	}
	if err := readJSON(filepath.Join(candidate, "public/version.json"), &version); err != nil {
		return err
	}
	if version.Commit != head || version.ApplicationCommit != app.Source || version.ApplicationPackage != app.Digest {
		return errors.New("candidate identity mismatch")
	}
	if c.Mode == "content" && c.RaceBarrier {
		setStage("operator race barrier")
		if err := waitContentRaceBarrier(ctx, root, head, 90*time.Second); err != nil {
			return err
		}
	}
	// Content publication rechecks main before staging, immediately before activation,
	// and after verification. Only shadow needs this separate Git fetch.
	if c.Mode == "shadow" {
		setStage("final freshness check")
		current, err := latest(ctx)
		if err != nil {
			return err
		}
		if current != head {
			trace.outcome = "superseded"
			return errContentSuperseded
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if c.Mode == "shadow" {
		trace.outcome = "shadow_prepared"
		return writeJSONAtomic(filepath.Join(root, "last-shadow.json"), map[string]any{"state": "shadow-prepared-not-deployed", "commit": head, "applicationCommit": app.Source, "applicationPackage": app.Digest, "preparedAt": time.Now().UTC()})
	}
	setStage("conditional Canvas publication and verification")
	if err := coordinate("publish-staged"); err != nil {
		return err
	}
	trace.outcome = "verified"
	var deployed struct {
		Commit  string `json:"commit"`
		Outcome string `json:"outcome"`
	}
	if readJSON(proof, &deployed) == nil && deployed.Commit == head && (deployed.Outcome == "published" || deployed.Outcome == "already_current") {
		trace.outcome = deployed.Outcome
	}
	return nil
}

package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func assetRepository(t *testing.T) (*GitHub, Upload, *atomic.Int32) {
	t.Helper()
	parent := t.TempDir()
	remote := filepath.Join(parent, "remote.git")
	gitTest(t, parent, "init", "--bare", remote)
	root := filepath.Join(parent, "repo")
	gitTest(t, parent, "clone", remote, root)
	cfg := Config{RepoCacheDir: root, StateDir: t.TempDir()}
	u := stagedText(t, cfg)
	g := &GitHub{cfg: cfg}
	now := time.Now()
	g.assetCache().now = func() time.Time { return now }
	if err := g.applyAssets(root, AssetChanges{Attach: []AssetAttachment{{UploadID: u.ID}}}, "alice"); err != nil {
		t.Fatal(err)
	}
	gitTest(t, root, "add", ".")
	gitTest(t, root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "Assets")
	gitTest(t, root, "branch", "-M", "main")
	gitTest(t, root, "push", "origin", "main")
	var fetches atomic.Int32
	g.assetCache().fetch = func(ctx context.Context) error {
		fetches.Add(1)
		_, err := g.runGit(ctx, "", root, "fetch", "origin", "+refs/heads/main:refs/remotes/origin/main")
		return err
	}
	return g, u, &fetches
}

func TestAssetSnapshotsShareRefreshAndWarmReads(t *testing.T) {
	g, u, fetches := assetRepository(t)
	var wg sync.WaitGroup
	for range 7 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s, release, err := g.acquireAssetSnapshot(context.Background())
			if err != nil {
				t.Error(err)
				return
			}
			defer release()
			if s.files[u.RepoPath].file.SHA256 != u.Revision.Original.SHA256 {
				t.Error("wrong snapshot")
			}
		}()
	}
	wg.Wait()
	if fetches.Load() != 1 {
		t.Fatalf("fetches=%d", fetches.Load())
	}
	g.repoMu.Lock()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, release, err := g.acquireAssetSnapshot(ctx)
	g.repoMu.Unlock()
	if err != nil {
		t.Fatal("warm read waited for publisher", err)
	}
	release()
	if _, err := os.Stat(g.worktreeRoot()); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("read created a worktree", err)
	}
}

func TestAssetSnapshotExpiryFailureAndInvalidation(t *testing.T) {
	g, _, fetches := assetRepository(t)
	now := time.Now()
	c := g.assetCache()
	c.now = func() time.Time { return now }
	s, release, err := g.acquireAssetSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	release()
	initial := s.sha
	now = now.Add(6 * time.Second)
	fetch := c.fetch
	c.fetch = func(context.Context) error { return errors.New("offline") }
	if _, _, err := g.acquireAssetSnapshot(context.Background()); err == nil {
		t.Fatal("served stale after refresh failure")
	}
	c.fetch = fetch
	gitTest(t, g.repoRoot(), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--allow-empty", "-m", "Next")
	gitTest(t, g.repoRoot(), "push", "origin", "main")
	s, release, err = g.acquireAssetSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	release()
	if s.sha == initial {
		t.Fatal("did not refresh head")
	}
	g.invalidateAssetSnapshots()
	_, release, err = g.acquireAssetSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	release()
	if fetches.Load() != 3 {
		t.Fatal(fetches.Load())
	}
}

func TestAssetSnapshotCancelledWaiterDoesNotCancelRefresh(t *testing.T) {
	g, _, _ := assetRepository(t)
	c := g.assetCache()
	fetch := c.fetch
	started, unblock := make(chan struct{}), make(chan struct{})
	c.fetch = func(ctx context.Context) error {
		close(started)
		select {
		case <-unblock:
			return fetch(ctx)
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, release, err := g.acquireAssetSnapshot(ctx)
		if release != nil {
			release()
		}
		done <- err
	}()
	<-started
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	close(unblock)
	_, release, err := g.acquireAssetSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	release()
}

func TestAssetSnapshotEvictionKeepsActiveCommitReachable(t *testing.T) {
	g, u, _ := assetRepository(t)
	first, release, err := g.acquireAssetSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	for i := 0; i < 10; i++ {
		gitTest(t, g.repoRoot(), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--allow-empty", "-m", "Next")
		gitTest(t, g.repoRoot(), "push", "origin", "main")
		g.invalidateAssetSnapshots()
		_, done, err := g.acquireAssetSnapshot(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		done()
	}
	if len(g.assetCache().snapshots) != 8 {
		t.Fatal("unbounded snapshots")
	}
	gitTest(t, g.repoRoot(), "rev-parse", assetRefPrefix+first.sha)
	_, data, err := g.assetOriginal(context.Background(), first, u.RepoPath)
	if err != nil || string(data) != "canonical original bytes\n" {
		t.Fatal("active snapshot lost", err)
	}
}

func TestAssetRefreshCannotOverwritePublicationInvalidation(t *testing.T) {
	g, _, _ := assetRepository(t)
	c := g.assetCache()
	fetch := c.fetch
	started, finish := make(chan struct{}), make(chan struct{})
	var once sync.Once
	c.fetch = func(ctx context.Context) error { once.Do(func() { close(started); <-finish }); return fetch(ctx) }
	done := make(chan error, 1)
	go func() {
		_, release, err := g.acquireAssetSnapshot(context.Background())
		if release != nil {
			release()
		}
		done <- err
	}()
	<-started
	g.invalidateAssetSnapshots()
	close(finish)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if c.current == nil {
		t.Fatal("did not recover after invalidation")
	}
}

func TestAssetGitOutputIsBounded(t *testing.T) {
	g, u, _ := assetRepository(t)
	s, release, err := g.acquireAssetSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	if _, err := g.assetGit(context.Background(), 1, "cat-file", "blob", s.files[u.RepoPath].oid); err == nil {
		t.Fatal("output bypassed size limit")
	}
}

func TestAssetPublicationAndRecoveryInvalidateWarmSnapshot(t *testing.T) {
	g, _, _ := assetRepository(t)
	g.instTok = "test"
	g.instExp = time.Now().Add(time.Hour)
	g.cfg.Repo = "test/assets"
	gitTest(t, g.repoRoot(), "config", "url."+filepath.Join(filepath.Dir(g.repoRoot()), "remote.git")+".insteadOf", g.repoURL())
	_, release, err := g.acquireAssetSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	release()
	cs := Changeset{RequestID: "publication-asset-cache", Created: []ItemNew{{ID: "new-cache-test", Product: "Music App", Title: "Cache publication", Frontmatter: map[string]string{"owner": "Alice", "horizon": "Next", "stage": "Discovery", "visibility": "Internal"}}}}
	for range 2 {
		out, err := g.syncChangeset(context.Background(), cs, "Publish", "alice")
		if err != nil || len(out.Errors) > 0 || len(out.Conflicts) > 0 {
			t.Fatal(out, err)
		}
		if !g.assetCache().freshUntil.IsZero() {
			t.Fatal("publication retained fresh old snapshot")
		}
		next, release, err := g.acquireAssetSnapshot(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		release()
		if next.sha != out.SHA {
			t.Fatal("publication and asset snapshot differ")
		}
	}
}

func TestAssetSnapshotSurvivesForcePushAndPrune(t *testing.T) {
	g, u, _ := assetRepository(t)
	first, release, err := g.acquireAssetSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	gitTest(t, g.repoRoot(), "checkout", "--orphan", "replacement")
	gitTest(t, g.repoRoot(), "rm", "-rf", ".")
	gitTest(t, g.repoRoot(), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--allow-empty", "-m", "Replace history")
	gitTest(t, g.repoRoot(), "push", "--force", "origin", "HEAD:main")
	gitTest(t, g.repoRoot(), "branch", "-D", "main")
	g.invalidateAssetSnapshots()
	next, done, err := g.acquireAssetSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	done()
	if _, ok := next.files[u.RepoPath]; ok {
		t.Fatal("removed original still available in latest snapshot")
	}
	gitTest(t, g.repoRoot(), "reflog", "expire", "--expire=now", "--all")
	gitTest(t, g.repoRoot(), "gc", "--prune=now")
	file, data, err := g.assetOriginal(context.Background(), first, u.RepoPath)
	if err != nil || string(data) != "canonical original bytes\n" {
		t.Fatal("active snapshot was pruned", err)
	}
	file.SHA256 = "caller mutation"
	if first.files[u.RepoPath].file.SHA256 == file.SHA256 {
		t.Fatal("returned metadata aliases cached metadata")
	}
}

func TestAssetSnapshotRejectsOversizedMetadata(t *testing.T) {
	g, u, _ := assetRepository(t)
	if err := os.WriteFile(filepath.Join(g.repoRoot(), assetPath(u.AssetID)), make([]byte, assetMetadataBudget+1), 0600); err != nil {
		t.Fatal(err)
	}
	gitTest(t, g.repoRoot(), "add", ".")
	gitTest(t, g.repoRoot(), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "Oversized metadata")
	gitTest(t, g.repoRoot(), "push", "origin", "main")
	if _, _, err := g.acquireAssetSnapshot(context.Background()); err == nil {
		t.Fatal("accepted oversized metadata")
	}
}

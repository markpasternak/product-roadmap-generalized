package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"
)

const assetMetadataBudget = 8 << 20
const assetSnapshotTTL = 5 * time.Second
const assetRefPrefix = "refs/roadmap-asset-cache/"

type assetBlob struct {
	oid  string
	size int64
	file AssetFile
}
type assetSnapshot struct {
	sha     string
	files   map[string]assetBlob
	cost    int
	readers int
}
type assetRefresh struct {
	done chan struct{}
	err  error
}
type assetSnapshotCache struct {
	mu          sync.Mutex
	snapshots   []*assetSnapshot
	current     *assetSnapshot
	freshUntil  time.Time
	generation  uint64
	refresh     *assetRefresh
	initialized bool
	slots       chan struct{}
	now         func() time.Time
	fetch       func(context.Context) error
}

func (g *GitHub) assetCache() *assetSnapshotCache {
	g.assetsOnce.Do(func() {
		g.assets = &assetSnapshotCache{slots: make(chan struct{}, 4), now: time.Now}
		g.assets.fetch = func(ctx context.Context) error {
			token, err := g.installationToken(ctx)
			if err != nil {
				return err
			}
			return g.fetchMainLocked(ctx, token)
		}
	})
	return g.assets
}

// Lock order is repoMu -> cache.mu. Warm readers take only cache.mu. A refresh
// owns repoMu through installation, so publication cannot install an older head.
func (g *GitHub) invalidateAssetSnapshots() {
	c := g.assetCache()
	c.mu.Lock()
	defer c.mu.Unlock()
	c.generation++
	c.freshUntil = time.Time{}
}

// The caller must hold response capacity before leasing, and release the lease
// only after the HTTP response finishes. Snapshots and their maps are immutable.
func (g *GitHub) acquireAssetSnapshot(ctx context.Context) (*assetSnapshot, func(), error) {
	c := g.assetCache()
	for {
		if err := ctx.Err(); err != nil {
			return nil, nil, err
		}
		c.mu.Lock()
		if c.current != nil && c.now().Before(c.freshUntil) {
			s := c.current
			s.readers++
			c.mu.Unlock()
			return s, func() { c.mu.Lock(); s.readers--; c.mu.Unlock() }, nil
		}
		call := c.refresh
		if call == nil {
			call = &assetRefresh{done: make(chan struct{})}
			c.refresh = call
			go g.refreshAssetSnapshot(call)
		}
		c.mu.Unlock()
		select {
		case <-ctx.Done():
			return nil, nil, ctx.Err()
		case <-call.done:
		}
		if call.err != nil {
			return nil, nil, call.err
		}
	}
}

func (g *GitHub) refreshAssetSnapshot(call *assetRefresh) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	g.repoMu.Lock()
	defer g.repoMu.Unlock()
	c := g.assetCache()
	c.mu.Lock()
	generation := c.generation
	c.mu.Unlock()
	s, err := g.loadAssetSnapshot(ctx)
	c.mu.Lock()
	defer c.mu.Unlock()
	if err == nil && generation == c.generation {
		c.current = s
		c.freshUntil = c.now().Add(assetSnapshotTTL)
	}
	call.err = err
	c.refresh = nil
	close(call.done)
}

func (g *GitHub) loadAssetSnapshot(ctx context.Context) (*assetSnapshot, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	c := g.assetCache()
	if err := c.fetch(ctx); err != nil {
		return nil, err
	}
	// Startup cleanup is confined to our private ref namespace, never worktrees.
	if !c.initialized {
		refs, err := g.assetGit(ctx, assetMetadataBudget, "for-each-ref", "--format=%(refname)", assetRefPrefix)
		if err != nil {
			return nil, err
		}
		for _, ref := range strings.Fields(string(refs)) {
			if _, err = g.assetGit(ctx, 1024, "update-ref", "-d", ref); err != nil {
				return nil, err
			}
		}
		c.initialized = true
	}
	raw, err := g.assetGit(ctx, 128, "rev-parse", "refs/remotes/origin/main")
	if err != nil {
		return nil, err
	}
	sha := strings.TrimSpace(string(raw))
	c.mu.Lock()
	for _, s := range c.snapshots {
		if s.sha == sha {
			c.mu.Unlock()
			return s, nil
		}
	}
	c.mu.Unlock()
	s, err := g.readAssetSnapshot(ctx, sha)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	cost := s.cost
	for _, old := range c.snapshots {
		cost += old.cost
	}
	for len(c.snapshots) >= 8 || cost > assetMetadataBudget {
		victim := -1
		for i, old := range c.snapshots {
			if old.readers == 0 {
				victim = i
				break
			}
		}
		if victim < 0 {
			return nil, errors.New("asset snapshots are busy")
		}
		old := c.snapshots[victim]
		if _, err = g.assetGit(ctx, 1024, "update-ref", "-d", assetRefPrefix+old.sha); err != nil {
			return nil, err
		}
		cost -= old.cost
		c.snapshots = append(c.snapshots[:victim], c.snapshots[victim+1:]...)
	}
	if _, err = g.assetGit(ctx, 1024, "update-ref", assetRefPrefix+sha, sha); err != nil {
		return nil, err
	}
	c.snapshots = append(c.snapshots, s)
	return s, nil
}

func (g *GitHub) readAssetSnapshot(ctx context.Context, sha string) (*assetSnapshot, error) {
	raw, err := g.assetGit(ctx, assetMetadataBudget, "ls-tree", "-rlz", sha, "--", "content/assets/")
	if err != nil {
		return nil, err
	}
	type treeBlob struct {
		oid     string
		size    int64
		regular bool
	}
	tree := map[string]treeBlob{}
	var manifests []string
	for _, entry := range bytes.Split(raw, []byte{0}) {
		if len(entry) == 0 {
			continue
		}
		fields, p, ok := strings.Cut(string(entry), "\t")
		cols := strings.Fields(fields)
		if !ok || len(cols) != 4 {
			return nil, errors.New("invalid asset tree")
		}
		size, _ := strconv.ParseInt(cols[3], 10, 64)
		tree[p] = treeBlob{cols[2], size, cols[1] == "blob" && (cols[0] == "100644" || cols[0] == "100755")}
		if path.Base(p) == "asset.json" && len(strings.Split(p, "/")) == 4 {
			manifests = append(manifests, p)
		}
	}
	s := &assetSnapshot{sha: sha, files: map[string]assetBlob{}, cost: len(raw)}
	for _, p := range manifests {
		b := tree[p]
		if !b.regular || b.size <= 0 || b.size > assetMetadataBudget {
			return nil, errors.New("invalid asset manifest blob")
		}
		if s.cost+int(b.size) > assetMetadataBudget {
			return nil, errors.New("asset metadata budget exceeded")
		}
		data, err := g.assetGit(ctx, int(b.size), "cat-file", "blob", b.oid)
		if err != nil {
			return nil, err
		}
		var a Asset
		if err = json.Unmarshal(data, &a); err != nil {
			return nil, err
		}
		if err = validateAssetManifest(a, path.Base(path.Dir(p))); err != nil {
			return nil, err
		}
		s.cost += len(data)
		for _, rev := range a.Revisions {
			name := "content/assets/" + a.ID + "/" + rev.Original.Path
			original, exists := tree[name]
			// A bad original rejects that request, without reading unrelated bodies.
			if !exists || !original.regular || original.size != rev.Original.Bytes {
				continue
			}
			s.cost += len(name) + len(rev.Original.Path) + len(rev.Original.MediaType) + len(rev.Original.SHA256) + 256
			if s.cost > assetMetadataBudget {
				return nil, errors.New("asset metadata budget exceeded")
			}
			s.files[name] = assetBlob{original.oid, original.size, rev.Original}
		}
	}
	return s, nil
}

// All commands are local object/ref operations with bounded output. No filters,
// text conversion, symlink following, shell interpolation or network credentials.
func (g *GitHub) assetGit(ctx context.Context, limit int, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = g.repoRoot()
	cmd.Env = g.gitEnv("")
	cmd.WaitDelay = time.Second
	out := &limitedAssetBuffer{limit: limit}
	cmd.Stdout = out
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("asset git %s: %w", args[0], err)
	}
	return out.buffer.Bytes(), nil
}

type limitedAssetBuffer struct {
	buffer bytes.Buffer
	limit  int
}

func (b *limitedAssetBuffer) Write(p []byte) (int, error) {
	if len(p) > b.limit-b.buffer.Len() {
		return 0, errors.New("asset output limit exceeded")
	}
	return b.buffer.Write(p)
}

func validateAssetManifest(a Asset, id string) error {
	if !safeStateID(id) || a.ID != id || a.SchemaVersion != 1 || !strings.HasPrefix(a.ID, "ast_") || (a.Visibility != "Public" && a.Visibility != "Internal") || strings.TrimSpace(a.Name) == "" || len(a.Name) > 250 || len(a.Revisions) == 0 {
		return fmt.Errorf("invalid asset manifest: %s", id)
	}
	seen := map[string]bool{}
	for _, rev := range a.Revisions {
		f := rev.Original
		if !safeStateID(rev.ID) || !strings.HasPrefix(rev.ID, "rev_") || seen[rev.ID] || path.Dir(f.Path) != rev.ID || sanitizedFilename(path.Base(f.Path)) != path.Base(f.Path) || f.Bytes <= 0 || f.Bytes > maxUploadBytes {
			return fmt.Errorf("invalid revision in %s", id)
		}
		seen[rev.ID] = true
	}
	return nil
}

func safeAssetRequest(p string) bool {
	parts := strings.Split(p, "/")
	return len(parts) == 5 && parts[0] == "content" && parts[1] == "assets" && safeStateID(parts[2]) && strings.HasPrefix(parts[2], "ast_") && safeStateID(parts[3]) && strings.HasPrefix(parts[3], "rev_") && parts[4] != "" && sanitizedFilename(parts[4]) == parts[4] && path.Clean(p) == p && !strings.Contains(p, "\\")
}

func (g *GitHub) assetOriginal(ctx context.Context, s *assetSnapshot, p string) (AssetFile, []byte, error) {
	b, ok := s.files[p]
	if !ok {
		return AssetFile{}, nil, os.ErrNotExist
	}
	data, err := g.assetGit(ctx, int(b.size), "cat-file", "blob", b.oid)
	if err != nil {
		return AssetFile{}, nil, err
	}
	if err = validateAssetOriginal(b.file, data); err != nil {
		return AssetFile{}, nil, err
	}
	return b.file, data, nil
}

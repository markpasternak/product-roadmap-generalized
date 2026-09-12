package main

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"time"
)

const maxPushAttempts = 3

type syncOutcome struct {
	Items           []APIItem
	DeletedIDs      []string
	SHA             string
	Errors          []string
	Conflicts       []string
	SkippedReorders []string
	CreatedIDs      map[string]string
	NoChanges       bool
}

type ItemGitMetadata struct {
	ActivityDates  []string `json:"activityDates"`
	Created        string   `json:"created"`
	Updated        string   `json:"updated"`
	CreatedAt      string   `json:"createdAt"`
	UpdatedAt      string   `json:"updatedAt"`
	CreatedBy      string   `json:"createdBy"`
	UpdatedBy      string   `json:"updatedBy"`
	CreatedCommit  string   `json:"createdCommit"`
	UpdatedCommit  string   `json:"updatedCommit"`
	CreatedSubject string   `json:"createdSubject"`
	UpdatedSubject string   `json:"updatedSubject"`
}

type itemGitRecord struct {
	SHA     string
	Date    string
	By      string
	Subject string
}

// gitBlobSha computes the git blob sha1 of content — the same algorithm `git
// hash-object` uses (`sha1("blob " + len(content) + "\0" + content)`, KTD1).
// RepoFile is read straight off disk (filepath.WalkDir + os.ReadFile), which
// carries no sha from git itself, so this is how each item's base version is
// derived rather than read from the tree.
func gitBlobSha(content []byte) string {
	h := sha1.New()
	fmt.Fprintf(h, "blob %d\x00", len(content))
	h.Write(content)
	return hex.EncodeToString(h.Sum(nil))
}

func (g *GitHub) repoURL() string {
	return "https://github.com/" + strings.TrimSuffix(g.cfg.Repo, ".git") + ".git"
}

func (g *GitHub) repoRoot() string {
	return g.cfg.RepoCacheDir
}

func (g *GitHub) worktreeRoot() string {
	return filepath.Join(filepath.Dir(g.repoRoot()), "worktrees")
}

func (g *GitHub) gitEnv(token string) []string {
	var env []string
	for _, value := range os.Environ() {
		// The optional Canvas credential is never needed by Git or its hooks.
		if !strings.HasPrefix(value, "CANVAS_DROP_TOKEN=") {
			env = append(env, value)
		}
	}
	env = append(env,
		"GIT_TERMINAL_PROMPT=0",
		"HOME="+filepath.Dir(g.repoRoot()),
	)
	if token != "" {
		auth := base64.StdEncoding.EncodeToString([]byte("x-access-token:" + token))
		env = append(env,
			"GIT_CONFIG_COUNT=1",
			"GIT_CONFIG_KEY_0=http.https://github.com/.extraheader",
			"GIT_CONFIG_VALUE_0=Authorization: Basic "+auth,
		)
	}
	return env
}

func (g *GitHub) runGit(ctx context.Context, token, dir string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	if dir != "" {
		cmd.Dir = dir
	}
	cmd.Env = g.gitEnv(token)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	if err := cmd.Run(); err != nil {
		return out.Bytes(), fmt.Errorf("git %s: %w\n%s", strings.Join(args, " "), err, out.String())
	}
	return out.Bytes(), nil
}

func dateOnly(iso string) string {
	if len(iso) >= 10 {
		return iso[:10]
	}
	return iso
}

func parseItemGitLog(out []byte) []itemGitRecord {
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	records := make([]itemGitRecord, 0, len(lines))
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.SplitN(line, "\x1f", 4)
		for len(parts) < 4 {
			parts = append(parts, "")
		}
		if parts[0] == "" || parts[1] == "" {
			continue
		}
		records = append(records, itemGitRecord{SHA: parts[0], Date: parts[1], By: parts[2], Subject: parts[3]})
	}
	return records
}

func isOnlyUpdatedFrontmatterPatch(patch []byte) bool {
	changed := []string{}
	for _, line := range strings.Split(string(patch), "\n") {
		if strings.HasPrefix(line, "+++") || strings.HasPrefix(line, "---") {
			continue
		}
		if strings.HasPrefix(line, "+") || strings.HasPrefix(line, "-") {
			changed = append(changed, line)
		}
	}
	if len(changed) == 0 {
		return false
	}
	for _, line := range changed {
		body := strings.TrimSpace(line[1:])
		if !strings.HasPrefix(body, "updated:") {
			return false
		}
	}
	return true
}

func (g *GitHub) itemGitMetadata(ctx context.Context, token, wt, repoPath string) ItemGitMetadata {
	out, err := g.runGit(ctx, token, wt, "log", "--follow", "--format=%x1e%H%x1f%cI%x1f%an%x1f%s", "--patch", "--unified=0", "--no-ext-diff", "--", repoPath)
	if err != nil {
		return ItemGitMetadata{}
	}
	return itemMetadataFromLog(out)
}

func itemMetadataFromLog(out []byte) ItemGitMetadata {
	records := []itemGitRecord{}
	meaningful := []itemGitRecord{}
	activityDates := []string{}
	seen := map[string]bool{}
	for _, block := range strings.Split(string(out), "\x1e") {
		lines := strings.SplitN(strings.TrimSpace(block), "\n", 2)
		if len(lines) != 2 {
			continue
		}
		parsed := parseItemGitLog([]byte(lines[0]))
		if len(parsed) != 1 {
			continue
		}
		record := parsed[0]
		records = append(records, record)
		patch := []byte(lines[1])
		hasChanges := false
		for _, line := range strings.Split(lines[1], "\n") {
			if (strings.HasPrefix(line, "+") || strings.HasPrefix(line, "-")) && !strings.HasPrefix(line, "+++") && !strings.HasPrefix(line, "---") {
				hasChanges = true
				break
			}
		}
		if hasChanges && !isOnlyUpdatedFrontmatterPatch(patch) {
			meaningful = append(meaningful, record)
			if !seen[record.Date] {
				activityDates = append(activityDates, record.Date)
				seen[record.Date] = true
			}
		}
	}
	if len(records) == 0 {
		return ItemGitMetadata{}
	}
	latest := records[0]
	if len(meaningful) > 0 {
		latest = meaningful[0]
	}
	created := records[len(records)-1]
	return ItemGitMetadata{
		ActivityDates:  activityDates,
		Created:        dateOnly(created.Date),
		Updated:        dateOnly(latest.Date),
		CreatedAt:      created.Date,
		UpdatedAt:      latest.Date,
		CreatedBy:      created.By,
		UpdatedBy:      latest.By,
		CreatedCommit:  created.SHA,
		UpdatedCommit:  latest.SHA,
		CreatedSubject: created.Subject,
		UpdatedSubject: latest.Subject,
	}
}

func (g *GitHub) attachItemGitMetadata(ctx context.Context, token, wt string, files map[string]RepoFile) {
	for id, rf := range files {
		rf.Git = g.itemGitMetadata(ctx, token, wt, rf.Path)
		files[id] = rf
	}
}

func (g *GitHub) ensureRepoLocked(ctx context.Context, token string) error {
	root := g.repoRoot()
	if _, err := os.Stat(filepath.Join(root, ".git")); err == nil {
		_, err = g.runGit(ctx, token, root, "remote", "set-url", "origin", g.repoURL())
		return err
	}
	if err := os.MkdirAll(filepath.Dir(root), 0o755); err != nil {
		return err
	}
	tmp := fmt.Sprintf("%s.clone-%d", root, time.Now().UnixNano())
	defer os.RemoveAll(tmp)
	if _, err := g.runGit(ctx, token, "", "clone", "--no-checkout", "--single-branch", "--branch", "main", g.repoURL(), tmp); err != nil {
		return err
	}
	_ = os.RemoveAll(root)
	return os.Rename(tmp, root)
}

func (g *GitHub) fetchMainLocked(ctx context.Context, token string) error {
	if err := g.ensureRepoLocked(ctx, token); err != nil {
		return err
	}
	_, err := g.runGit(ctx, token, g.repoRoot(), "fetch", "--prune", "origin", "+refs/heads/main:refs/remotes/origin/main")
	return err
}

func (g *GitHub) headSHALocked(ctx context.Context, token string) (string, error) {
	out, err := g.runGit(ctx, token, g.repoRoot(), "rev-parse", "origin/main")
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func (g *GitHub) addWorktreeLocked(ctx context.Context, token string) (string, error) {
	if err := os.MkdirAll(g.worktreeRoot(), 0o755); err != nil {
		return "", err
	}
	id, err := randHex(8)
	if err != nil {
		return "", err
	}
	wt := filepath.Join(g.worktreeRoot(), id)
	if _, err := g.runGit(ctx, token, g.repoRoot(), "worktree", "add", "--detach", wt, "origin/main"); err != nil {
		_ = os.RemoveAll(wt)
		return "", err
	}
	return wt, nil
}

func (g *GitHub) removeWorktree(ctx context.Context, token, wt string) {
	if wt == "" {
		return
	}
	_, _ = g.runGit(ctx, token, g.repoRoot(), "worktree", "remove", "--force", wt)
	_ = os.RemoveAll(wt)
}

func safeRepoPath(p string) (string, error) {
	clean := path.Clean(filepath.ToSlash(p))
	if clean == "." || strings.HasPrefix(clean, "../") || strings.HasPrefix(clean, "/") {
		return "", fmt.Errorf("unsafe path %q", p)
	}
	if !strings.HasPrefix(clean, "content/items/") || !strings.HasSuffix(clean, ".md") {
		return "", fmt.Errorf("path outside editable items: %q", p)
	}
	return clean, nil
}

func readItemsFromDir(root string) (map[string]RepoFile, error) {
	base := filepath.Join(root, "content", "items")
	out := map[string]RepoFile{}
	if _, err := os.Stat(base); os.IsNotExist(err) {
		return out, nil
	} else if err != nil {
		return nil, err
	}
	err := filepath.WalkDir(base, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(d.Name(), ".md") {
			return nil
		}
		raw, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		repoPath := filepath.ToSlash(rel)
		doc := ParseDoc(string(raw))
		id := doc.FM["id"]
		if id == "" {
			return nil
		}
		out[id] = RepoFile{Path: repoPath, Content: string(raw), Sha: gitBlobSha(raw)}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func applyRepoFiles(root string, write []RepoFile, del []string) error {
	for _, f := range write {
		repoPath, err := safeRepoPath(f.Path)
		if err != nil {
			return err
		}
		if err := writeConfined(root, repoPath, []byte(f.Content)); err != nil {
			return err
		}
	}
	for _, p := range del {
		repoPath, err := safeRepoPath(p)
		if err != nil {
			return err
		}
		dst, err := confinedPath(root, repoPath)
		if err != nil {
			return err
		}
		if err := os.Remove(dst); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func cleanGitIdent(s string) string {
	s = strings.TrimSpace(s)
	s = strings.NewReplacer("<", "", ">", "", "\n", "", "\r", "").Replace(s)
	if s == "" {
		return "roadmap-editor"
	}
	return s
}

func isPushRace(output []byte, err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(string(output) + "\n" + err.Error())
	return strings.Contains(s, "non-fast-forward") ||
		strings.Contains(s, "fetch first") ||
		strings.Contains(s, "rejected")
}

func (g *GitHub) listItemsFromGit(ctx context.Context) (map[string]RepoFile, error) {
	token, err := g.installationToken(ctx)
	if err != nil {
		return nil, err
	}
	g.repoMu.Lock()
	defer g.repoMu.Unlock()
	if err := g.fetchMainLocked(ctx, token); err != nil {
		return nil, err
	}
	head, err := g.headSHALocked(ctx, token)
	if err != nil {
		return nil, err
	}
	if files, ok := g.cachedItems(head); ok {
		return files, nil
	}
	wt, err := g.addWorktreeLocked(ctx, token)
	if err != nil {
		return nil, err
	}
	defer g.removeWorktree(context.Background(), token, wt)
	files, err := readItemsFromDir(wt)
	if err != nil {
		return nil, err
	}
	g.attachItemGitMetadata(ctx, token, wt, files)
	g.cacheItems(head, files)
	return files, nil
}

func (g *GitHub) syncChangeset(ctx context.Context, cs Changeset, msg, login string) (syncOutcome, error) {
	started := time.Now()
	defer func() { log.Printf("publication repository duration=%s", time.Since(started)) }()
	token, err := g.installationToken(ctx)
	if err != nil {
		return syncOutcome{}, err
	}
	g.repoMu.Lock()
	defer g.repoMu.Unlock()

	var lastErr error
	for attempt := 1; attempt <= maxPushAttempts; attempt++ {
		if err := g.fetchMainLocked(ctx, token); err != nil {
			return syncOutcome{}, err
		}
		baseSHA, err := g.headSHALocked(ctx, token)
		if err != nil {
			return syncOutcome{}, err
		}
		wt, err := g.addWorktreeLocked(ctx, token)
		if err != nil {
			return syncOutcome{}, err
		}
		outcome, pushOut, pushErr, err := g.applyCommitPush(ctx, token, wt, cs, msg, login, baseSHA)
		g.removeWorktree(context.Background(), token, wt)
		if err != nil {
			return syncOutcome{}, err
		}
		if len(outcome.Errors) > 0 || len(outcome.Conflicts) > 0 || pushErr == nil {
			return outcome, pushErr
		}
		lastErr = pushErr
		if !isPushRace(pushOut, pushErr) || attempt == maxPushAttempts {
			return syncOutcome{}, pushErr
		}
	}
	return syncOutcome{}, lastErr
}

func (g *GitHub) applyCommitPush(ctx context.Context, token, wt string, cs Changeset, msg, login, baseSHA string) (syncOutcome, []byte, error, error) {
	if prior, exists, err := g.existingPublication(ctx, token, wt, login, cs); err != nil || exists {
		return prior, nil, nil, err
	}
	current, err := readItemsFromDir(wt)
	if err != nil {
		return syncOutcome{}, nil, nil, err
	}
	// This re-runs the conflict check (KTD1/KTD2) against the just-fetched
	// worktree state, right before committing — closing the race window
	// between handleSync's preview read and this attempt, in addition to the
	// preview-time check handleSync already does for fast user feedback.
	write, del, conflicts, skippedReorders, errs := BuildFiles(cs, current)
	if len(conflicts) != 0 {
		return syncOutcome{Conflicts: conflicts}, nil, nil, nil
	}
	if len(errs) != 0 {
		return syncOutcome{Errors: errs}, nil, nil, nil
	}
	if err := applyRepoFiles(wt, write, del); err != nil {
		return syncOutcome{}, nil, nil, err
	}
	if err := g.applyAssets(wt, cs.Assets, login); err != nil {
		return syncOutcome{Errors: []string{err.Error()}}, nil, nil, nil
	}
	createdIDs, err := createdIdentityMap(cs, current)
	if err != nil {
		return syncOutcome{}, nil, nil, err
	}
	if _, err := g.runGit(ctx, token, wt, "add", "-A", "--", "content"); err != nil {
		return syncOutcome{}, nil, nil, err
	}
	status, err := g.runGit(ctx, token, wt, "status", "--porcelain", "--", "content")
	if err != nil {
		return syncOutcome{}, nil, nil, err
	}
	if strings.TrimSpace(string(status)) == "" {
		return syncOutcome{SHA: baseSHA, SkippedReorders: skippedReorders, NoChanges: true}, nil, nil, nil
	}
	if cs.RequestID != "" {
		receipt := PublicationReceipt{RequestID: cs.RequestID, Actor: login, Digest: payloadDigest(cs), CreatedIDs: createdIDs, CommittedAt: time.Now().UTC().Format(time.RFC3339)}
		data, err := json.MarshalIndent(receipt, "", "  ")
		if err != nil {
			return syncOutcome{}, nil, nil, err
		}
		if err = writeConfined(wt, publicationPath(login, cs.RequestID), append(data, '\n')); err != nil {
			return syncOutcome{}, nil, nil, err
		}
		if _, err = g.runGit(ctx, token, wt, "add", "--", publicationPath(login, cs.RequestID)); err != nil {
			return syncOutcome{}, nil, nil, err
		}
	}
	ident := cleanGitIdent(login)
	author := fmt.Sprintf("%s <%s@users.noreply.github.com>", ident, ident)
	if _, err := g.runGit(ctx, token, wt,
		"-c", "user.name=Product Roadmap Editor",
		"-c", "user.email=roadmap-editor@users.noreply.github.com",
		"commit", "--author", author, "-m", msg,
	); err != nil {
		return syncOutcome{}, nil, nil, err
	}
	shaOut, err := g.runGit(ctx, token, wt, "rev-parse", "HEAD")
	if err != nil {
		return syncOutcome{}, nil, nil, err
	}
	pushOut, pushErr := g.runGit(ctx, token, wt, "push", "origin", "HEAD:refs/heads/main")
	if pushErr != nil {
		return syncOutcome{}, pushOut, pushErr, nil
	}
	// One non-blocking wake after a real successful push, shared by /publish
	// and legacy /sync. No-op, conflict and failed pushes never enter this path.
	g.localBuild.enqueue()
	out := syncOutcome{SHA: strings.TrimSpace(string(shaOut)), SkippedReorders: skippedReorders, CreatedIDs: createdIDs}
	// Reuse the committed worktree and read history only for changed items. A
	// post-push read failure must never turn a successful commit into a failure;
	// clients can fall back to the immutable commit endpoint.
	if committed, err := readItemsFromDir(wt); err == nil {
		changed := make(map[string]RepoFile)
		for id, file := range committed {
			if old, exists := current[id]; !exists || old.Sha != file.Sha || old.Path != file.Path {
				changed[id] = file
			}
		}
		for id := range current {
			if _, exists := committed[id]; !exists {
				out.DeletedIDs = append(out.DeletedIDs, id)
			}
		}
		g.attachItemGitMetadata(ctx, token, wt, changed)
		out.Items = apiItems(changed)
	}
	return out, nil, nil, nil
}

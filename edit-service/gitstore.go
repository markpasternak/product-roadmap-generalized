package main

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"time"
)

const maxPushAttempts = 3

type syncOutcome struct {
	SHA             string
	Errors          []string
	Conflicts       []string
	SkippedReorders []string
}

type ItemGitMetadata struct {
	Created        string `json:"created"`
	Updated        string `json:"updated"`
	CreatedAt      string `json:"createdAt"`
	UpdatedAt      string `json:"updatedAt"`
	CreatedBy      string `json:"createdBy"`
	UpdatedBy      string `json:"updatedBy"`
	CreatedCommit  string `json:"createdCommit"`
	UpdatedCommit  string `json:"updatedCommit"`
	CreatedSubject string `json:"createdSubject"`
	UpdatedSubject string `json:"updatedSubject"`
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
	env := append([]string{}, os.Environ()...)
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
	out, err := g.runGit(ctx, token, wt, "log", "--follow", "--format=%H%x1f%cI%x1f%an%x1f%s", "--", repoPath)
	if err != nil {
		return ItemGitMetadata{}
	}
	records := parseItemGitLog(out)
	if len(records) == 0 {
		return ItemGitMetadata{}
	}

	latest := records[0]
	for _, record := range records {
		patch, err := g.runGit(ctx, token, wt, "show", "--format=", "--unified=0", "--no-ext-diff", record.SHA, "--", repoPath)
		if err != nil || !isOnlyUpdatedFrontmatterPatch(patch) {
			latest = record
			break
		}
	}
	created := records[len(records)-1]
	return ItemGitMetadata{
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
		dst := filepath.Join(root, filepath.FromSlash(repoPath))
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(dst, []byte(f.Content), 0o644); err != nil {
			return err
		}
	}
	for _, p := range del {
		repoPath, err := safeRepoPath(p)
		if err != nil {
			return err
		}
		if err := os.Remove(filepath.Join(root, filepath.FromSlash(repoPath))); err != nil && !os.IsNotExist(err) {
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
	return files, nil
}

func (g *GitHub) syncChangeset(ctx context.Context, cs Changeset, msg, login string) (syncOutcome, error) {
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
	if _, err := g.runGit(ctx, token, wt, "add", "-A", "--", "content/items"); err != nil {
		return syncOutcome{}, nil, nil, err
	}
	status, err := g.runGit(ctx, token, wt, "status", "--porcelain", "--", "content/items")
	if err != nil {
		return syncOutcome{}, nil, nil, err
	}
	if strings.TrimSpace(string(status)) == "" {
		return syncOutcome{SHA: baseSHA, SkippedReorders: skippedReorders}, nil, nil, nil
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
	return syncOutcome{SHA: strings.TrimSpace(string(shaOut)), SkippedReorders: skippedReorders}, nil, nil, nil
}

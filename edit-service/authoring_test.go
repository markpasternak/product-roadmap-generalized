package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func draftRequest(s *Server, method, route, body, login string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, route, strings.NewReader(body))
	if login != "" {
		r.Header.Set("Authorization", "Bearer "+mintSession(s.cfg.SessionSecret, login, time.Now()))
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	return w
}
func TestDraftDurabilityCASAndIsolation(t *testing.T) {
	s := testServer()
	s.cfg.StateDir = t.TempDir()
	s.routes()
	if w := draftRequest(s, "GET", "/api/draft", "", ""); w.Code != 401 {
		t.Fatal(w.Code)
	}
	w := draftRequest(s, "PUT", "/api/draft", `{"revision":0,"data":{"body":"first"}}`, "alice")
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	s2 := testServer()
	s2.cfg = s.cfg
	s2.routes()
	w = draftRequest(s2, "GET", "/api/draft", "", "alice")
	if !strings.Contains(w.Body.String(), `"first"`) {
		t.Fatal("draft did not survive service restart")
	}
	w = draftRequest(s2, "GET", "/api/draft", "", "bob")
	if strings.Contains(w.Body.String(), "first") {
		t.Fatal("draft leaked")
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	codes := map[int]int{}
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := draftRequest(s2, "PUT", "/api/draft", `{"revision":1,"data":{"body":"second"}}`, "alice")
			mu.Lock()
			codes[w.Code]++
			mu.Unlock()
		}()
	}
	wg.Wait()
	if codes[200] != 1 || codes[409] != 1 {
		t.Fatalf("CAS allowed competing writes: %v", codes)
	}
}
func TestUploadRetryOwnershipAndType(t *testing.T) {
	s := testServer()
	s.cfg.StateDir = t.TempDir()
	s.gh = testGitHub(t, permissionHandler(http.StatusOK, `{"permission":"write"}`))
	s.routes()
	route := "/api/uploads?name=notes.txt"
	w := draftRequest(s, "POST", route, "supporting notes", "alice")
	if w.Code != 201 && w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	var first Upload
	if err := json.Unmarshal(w.Body.Bytes(), &first); err != nil {
		t.Fatal(err)
	}
	w = draftRequest(s, "POST", route, "supporting notes", "alice")
	var again Upload
	json.Unmarshal(w.Body.Bytes(), &again)
	if again.ID != first.ID {
		t.Fatal("lost response retry made another upload")
	}
	if w := draftRequest(s, "GET", "/api/uploads/"+first.ID, "", "bob"); w.Code != 404 {
		t.Fatal("other user could read an upload", w.Code)
	}
	if w := draftRequest(s, "DELETE", "/api/uploads/"+first.ID, "", "bob"); w.Code != 404 {
		t.Fatal("other user could remove an upload", w.Code)
	}
	if w := draftRequest(s, "POST", "/api/uploads?name=bad.png", "<script>bad()</script>", "alice"); w.Code != 415 {
		t.Fatal("mismatched type accepted", w.Code)
	}
	if w := draftRequest(s, "DELETE", "/api/uploads/"+first.ID, "", "alice"); w.Code != 204 {
		t.Fatal(w.Code)
	}
}
func TestIndependentEditRebase(t *testing.T) {
	base := cur()
	cs := Changeset{Updated: []ItemEdit{{ID: "TALK-001", Frontmatter: map[string]string{"title": "Mine"}}}, BaseShas: baseShasFor(base, "TALK-001"), BaseContents: map[string]string{"TALK-001": base["TALK-001"].Content}}
	changed := cur()
	rf := changed["TALK-001"]
	rf.Content = strings.Replace(rf.Content, "stage: Building", "stage: Shipped", 1)
	rf.Sha = gitBlobSha([]byte(rf.Content))
	changed["TALK-001"] = rf
	files, _, conflicts, _, errs := BuildFiles(cs, changed)
	if len(conflicts)+len(errs) > 0 || !strings.Contains(files[0].Content, "stage: Shipped") || !strings.Contains(files[0].Content, "title: Mine") {
		t.Fatalf("independent fields not merged: %v %v", conflicts, errs)
	}
	rf.Content = strings.Replace(rf.Content, "title: A", "title: Theirs", 1)
	rf.Sha = gitBlobSha([]byte(rf.Content))
	changed["TALK-001"] = rf
	_, _, conflicts, _, _ = BuildFiles(cs, changed)
	if len(conflicts) != 1 {
		t.Fatal("overlapping edit overwrote latest")
	}
	cs.BaseContents["TALK-001"] = rf.Content
	_, _, conflicts, _, _ = BuildFiles(cs, changed)
	if len(conflicts) != 1 {
		t.Fatal("unauthenticated base content bypassed conflict")
	}
}
func gitTest(t *testing.T, dir string, args ...string) string {
	t.Helper()
	c := exec.Command("git", args...)
	c.Dir = dir
	c.Env = append(os.Environ(), "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null")
	out, err := c.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v %s", args, err, out)
	}
	return strings.TrimSpace(string(out))
}
func stagedText(t *testing.T, cfg Config) Upload {
	t.Helper()
	bytes := []byte("canonical original bytes\n")
	hash := sha256.Sum256(bytes)
	u := Upload{ID: "upl_testing123", Login: "alice", AssetID: "ast_testing123", Name: "Evidence", RepoPath: "content/assets/ast_testing123/rev_testing123/evidence.txt", ExpiresAt: time.Now().Add(time.Hour), Revision: AssetRevision{ID: "rev_testing123", Original: AssetFile{Path: "rev_testing123/evidence.txt", MediaType: "text/plain; charset=utf-8", Bytes: int64(len(bytes)), SHA256: hex.EncodeToString(hash[:])}}}
	u.Revision.Original.MediaType, _ = detectedFileType(bytes, "evidence.txt")
	if err := writeJSONAtomic(filepath.Join(uploadDir(cfg, u.ID), "upload.json"), u); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(uploadDir(cfg, u.ID), "bytes"), bytes, 0600); err != nil {
		t.Fatal(err)
	}
	return u
}
func TestAtomicPublicationAndDurableReceipt(t *testing.T) {
	parent := t.TempDir()
	remote := filepath.Join(parent, "remote.git")
	gitTest(t, parent, "init", "--bare", remote)
	root := filepath.Join(parent, "work")
	gitTest(t, parent, "clone", remote, root)
	gitTest(t, root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--allow-empty", "-m", "Initial")
	gitTest(t, root, "branch", "-M", "main")
	gitTest(t, root, "push", "origin", "main")
	cfg := Config{StateDir: t.TempDir()}
	g := &GitHub{cfg: cfg}
	u := stagedText(t, cfg)
	cs := Changeset{RequestID: "publication-testing123", Created: []ItemNew{{ID: "new-client-123", Product: "Podcasts & Audiobooks", Title: "With an attachment", Frontmatter: map[string]string{"owner": "Alice", "horizon": "Next", "stage": "Discovery", "visibility": "Internal"}, Body: "## Resources\n\n- [Evidence](../../assets/ast_testing123/rev_testing123/evidence.txt)\n"}}, Assets: AssetChanges{Attach: []AssetAttachment{{UploadID: u.ID}}}}
	out, _, pushErr, err := g.applyCommitPush(context.Background(), "", root, cs, "Publish resources", "alice", gitTest(t, root, "rev-parse", "HEAD"))
	if err != nil || pushErr != nil || len(out.Errors) > 0 {
		t.Fatal(err, pushErr, out)
	}
	if out.CreatedIDs["new-client-123"] != "TALK-001" {
		t.Fatal("missing stable create identity", out.CreatedIDs)
	}
	if len(out.Items) != 1 || out.Items[0].ID != "TALK-001" || out.Items[0].Sha == "" || out.Items[0].Git.UpdatedCommit != out.SHA {
		t.Fatal("publication must return the exact committed item and metadata", out.Items)
	}
	tree := gitTest(t, root, "show", "--name-only", "--format=", out.SHA)
	for _, path := range []string{u.RepoPath, assetPath(u.AssetID), publicationPath("alice", cs.RequestID), "content/items/podcasts-audiobooks/TALK-001"} {
		if !strings.Contains(tree, path) {
			t.Fatalf("atomic commit missing %s: %s", path, tree)
		}
	}
	// Pretend every in-memory/disk operation record was lost after the push.
	restarted := &GitHub{cfg: cfg}
	retry, _, _, err := restarted.applyCommitPush(context.Background(), "", root, cs, "Retry", "alice", out.SHA)
	if err != nil || retry.SHA != out.SHA || retry.CreatedIDs["new-client-123"] != "TALK-001" {
		t.Fatal("retry was not recovered from git", retry, err)
	}
	if count := gitTest(t, root, "rev-list", "--count", "HEAD"); count != "2" {
		t.Fatal("retry made a duplicate commit", count)
	}
	cs.Created[0].Title = "Different request"
	if _, _, _, err := restarted.applyCommitPush(context.Background(), "", root, cs, "Retry", "alice", out.SHA); err == nil {
		t.Fatal("same ID accepted different content")
	}
	assets, err := readAssets(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := g.applyAssets(root, AssetChanges{Update: []AssetUpdate{{ID: u.AssetID, BaseSHA: assets[0].SHA, Remove: true}}}, "alice"); err == nil {
		t.Fatal("referenced original was deleted")
	}
}
func TestAssetsFailClosed(t *testing.T) {
	for _, test := range []string{"wrong-owner", "checksum", "public-internal", "missing-file", "symlink"} {
		t.Run(test, func(t *testing.T) {
			cfg := Config{StateDir: t.TempDir()}
			root := t.TempDir()
			g := &GitHub{cfg: cfg}
			u := stagedText(t, cfg)
			login := "alice"
			body := "---\nvisibility: Internal\n---\n[Evidence](../../assets/ast_testing123/rev_testing123/evidence.txt)\n"
			changes := AssetChanges{Attach: []AssetAttachment{{UploadID: u.ID}}}
			switch test {
			case "wrong-owner":
				login = "bob"
			case "checksum":
				os.WriteFile(filepath.Join(uploadDir(cfg, u.ID), "bytes"), []byte("tampered"), 0600)
			case "public-internal":
				body = strings.Replace(body, "Internal", "Public", 1)
			case "missing-file":
				changes.Attach = nil
			case "symlink":
				os.MkdirAll(filepath.Join(root, "content"), 0755)
				os.Symlink(t.TempDir(), filepath.Join(root, "content/assets"))
			}
			if err := writeConfined(root, "content/items/test/TALK-001.md", []byte(body)); err != nil {
				t.Fatal(err)
			}
			if err := g.applyAssets(root, changes, login); err == nil {
				t.Fatal("unsafe assets accepted")
			}
		})
	}
}
func TestItemWritesRejectSymlinks(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	os.MkdirAll(filepath.Join(root, "content/items"), 0755)
	os.Symlink(outside, filepath.Join(root, "content/items/music-app"))
	if err := applyRepoFiles(root, []RepoFile{{Path: "content/items/music-app/test.md", Content: "no"}}, nil); err == nil {
		t.Fatal("write escaped through symlink")
	}
}

func TestAssetReplacementPreservesPinnedOriginalAndDeletionChecksPresentations(t *testing.T) {
	cfg := Config{StateDir: t.TempDir()}
	root := t.TempDir()
	g := &GitHub{cfg: cfg}
	first := stagedText(t, cfg)
	if err := g.applyAssets(root, AssetChanges{Attach: []AssetAttachment{{UploadID: first.ID}}}, "alice"); err != nil {
		t.Fatal(err)
	}
	assets, err := readAssets(root)
	if err != nil {
		t.Fatal(err)
	}
	originalSHA := assets[0].SHA
	second := first
	second.ID = "upl_replacement"
	second.Revision.ID = "rev_replacement"
	second.Revision.Original.Path = "rev_replacement/evidence.txt"
	second.RepoPath = "content/assets/" + second.AssetID + "/" + second.Revision.Original.Path
	if err := writeJSONAtomic(filepath.Join(uploadDir(cfg, second.ID), "upload.json"), second); err != nil {
		t.Fatal(err)
	}
	bytes, _ := os.ReadFile(filepath.Join(uploadDir(cfg, first.ID), "bytes"))
	if err := os.WriteFile(filepath.Join(uploadDir(cfg, second.ID), "bytes"), bytes, 0600); err != nil {
		t.Fatal(err)
	}
	if err := g.applyAssets(root, AssetChanges{Attach: []AssetAttachment{{UploadID: second.ID, BaseSHA: originalSHA}}}, "alice"); err != nil {
		t.Fatal(err)
	}
	assets, err = readAssets(root)
	if err != nil || len(assets[0].Revisions) != 2 {
		t.Fatal("lost pinned revision", err)
	}
	if _, err = os.ReadFile(filepath.Join(root, first.RepoPath)); err != nil {
		t.Fatal("lost original", err)
	}
	if err = writeConfined(root, "presentations/test/index.html", []byte(`<a href="/assets/ast_testing123/rev_testing123/evidence.txt">Evidence</a>`)); err != nil {
		t.Fatal(err)
	}
	remove := AssetChanges{Update: []AssetUpdate{{ID: first.AssetID, BaseSHA: assets[0].SHA, Remove: true}}}
	if err = g.applyAssets(root, remove, "alice"); err == nil {
		t.Fatal("deleted resource used in a presentation")
	}
	os.Remove(filepath.Join(root, "presentations/test/index.html"))
	if err = g.applyAssets(root, remove, "alice"); err != nil {
		t.Fatal("could not delete unused resource", err)
	}
	if _, err = os.Stat(filepath.Join(root, assetPath(first.AssetID))); !os.IsNotExist(err) {
		t.Fatal("asset remains")
	}
}
func TestAssetReferencesIgnoreMarkdownExamples(t *testing.T) {
	path := "../../assets/ast_testing123/rev_testing123/evidence.txt"
	body := "````md\n[example](" + path + ")\n```\n[still example](" + path + ")\n````\n`" + path + "`\n[actual](" + path + ")\n"
	if refs := assetReferences(body); len(refs) != 1 {
		t.Fatal(refs)
	}
}
func TestPublicationClearsAnExistingBody(t *testing.T) {
	current := cur()
	cs := Changeset{Updated: []ItemEdit{{ID: "TALK-001", BodySet: true, Body: ""}}, BaseShas: baseShasFor(current, "TALK-001")}
	files, _, conflicts, _, errs := BuildFiles(cs, current)
	if len(conflicts)+len(errs) > 0 || len(files) != 1 || strings.TrimSpace(ParseDoc(files[0].Content).Body) != "" {
		t.Fatal(files, conflicts, errs)
	}
}

func TestPublishedStagingDoesNotExhaustUploadQuota(t *testing.T) {
	s := testServer()
	s.cfg.StateDir = t.TempDir()
	s.gh = testGitHub(t, permissionHandler(http.StatusOK, `{"permission":"write"}`))
	s.routes()
	old := stagedText(t, s.cfg)
	old.Published = true
	old.Revision.Original.Bytes = maxStagingBytes
	if err := writeJSONAtomic(filepath.Join(uploadDir(s.cfg, old.ID), "upload.json"), old); err != nil {
		t.Fatal(err)
	}
	response := draftRequest(s, "POST", "/api/uploads?name=another.txt", "Another original", "alice")
	if response.Code != 201 {
		t.Fatal(response.Code, response.Body.String())
	}
	if _, err := os.Stat(uploadDir(s.cfg, old.ID)); !os.IsNotExist(err) {
		t.Fatal("published staging was not collected")
	}
}

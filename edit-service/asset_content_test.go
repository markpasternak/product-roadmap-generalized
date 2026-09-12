package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestAssetContentUsesObjectsAndPreservesHTTP(t *testing.T) {
	g, u, fetches := assetRepository(t)
	g.instTok = "test"
	g.instExp = time.Now().Add(time.Hour)
	g.cfg.Repo = "test/assets"
	gitTest(t, g.repoRoot(), "config", "url."+filepath.Join(filepath.Dir(g.repoRoot()), "remote.git")+".insteadOf", g.repoURL())
	s := testServer()
	s.gh = g
	s.routes()
	route := "/api/assets/content?path=" + url.QueryEscape(u.RepoPath)
	for _, method := range []string{"GET", "HEAD"} {
		r := httptest.NewRequest(method, route, nil)
		r.Header.Set("Authorization", "Bearer "+mintSession(s.cfg.SessionSecret, "alice", time.Now()))
		if method == "GET" {
			r.Header.Set("Range", "bytes=0-8")
		}
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		want := 200
		if method == "GET" {
			want = 206
		}
		if w.Code != want || w.Header().Get("Cache-Control") != "private, no-store" || w.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatal(w.Code, w.Header())
		}
		if method == "GET" && w.Body.String() != "canonical" {
			t.Fatal(w.Body.String())
		}
	}
	if fetches.Load() != 1 {
		t.Fatal("content did not use shared snapshot", fetches.Load())
	}
	if _, err := os.Stat(g.worktreeRoot()); !os.IsNotExist(err) {
		t.Fatal("content created worktrees", err)
	}
	for _, bad := range []string{u.RepoPath + "/../evidence.txt", "../secret", "content/assets/ast_x/rev_x/x%2ftxt"} {
		if w := draftRequest(s, "GET", "/api/assets/content?path="+url.QueryEscape(bad), "", "alice"); w.Code != 404 {
			t.Fatal(w.Code)
		}
	}
	if w := draftRequest(s, "GET", route, "", ""); w.Code != 401 || w.Body.Len() > 30 {
		t.Fatal("anonymous image", w.Code)
	}
	if fetches.Load() != 1 {
		t.Fatal("invalid requests performed repository work")
	}
}

func TestAssetContentRejectsInvalidOriginals(t *testing.T) {
	for _, kind := range []string{"checksum", "mime", "missing", "symlink", "manifest-symlink", "manifest", "oversized", "gitlink"} {
		t.Run(kind, func(t *testing.T) {
			g, u, _ := assetRepository(t)
			p := filepath.Join(g.repoRoot(), u.RepoPath)
			switch kind {
			case "checksum":
				os.WriteFile(p, []byte(strings.Repeat("x", int(u.Revision.Original.Bytes))), 0600)
			case "missing":
				os.Remove(p)
			case "symlink":
				os.Remove(p)
				os.Symlink("/etc/passwd", p)
			case "gitlink":
				os.Remove(p)
				head := strings.TrimSpace(gitTest(t, g.repoRoot(), "rev-parse", "HEAD"))
				gitTest(t, g.repoRoot(), "update-index", "--add", "--cacheinfo", "160000,"+head+","+u.RepoPath)
			case "manifest-symlink":
				os.Remove(filepath.Join(g.repoRoot(), assetPath(u.AssetID)))
				os.Symlink("/etc/passwd", filepath.Join(g.repoRoot(), assetPath(u.AssetID)))
			default:
				a := Asset{SchemaVersion: 1, ID: u.AssetID, Name: "Evidence", Visibility: "Internal", Revisions: []AssetRevision{u.Revision}}
				if kind == "mime" {
					a.Revisions[0].Original.MediaType = "image/png"
				}
				if kind == "manifest" {
					a.Revisions[0].Original.Path = "../evidence.txt"
				}
				if kind == "oversized" {
					a.Revisions[0].Original.Bytes = maxUploadBytes + 1
				}
				if err := writeJSONAtomic(filepath.Join(g.repoRoot(), assetPath(u.AssetID)), a); err != nil {
					t.Fatal(err)
				}
			}
			if kind != "gitlink" {
				gitTest(t, g.repoRoot(), "add", "-A")
			}
			gitTest(t, g.repoRoot(), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "Invalid fixture")
			gitTest(t, g.repoRoot(), "push", "origin", "main")
			s := testServer()
			s.gh = g
			s.routes()
			w := draftRequest(s, "GET", "/api/assets/content?path="+url.QueryEscape(u.RepoPath), "", "alice")
			if w.Code != 404 {
				t.Fatal(w.Code, w.Body.String())
			}
		})
	}
}

type blockingAssetWriter struct {
	*httptest.ResponseRecorder
	started chan struct{}
	unblock chan struct{}
	once    sync.Once
}

func (w *blockingAssetWriter) Write(p []byte) (int, error) {
	w.once.Do(func() { close(w.started) })
	<-w.unblock
	return w.ResponseRecorder.Write(p)
}
func TestAssetResponseCapacityIncludesSlowWriters(t *testing.T) {
	g, u, _ := assetRepository(t)
	s := testServer()
	s.gh = g
	s.routes()
	route := "/api/assets/content?path=" + url.QueryEscape(u.RepoPath)
	var wg sync.WaitGroup
	unblock := make(chan struct{})
	for range 4 {
		w := &blockingAssetWriter{ResponseRecorder: httptest.NewRecorder(), started: make(chan struct{}), unblock: unblock}
		wg.Add(1)
		go func() {
			defer wg.Done()
			r := httptest.NewRequest("GET", route, nil)
			r.Header.Set("Authorization", "Bearer "+mintSession(s.cfg.SessionSecret, "alice", time.Now()))
			s.ServeHTTP(w, r)
		}()
		select {
		case <-w.started:
		case <-time.After(3 * time.Second):
			close(unblock)
			wg.Wait()
			t.Fatal("response failed to start")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r := httptest.NewRequest("GET", route, nil).WithContext(ctx)
	r.Header.Set("Authorization", "Bearer "+mintSession(s.cfg.SessionSecret, "alice", time.Now()))
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code == http.StatusOK {
		t.Error("cancelled queued request served bytes")
	}
	if len(g.assetCache().slots) != 4 {
		t.Error("slow responses released capacity early")
	}
	close(unblock)
	wg.Wait()
	if len(g.assetCache().slots) != 0 {
		t.Fatal("capacity leaked")
	}
}

func TestAssetContentProductionFetchColdStartAndTokenFailure(t *testing.T) {
	fixture, u, _ := assetRepository(t)
	remote := filepath.Join(filepath.Dir(fixture.repoRoot()), "remote.git")
	for _, tokenOK := range []bool{true, false} {
		t.Run(map[bool]string{true: "clone", false: "token-failure"}[tokenOK], func(t *testing.T) {
			var tokenRequests int
			g := testGitHub(t, func(w http.ResponseWriter, r *http.Request) {
				tokenRequests++
				if !tokenOK {
					http.Error(w, "unavailable", 503)
					return
				}
				w.WriteHeader(201)
				fmt.Fprintf(w, `{"token":"test","expires_at":%q}`, time.Now().Add(time.Hour).Format(time.RFC3339))
			})
			parent := t.TempDir()
			g.cfg.RepoCacheDir = filepath.Join(parent, "cold-repo")
			config := filepath.Join(parent, ".gitconfig")
			gitTest(t, parent, "config", "--file", config, "url."+remote+".insteadOf", g.repoURL())
			t.Setenv("GIT_CONFIG_GLOBAL", config)
			s := testServer()
			s.gh = g
			s.routes()
			w := draftRequest(s, "GET", "/api/assets/content?path="+url.QueryEscape(u.RepoPath), "", "alice")
			if tokenRequests != 1 {
				t.Fatalf("production token path calls=%d", tokenRequests)
			}
			if !tokenOK {
				if w.Code != 404 || strings.Contains(w.Body.String(), "canonical") {
					t.Fatal("token failure served content", w.Code)
				}
				return
			}
			if w.Code != 200 || w.Body.String() != "canonical original bytes\n" {
				t.Fatal(w.Code, w.Body.String())
			}
			if _, err := os.Stat(filepath.Join(g.repoRoot(), ".git")); err != nil {
				t.Fatal("cold request did not clone", err)
			}
			if _, err := os.Stat(g.worktreeRoot()); !os.IsNotExist(err) {
				t.Fatal("cold request created worktree", err)
			}
		})
	}
}

type deadlineAssetWriter struct {
	*httptest.ResponseRecorder
	deadlines         []time.Time
	wroteWithDeadline bool
}

func (w *deadlineAssetWriter) SetWriteDeadline(deadline time.Time) error {
	w.deadlines = append(w.deadlines, deadline)
	return nil
}
func (w *deadlineAssetWriter) Write(p []byte) (int, error) {
	w.wroteWithDeadline = len(w.deadlines) == 1 && !w.deadlines[0].IsZero()
	return 0, os.ErrDeadlineExceeded
}
func TestAssetWriteDeadlineReleasesResponseCapacity(t *testing.T) {
	g, u, _ := assetRepository(t)
	s := testServer()
	s.gh = g
	s.routes()
	r := httptest.NewRequest("GET", "/api/assets/content?path="+url.QueryEscape(u.RepoPath), nil)
	r.Header.Set("Authorization", "Bearer "+mintSession(s.cfg.SessionSecret, "alice", time.Now()))
	w := &deadlineAssetWriter{ResponseRecorder: httptest.NewRecorder()}
	s.ServeHTTP(w, r)
	if !w.wroteWithDeadline || len(w.deadlines) != 2 || !w.deadlines[1].IsZero() {
		t.Fatal("deadline was not set through write and cleared", w.deadlines)
	}
	if remaining := time.Until(w.deadlines[0]); remaining <= 0 || remaining > assetResponseWriteTimeout {
		t.Fatal("incorrect write deadline", remaining)
	}
	if len(g.assetCache().slots) != 0 || g.assetCache().current.readers != 0 {
		t.Fatal("timeout leaked response capacity or lease")
	}
}

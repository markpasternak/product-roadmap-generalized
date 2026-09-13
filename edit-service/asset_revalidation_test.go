package main

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCommittedRevalidationTracksSnapshotValidity(t *testing.T) {
	for _, mutation := range []string{"removed", "changed", "corrupt", "mime", "refresh-failure"} {
		t.Run(mutation, func(t *testing.T) {
			g, u, _ := assetRepository(t)
			s := testServer()
			s.gh = g
			s.routes()
			route := "/api/assets/content?path=" + url.QueryEscape(u.RepoPath)
			token := mintSession(s.cfg.SessionSecret, "alice", time.Now())
			w := previewRequest(s, "GET", route, token, "")
			if w.Code != 200 {
				t.Fatal(w.Code)
			}
			oldETag := w.Header().Get("ETag")
			a := Asset{SchemaVersion: 1, ID: u.AssetID, Name: u.Name, Visibility: "Internal", Revisions: []AssetRevision{u.Revision}}
			switch mutation {
			case "removed":
				os.Remove(filepath.Join(g.repoRoot(), u.RepoPath))
			case "changed", "corrupt":
				data := []byte(strings.Repeat("x", int(u.Revision.Original.Bytes)))
				os.WriteFile(filepath.Join(g.repoRoot(), u.RepoPath), data, 0600)
				if mutation == "changed" {
					a.Revisions[0].Original.SHA256 = fmt.Sprintf("%x", sha256.Sum256(data))
				}
			case "mime":
				a.Revisions[0].Original.MediaType = "image/png"
			case "refresh-failure":
				g.assetCache().fetch = func(context.Context) error { return fmt.Errorf("offline") }
			}
			if mutation != "refresh-failure" {
				if err := writeJSONAtomic(filepath.Join(g.repoRoot(), assetPath(u.AssetID)), a); err != nil {
					t.Fatal(err)
				}
				gitTest(t, g.repoRoot(), "add", "-A")
				gitTest(t, g.repoRoot(), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "Change original")
				gitTest(t, g.repoRoot(), "push", "origin", "main")
			}
			g.invalidateAssetSnapshots()
			w = previewRequest(s, "GET", route, token, oldETag)
			if mutation == "changed" {
				if w.Code != 200 || w.Header().Get("ETag") == oldETag || w.Body.Len() == 0 {
					t.Fatal("changed bytes not served", w.Code, w.Header())
				}
			} else if w.Code != 404 || w.Header().Get("ETag") != "" || w.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatal("invalidated resource reused", w.Code, w.Header())
			}
		})
	}
}

func TestValidatedCommittedConditionalDoesNotReadBody(t *testing.T) {
	g, u, _ := assetRepository(t)
	s := testServer()
	s.gh = g
	s.routes()
	route := "/api/assets/content?path=" + url.QueryEscape(u.RepoPath)
	token := mintSession(s.cfg.SessionSecret, "alice", time.Now())
	w := previewRequest(s, "GET", route, token, "")
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	// The warm immutable snapshot is leased and validated. Make any accidental
	// subprocess/body read fail; conditional validation must need neither.
	t.Setenv("PATH", t.TempDir())
	w = previewRequest(s, "GET", route, token, w.Header().Get("ETag"))
	if w.Code != 304 || w.Body.Len() != 0 {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestPreviewHTTPPreconditionsAndCORS(t *testing.T) {
	for _, kind := range []string{"committed", "upload"} {
		t.Run(kind, func(t *testing.T) {
			g, u, _ := assetRepository(t)
			s := testServer()
			s.gh = g
			s.cfg.StateDir = g.cfg.StateDir
			s.routes()
			route := "/api/assets/content?path=" + url.QueryEscape(u.RepoPath)
			if kind == "upload" {
				route = "/api/uploads/" + u.ID + "/content"
			}
			token := mintSession(s.cfg.SessionSecret, "alice", time.Now())
			etag := previewRequest(s, "GET", route, token, "").Header().Get("ETag")
			for _, tc := range []struct {
				method, rangeHeader, ifRange, ifMatch, ifNone string
				status                                        int
				body                                          string
			}{
				{"HEAD", "", "", "", "", 200, ""},
				{"HEAD", "", "", "", etag, 304, ""},
				{"GET", "bytes=0-8", etag, "", "", 206, "canonical"},
				{"GET", "bytes=0-8", `"wrong"`, "", "", 200, "canonical original bytes\n"},
				{"GET", "bytes=999-", "", "", "", 416, ""},
				{"GET", "", "", `"wrong"`, etag, 412, ""},
			} {
				r := httptest.NewRequest(tc.method, route, nil)
				r.Header.Set("Authorization", "Bearer "+token)
				r.Header.Set("Range", tc.rangeHeader)
				r.Header.Set("If-Range", tc.ifRange)
				r.Header.Set("If-Match", tc.ifMatch)
				r.Header.Set("If-None-Match", tc.ifNone)
				w := httptest.NewRecorder()
				s.ServeHTTP(w, r)
				if w.Code != tc.status {
					t.Fatalf("%+v: %d %s", tc, w.Code, w.Body.String())
				}
				if tc.status < 400 && w.Body.String() != tc.body {
					t.Fatal(w.Body.String())
				}
				if tc.status >= 400 && (w.Header().Get("ETag") != "" || w.Header().Get("Cache-Control") != "private, no-store") {
					t.Fatal(w.Header())
				}
			}
			r := httptest.NewRequest("OPTIONS", route, nil)
			r.Header.Set("Origin", s.cfg.AllowedOrigin)
			r.Header.Set("Access-Control-Request-Headers", "authorization,if-none-match")
			w := httptest.NewRecorder()
			s.ServeHTTP(w, r)
			if w.Code != 204 || !strings.Contains(w.Header().Get("Access-Control-Allow-Headers"), "If-None-Match") {
				t.Fatal(w.Code, w.Header())
			}
			r.Header.Set("Origin", "https://untrusted.example")
			w = httptest.NewRecorder()
			s.ServeHTTP(w, r)
			if w.Header().Get("Access-Control-Allow-Origin") != "" {
				t.Fatal("CORS widened")
			}
		})
	}
}

func previewRequest(s *Server, method, route, token, etag string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, route, nil)
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	r.Header.Set("If-None-Match", etag)
	r.Header.Set("Origin", s.cfg.AllowedOrigin)
	w := httptest.NewRecorder()
	w.Header().Add("Vary", "Accept-Encoding")
	s.ServeHTTP(w, r)
	return w
}

func assertPreviewHeaders(t *testing.T, w *httptest.ResponseRecorder, etag string) {
	t.Helper()
	if w.Header().Get("ETag") != etag || w.Header().Get("Cache-Control") != "private, no-cache" || w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal(w.Code, w.Header())
	}
	vary := strings.Join(w.Header().Values("Vary"), ", ")
	for _, field := range []string{"Authorization", "Origin", "Accept-Encoding"} {
		if !strings.Contains(vary, field) {
			t.Fatalf("missing Vary %s: %s", field, vary)
		}
	}
	if w.Header().Get("Access-Control-Allow-Origin") != "https://roadmap" {
		t.Fatal("lost CORS", w.Header())
	}
}

func TestPreviewRevalidation(t *testing.T) {
	for _, kind := range []string{"committed", "upload"} {
		t.Run(kind, func(t *testing.T) {
			g, u, _ := assetRepository(t)
			s := testServer()
			s.gh = g
			s.cfg.StateDir = g.cfg.StateDir
			s.routes()
			route := "/api/assets/content?path=" + url.QueryEscape(u.RepoPath)
			if kind == "upload" {
				route = "/api/uploads/" + u.ID + "/content"
			}
			token := mintSession(s.cfg.SessionSecret, "alice", time.Now())
			etag := `"` + u.Revision.Original.SHA256 + `"`
			w := previewRequest(s, "GET", route, token, "")
			if w.Code != 200 || w.Body.String() != "canonical original bytes\n" {
				t.Fatal(w.Code, w.Body.String())
			}
			assertPreviewHeaders(t, w, etag)
			for _, conditional := range []string{etag, "W/" + etag, `"different", ` + etag, "*"} {
				w = previewRequest(s, "GET", route, token, conditional)
				if w.Code != 304 || w.Body.Len() != 0 {
					t.Fatal("not revalidated", conditional, w.Code, w.Body.String())
				}
				assertPreviewHeaders(t, w, etag)
			}
			w = previewRequest(s, "GET", route, token, `"different"`)
			if w.Code != 200 || w.Body.String() != "canonical original bytes\n" {
				t.Fatal(w.Code, w.Body.String())
			}
			for _, bad := range []string{"", "invalid", mintSession(s.cfg.SessionSecret, "alice", time.Now().Add(-8*24*time.Hour))} {
				w = previewRequest(s, "GET", route, bad, etag)
				if w.Code != 401 || w.Header().Get("ETag") != "" || w.Header().Get("Cache-Control") != "private, no-store" || strings.Contains(w.Body.String(), "canonical") {
					t.Fatal("auth bypass", w.Code, w.Header())
				}
			}
			if kind == "upload" {
				w = previewRequest(s, "GET", route, mintSession(s.cfg.SessionSecret, "bob", time.Now()), etag)
				if w.Code != 404 || w.Header().Get("ETag") != "" {
					t.Fatal("owner bypass", w.Code)
				}
			}
		})
	}
}

func TestUploadRevalidationRejectsInvalidResource(t *testing.T) {
	for _, mutation := range []string{"deleted", "missing-bytes", "expired", "corrupt", "mime"} {
		t.Run(mutation, func(t *testing.T) {
			s := testServer()
			s.cfg.StateDir = t.TempDir()
			s.routes()
			u := stagedText(t, s.cfg)
			route := "/api/uploads/" + u.ID + "/content"
			token := mintSession(s.cfg.SessionSecret, "alice", time.Now())
			w := previewRequest(s, "GET", route, token, "")
			if w.Code != 200 {
				t.Fatal(w.Code)
			}
			etag := `"` + u.Revision.Original.SHA256 + `"`
			switch mutation {
			case "deleted":
				os.Remove(filepath.Join(uploadDir(s.cfg, u.ID), "upload.json"))
			case "missing-bytes":
				os.Remove(filepath.Join(uploadDir(s.cfg, u.ID), "bytes"))
			case "expired":
				u.ExpiresAt = time.Now().Add(-time.Second)
				writeJSONAtomic(filepath.Join(uploadDir(s.cfg, u.ID), "upload.json"), u)
			case "mime":
				u.Revision.Original.MediaType = "image/png"
				writeJSONAtomic(filepath.Join(uploadDir(s.cfg, u.ID), "upload.json"), u)
			case "corrupt":
				os.WriteFile(filepath.Join(uploadDir(s.cfg, u.ID), "bytes"), []byte(strings.Repeat("x", int(u.Revision.Original.Bytes))), 0600)
			}
			w = previewRequest(s, "GET", route, token, etag)
			if w.Code != 404 || w.Header().Get("ETag") != "" || w.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatal("invalid resource validated", w.Code, w.Header())
			}
		})
	}
}

func TestUploadChangedBytesHaveNewValidator(t *testing.T) {
	s := testServer()
	s.cfg.StateDir = t.TempDir()
	s.routes()
	u := stagedText(t, s.cfg)
	route := "/api/uploads/" + u.ID + "/content"
	token := mintSession(s.cfg.SessionSecret, "alice", time.Now())
	old := previewRequest(s, "GET", route, token, "")
	if old.Code != 200 {
		t.Fatal(old.Code)
	}
	data := []byte("replacement original bytes\n")
	u.Revision.Original.Bytes = int64(len(data))
	u.Revision.Original.SHA256 = fmt.Sprintf("%x", sha256.Sum256(data))
	if err := os.WriteFile(filepath.Join(uploadDir(s.cfg, u.ID), "bytes"), data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONAtomic(filepath.Join(uploadDir(s.cfg, u.ID), "upload.json"), u); err != nil {
		t.Fatal(err)
	}
	w := previewRequest(s, "GET", route, token, old.Header().Get("ETag"))
	if w.Code != 200 || w.Body.String() != string(data) {
		t.Fatal(w.Code, w.Body.String())
	}
	assertPreviewHeaders(t, w, `"`+u.Revision.Original.SHA256+`"`)
}

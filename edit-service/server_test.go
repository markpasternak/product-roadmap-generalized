package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func testServer() *Server {
	cfg := Config{AllowedOrigin: "https://roadmap", SessionSecret: "s", Repo: "o/r"}
	return &Server{cfg: cfg, gh: nil, mux: http.NewServeMux(), dedup: newSyncDedup(syncDedupTTL, syncDedupMaxEntries)} // routes registered below
}

func TestSyncRequiresSession(t *testing.T) {
	s := testServer()
	s.routes()
	req := httptest.NewRequest("POST", "/api/sync", strings.NewReader(`{}`))
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 without session, got %d", rec.Code)
	}
	// With a valid session but nil gh we won't reach commit; assert we passed the gate (not 401).
	tok := mintSession("s", "octocat", time.Now())
	req2 := httptest.NewRequest("POST", "/api/sync", strings.NewReader(`{"reorder":{}}`))
	req2.Header.Set("Authorization", "Bearer "+tok)
	rec2 := httptest.NewRecorder()
	func() { defer func() { recover() }(); s.ServeHTTP(rec2, req2) }()
	if rec2.Code == http.StatusUnauthorized {
		t.Fatal("valid session should pass the gate")
	}
}

func TestSyncEmptyChangesetReportsNoChangesWithoutTouchingGitHub(t *testing.T) {
	// A changeset with nothing in it (no updates/creates/deletes/reorders)
	// can never produce a write or delete. handleSync must detect this
	// up front and respond {"ok":true,"sha":"","noChanges":true} without
	// ever calling into s.gh (which is nil here — a call would panic).
	s := testServer()
	s.routes()
	tok := mintSession("s", "octocat", time.Now())
	req := httptest.NewRequest("POST", "/api/sync", strings.NewReader(`{"reorder":{}}`))
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, `"noChanges":true`) {
		t.Fatalf("expected noChanges:true in response, got %s", body)
	}
	if !strings.Contains(body, `"sha":""`) {
		t.Fatalf("expected empty sha in response, got %s", body)
	}
}

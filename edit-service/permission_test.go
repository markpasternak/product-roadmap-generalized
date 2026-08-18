package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// permissionHandler serves the installation-token mint plus a canned
// response (status + body) for the collaborator-permission endpoint,
// mirroring commitsHandler in activity_test.go.
func permissionHandler(status int, body string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "/access_tokens"):
			w.WriteHeader(201)
			json.NewEncoder(w).Encode(map[string]any{
				"token": "test-installation-token", "expires_at": time.Now().Add(time.Hour),
			})
		case strings.Contains(r.URL.Path, "/collaborators/"):
			w.WriteHeader(status)
			w.Write([]byte(body))
		default:
			http.Error(w, "unexpected path: "+r.URL.Path, http.StatusNotFound)
		}
	}
}

// TestCollaboratorCanPush_WriteGrantsPush covers U7's "login with push ->
// proceeds": GitHub's "write" permission level is treated as push access.
func TestCollaboratorCanPush_WriteGrantsPush(t *testing.T) {
	gh := testGitHub(t, permissionHandler(http.StatusOK, `{"permission":"write"}`))
	ok, err := gh.collaboratorCanPush(context.Background(), "octocat")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Fatal("expected write permission to grant push")
	}
}

// TestCollaboratorCanPush_AdminGrantsPush: admin is also sufficient.
func TestCollaboratorCanPush_AdminGrantsPush(t *testing.T) {
	gh := testGitHub(t, permissionHandler(http.StatusOK, `{"permission":"admin"}`))
	ok, err := gh.collaboratorCanPush(context.Background(), "octocat")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Fatal("expected admin permission to grant push")
	}
}

// TestCollaboratorCanPush_ReadDeniesPush: read-only is not push access.
func TestCollaboratorCanPush_ReadDeniesPush(t *testing.T) {
	gh := testGitHub(t, permissionHandler(http.StatusOK, `{"permission":"read"}`))
	ok, err := gh.collaboratorCanPush(context.Background(), "octocat")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok {
		t.Fatal("expected read-only permission to deny push")
	}
}

// TestCollaboratorCanPush_RemovedCollaborator_404DeniesNotErrors: a removed
// collaborator (404) is a fail-closed deny, not a transport error — the
// caller should 403, not 502.
func TestCollaboratorCanPush_RemovedCollaborator_404DeniesNotErrors(t *testing.T) {
	gh := testGitHub(t, permissionHandler(http.StatusNotFound, `{"message":"Not Found"}`))
	ok, err := gh.collaboratorCanPush(context.Background(), "octocat")
	if err != nil {
		t.Fatalf("expected a 404 to be a plain deny, not an error: %v", err)
	}
	if ok {
		t.Fatal("expected a removed collaborator (404) to deny push")
	}
}

// TestCollaboratorCanPush_InstallationTokenFailure_ReturnsError: a broken
// installation-token mint (standing in for GitHub being unreachable) must
// surface as an error so the caller can distinguish "GitHub error" (502)
// from a deliberate deny (403) — apiGet's contract otherwise reports a
// non-2xx as a plain false, not an error, so this exercises the one path
// that does return err != nil.
func TestCollaboratorCanPush_InstallationTokenFailure_ReturnsError(t *testing.T) {
	gh := testGitHub(t, func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	})
	_, err := gh.collaboratorCanPush(context.Background(), "octocat")
	if err == nil {
		t.Fatal("expected an installation-token failure to surface as an error (mapped to 502 by the caller)")
	}
}

// TestHandleSync_PermissionDenied_Returns403_NoCommitAttempted covers the
// handleSync integration for a denied permission: the sync must 403 before
// ever reaching listItems (real git), which testGitHub's mocked transport
// can't service.
func TestHandleSync_PermissionDenied_Returns403_NoCommitAttempted(t *testing.T) {
	s := testServer()
	s.gh = testGitHub(t, permissionHandler(http.StatusOK, `{"permission":"read"}`))
	s.routes()

	tok := mintSession("s", "octocat", time.Now())
	req := httptest.NewRequest("POST", "/api/sync", strings.NewReader(`{"updated":[{"id":"TALK-001","frontmatter":{"stage":"Shipped"}}]}`))
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestHandleSync_PermissionCheckTransportError_Returns502: a broken
// permission check (installation token mint fails) surfaces as 502, not a
// silent 403 deny — the caller can distinguish "GitHub is unreachable" from
// "access was actually revoked."
func TestHandleSync_PermissionCheckTransportError_Returns502(t *testing.T) {
	s := testServer()
	s.gh = testGitHub(t, func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	})
	s.routes()

	tok := mintSession("s", "octocat", time.Now())
	req := httptest.NewRequest("POST", "/api/sync", strings.NewReader(`{"updated":[{"id":"TALK-001","frontmatter":{"stage":"Shipped"}}]}`))
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("want 502, got %d: %s", rec.Code, rec.Body.String())
	}
}

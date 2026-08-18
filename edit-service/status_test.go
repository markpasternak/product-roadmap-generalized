package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// deployRunsHandler serves the installation-token mint plus a canned
// response for the deploy.yml workflow-runs listing, mirroring
// commitsHandler in activity_test.go.
func deployRunsHandler(status int, body string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "/access_tokens"):
			w.WriteHeader(201)
			json.NewEncoder(w).Encode(map[string]any{
				"token": "test-installation-token", "expires_at": time.Now().Add(time.Hour),
			})
		case strings.Contains(r.URL.Path, "/actions/workflows/deploy.yml/runs"):
			w.WriteHeader(status)
			w.Write([]byte(body))
		default:
			http.Error(w, "unexpected path: "+r.URL.Path, http.StatusNotFound)
		}
	}
}

func TestHandleStatus_RequiresSession(t *testing.T) {
	s := testServer() // s.gh stays nil — a call into it would panic, proving the gate runs first.
	s.routes()

	req := httptest.NewRequest("GET", "/api/status", nil)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 without session, got %d", rec.Code)
	}
}

// TestHandleStatus_MapsInProgressRun covers the in_progress/headSha mapping.
func TestHandleStatus_MapsInProgressRun(t *testing.T) {
	s := testServer()
	s.gh = testGitHub(t, deployRunsHandler(http.StatusOK, `{"workflow_runs":[
		{"status":"in_progress","conclusion":null,"head_sha":"abc123","html_url":"https://github.com/acme/roadmap/actions/runs/1"}
	]}`))
	s.routes()

	tok := mintSession("s", "octocat", time.Now())
	req := httptest.NewRequest("GET", "/api/status", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var got DeployRun
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("bad json: %v (%s)", err, rec.Body.String())
	}
	if got.Status != "in_progress" || got.HeadSHA != "abc123" || got.HTMLURL != "https://github.com/acme/roadmap/actions/runs/1" {
		t.Fatalf("bad mapping: %+v", got)
	}
}

// TestHandleStatus_MapsSuccessRun covers the success + conclusion mapping.
func TestHandleStatus_MapsSuccessRun(t *testing.T) {
	s := testServer()
	s.gh = testGitHub(t, deployRunsHandler(http.StatusOK, `{"workflow_runs":[
		{"status":"completed","conclusion":"success","head_sha":"deadbeef","html_url":"https://github.com/acme/roadmap/actions/runs/2"}
	]}`))
	s.routes()

	tok := mintSession("s", "octocat", time.Now())
	req := httptest.NewRequest("GET", "/api/status", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	var got DeployRun
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("bad json: %v (%s)", err, rec.Body.String())
	}
	if got.Status != "completed" || got.Conclusion != "success" || got.HeadSHA != "deadbeef" {
		t.Fatalf("bad mapping: %+v", got)
	}
}

// TestHandleStatus_MapsFailureRun covers the failed-build shape the client
// uses to show "Publish didn't build — view run."
func TestHandleStatus_MapsFailureRun(t *testing.T) {
	s := testServer()
	s.gh = testGitHub(t, deployRunsHandler(http.StatusOK, `{"workflow_runs":[
		{"status":"completed","conclusion":"failure","head_sha":"badc0de","html_url":"https://github.com/acme/roadmap/actions/runs/3"}
	]}`))
	s.routes()

	tok := mintSession("s", "octocat", time.Now())
	req := httptest.NewRequest("GET", "/api/status", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	var got DeployRun
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("bad json: %v (%s)", err, rec.Body.String())
	}
	if got.Conclusion != "failure" || got.HTMLURL != "https://github.com/acme/roadmap/actions/runs/3" {
		t.Fatalf("bad mapping: %+v", got)
	}
}

// TestHandleStatus_NoRunsYet_ReturnsZeroValueNotError: a commit touching only
// path-filtered files can produce no run at all — that's a valid "no run
// yet" state, not a server error.
func TestHandleStatus_NoRunsYet_ReturnsZeroValueNotError(t *testing.T) {
	s := testServer()
	s.gh = testGitHub(t, deployRunsHandler(http.StatusOK, `{"workflow_runs":[]}`))
	s.routes()

	tok := mintSession("s", "octocat", time.Now())
	req := httptest.NewRequest("GET", "/api/status", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var got DeployRun
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("bad json: %v (%s)", err, rec.Body.String())
	}
	if got != (DeployRun{}) {
		t.Fatalf("expected a zero-value DeployRun for 'no runs yet', got %+v", got)
	}
}

// TestHandleStatus_GitHubErrorReturns502 mirrors
// TestHandleActivityGitHubErrorReturns502's pattern for the new endpoint.
func TestHandleStatus_GitHubErrorReturns502(t *testing.T) {
	s := testServer()
	s.gh = testGitHub(t, deployRunsHandler(http.StatusInternalServerError, `{"message":"boom"}`))
	s.routes()

	tok := mintSession("s", "octocat", time.Now())
	req := httptest.NewRequest("GET", "/api/status", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("want 502, got %d: %s", rec.Code, rec.Body.String())
	}
}

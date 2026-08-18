package main

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// rewriteTransport redirects requests bound for api.github.com to a local
// httptest server, so listCommits (which hardcodes the GitHub API host) can
// be exercised against a fake server without changing production wiring.
type rewriteTransport struct{ addr string }

func (t *rewriteTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	out := req.Clone(req.Context())
	out.URL.Scheme = "http"
	out.URL.Host = t.addr
	out.Host = t.addr
	return http.DefaultTransport.RoundTrip(out)
}

// testGitHub builds a *GitHub wired to handler in place of api.github.com.
func testGitHub(t *testing.T, handler http.HandlerFunc) *GitHub {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	return &GitHub{
		cfg:   Config{Repo: "acme/roadmap", AppID: "1", InstallationID: "1"},
		key:   key,
		httpc: &http.Client{Transport: &rewriteTransport{addr: strings.TrimPrefix(srv.URL, "http://")}},
	}
}

// commitsHandler serves the installation-token mint plus a canned response
// (status + body) for the commits list endpoint.
func commitsHandler(status int, body string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.Contains(r.URL.Path, "/access_tokens"):
			w.WriteHeader(201)
			json.NewEncoder(w).Encode(map[string]any{
				"token": "test-installation-token", "expires_at": time.Now().Add(time.Hour),
			})
		case strings.HasSuffix(r.URL.Path, "/commits"):
			w.WriteHeader(status)
			w.Write([]byte(body))
		default:
			http.Error(w, "unexpected path: "+r.URL.Path, http.StatusNotFound)
		}
	}
}

const sampleCommitsJSON = `[
  {
    "sha": "abc123",
    "html_url": "https://github.com/acme/roadmap/commit/abc123",
    "commit": {
      "message": "roadmap: 1 updated, 0 created, 0 deleted, 0 reordered (via octocat)",
      "author": {"date": "2026-07-01T12:00:00Z"},
      "committer": {"date": "2026-07-01T12:00:01Z"}
    }
  },
  {
    "sha": "def456",
    "html_url": "https://github.com/acme/roadmap/commit/def456",
    "commit": {
      "message": "roadmap: 0 updated, 1 created, 0 deleted, 0 reordered (via hubot)",
      "author": {"date": ""},
      "committer": {"date": "2026-06-30T09:30:00Z"}
    }
  }
]`

func TestHandleActivityHappyPath(t *testing.T) {
	s := testServer()
	s.gh = testGitHub(t, commitsHandler(http.StatusOK, sampleCommitsJSON))
	s.routes()

	tok := mintSession("s", "octocat", time.Now())
	req := httptest.NewRequest("GET", "/api/activity", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var got []struct {
		SHA     string `json:"sha"`
		HTMLURL string `json:"htmlUrl"`
		Message string `json:"message"`
		Date    string `json:"date"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("bad json: %v (%s)", err, rec.Body.String())
	}
	if len(got) != 2 {
		t.Fatalf("want 2 commits, got %d", len(got))
	}
	if got[0].SHA != "abc123" || got[0].HTMLURL != "https://github.com/acme/roadmap/commit/abc123" ||
		!strings.Contains(got[0].Message, "via octocat") || got[0].Date != "2026-07-01T12:00:00Z" {
		t.Fatalf("bad first commit mapping: %+v", got[0])
	}
	// Falls back to committer date when author date is empty.
	if got[1].SHA != "def456" || got[1].Date != "2026-06-30T09:30:00Z" {
		t.Fatalf("bad second commit mapping (committer-date fallback): %+v", got[1])
	}
}

func TestHandleActivityRequiresSession(t *testing.T) {
	s := testServer() // s.gh stays nil — a call into it would panic, proving the gate runs first.
	s.routes()

	req := httptest.NewRequest("GET", "/api/activity", nil)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401 without session, got %d", rec.Code)
	}
}

func TestHandleActivityGitHubErrorReturns502(t *testing.T) {
	s := testServer()
	s.gh = testGitHub(t, commitsHandler(http.StatusInternalServerError, `{"message":"boom"}`))
	s.routes()

	tok := mintSession("s", "octocat", time.Now())
	req := httptest.NewRequest("GET", "/api/activity", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()

	func() {
		defer func() {
			if r := recover(); r != nil {
				t.Fatalf("handleActivity panicked: %v", r)
			}
		}()
		s.ServeHTTP(rec, req)
	}()

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("want 502, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestHandleActivityEmptyListReturnsEmptyArrayNotNull(t *testing.T) {
	s := testServer()
	s.gh = testGitHub(t, commitsHandler(http.StatusOK, `[]`))
	s.routes()

	tok := mintSession("s", "octocat", time.Now())
	req := httptest.NewRequest("GET", "/api/activity", nil)
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", rec.Code, rec.Body.String())
	}
	body := strings.TrimSpace(rec.Body.String())
	if body != "[]" {
		t.Fatalf("want empty array body, got %q", body)
	}
}

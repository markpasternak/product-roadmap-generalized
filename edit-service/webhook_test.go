package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestGitHubWebhook(t *testing.T) {
	for _, scenario := range []string{"main", "duplicate", "wrong-repo", "branch", "deleted", "ping", "bad-signature", "missing-signature", "missing-secret", "malformed", "too-large"} {
		t.Run(scenario, func(t *testing.T) {
			worker := &localBuildWorker{wake: make(chan time.Time, 1), done: make(chan struct{})}
			s := &Server{cfg: Config{Repo: "example/roadmap", WebhookSecret: "test-webhook-secret"}, gh: &GitHub{localBuild: worker}, mux: http.NewServeMux()}
			s.routes()
			body := `{"ref":"refs/heads/main","deleted":false,"repository":{"full_name":"example/roadmap"},"after":"deliberately-not-a-source-of-authority"}`
			event := "push"
			want := 202
			wake := false
			switch scenario {
			case "main", "duplicate":
				wake = true
			case "wrong-repo":
				body = strings.ReplaceAll(body, "example/roadmap", "other/roadmap")
				want = 403
			case "branch":
				body = strings.ReplaceAll(body, "heads/main", "heads/feature")
			case "deleted":
				body = strings.ReplaceAll(body, "false", "true")
			case "ping":
				event = "ping"
			case "bad-signature", "missing-signature":
				want = 401
			case "missing-secret":
				s.cfg.WebhookSecret = ""
				want = 404
			case "malformed":
				body = "{"
				want = 400
			case "too-large":
				body = strings.Repeat("x", 1024*1024+1)
				want = 413
			}
			hash := hmac.New(sha256.New, []byte("test-webhook-secret"))
			hash.Write([]byte(body))
			signature := "sha256=" + hex.EncodeToString(hash.Sum(nil))
			if scenario == "bad-signature" {
				signature = "sha256=" + strings.Repeat("0", 64)
			}
			if scenario == "missing-signature" {
				signature = ""
			}
			attempts := 1
			if scenario == "duplicate" {
				attempts = 2
			}
			for range attempts {
				r := httptest.NewRequest("POST", "/webhooks/github", strings.NewReader(body))
				r.Header.Set("X-Hub-Signature-256", signature)
				r.Header.Set("X-GitHub-Event", event)
				w := httptest.NewRecorder()
				s.ServeHTTP(w, r)
				if w.Code != want {
					t.Fatalf("status %d want %d", w.Code, want)
				}
				if w.Header().Get("Cache-Control") != "no-store" {
					t.Fatal("webhook responses must not cache")
				}
			}
			if (len(worker.wake) == 1) != wake {
				t.Fatalf("unexpected wake count %d", len(worker.wake))
			}
		})
	}
}

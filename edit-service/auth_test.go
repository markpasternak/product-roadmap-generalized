package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestSession(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	tok := mintSession("secret", "octocat", now)
	if login, ok := verifySession("secret", tok, now.Add(time.Hour)); !ok || login != "octocat" {
		t.Fatalf("valid session rejected: %q %v", login, ok)
	}
	if _, ok := verifySession("secret", tok, now.Add(7*24*time.Hour-time.Second)); !ok {
		t.Fatal("session expired before seven days")
	}
	if _, ok := verifySession("secret", tok, now.Add(7*24*time.Hour)); ok {
		t.Fatal("session accepted at expiry")
	}
	if _, ok := verifySession("secret", tok, now.Add(8*24*time.Hour)); ok {
		t.Fatal("expired session accepted")
	}
	if _, ok := verifySession("secret", tok+"x", now.Add(time.Hour)); ok {
		t.Fatal("tampered session accepted")
	}
	if _, ok := verifySession("other", tok, now.Add(time.Hour)); ok {
		t.Fatal("wrong-secret session accepted")
	}
}

func TestCallbackRejectsBadState(t *testing.T) {
	s := &Server{cfg: Config{AllowedOrigin: "https://roadmap", SessionSecret: "sec"}, mux: http.NewServeMux()}
	s.mux.HandleFunc("GET /auth/callback", s.handleCallback)
	// No state cookie set + a state query value → must reject before any GitHub call (gh is nil).
	req := httptest.NewRequest("GET", "/auth/callback?code=x&state=abc", nil)
	rec := httptest.NewRecorder()
	s.mux.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400 on missing/mismatched state, got %d", rec.Code)
	}
}

package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

func (s *Server) handleGitHubWebhook(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if s.cfg.WebhookSecret == "" {
		http.NotFound(w, r)
		return
	}
	controller := http.NewResponseController(w)
	_ = controller.SetReadDeadline(time.Now().Add(5 * time.Second))
	_ = controller.SetWriteDeadline(time.Now().Add(5 * time.Second))
	b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1024*1024))
	if err != nil {
		http.Error(w, "invalid payload", http.StatusRequestEntityTooLarge)
		return
	}
	signature := r.Header.Get("X-Hub-Signature-256")
	want := hmac.New(sha256.New, []byte(s.cfg.WebhookSecret))
	want.Write(b)
	provided, err := hex.DecodeString(strings.TrimPrefix(signature, "sha256="))
	if err != nil || !strings.HasPrefix(signature, "sha256=") || !hmac.Equal(provided, want.Sum(nil)) {
		http.Error(w, "invalid signature", http.StatusUnauthorized)
		return
	}
	if r.Header.Get("X-GitHub-Event") != "push" {
		w.WriteHeader(http.StatusAccepted)
		return
	}
	var event struct {
		Ref        string `json:"ref"`
		Deleted    bool   `json:"deleted"`
		Repository struct {
			FullName string `json:"full_name"`
		} `json:"repository"`
	}
	if json.Unmarshal(b, &event) != nil {
		http.Error(w, "invalid payload", http.StatusBadRequest)
		return
	}
	if event.Repository.FullName != s.cfg.Repo {
		http.Error(w, "wrong repository", http.StatusForbidden)
		return
	}
	if event.Ref == "refs/heads/main" && !event.Deleted && s.gh != nil {
		s.gh.localBuild.enqueue()
	}
	w.WriteHeader(http.StatusAccepted)
}

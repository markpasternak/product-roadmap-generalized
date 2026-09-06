package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// The service runs as one systemd instance. Atomic records in StateDirectory survive
// process restarts; stateMu serializes compare-and-swap and upload/publish ownership.
func stateKey(parts ...string) string {
	h := sha256.New()
	for _, p := range parts {
		h.Write([]byte(p))
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

func writeJSONAtomic(file string, value any) error {
	if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(file), ".pending-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = json.NewEncoder(f).Encode(value); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = os.Rename(f.Name(), file); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(file))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

func readJSON(file string, target any) error {
	data, err := os.ReadFile(file)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, target)
}

type DraftRecord struct {
	Revision  int64           `json:"revision"`
	Data      json.RawMessage `json:"data"`
	UpdatedAt string          `json:"updatedAt"`
}

func (s *Server) draftFile(login string) string {
	return filepath.Join(s.cfg.StateDir, "drafts", stateKey(s.cfg.Repo, login)+".json")
}

func jsonResponse(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(value)
}

func (s *Server) handleDraft(w http.ResponseWriter, r *http.Request) {
	login := s.session(r)
	if login == "" {
		jsonResponse(w, 401, map[string]string{"error": "Sign in to save your draft."})
		return
	}
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	current := DraftRecord{Data: json.RawMessage(`null`)}
	if err := readJSON(s.draftFile(login), &current); err != nil && !errors.Is(err, os.ErrNotExist) {
		jsonResponse(w, 500, map[string]string{"error": "Could not read your saved draft."})
		return
	}
	if r.Method == "GET" {
		jsonResponse(w, 200, current)
		return
	}
	var next DraftRecord
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&next); err != nil || !json.Valid(next.Data) {
		jsonResponse(w, 400, map[string]string{"error": "Draft is invalid or too large."})
		return
	}
	if next.Revision != current.Revision {
		jsonResponse(w, 409, current)
		return
	}
	next.Revision++
	next.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	if err := writeJSONAtomic(s.draftFile(login), next); err != nil {
		jsonResponse(w, 507, map[string]string{"error": "Could not save your draft. Your local copy is still available."})
		return
	}
	jsonResponse(w, 200, next)
}

func (s *Server) requireWriter(w http.ResponseWriter, r *http.Request) string {
	login := s.session(r)
	if login == "" {
		jsonResponse(w, 401, map[string]string{"error": "Sign in again to continue."})
		return ""
	}
	ok, err := s.gh.collaboratorCanPush(r.Context(), login)
	if err != nil {
		jsonResponse(w, 502, map[string]string{"error": "Could not check editing access. Try again."})
		return ""
	}
	if !ok {
		jsonResponse(w, 403, map[string]string{"error": "You no longer have editing access to this roadmap."})
		return ""
	}
	return login
}

func safeStateID(id string) bool {
	if len(id) < 8 || len(id) > 100 {
		return false
	}
	for _, c := range id {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '_' || c == '-') {
			return false
		}
	}
	return true
}

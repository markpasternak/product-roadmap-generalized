package main

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// syncDedupTTL/syncDedupMaxEntries tune the in-memory idempotency cache
// (R3/KTD3). ~10 min matches the plan; the repo-reconcile-before-commit
// safety net (buildFiles' no-op-write behavior) covers a miss past this
// window or a restart, so this is a fast-path tuning knob, not a
// correctness one — see the Open Questions note in the plan.
const (
	syncDedupTTL        = 10 * time.Minute
	syncDedupMaxEntries = 1000
)

type Server struct {
	cfg       Config
	gh        *GitHub
	mux       *http.ServeMux
	dedup     *syncDedup
	stateMu   sync.Mutex
	publishMu sync.Mutex
}

func NewServer(cfg Config) *Server {
	gh, err := NewGitHub(cfg)
	if err != nil {
		log.Fatal(err)
	}
	s := &Server{cfg: cfg, gh: gh, mux: http.NewServeMux(), dedup: newSyncDedup(syncDedupTTL, syncDedupMaxEntries)}
	s.routes()
	return s
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })
	s.mux.HandleFunc("GET /auth/login", s.handleLogin)
	s.mux.HandleFunc("GET /auth/callback", s.handleCallback)
	s.mux.HandleFunc("GET /api/me", s.handleMe)
	s.mux.HandleFunc("GET /api/items", s.handleItems)
	s.mux.HandleFunc("GET /api/activity", s.handleActivity)
	s.mux.HandleFunc("GET /api/status", s.handleStatus)
	s.mux.HandleFunc("POST /api/sync", s.handleSync)
	s.mux.HandleFunc("GET /api/capabilities", func(w http.ResponseWriter, r *http.Request) {
		jsonResponse(w, 200, map[string]any{"version": version, "drafts": true, "resources": true, "publications": true, "maxUploadBytes": maxUploadBytes})
	})
	s.mux.HandleFunc("GET /api/draft", s.handleDraft)
	s.mux.HandleFunc("PUT /api/draft", s.handleDraft)
	s.mux.HandleFunc("POST /api/uploads", s.handleUpload)
	s.mux.HandleFunc("GET /api/uploads/{id}", s.handleUploadStatus)
	s.mux.HandleFunc("GET /api/uploads/{id}/content", s.handleUploadContent)
	s.mux.HandleFunc("DELETE /api/uploads/{id}", s.handleUploadDelete)
	s.mux.HandleFunc("GET /api/assets", s.handleAssets)
	s.mux.HandleFunc("GET /api/assets/content", s.handleAssetContent)
	s.mux.HandleFunc("POST /api/publish", s.handlePublish)
	s.mux.HandleFunc("GET /api/publications/{id}", s.handlePublication)
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Origin") == s.cfg.AllowedOrigin {
		w.Header().Set("Access-Control-Allow-Origin", s.cfg.AllowedOrigin)
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, Idempotency-Key")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
	}
	if r.Method == "OPTIONS" {
		w.WriteHeader(204)
		return
	}
	s.mux.ServeHTTP(w, r)
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	nonce, err := randHex(16)
	if err != nil {
		http.Error(w, "server error", http.StatusInternalServerError)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: "rme_oauth_state", Value: nonce, Path: "/auth", MaxAge: 600,
		HttpOnly: true, Secure: true, SameSite: http.SameSiteLaxMode,
	})
	u := "https://github.com/login/oauth/authorize?client_id=" + s.cfg.ClientID +
		"&redirect_uri=" + url.QueryEscape(s.cfg.APIOrigin+"/auth/callback") +
		"&state=" + nonce
	http.Redirect(w, r, u, http.StatusFound)
}

func (s *Server) handleCallback(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("rme_oauth_state")
	state := r.URL.Query().Get("state")
	if err != nil || state == "" || subtle.ConstantTimeCompare([]byte(c.Value), []byte(state)) != 1 {
		http.Error(w, "invalid oauth state", http.StatusBadRequest)
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "rme_oauth_state", Path: "/auth", MaxAge: -1}) // clear one-time state
	dest := s.cfg.AllowedOrigin                                                         // token is only ever delivered to the single allowed origin
	tok, err := s.gh.exchangeCode(r.Context(), r.URL.Query().Get("code"))
	if err != nil {
		http.Error(w, "oauth failed", http.StatusBadRequest)
		return
	}
	login, ok, err := s.gh.userCanPush(r.Context(), tok)
	if err != nil {
		http.Error(w, "github error", http.StatusBadGateway)
		return
	}
	if !ok {
		http.Redirect(w, r, dest+"#roadmap_edit=denied", http.StatusFound)
		return
	}
	session := mintSession(s.cfg.SessionSecret, login, time.Now())
	http.Redirect(w, r, dest+"#roadmap_edit_token="+url.QueryEscape(session), http.StatusFound)
}

func randHex(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// session extracts the bearer session login, or "" if unauthenticated.
func (s *Server) session(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return ""
	}
	login, ok := verifySession(s.cfg.SessionSecret, strings.TrimPrefix(h, "Bearer "), time.Now())
	if !ok {
		return ""
	}
	return login
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	login := s.session(r)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"editor": login != "", "login": login})
}

func (s *Server) handleItems(w http.ResponseWriter, r *http.Request) {
	if s.session(r) == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var files map[string]RepoFile
	var err error
	if at := r.URL.Query().Get("at"); at != "" {
		files, err = s.gh.itemsAt(r.Context(), at)
	} else {
		files, err = s.gh.listItems(r.Context())
	}
	if err != nil {
		log.Printf("/api/items: list items failed: %v", err)
		http.Error(w, "github error", http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(apiItems(files))
}

func (s *Server) handleActivity(w http.ResponseWriter, r *http.Request) {
	if s.session(r) == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	commits, err := s.gh.listCommits(r.Context(), "content/items", 30)
	if err != nil {
		log.Printf("/api/activity: list commits failed: %v", err)
		http.Error(w, "github error", http.StatusBadGateway)
		return
	}
	// ActivityCommit (github.go) already has the exact json shape the client expects;
	// encode it directly rather than copying into a local twin struct. listCommits
	// itself always returns a non-nil (possibly empty) slice, but default to an empty
	// slice here too so the response is always `[]`, never `null`.
	if commits == nil {
		commits = []ActivityCommit{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(commits)
}

// handleStatus reports the latest deploy.yml run on main (KTD4/R4/R5). It's
// session-gated exactly like handleItems/handleActivity — without that gate
// it would be an unauthenticated proxy over the App token, leaking Actions
// run internals to anyone. It always returns the LATEST run (re-fetched
// here, never a pinned run id): superseded/no-run/live interpretation is a
// client-side concern (KTD4), this endpoint just reports the raw mapping.
func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if s.session(r) == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	// Live-version proof is independent of Actions visibility or retention.
	commit, deployed := r.URL.Query().Get("commit"), r.URL.Query().Get("deployed")
	if gitSHA.MatchString(commit) && gitSHA.MatchString(deployed) {
		live := commit == deployed
		if !live {
			live, _ = s.gh.containsCommit(r.Context(), commit, deployed)
		}
		if live {
			jsonResponse(w, 200, DeployRun{Status: "completed", Conclusion: "success", HeadSHA: deployed, IncludesCommit: true, Live: true})
			return
		}
	}
	run, err := s.gh.latestDeployRun(r.Context())
	if err == nil && r.URL.Query().Get("commit") != "" {
		run.IncludesCommit, err = s.gh.containsCommit(r.Context(), r.URL.Query().Get("commit"), run.HeadSHA)
	}
	if err != nil {
		log.Printf("/api/status: latest deploy run failed: %v", err)
		http.Error(w, "github error", http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(run)
}

// syncResponse renders a successful sync/no-op result, optionally caching it
// under (login, requestId) so a retried request (lost response, R3/KTD3)
// gets this exact result back instead of re-committing.
func (s *Server) syncResponse(w http.ResponseWriter, login, requestID string, result syncCacheResult, cache bool) {
	if cache {
		s.dedup.put(login, requestID, result)
	}
	resp := map[string]any{"ok": true, "sha": result.SHA}
	if result.NoChanges {
		resp["noChanges"] = true
	}
	if len(result.SkippedReorders) != 0 {
		resp["skippedReorders"] = result.SkippedReorders
	}
	json.NewEncoder(w).Encode(resp)
}

func (s *Server) handleSync(w http.ResponseWriter, r *http.Request) {
	login := s.session(r)
	if login == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var cs Changeset
	if err := json.NewDecoder(r.Body).Decode(&cs); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	w.Header().Set("Content-Type", "application/json")

	// Idempotency fast path (R3/KTD3): a retried request carrying the same
	// (login, requestId) gets the cached result back, no re-commit. Only a
	// fast path — see syncDedup's doc comment for the repo-state safety net
	// that covers a cache miss (TTL expiry / restart).
	if cached, ok := s.dedup.get(login, cs.RequestID); ok {
		s.syncResponse(w, login, cs.RequestID, cached, false)
		return
	}

	// Count reordered items so a reorder-only sync doesn't read as "0 updated, 0 created,
	// 0 deleted" — reorders DO change files (they rewrite each item's `order`).
	reordered := 0
	for _, lanes := range cs.Reorder {
		for _, ids := range lanes {
			reordered += len(ids)
		}
	}
	// A changeset with nothing at all in it can never produce a write or a
	// delete; skip the round-trip to GitHub entirely (including the
	// permission recheck below — nothing is being published).
	if len(cs.Updated) == 0 && len(cs.Created) == 0 && len(cs.DeletedIDs) == 0 && reordered == 0 {
		s.syncResponse(w, login, cs.RequestID, syncCacheResult{NoChanges: true}, true)
		return
	}

	// Live permission recheck (R8/KTD6): the signed session only proves who
	// logged in, not that their push access hasn't since been revoked.
	// Fail-closed — a GitHub-side denial (including a 404 for a removed
	// collaborator) is 403; a transport/request error is 502, distinct from
	// a deliberate deny.
	canPush, err := s.gh.collaboratorCanPush(r.Context(), login)
	if err != nil {
		log.Printf("/api/sync: permission check failed: %v", err)
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "errors": []string{"permission check failed"}})
		return
	}
	if !canPush {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "errors": []string{"you no longer have push access to this repo"}})
		return
	}

	// Pre-check against the current repo state so we know, before committing,
	// which ids actually change (buildFiles skips no-op writes) and whether
	// there's anything to commit at all — and run the per-item conflict
	// check (R1/R2/KTD1/KTD2) up front so a stale baseSha is rejected without
	// ever reaching a commit attempt. syncChangeset re-runs the same
	// computation against a freshly fetched worktree right before it
	// commits, so this is a preview for validation/messaging/fast-rejection,
	// not the sole source of truth for what gets pushed.
	current, err := s.gh.listItems(r.Context())
	if err != nil {
		log.Printf("/api/sync: list items failed: %v", err)
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "errors": []string{err.Error()}})
		return
	}
	_, _, changedIDs, deletedIDs, conflicts, skippedReorders, errs := buildFiles(cs, current)
	if len(conflicts) != 0 {
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "conflict": conflicts})
		return
	}
	if len(errs) != 0 {
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "errors": errs})
		return
	}
	if len(changedIDs) == 0 && len(deletedIDs) == 0 {
		s.syncResponse(w, login, cs.RequestID, syncCacheResult{NoChanges: true, SkippedReorders: skippedReorders}, true)
		return
	}
	msg := commitMessage(len(cs.Updated), len(cs.Created), len(cs.DeletedIDs), reordered, login, changedIDs, deletedIDs)
	out, err := s.gh.syncChangeset(r.Context(), cs, msg, login)
	if len(out.Conflicts) != 0 {
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "conflict": out.Conflicts})
		return
	}
	if len(out.Errors) != 0 {
		w.WriteHeader(http.StatusUnprocessableEntity)
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "errors": out.Errors})
		return
	}
	if err != nil {
		log.Printf("/api/sync: sync failed: %v", err)
		w.WriteHeader(http.StatusBadGateway)
		json.NewEncoder(w).Encode(map[string]any{"ok": false, "errors": []string{err.Error()}})
		return
	}
	s.syncResponse(w, login, cs.RequestID, syncCacheResult{SHA: out.SHA, SkippedReorders: out.SkippedReorders}, true)
}

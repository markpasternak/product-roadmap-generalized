package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var gitSHA = regexp.MustCompile(`^[a-f0-9]{40}$`)

func (g *GitHub) containsCommit(ctx context.Context, ancestor, descendant string) (bool, error) {
	if !gitSHA.MatchString(ancestor) || !gitSHA.MatchString(descendant) {
		return false, nil
	}
	ok := false
	err := g.withRepository(ctx, func(root string) error {
		token, err := g.installationToken(ctx)
		if err != nil {
			return err
		}
		_, err = g.runGit(ctx, token, root, "merge-base", "--is-ancestor", ancestor, descendant)
		ok = err == nil
		return nil
	})
	return ok, err
}
func (g *GitHub) itemsAt(ctx context.Context, sha string) (map[string]RepoFile, error) {
	if !gitSHA.MatchString(sha) {
		return nil, fmt.Errorf("invalid commit")
	}
	if files, ok := g.cachedItems(sha); ok {
		return files, nil
	}
	var files map[string]RepoFile
	err := g.withRepository(ctx, func(root string) error {
		token, err := g.installationToken(ctx)
		if err != nil {
			return err
		}
		if _, err = g.runGit(ctx, token, root, "merge-base", "--is-ancestor", sha, "HEAD"); err != nil {
			return fmt.Errorf("commit is not part of this roadmap")
		}
		if _, err = g.runGit(ctx, token, root, "checkout", "--detach", sha); err != nil {
			return err
		}
		files, err = readItemsFromDir(root)
		if err == nil {
			g.attachItemGitMetadata(ctx, token, root, files)
		}
		return err
	})
	if err == nil {
		g.cacheItems(sha, files)
	}
	return files, err
}

type PublicationReceipt struct {
	RequestID   string            `json:"requestId"`
	Actor       string            `json:"actor"`
	Digest      string            `json:"digest"`
	CreatedIDs  map[string]string `json:"createdIds"`
	CommittedAt string            `json:"committedAt"`
}
type PublicationResult struct {
	Items           []APIItem         `json:"items"`
	DeletedIDs      []string          `json:"deletedIds,omitempty"`
	OK              bool              `json:"ok"`
	SHA             string            `json:"sha"`
	NoChanges       bool              `json:"noChanges,omitempty"`
	CreatedIDs      map[string]string `json:"createdIds,omitempty"`
	Errors          []string          `json:"errors,omitempty"`
	Conflict        []string          `json:"conflict,omitempty"`
	SkippedReorders []string          `json:"skippedReorders,omitempty"`
	State           string            `json:"state,omitempty"`
}

func publicationPath(login, id string) string {
	return ".roadmap/publications/" + stateKey(login, id) + ".json"
}
func payloadDigest(cs Changeset) string {
	b, _ := json.Marshal(cs)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

// Only rebase independent changes. The caller's original content must authenticate
// against its original blob SHA. Concurrent changes to the same field/body stay conflicts.
func mergeIndependentEdits(cs Changeset, current map[string]RepoFile) Changeset {
	shas := map[string]string{}
	for id, sha := range cs.BaseShas {
		shas[id] = sha
	}
	cs.BaseShas = shas
	for _, edit := range cs.Updated {
		cur, exists := current[edit.ID]
		base, hasBase := cs.BaseContents[edit.ID]
		if !exists || !hasBase || gitBlobSha([]byte(base)) != cs.BaseShas[edit.ID] || cur.Sha == cs.BaseShas[edit.ID] {
			continue
		}
		oldDoc, newDoc := ParseDoc(base), ParseDoc(cur.Content)
		conflict := false
		for k, mine := range edit.Frontmatter {
			if newDoc.FM[k] != oldDoc.FM[k] && newDoc.FM[k] != mine {
				conflict = true
			}
		}
		if (edit.BodySet || edit.Body != "") && newDoc.Body != oldDoc.Body && newDoc.Body != edit.Body {
			conflict = true
		}
		if !conflict {
			cs.BaseShas[edit.ID] = cur.Sha
		}
	}
	return cs
}

func createdIdentityMap(cs Changeset, current map[string]RepoFile) (map[string]string, error) {
	perProduct := map[string][]string{}
	for id, rf := range current {
		p := ParseDoc(rf.Content).FM["product"]
		perProduct[p] = append(perProduct[p], id)
	}
	out := map[string]string{}
	for _, n := range cs.Created {
		id, err := NextID(n.Product, perProduct[n.Product])
		if err != nil {
			return nil, err
		}
		perProduct[n.Product] = append(perProduct[n.Product], id)
		if n.ID != "" {
			if _, exists := out[n.ID]; exists {
				return nil, fmt.Errorf("duplicate draft item identity")
			}
			out[n.ID] = id
		}
	}
	return out, nil
}

func (g *GitHub) existingPublication(ctx context.Context, token, root, login string, cs Changeset) (syncOutcome, bool, error) {
	if cs.RequestID == "" {
		return syncOutcome{}, false, nil
	}
	p := publicationPath(login, cs.RequestID)
	file, err := confinedPath(root, p)
	if err != nil {
		return syncOutcome{}, false, err
	}
	var receipt PublicationReceipt
	if err = readJSON(file, &receipt); errors.Is(err, os.ErrNotExist) {
		return syncOutcome{}, false, nil
	} else if err != nil {
		return syncOutcome{}, false, err
	}
	if receipt.Actor != login || receipt.Digest != payloadDigest(cs) {
		return syncOutcome{}, false, fmt.Errorf("this publication ID belongs to different changes; check its result before publishing again")
	}
	sha, err := g.runGit(ctx, token, root, "log", "-1", "--format=%H", "--", p)
	return syncOutcome{SHA: strings.TrimSpace(string(sha)), CreatedIDs: receipt.CreatedIDs}, true, err
}

func (s *Server) handlePublish(w http.ResponseWriter, r *http.Request) {
	login := s.requireWriter(w, r)
	if login == "" {
		return
	}
	var cs Changeset
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<20)).Decode(&cs); err != nil || len(cs.RequestID) < 8 || len(cs.RequestID) > 128 {
		jsonResponse(w, 400, PublicationResult{Errors: []string{"A valid publication ID and changeset are required."}})
		return
	}
	// A disconnected browser must not cancel an accepted commit halfway through push.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 2*time.Minute)
	defer cancel()
	s.publishMu.Lock()
	defer s.publishMu.Unlock()
	operationFile := filepath.Join(s.cfg.StateDir, "publications", stateKey(s.cfg.Repo, login, cs.RequestID)+".json")
	if err := writeJSONAtomic(operationFile, PublicationResult{State: "publishing"}); err != nil {
		jsonResponse(w, 507, PublicationResult{Errors: []string{"Could not start a recoverable publication. Try again."}})
		return
	}
	msg := fmt.Sprintf("Update roadmap by %s\n\nRoadmap-Publication: %s", cleanGitIdent(login), cs.RequestID)
	out, err := s.gh.syncChangeset(ctx, cs, msg, login)
	res := PublicationResult{OK: err == nil && len(out.Errors) == 0 && len(out.Conflicts) == 0, SHA: out.SHA, CreatedIDs: out.CreatedIDs, Errors: out.Errors, Conflict: out.Conflicts, SkippedReorders: out.SkippedReorders, NoChanges: out.NoChanges}
	res.Items, res.DeletedIDs = out.Items, out.DeletedIDs
	status := 200
	if err != nil {
		res.Errors = []string{"Could not confirm publication. Check status or retry these same changes."}
		res.State = "unconfirmed"
		status = 502
	} else if len(out.Conflicts) > 0 {
		res.State = "conflict"
		status = 409
	} else if len(out.Errors) > 0 {
		res.State = "invalid"
		status = 422
	} else {
		res.State = "committed"
	}
	_ = writeJSONAtomic(operationFile, res)
	if res.OK {
		for _, claim := range cs.Assets.Attach {
			if u, err := loadUpload(s.cfg, claim.UploadID, login); err == nil {
				u.Published = true
				_ = writeJSONAtomic(filepath.Join(uploadDir(s.cfg, u.ID), "upload.json"), u)
			}
		}
	}
	jsonResponse(w, status, res)
}

func (s *Server) handlePublication(w http.ResponseWriter, r *http.Request) {
	login := s.session(r)
	if login == "" {
		jsonResponse(w, 401, map[string]string{"error": "Sign in again."})
		return
	}
	id := r.PathValue("id")
	if len(id) < 8 || len(id) > 128 {
		http.NotFound(w, r)
		return
	}
	var result PublicationResult
	_ = readJSON(filepath.Join(s.cfg.StateDir, "publications", stateKey(s.cfg.Repo, login, id)+".json"), &result)
	if result.OK {
		jsonResponse(w, 200, result)
		return
	}
	err := s.gh.withRepository(r.Context(), func(root string) error {
		var receipt PublicationReceipt
		p := publicationPath(login, id)
		if err := readJSON(filepath.Join(root, p), &receipt); err != nil {
			return err
		}
		token, err := s.gh.installationToken(r.Context())
		if err != nil {
			return err
		}
		sha, err := s.gh.runGit(r.Context(), token, root, "log", "-1", "--format=%H", "--", p)
		result = PublicationResult{OK: true, SHA: strings.TrimSpace(string(sha)), CreatedIDs: receipt.CreatedIDs, State: "committed"}
		return err
	})
	if err == nil {
		jsonResponse(w, 200, result)
		return
	}
	if !errors.Is(err, os.ErrNotExist) {
		jsonResponse(w, 502, map[string]string{"error": "Publication status is unavailable. Your draft is still saved."})
		return
	}
	if result.State != "" {
		jsonResponse(w, 200, result)
		return
	}
	jsonResponse(w, 404, map[string]string{"error": "No completed publication found. Retrying with the same ID is safe."})
}

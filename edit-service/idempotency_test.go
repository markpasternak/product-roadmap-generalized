package main

import (
	"testing"
	"time"
)

// TestSyncDedup_SameRequestID_ReturnsCachedResult covers R3: a second get for
// the same (login, requestId) after a put returns the cached result without
// the caller needing to re-commit.
func TestSyncDedup_SameRequestID_ReturnsCachedResult(t *testing.T) {
	d := newSyncDedup(10*time.Minute, 1000)
	d.put("octocat", "req-1", syncCacheResult{SHA: "abc123"})

	got, ok := d.get("octocat", "req-1")
	if !ok {
		t.Fatal("expected a cache hit for the same (login, requestId)")
	}
	if got.SHA != "abc123" {
		t.Fatalf("expected the cached sha, got %+v", got)
	}
}

// TestSyncDedup_DifferentRequestID_Miss: a different requestId (same login)
// is a distinct key — never returns another request's result.
func TestSyncDedup_DifferentRequestID_Miss(t *testing.T) {
	d := newSyncDedup(10*time.Minute, 1000)
	d.put("octocat", "req-1", syncCacheResult{SHA: "abc123"})

	if _, ok := d.get("octocat", "req-2"); ok {
		t.Fatal("expected a miss for a different requestId")
	}
}

// TestSyncDedup_DifferentLogin_Miss: the cache key includes login, so two
// different users can't collide on the same requestId.
func TestSyncDedup_DifferentLogin_Miss(t *testing.T) {
	d := newSyncDedup(10*time.Minute, 1000)
	d.put("octocat", "req-1", syncCacheResult{SHA: "abc123"})

	if _, ok := d.get("hubot", "req-1"); ok {
		t.Fatal("expected a miss for a different login with the same requestId")
	}
}

// TestSyncDedup_EmptyRequestID_NeverCachesOrHits: an empty requestId disables
// dedup entirely — it must never be cached and never returned as a hit.
func TestSyncDedup_EmptyRequestID_NeverCachesOrHits(t *testing.T) {
	d := newSyncDedup(10*time.Minute, 1000)
	d.put("octocat", "", syncCacheResult{SHA: "abc123"})

	if _, ok := d.get("octocat", ""); ok {
		t.Fatal("expected an empty requestId to never hit the cache")
	}
}

// TestSyncDedup_TTLExpiry_Miss: past the TTL, a cached entry is gone — the
// server falls back to the repo-state safety net (buildFiles' no-op
// behavior) rather than serving a stale cached sha.
func TestSyncDedup_TTLExpiry_Miss(t *testing.T) {
	now := time.Date(2026, 7, 7, 12, 0, 0, 0, time.UTC)
	d := newSyncDedup(10*time.Minute, 1000)
	d.now = func() time.Time { return now }
	d.put("octocat", "req-1", syncCacheResult{SHA: "abc123"})

	// Still within the TTL.
	if _, ok := d.get("octocat", "req-1"); !ok {
		t.Fatal("expected a hit just before TTL expiry")
	}

	// Past the TTL.
	d.now = func() time.Time { return now.Add(10*time.Minute + time.Second) }
	if _, ok := d.get("octocat", "req-1"); ok {
		t.Fatal("expected a miss past the TTL")
	}
}

// TestSyncDedup_MaxEntriesCap_EvictsOldest: the cache is bounded — once at
// the cap, a new put evicts the entry closest to expiring rather than
// growing unbounded.
func TestSyncDedup_MaxEntriesCap_EvictsOldest(t *testing.T) {
	now := time.Date(2026, 7, 7, 12, 0, 0, 0, time.UTC)
	d := newSyncDedup(10*time.Minute, 2)
	d.now = func() time.Time { return now }
	d.put("octocat", "req-1", syncCacheResult{SHA: "first"}) // expires at now+10m
	d.now = func() time.Time { return now.Add(time.Minute) }
	d.put("octocat", "req-2", syncCacheResult{SHA: "second"}) // expires at now+11m

	// At the cap (2 entries); the next put must evict the oldest-expiring
	// entry (req-1) to make room.
	d.now = func() time.Time { return now.Add(2 * time.Minute) }
	d.put("octocat", "req-3", syncCacheResult{SHA: "third"})

	if _, ok := d.get("octocat", "req-1"); ok {
		t.Fatal("expected req-1 (oldest-expiring) to be evicted at the cap")
	}
	if _, ok := d.get("octocat", "req-2"); !ok {
		t.Fatal("expected req-2 to survive")
	}
	if _, ok := d.get("octocat", "req-3"); !ok {
		t.Fatal("expected req-3 (just inserted) to be present")
	}
}

// TestBuildFiles_RetryOfAlreadyLandedUpdate_IsNoOp is the U3 "safety net"
// verification: buildFiles run again with the SAME update changeset,
// against a `current` that already reflects that update having landed
// (simulating a TTL-expired or post-restart dedup-cache miss on a retried
// request), yields zero writes/deletes — a safe no-op, not a duplicate
// write. This is what makes a dedup-cache miss survivable for
// updates/deletes.
func TestBuildFiles_RetryOfAlreadyLandedUpdate_IsNoOp(t *testing.T) {
	landed := cur() // TALK-001's stage is already "Shipped" in this variant below
	doc := ParseDoc(landed["TALK-001"].Content)
	doc.Set("stage", "Shipped")
	rendered := doc.Render()
	landed["TALK-001"] = RepoFile{Path: landed["TALK-001"].Path, Content: rendered, Sha: gitBlobSha([]byte(rendered))}

	cs := Changeset{
		Updated:  []ItemEdit{{ID: "TALK-001", Frontmatter: map[string]string{"stage": "Shipped"}}},
		BaseShas: baseShasFor(landed, "TALK-001"), // the retry captures the NOW-current sha, same as a real client re-fetch would
	}
	write, del, changedIDs, deletedIDs, conflicts, _, errs := buildFiles(cs, landed)
	if len(conflicts) != 0 || len(errs) != 0 {
		t.Fatalf("unexpected conflicts=%v errs=%v", conflicts, errs)
	}
	if len(write) != 0 || len(del) != 0 || len(changedIDs) != 0 || len(deletedIDs) != 0 {
		t.Fatalf("expected a retried already-landed update to be a no-op, got write=%v del=%v changedIDs=%v deletedIDs=%v",
			write, del, changedIDs, deletedIDs)
	}
}

// TestBuildFiles_RetryOfAlreadyLandedDelete_IsNoOp mirrors the above for a
// delete: retrying a delete whose target is already gone from current must
// not error or duplicate anything destructive — it's simply not found, so
// nothing is deleted again. (Note: with a baseSha supplied, an already-gone
// target is caught by the fail-closed conflict check instead of silently
// no-op'ing — see the note below on why that's the right tradeoff here, and
// conflict_test.go's DeleteOfNonexistentID case for that path.)
func TestBuildFiles_RetryOfAlreadyLandedDelete_ConflictsRatherThanSilentlyNoOps(t *testing.T) {
	// current no longer has TALK-002 (the first attempt's delete already landed).
	landed := cur()
	delete(landed, "TALK-002")
	cs := Changeset{
		DeletedIDs: []string{"TALK-002"},
		BaseShas:   map[string]string{"TALK-002": gitBlobSha([]byte(cur()["TALK-002"].Content))}, // the client's stale base
	}
	_, _, _, _, conflicts, _, _ := buildFiles(cs, landed)
	// This is intentional, not a gap: an already-landed delete looks
	// identical, from the server's point of view, to "someone else deleted
	// it out from under you" — both present as "target no longer exists."
	// Surfacing it as a conflict (reload-and-resync) is safe; silently
	// treating it as a no-op would mask the latter case.
	if len(conflicts) != 1 || conflicts[0] != "TALK-002" {
		t.Fatalf("expected a retried delete of an already-gone target to surface as a conflict, got %v", conflicts)
	}
}

// TestBuildFiles_RetryOfCreate_ProducesADifferentDuplicateItem is a
// DOCUMENTED GAP, not a passing safety-net test: unlike updates/deletes, a
// retried CREATE is NOT idempotent via buildFiles' no-op detection. NextID
// always assigns the next free sequential id from `current`, so if the
// dedup cache misses (TTL expiry / restart) on a retry of an already-landed
// create, the retry lands against a `current` that now includes the first
// create's item and assigns a NEW id — a genuine duplicate item with
// different ids but the same content, not a no-op. KTD3's "buildFiles
// already yields no-op writes when the changeset landed" claim holds for
// updates/deletes/reorders but not creates; flagging this explicitly rather
// than silently relying on it.
func TestBuildFiles_RetryOfCreate_ProducesADifferentDuplicateItem(t *testing.T) {
	empty := map[string]RepoFile{}
	create := ItemNew{Product: "Music App", Title: "New Thing", Frontmatter: map[string]string{"horizon": "Next", "stage": "Discovery", "owner": "Y"}}

	// First attempt: lands as MUSIC-001.
	write1, _, _, _, _, _, errs1 := buildFiles(Changeset{Created: []ItemNew{create}}, empty)
	if len(errs1) != 0 || len(write1) != 1 {
		t.Fatalf("setup: first create failed, errs=%v write=%v", errs1, write1)
	}
	firstID := ParseDoc(write1[0].Content).FM["id"]

	// Simulate the first attempt having landed: current now contains it.
	landed := map[string]RepoFile{firstID: write1[0]}

	// Retry of the SAME create changeset (e.g. a dedup-cache miss after the
	// original response was lost) against the post-landing state.
	write2, _, _, _, _, _, errs2 := buildFiles(Changeset{Created: []ItemNew{create}}, landed)
	if len(errs2) != 0 || len(write2) != 1 {
		t.Fatalf("retry: unexpected errs=%v write=%v", errs2, write2)
	}
	secondID := ParseDoc(write2[0].Content).FM["id"]

	if secondID == firstID {
		t.Fatalf("if this ever fails, buildFiles has started deduping creates by content — update KTD3's " +
			"documentation and the U3 report to say creates ARE covered by the safety net")
	}
	// This assertion documents the gap: two items, same content, different
	// ids — a real duplicate, confirming creates need the dedup CACHE
	// (not just the repo-state safety net) to avoid duplication on retry.
}

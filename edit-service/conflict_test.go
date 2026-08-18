package main

import (
	"os/exec"
	"strings"
	"testing"
)

// TestGitBlobSha_MatchesGitHashObject pins gitBlobSha to the real `git
// hash-object` algorithm (KTD1) — if this ever drifts, the conflict check
// would compare against the wrong signal for every real repo file.
func TestGitBlobSha_MatchesGitHashObject(t *testing.T) {
	content := []byte("---\nid: TALK-001\ntitle: A\nproduct: Podcasts & Audiobooks\nhorizon: Now\nstage: Building\nowner: X\n---\nbody A\n")
	cmd := exec.Command("git", "hash-object", "--stdin")
	cmd.Stdin = strings.NewReader(string(content))
	out, err := cmd.Output()
	if err != nil {
		t.Skipf("git hash-object unavailable: %v", err)
	}
	want := strings.TrimSpace(string(out))
	got := gitBlobSha(content)
	if got != want {
		t.Fatalf("gitBlobSha mismatch: got %s want %s (git hash-object)", got, want)
	}
}

// TestCheckConflicts_MatchingBaseSha_NoConflict covers R1: a changeset whose
// baseSha matches the current file's blob sha passes the check cleanly.
func TestCheckConflicts_MatchingBaseSha_NoConflict(t *testing.T) {
	current := cur()
	cs := Changeset{
		Updated:  []ItemEdit{{ID: "TALK-001", Frontmatter: map[string]string{"stage": "Shipped"}}},
		BaseShas: baseShasFor(current, "TALK-001"),
	}
	if got := checkConflicts(cs, current); len(got) != 0 {
		t.Fatalf("expected no conflicts for a matching baseSha, got %v", got)
	}
}

// TestCheckConflicts_StaleBaseSha_ConflictsNamingItem covers R2: a stale
// baseSha is named as a conflict.
func TestCheckConflicts_StaleBaseSha_ConflictsNamingItem(t *testing.T) {
	current := cur()
	cs := Changeset{
		Updated:  []ItemEdit{{ID: "TALK-001", Frontmatter: map[string]string{"stage": "Shipped"}}},
		BaseShas: map[string]string{"TALK-001": "0000000000000000000000000000000000000000"},
	}
	got := checkConflicts(cs, current)
	if len(got) != 1 || got[0] != "TALK-001" {
		t.Fatalf("expected conflict naming TALK-001, got %v", got)
	}
}

// TestCheckConflicts_UpdateMissingBaseSha_FailsClosed covers the fail-closed
// requirement: an update with no baseSha at all is a conflict, not "no
// check."
func TestCheckConflicts_UpdateMissingBaseSha_FailsClosed(t *testing.T) {
	current := cur()
	cs := Changeset{
		Updated: []ItemEdit{{ID: "TALK-001", Frontmatter: map[string]string{"stage": "Shipped"}}},
		// No BaseShas at all.
	}
	got := checkConflicts(cs, current)
	if len(got) != 1 || got[0] != "TALK-001" {
		t.Fatalf("expected a missing-baseSha update to be a fail-closed conflict, got %v", got)
	}
}

// TestCheckConflicts_DeleteMissingBaseSha_FailsClosed mirrors the above for a
// delete: fail-closed applies to deletes too, not just updates.
func TestCheckConflicts_DeleteMissingBaseSha_FailsClosed(t *testing.T) {
	current := cur()
	cs := Changeset{DeletedIDs: []string{"TALK-002"}} // no BaseShas
	got := checkConflicts(cs, current)
	if len(got) != 1 || got[0] != "TALK-002" {
		t.Fatalf("expected a missing-baseSha delete to be a fail-closed conflict, got %v", got)
	}
}

// TestCheckConflicts_DeleteStaleBaseSha_Conflicts covers "a delete of an item
// whose base drifted → conflict."
func TestCheckConflicts_DeleteStaleBaseSha_Conflicts(t *testing.T) {
	current := cur()
	cs := Changeset{
		DeletedIDs: []string{"TALK-002"},
		BaseShas:   map[string]string{"TALK-002": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"},
	}
	got := checkConflicts(cs, current)
	if len(got) != 1 || got[0] != "TALK-002" {
		t.Fatalf("expected conflict naming TALK-002, got %v", got)
	}
}

// TestCheckConflicts_DeleteOfNonexistentID_Conflicts: deleting an id that
// isn't in current at all (already gone/never existed upstream) is a
// conflict too — there's no "current" state a baseSha could ever have
// matched, so this can't be silently ignored under fail-closed semantics.
func TestCheckConflicts_DeleteOfNonexistentID_Conflicts(t *testing.T) {
	current := cur()
	cs := Changeset{
		DeletedIDs: []string{"TALK-999"},
		BaseShas:   map[string]string{"TALK-999": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"},
	}
	got := checkConflicts(cs, current)
	if len(got) != 1 || got[0] != "TALK-999" {
		t.Fatalf("expected conflict naming TALK-999 (never existed), got %v", got)
	}
}

// TestCheckConflicts_CreateExempt: a create never appears in
// Updated/DeletedIDs, so it never participates in the conflict check at all
// — only a true create is exempt from baseSha, per R1.
func TestCheckConflicts_CreateExempt(t *testing.T) {
	current := cur()
	cs := Changeset{Created: []ItemNew{{Product: "Music App", Title: "New Thing"}}} // no BaseShas, no Updated/DeletedIDs
	if got := checkConflicts(cs, current); len(got) != 0 {
		t.Fatalf("expected a pure create to be exempt from the conflict check, got %v", got)
	}
}

// TestBuildFiles_StaleBaseSha_RejectsWholeSync_NothingWritten: a stale
// baseSha rejects the entire sync — no partial write, even alongside an
// otherwise-valid create (KTD2, all-or-nothing).
func TestBuildFiles_StaleBaseSha_RejectsWholeSync_NothingWritten(t *testing.T) {
	current := cur()
	cs := Changeset{
		Updated:  []ItemEdit{{ID: "TALK-001", Frontmatter: map[string]string{"stage": "Shipped"}}},
		Created:  []ItemNew{{Product: "Music App", Title: "New Thing", Frontmatter: map[string]string{"horizon": "Next", "stage": "Discovery", "owner": "Y"}}},
		BaseShas: map[string]string{"TALK-001": "0000000000000000000000000000000000000000"},
	}
	write, del, changedIDs, deletedIDs, conflicts, skippedReorders, errs := buildFiles(cs, current)
	if len(conflicts) != 1 || conflicts[0] != "TALK-001" {
		t.Fatalf("expected conflict naming TALK-001, got %v", conflicts)
	}
	if write != nil || del != nil || changedIDs != nil || deletedIDs != nil || skippedReorders != nil || errs != nil {
		t.Fatalf("expected nothing else populated on a conflict, got write=%v del=%v changedIDs=%v deletedIDs=%v skippedReorders=%v errs=%v",
			write, del, changedIDs, deletedIDs, skippedReorders, errs)
	}
}

// TestBuildFiles_ConflictTakesPriorityOverValidation: even if the changed
// field would also fail ValidateFrontmatter, a stale baseSha is reported as
// a conflict, not folded into the generic validation errors — the client
// needs to tell these apart (reload-and-resync vs fix-the-field).
func TestBuildFiles_ConflictTakesPriorityOverValidation(t *testing.T) {
	current := cur()
	cs := Changeset{
		Updated:  []ItemEdit{{ID: "TALK-001", Frontmatter: map[string]string{"horizon": "NotARealHorizon"}}},
		BaseShas: map[string]string{"TALK-001": "0000000000000000000000000000000000000000"},
	}
	_, _, _, _, conflicts, _, errs := buildFiles(cs, current)
	if len(conflicts) != 1 || conflicts[0] != "TALK-001" {
		t.Fatalf("expected conflict naming TALK-001, got %v", conflicts)
	}
	if len(errs) != 0 {
		t.Fatalf("expected no validation errors alongside a conflict, got %v", errs)
	}
}

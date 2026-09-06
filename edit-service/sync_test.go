package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func cur() map[string]RepoFile {
	m := map[string]RepoFile{
		"TALK-001": {Path: "content/items/podcasts-audiobooks/TALK-001-a.md", Content: "---\nid: TALK-001\ntitle: A\nproduct: Podcasts & Audiobooks\nhorizon: Now\nstage: Building\nowner: X\norder: 1\n---\nbody A\n"},
		"TALK-002": {Path: "content/items/podcasts-audiobooks/TALK-002-b.md", Content: "---\nid: TALK-002\ntitle: B\nproduct: Podcasts & Audiobooks\nhorizon: Now\nstage: Building\nowner: X\norder: 2\n---\nbody B\n"},
	}
	for id, rf := range m {
		rf.Sha = gitBlobSha([]byte(rf.Content))
		m[id] = rf
	}
	return m
}

// baseShasFor captures c's current blob sha for each given id, for populating
// Changeset.BaseShas in tests below. Every Updated/DeletedIDs entry needs one
// now that a missing baseSha is itself a conflict (fail-closed, U1/R1) —
// these tests predate the per-item conflict check and are exercising other
// behavior (no-op detection, validation, reorder, ...), so they carry a
// matching baseSha to opt out of the conflict path rather than trip it.
func baseShasFor(c map[string]RepoFile, ids ...string) map[string]string {
	m := map[string]string{}
	for _, id := range ids {
		m[id] = c[id].Sha
	}
	return m
}

func TestBuildFiles_UpdateAndReorder(t *testing.T) {
	cs := Changeset{
		Updated:  []ItemEdit{{ID: "TALK-001", Frontmatter: map[string]string{"stage": "Shipped"}}},
		Reorder:  map[string]map[string][]string{"Podcasts & Audiobooks": {"Now": {"TALK-002", "TALK-001"}}},
		BaseShas: baseShasFor(cur(), "TALK-001"),
	}
	write, del, _, _, errs := BuildFiles(cs, cur())
	if len(errs) != 0 {
		t.Fatalf("unexpected errors: %v", errs)
	}
	if len(del) != 0 {
		t.Fatalf("no deletes expected")
	}
	got := map[string]string{}
	for _, f := range write {
		got[f.Path] = ParseDoc(f.Content).FM["order"] + "/" + ParseDoc(f.Content).FM["stage"]
	}
	if got["content/items/podcasts-audiobooks/TALK-002-b.md"] != "1/Building" {
		t.Fatalf("TALK-002 order wrong: %v", got)
	}
	if got["content/items/podcasts-audiobooks/TALK-001-a.md"] != "2/Shipped" {
		t.Fatalf("TALK-001 wrong: %v", got)
	}
}

// TestBuildFiles_ReorderSkipsUnplaceableID_DoesNotAbort covers U8/R9: a
// reorder that references an id which moved out of the lane's product (or
// was deleted upstream) no longer aborts the whole sync — it's skipped and
// named in skippedReorders, while the rest of the reorder still applies.
func TestBuildFiles_ReorderSkipsUnplaceableID_DoesNotAbort(t *testing.T) {
	current := cur()
	cs := Changeset{
		Reorder: map[string]map[string][]string{
			"Podcasts & Audiobooks": {"Now": {"TALK-999", "TALK-002", "TALK-001"}}, // TALK-999 doesn't exist
		},
	}
	write, del, _, _, conflicts, skippedReorders, errs := buildFiles(cs, current)
	if len(conflicts) != 0 {
		t.Fatalf("unexpected conflicts: %v", conflicts)
	}
	if len(errs) != 0 {
		t.Fatalf("expected the sync to succeed despite the stale reorder id, got errs: %v", errs)
	}
	if len(del) != 0 {
		t.Fatalf("expected no deletes, got %v", del)
	}
	if len(skippedReorders) != 1 || skippedReorders[0] != "TALK-999" {
		t.Fatalf("expected skippedReorders to name TALK-999, got %v", skippedReorders)
	}
	got := map[string]string{}
	for _, f := range write {
		got[f.Path] = ParseDoc(f.Content).FM["order"]
	}
	// TALK-999 is skipped; TALK-002 and TALK-001 are renumbered 1..N over the gap.
	if got["content/items/podcasts-audiobooks/TALK-002-b.md"] != "1" {
		t.Fatalf("expected TALK-002 order 1, got %v", got)
	}
	if got["content/items/podcasts-audiobooks/TALK-001-a.md"] != "2" {
		t.Fatalf("expected TALK-001 order 2, got %v", got)
	}
}

// TestBuildFiles_ReorderMismatchedProduct_Skipped: a reorder id that exists
// but belongs to a different product than the lane it's listed under is
// treated the same as "unplaceable" — skipped, not an abort.
func TestBuildFiles_ReorderMismatchedProduct_Skipped(t *testing.T) {
	current := cur() // both TALK-001/TALK-002 are "Podcasts & Audiobooks"
	cs := Changeset{
		Reorder: map[string]map[string][]string{
			"Music App": {"Now": {"TALK-001"}}, // TALK-001 isn't a Music App item
		},
	}
	_, _, _, _, conflicts, skippedReorders, errs := buildFiles(cs, current)
	if len(conflicts) != 0 {
		t.Fatalf("unexpected conflicts: %v", conflicts)
	}
	if len(errs) != 0 {
		t.Fatalf("expected no abort for a mismatched-product reorder id, got errs: %v", errs)
	}
	if len(skippedReorders) != 1 || skippedReorders[0] != "TALK-001" {
		t.Fatalf("expected skippedReorders to name TALK-001, got %v", skippedReorders)
	}
}

// TestBuildFiles_FullyValidReorder_EmptySkippedList: a fully-valid reorder
// applies normally with an empty skipped list.
func TestBuildFiles_FullyValidReorder_EmptySkippedList(t *testing.T) {
	current := cur()
	cs := Changeset{
		Reorder: map[string]map[string][]string{"Podcasts & Audiobooks": {"Now": {"TALK-002", "TALK-001"}}},
	}
	_, _, _, _, conflicts, skippedReorders, errs := buildFiles(cs, current)
	if len(conflicts) != 0 {
		t.Fatalf("unexpected conflicts: %v", conflicts)
	}
	if len(errs) != 0 {
		t.Fatalf("unexpected errors: %v", errs)
	}
	if len(skippedReorders) != 0 {
		t.Fatalf("expected an empty skipped list for a fully-valid reorder, got %v", skippedReorders)
	}
}

func TestBuildFiles_Create(t *testing.T) {
	cs := Changeset{Created: []ItemNew{{Product: "Music App", Title: "New Thing", Frontmatter: map[string]string{"horizon": "Next", "stage": "Discovery", "owner": "Y"}, Body: "# New Thing\n"}}}
	write, _, _, _, errs := BuildFiles(cs, map[string]RepoFile{})
	if len(errs) != 0 {
		t.Fatalf("errs: %v", errs)
	}
	if len(write) != 1 || write[0].Path != "content/items/music-app/MUSIC-001-new-thing.md" {
		t.Fatalf("bad create path: %+v", write)
	}
}

func TestBuildFiles_Create_MinimalDefaultsStageAndOwner(t *testing.T) {
	cs := Changeset{Created: []ItemNew{{Product: "Music App", Title: "New Thing", Frontmatter: map[string]string{"horizon": "Next"}}}}
	write, _, _, _, errs := BuildFiles(cs, map[string]RepoFile{})
	if len(errs) != 0 {
		t.Fatalf("errs: %v", errs)
	}
	if len(write) != 1 {
		t.Fatalf("expected 1 file written, got %+v", write)
	}
	fm := ParseDoc(write[0].Content).FM
	if fm["stage"] != "Discovery" {
		t.Fatalf("expected default stage Discovery, got %q", fm["stage"])
	}
	if fm["owner"] != "Unassigned" {
		t.Fatalf("expected default owner Unassigned, got %q", fm["owner"])
	}
	if e := ValidateFrontmatter(fm, write[0].Path); len(e) != 0 {
		t.Fatalf("written frontmatter should validate, got errs: %v", e)
	}
}

func TestBuildFiles_ValidationBlocks(t *testing.T) {
	cs := Changeset{
		Updated:  []ItemEdit{{ID: "TALK-001", Frontmatter: map[string]string{"horizon": "Whenever"}}},
		BaseShas: baseShasFor(cur(), "TALK-001"),
	}
	_, _, _, _, errs := BuildFiles(cs, cur())
	if len(errs) == 0 {
		t.Fatal("expected validation error for bad horizon")
	}
}

func TestBuildFiles_NoOpUpdate_SkipsWrite(t *testing.T) {
	// stage is already "Building" for TALK-001 in cur() — setting it to the
	// same value must not produce a write, or an empty/misleading commit
	// would result.
	cs := Changeset{
		Updated:  []ItemEdit{{ID: "TALK-001", Frontmatter: map[string]string{"stage": "Building"}}},
		BaseShas: baseShasFor(cur(), "TALK-001"),
	}
	write, del, _, _, errs := BuildFiles(cs, cur())
	if len(errs) != 0 {
		t.Fatalf("unexpected errors: %v", errs)
	}
	if len(write) != 0 {
		t.Fatalf("expected 0 writes for a no-op update, got %+v", write)
	}
	if len(del) != 0 {
		t.Fatalf("expected 0 deletes, got %v", del)
	}
}

func TestBuildFiles_ChangedThenRevertedInSameBatch_SkipsWrite(t *testing.T) {
	// Two edits to the same id in one changeset: the first changes stage,
	// the second reverts it back to the original value. The *final*
	// rendered content (against the real cur() baseline) is what matters,
	// not the intermediate value, so this must still be a no-op.
	cs := Changeset{
		Updated: []ItemEdit{
			{ID: "TALK-001", Frontmatter: map[string]string{"stage": "Shipped"}},
			{ID: "TALK-001", Frontmatter: map[string]string{"stage": "Building"}},
		},
		BaseShas: baseShasFor(cur(), "TALK-001"),
	}
	write, del, _, _, errs := BuildFiles(cs, cur())
	if len(errs) != 0 {
		t.Fatalf("unexpected errors: %v", errs)
	}
	if len(write) != 0 {
		t.Fatalf("expected 0 writes for a within-batch revert, got %+v", write)
	}
	if len(del) != 0 {
		t.Fatalf("expected 0 deletes, got %v", del)
	}
}

func TestBuildFiles_RealChange_Writes(t *testing.T) {
	cs := Changeset{
		Updated:  []ItemEdit{{ID: "TALK-001", Frontmatter: map[string]string{"stage": "Shipped"}}},
		BaseShas: baseShasFor(cur(), "TALK-001"),
	}
	write, del, _, _, errs := BuildFiles(cs, cur())
	if len(errs) != 0 {
		t.Fatalf("unexpected errors: %v", errs)
	}
	if len(write) != 1 || write[0].Path != "content/items/podcasts-audiobooks/TALK-001-a.md" {
		t.Fatalf("expected 1 write for the changed item, got %+v", write)
	}
	if len(del) != 0 {
		t.Fatalf("expected 0 deletes, got %v", del)
	}
}

func TestBuildFilesInternal_ChangedAndDeletedIDs(t *testing.T) {
	// TALK-003 (never existed in cur()) is deliberately NOT included in
	// DeletedIDs here: deleting a nonexistent id is now a conflict under the
	// fail-closed check (U1/R1), not a silently-ignored no-op — see
	// conflict_test.go for that scenario.
	current := cur()
	cs := Changeset{
		Updated:    []ItemEdit{{ID: "TALK-001", Frontmatter: map[string]string{"stage": "Shipped"}}, {ID: "TALK-002", Frontmatter: map[string]string{"stage": "Building"}}}, // TALK-002 is a no-op
		DeletedIDs: []string{"TALK-002"},
		BaseShas:   baseShasFor(current, "TALK-001", "TALK-002"),
	}
	write, del, changedIDs, deletedIDs, conflicts, _, errs := buildFiles(cs, current)
	if len(conflicts) != 0 {
		t.Fatalf("unexpected conflicts: %v", conflicts)
	}
	if len(errs) != 0 {
		t.Fatalf("unexpected errors: %v", errs)
	}
	// TALK-002 is both a no-op update and a delete target; deletes win (it's
	// excluded from touched-and-not-deleted), so only TALK-001 is a real write.
	if len(write) != 1 || len(changedIDs) != 1 || changedIDs[0] != "TALK-001" {
		t.Fatalf("expected only TALK-001 as a changed id, got write=%+v changedIDs=%v", write, changedIDs)
	}
	if len(del) != 1 || len(deletedIDs) != 1 || deletedIDs[0] != "TALK-002" {
		t.Fatalf("expected only TALK-002 as a deleted id, got del=%v deletedIDs=%v", del, deletedIDs)
	}
}

func TestBuildFilesInternal_NoChanges_ZeroWritesZeroDeletes(t *testing.T) {
	// No DeletedIDs here: deleting a nonexistent id (e.g. "TALK-999") is now a
	// conflict under the fail-closed check (U1/R1), not a silently-ignored
	// no-op — see conflict_test.go for that scenario. This test now covers
	// purely the no-op-update case.
	current := cur()
	cs := Changeset{
		Updated:  []ItemEdit{{ID: "TALK-001", Frontmatter: map[string]string{"stage": "Building"}}}, // no-op
		BaseShas: baseShasFor(current, "TALK-001"),
	}
	write, del, changedIDs, deletedIDs, conflicts, _, errs := buildFiles(cs, current)
	if len(conflicts) != 0 {
		t.Fatalf("unexpected conflicts: %v", conflicts)
	}
	if len(errs) != 0 {
		t.Fatalf("unexpected errors: %v", errs)
	}
	if len(write) != 0 || len(del) != 0 || len(changedIDs) != 0 || len(deletedIDs) != 0 {
		t.Fatalf("expected a fully no-op changeset to yield nothing, got write=%v del=%v changedIDs=%v deletedIDs=%v",
			write, del, changedIDs, deletedIDs)
	}
}

func TestBuildFiles_ValidationRunsEvenWhenUnchanged(t *testing.T) {
	// Setting horizon to its own (already-invalid, hypothetically) current
	// value must still surface a validation error rather than being
	// silently skipped as a no-op. Simulate this by seeding a current doc
	// whose horizon is already invalid, then "updating" it to that same
	// invalid value.
	badContent := "---\nid: TALK-001\ntitle: A\nproduct: Podcasts & Audiobooks\nhorizon: Whenever\nstage: Building\nowner: X\norder: 1\n---\nbody A\n"
	badCurrent := map[string]RepoFile{
		"TALK-001": {
			Path:    "content/items/podcasts-audiobooks/TALK-001-a.md",
			Content: badContent,
			Sha:     gitBlobSha([]byte(badContent)),
		},
	}
	cs := Changeset{
		Updated:  []ItemEdit{{ID: "TALK-001", Frontmatter: map[string]string{"horizon": "Whenever"}}},
		BaseShas: baseShasFor(badCurrent, "TALK-001"),
	}
	_, _, _, _, errs := BuildFiles(cs, badCurrent)
	if len(errs) == 0 {
		t.Fatal("expected validation error to survive even though the edit is a no-op")
	}
}

func TestCommitMessage_NamesChangedAndDeletedIDs(t *testing.T) {
	msg := commitMessage(1, 0, 1, 4, "markpasternak",
		[]string{"TALK-013", "ARTISTS-001", "ARTISTS-002", "ARTISTS-003", "ARTISTS-004"}, []string{"STU-007"})
	want := "roadmap: 1 updated, 0 created, 1 deleted, 4 reordered (via markpasternak)\n\n" +
		"Changed: TALK-013, ARTISTS-001, ARTISTS-002, ARTISTS-003, ARTISTS-004\n" +
		"Deleted: STU-007\n" +
		"Co-authored-by: markpasternak <markpasternak@users.noreply.github.com>"
	if msg != want {
		t.Fatalf("commit message mismatch:\ngot:  %q\nwant: %q", msg, want)
	}
}

func TestCommitMessage_CapsLongIDList(t *testing.T) {
	ids := make([]string, 12)
	for i := range ids {
		ids[i] = fmt.Sprintf("TALK-%03d", i+1)
	}
	msg := commitMessage(12, 0, 0, 0, "octocat", ids, nil)
	if !strings.Contains(msg, "+2 more") {
		t.Fatalf("expected capped id list with '+2 more', got: %s", msg)
	}
	if strings.Contains(msg, "TALK-011") || strings.Contains(msg, "TALK-012") {
		t.Fatalf("expected only the first 10 ids to be listed, got: %s", msg)
	}
}

func TestCommitMessage_NoChangedOrDeleted_OmitsLines(t *testing.T) {
	msg := commitMessage(0, 0, 0, 0, "octocat", nil, nil)
	if strings.Contains(msg, "Changed:") || strings.Contains(msg, "Deleted:") {
		t.Fatalf("expected no Changed/Deleted lines when nothing changed, got: %s", msg)
	}
}

func TestTreeEntries(t *testing.T) {
	e := treeEntries([]RepoFile{{Path: "a.md", Content: "hi"}}, []string{"b.md"})
	w, _ := json.Marshal(e[0])
	if strings.Contains(string(w), "sha") {
		t.Fatalf("write entry must not carry sha: %s", w)
	}
	if !strings.Contains(string(w), `"content":"hi"`) {
		t.Fatalf("write entry must carry content: %s", w)
	}
	d, _ := json.Marshal(e[1])
	if !strings.Contains(string(d), `"sha":null`) {
		t.Fatalf("delete entry must carry sha:null: %s", d)
	}
	if strings.Contains(string(d), "content") {
		t.Fatalf("delete entry must not carry content: %s", d)
	}
}

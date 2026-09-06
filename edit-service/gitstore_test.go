package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
)

func TestSafeRepoPath(t *testing.T) {
	ok, err := safeRepoPath("content/items/music-app/MUSIC-001-test.md")
	if err != nil {
		t.Fatal(err)
	}
	if ok != "content/items/music-app/MUSIC-001-test.md" {
		t.Fatalf("bad clean path: %s", ok)
	}
	for _, p := range []string{
		"../secret.md",
		"/content/items/music-app/X.md",
		"content/docs/x.md",
		"content/items/music-app/not-markdown.txt",
	} {
		if _, err := safeRepoPath(p); err == nil {
			t.Fatalf("expected unsafe path error for %q", p)
		}
	}
}

func TestApplyAndReadRepoFiles(t *testing.T) {
	root := t.TempDir()
	file := RepoFile{
		Path: "content/items/music-app/MUSIC-001-test.md",
		Content: "---\n" +
			"id: MUSIC-001\n" +
			"title: Test\n" +
			"product: Music App\n" +
			"horizon: Now\n" +
			"stage: Building\n" +
			"owner: Mark\n" +
			"---\n" +
			"# Body\n",
	}
	if err := applyRepoFiles(root, []RepoFile{file}, nil); err != nil {
		t.Fatal(err)
	}
	got, err := readItemsFromDir(root)
	if err != nil {
		t.Fatal(err)
	}
	if got["MUSIC-001"].Path != file.Path || got["MUSIC-001"].Content != file.Content {
		t.Fatalf("bad readback: %+v", got["MUSIC-001"])
	}
	if err := applyRepoFiles(root, nil, []string{file.Path}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(file.Path))); !os.IsNotExist(err) {
		t.Fatalf("expected file deleted, err=%v", err)
	}
}

func TestIsOnlyUpdatedFrontmatterPatch(t *testing.T) {
	patch := []byte(`diff --git a/content/items/music-app/MUSIC-001-test.md b/content/items/music-app/MUSIC-001-test.md
index abc..def 100644
--- a/content/items/music-app/MUSIC-001-test.md
+++ b/content/items/music-app/MUSIC-001-test.md
@@ -8 +8,0 @@
-updated: 2026-07-08
`)
	if !isOnlyUpdatedFrontmatterPatch(patch) {
		t.Fatalf("expected updated-only patch to be ignored")
	}

	contentPatch := []byte(`@@ -8 +8,2 @@
-updated: 2026-07-08
+title: Changed
`)
	if isOnlyUpdatedFrontmatterPatch(contentPatch) {
		t.Fatalf("expected content patch not to be ignored")
	}
}

func TestReadItemsFromDirMissingItemsDir(t *testing.T) {
	got, err := readItemsFromDir(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("expected empty item map, got %+v", got)
	}
}

func TestItemActivityFollowsRenamesAndSkipsMaintenance(t *testing.T) {
	root := t.TempDir()
	run := func(date string, args ...string) {
		t.Helper()
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		cmd.Env = append(os.Environ(), "GIT_AUTHOR_NAME=Tester", "GIT_AUTHOR_EMAIL=test@example.com", "GIT_COMMITTER_NAME=Tester", "GIT_COMMITTER_EMAIL=test@example.com", "GIT_AUTHOR_DATE="+date, "GIT_COMMITTER_DATE="+date)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git: %s %v", out, err)
		}
	}
	run("2026-07-01T12:00:00Z", "init", "-q")
	write := func(body string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, "old.md"), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	commit := func(date, message string) { run(date, "add", "-A"); run(date, "commit", "-qm", message) }
	write("title: First\nupdated: 2026-07-01\n")
	commit("2026-07-01T12:00:00Z", "Create")
	write("title: Improved\nupdated: 2026-08-04\n")
	commit("2026-08-04T12:00:00Z", "Improve")
	write("title: Improved\nupdated: 2026-09-05\n")
	commit("2026-09-05T12:00:00Z", "Date only")
	run("2026-09-06T12:00:00Z", "mv", "old.md", "new.md")
	commit("2026-09-06T12:00:00Z", "Rename")
	g := &GitHub{cfg: Config{RepoCacheDir: root}}
	history := g.itemGitMetadata(context.Background(), "", root, "new.md")
	if history.Created != "2026-07-01" || history.Updated != "2026-08-04" {
		t.Fatalf("bad history: %+v", history)
	}
	want := []string{"2026-08-04T12:00:00Z", "2026-07-01T12:00:00Z"}
	if !reflect.DeepEqual(history.ActivityDates, want) {
		t.Fatalf("activity = %v, want %v", history.ActivityDates, want)
	}
}

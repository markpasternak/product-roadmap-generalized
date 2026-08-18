package main

import (
	"os"
	"path/filepath"
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

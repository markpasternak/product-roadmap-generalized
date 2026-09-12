package main

import (
	"context"
	"fmt"
	"testing"
)

func TestImmutableItemSnapshotCache(t *testing.T) {
	g := &GitHub{}
	sha := fmt.Sprintf("%040d", 1)
	files := map[string]RepoFile{"A": {Content: "original", Git: ItemGitMetadata{ActivityDates: []string{"2026-09-12"}}}}
	g.cacheItems(sha, files)
	files["A"] = RepoFile{Content: "mutated input"}
	// No Git credentials or remote are configured: an immutable cache hit must
	// neither fetch nor acquire the repository lock held by an active publisher.
	g.repoMu.Lock()
	got, err := g.itemsAt(context.Background(), sha)
	g.repoMu.Unlock()
	if err != nil || got["A"].Content != "original" {
		t.Fatal(got, err)
	}
	got["A"].Git.ActivityDates[0] = "changed"
	delete(got, "A")
	next, _ := g.cachedItems(sha)
	if next["A"].Git.ActivityDates[0] != "2026-09-12" {
		t.Fatal("cache leaked mutable state")
	}
	for i := 2; i <= 10; i++ {
		g.cacheItems(fmt.Sprintf("%040d", i), files)
	}
	if _, ok := g.cachedItems(sha); ok || len(g.itemSnapshots) != 8 {
		t.Fatal("cache must be bounded")
	}
}

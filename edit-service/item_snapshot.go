package main

import "sort"

type APIItem struct {
	ID          string            `json:"id"`
	Path        string            `json:"path"`
	Sha         string            `json:"sha"`
	Git         ItemGitMetadata   `json:"git"`
	Frontmatter map[string]string `json:"frontmatter"`
	Body        string            `json:"body"`
	Content     string            `json:"content"`
}

func apiItems(files map[string]RepoFile) []APIItem {
	items := make([]APIItem, 0, len(files))
	for id, file := range files {
		doc := ParseDoc(file.Content)
		items = append(items, APIItem{ID: id, Path: file.Path, Sha: file.Sha, Git: file.Git, Frontmatter: doc.FM, Body: doc.Body, Content: file.Content})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].ID < items[j].ID })
	return items
}

// Only validated immutable commits enter this small process-local cache. Copy
// on both boundaries so callers cannot mutate another request's snapshot.
func cloneItems(files map[string]RepoFile) map[string]RepoFile {
	copy := make(map[string]RepoFile, len(files))
	for id, file := range files {
		file.Git.ActivityDates = append([]string(nil), file.Git.ActivityDates...)
		copy[id] = file
	}
	return copy
}
func (g *GitHub) cachedItems(sha string) (map[string]RepoFile, bool) {
	g.itemsMu.Lock()
	defer g.itemsMu.Unlock()
	files, ok := g.itemSnapshots[sha]
	if !ok {
		return nil, false
	}
	return cloneItems(files), true
}
func (g *GitHub) cacheItems(sha string, files map[string]RepoFile) {
	g.itemsMu.Lock()
	defer g.itemsMu.Unlock()
	if g.itemSnapshots == nil {
		g.itemSnapshots = make(map[string]map[string]RepoFile)
	}
	if _, exists := g.itemSnapshots[sha]; !exists {
		g.itemSnapshotOrder = append(g.itemSnapshotOrder, sha)
	}
	g.itemSnapshots[sha] = cloneItems(files)
	for len(g.itemSnapshotOrder) > 8 {
		delete(g.itemSnapshots, g.itemSnapshotOrder[0])
		g.itemSnapshotOrder = g.itemSnapshotOrder[1:]
	}
}

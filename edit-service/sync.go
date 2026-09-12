package main

import (
	"fmt"
	"log"
	"sort"
	"strconv"
	"strings"
)

type ItemEdit struct {
	ID          string            `json:"id"`
	Frontmatter map[string]string `json:"frontmatter"`
	Body        string            `json:"body"`
	BodySet     bool              `json:"bodySet,omitempty"`
}
type ItemNew struct {
	ID          string            `json:"id,omitempty"`
	Product     string            `json:"product"`
	Title       string            `json:"title"`
	Frontmatter map[string]string `json:"frontmatter"`
	Body        string            `json:"body"`
}
type Changeset struct {
	Updated    []ItemEdit                     `json:"updated"`
	Created    []ItemNew                      `json:"created"`
	DeletedIDs []string                       `json:"deletedIds"`
	Reorder    map[string]map[string][]string `json:"reorder"`
	// BaseShas carries, per Updated/DeletedIDs item id, the git blob sha the
	// client last saw for that item (KTD1). Creates never appear here — a
	// true create has no prior file, so it's exempt from the conflict check.
	// Fail-closed (R1): an id in Updated/DeletedIDs with no entry here is
	// itself treated as a conflict, not skipped.
	BaseShas map[string]string `json:"baseShas,omitempty"`
	// RequestID is a client-generated id used to dedup a retried sync
	// (R3/KTD3); empty disables dedup for that request (and it won't be
	// cached either).
	RequestID    string            `json:"requestId,omitempty"`
	BaseContents map[string]string `json:"baseContents,omitempty"`
	Assets       AssetChanges      `json:"assets,omitempty"`
}
type RepoFile struct {
	Path    string          `json:"path"`
	Content string          `json:"content"`
	Git     ItemGitMetadata `json:"git,omitempty"`
	// Sha is the git blob sha of Content, computed the same way `git
	// hash-object` does (KTD1) — RepoFile is read straight off disk
	// (filepath.WalkDir + os.ReadFile in readItemsFromDir) and carries no sha
	// from git itself, so it's derived rather than read from the tree.
	Sha string `json:"sha,omitempty"`
}

// BuildFiles is the stable entry point used by the git-worktree commit path
// (gitstore.go). It wraps buildFiles, dropping the changed/deleted id lists
// that only the honest-commit-message caller (handleSync) needs, so existing
// callers keep conflicts/skippedReorders/errs but not the id-naming detail.
func BuildFiles(cs Changeset, current map[string]RepoFile) (write []RepoFile, del []string, conflicts []string, skippedReorders []string, errs []string) {
	write, del, _, _, conflicts, skippedReorders, errs = buildFiles(cs, current)
	return
}

// checkConflicts returns, sorted, the ids among cs.Updated/DeletedIDs whose
// baseSha is missing or doesn't match current's computed blob sha (KTD1,
// KTD2). Fail-closed: a missing baseSha is itself a conflict, and an id that
// no longer exists in current (deleted/moved upstream) is a conflict too —
// only a true create (which never appears in Updated/DeletedIDs) is exempt.
func checkConflicts(cs Changeset, current map[string]RepoFile) []string {
	seen := map[string]bool{}
	var ids []string
	add := func(id string) {
		if seen[id] {
			return
		}
		base, hasBase := cs.BaseShas[id]
		cur, exists := current[id]
		if !hasBase || !exists || base != cur.Sha {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	for _, u := range cs.Updated {
		add(u.ID)
	}
	for _, id := range cs.DeletedIDs {
		add(id)
	}
	sort.Strings(ids)
	return ids
}

// buildFiles computes the write/delete set for a changeset. write only
// contains files whose rendered content actually differs from what's
// currently on disk (current[id].Content) — a no-op edit (a field set to its
// existing value, or changed-then-reverted) is skipped so it can't produce
// an empty/misleading commit. changedIDs and deletedIDs mirror write/del as
// item ids (not paths), sorted, so callers can name what changed (e.g. in a
// commit message) without re-deriving ids from rendered content or paths.
//
// Before anything else, it runs the per-item conflict check (checkConflicts,
// KTD1/KTD2): if any changed/deleted item's baseSha is stale or missing, it
// returns immediately with those ids in conflicts and nothing else — no
// partial commit, all-or-nothing. A stale *reorder* id is the deliberate
// exception (U8/R9): it's skipped and named in skippedReorders rather than
// rejecting the whole sync.
func buildFiles(cs Changeset, current map[string]RepoFile) (write []RepoFile, del []string, changedIDs []string, deletedIDs []string, conflicts []string, skippedReorders []string, errs []string) {
	cs = mergeIndependentEdits(cs, current)
	if conflicts = checkConflicts(cs, current); len(conflicts) != 0 {
		return nil, nil, nil, nil, conflicts, nil, nil
	}

	// Work on a mutable copy of current docs keyed by id.
	docs := map[string]*Doc{}
	pathOf := map[string]string{}
	for id, rf := range current {
		d := ParseDoc(rf.Content)
		docs[id] = &d
		pathOf[id] = rf.Path
	}
	touched := map[string]bool{}

	// Updates: patch frontmatter keys + optional body.
	for _, u := range cs.Updated {
		d, ok := docs[u.ID]
		if !ok {
			// checkConflicts already treats a missing/deleted-upstream id as
			// a conflict and returns before this loop runs, so this is
			// unreachable in practice — kept as a defensive fallback.
			return nil, nil, nil, nil, nil, nil, []string{"update: unknown id " + u.ID}
		}
		for k, v := range u.Frontmatter {
			if k == "created" || k == "updated" {
				continue
			}
			if (k == "cover" || k == "coverPosition" || k == "coverFraming") && v == "" {
				d.Unset(k)
				continue
			}
			d.Set(k, v)
		}
		if u.BodySet || u.Body != "" {
			d.Body = u.Body
		}
		touched[u.ID] = true
	}

	// Creates: assign id, path, seed frontmatter.
	existingIDs := []string{}
	for id := range docs {
		existingIDs = append(existingIDs, id)
	}
	perProduct := map[string][]string{}
	for _, id := range existingIDs {
		p := docs[id].FM["product"]
		perProduct[p] = append(perProduct[p], id)
	}
	for _, n := range cs.Created {
		id, err := NextID(n.Product, perProduct[n.Product])
		if err != nil {
			return nil, nil, nil, nil, nil, nil, []string{err.Error()}
		}
		perProduct[n.Product] = append(perProduct[n.Product], id)
		slug := Slugify(n.Title)
		d := Doc{HasFM: true, FM: map[string]string{}}
		d.Set("id", id)
		d.Set("title", n.Title)
		d.Set("product", n.Product)
		for _, k := range []string{"horizon", "stage", "owner", "visibility", "tags", "impact", "effort", "order", "startDate", "endDate", "cover", "coverPosition", "coverFraming"} {
			if v, ok := n.Frontmatter[k]; ok && v != "" {
				d.Set(k, v)
			}
		}
		if d.FM["visibility"] == "" {
			d.Set("visibility", "Internal")
		}
		if d.FM["stage"] == "" {
			d.Set("stage", "Discovery")
		}
		if d.FM["owner"] == "" {
			d.Set("owner", "Unassigned")
		}
		body := n.Body
		if body == "" {
			body = fmt.Sprintf("# %s\n\n## Why it matters\nTo fill in.\n\n## What ships\nTo fill in.\n", n.Title)
		}
		d.Body = body
		docs[id] = &d
		pathOf[id] = FilePath(n.Product, id, slug)
		touched[id] = true
	}

	// Reorder: renumber `order` 1..N within each product×horizon lane. An id
	// that can't be placed (moved lanes or deleted upstream) is skipped and
	// named in skippedReorders rather than aborting the whole sync (R9/U8) —
	// the deliberate exception to the otherwise all-or-nothing model (KTD2).
	// Remaining ids in the lane are still renumbered 1..N, compacted over the
	// skip.
	for product, lanes := range cs.Reorder {
		for lane, ids := range lanes {
			pos := 1
			for _, id := range ids {
				d, ok := docs[id]
				if !ok || d.FM["product"] != product || d.FM["horizon"] != lane {
					log.Printf("buildFiles: skipping reorder id %s (unknown or moved out of %s/%s)", id, product, lane)
					skippedReorders = append(skippedReorders, id)
					continue
				}
				d.Set("order", strconv.Itoa(pos))
				pos++
				touched[id] = true
			}
		}
	}
	sort.Strings(skippedReorders)

	// Deletes.
	delSet := map[string]bool{}
	for _, id := range cs.DeletedIDs {
		if p, ok := pathOf[id]; ok {
			del = append(del, p)
			deletedIDs = append(deletedIDs, id)
			delSet[id] = true
		}
	}
	sort.Strings(deletedIDs)

	// Assemble writes (touched and not deleted), validate each, and skip any
	// id whose rendered content is identical to what's already on disk —
	// it didn't actually change, so it shouldn't appear in the commit.
	ids := []string{}
	for id := range touched {
		if !delSet[id] {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	for _, id := range ids {
		d := docs[id]
		p := pathOf[id]
		if e := ValidateFrontmatter(d.FM, p); len(e) != 0 {
			for _, m := range e {
				errs = append(errs, id+": "+m)
			}
		}
		rendered := d.Render()
		if cur, ok := current[id]; ok && cur.Content == rendered {
			continue // unchanged (no-op edit, or changed-then-reverted): not a real write
		}
		write = append(write, RepoFile{Path: p, Content: rendered})
		changedIDs = append(changedIDs, id)
	}
	if len(errs) != 0 {
		return nil, nil, nil, nil, nil, nil, errs
	}
	return write, del, changedIDs, deletedIDs, nil, skippedReorders, nil
}

// capList joins ids for a commit message, capping the visible list at max
// and summarizing the remainder (e.g. "id1, id2, +8 more") so a large batch
// change doesn't blow out the commit message.
func capList(ids []string, max int) string {
	if len(ids) <= max {
		return strings.Join(ids, ", ")
	}
	return strings.Join(ids[:max], ", ") + fmt.Sprintf(", +%d more", len(ids)-max)
}

// commitMessage builds the roadmap sync commit message. The summary line
// keeps the existing counts (as requested by the caller); the "Changed"/
// "Deleted" lines name the ids that actually ended up in the commit
// (changedIDs/deletedIDs, from buildFiles's post-no-op-filter output), so the
// message can't claim a change that isn't really in the diff.
func commitMessage(updated, created, deleted, reordered int, login string, changedIDs, deletedIDs []string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "roadmap: %d updated, %d created, %d deleted, %d reordered (via %s)\n\n",
		updated, created, deleted, reordered, login)
	if len(changedIDs) > 0 {
		fmt.Fprintf(&b, "Changed: %s\n", capList(changedIDs, 10))
	}
	if len(deletedIDs) > 0 {
		fmt.Fprintf(&b, "Deleted: %s\n", capList(deletedIDs, 10))
	}
	fmt.Fprintf(&b, "Co-authored-by: %s <%s@users.noreply.github.com>", login, login)
	return b.String()
}

package main

import "testing"

func TestNextID(t *testing.T) {
	got, err := NextID("Podcasts & Audiobooks", []string{"TALK-001", "TALK-026", "TALK-013"})
	if err != nil || got != "TALK-027" {
		t.Fatalf("want TALK-027, got %q err %v", got, err)
	}
	got, _ = NextID("Music App", nil)
	if got != "MUSIC-001" {
		t.Fatalf("want MUSIC-001, got %q", got)
	}
	got, _ = NextID("Core Platform & Data", []string{"PLATFORM-001", "PLATFORM-004"})
	if got != "PLATFORM-005" {
		t.Fatalf("want PLATFORM-005, got %q", got)
	}
	got, _ = NextID("Ads Platform", []string{"ADS-001", "ADS-004"})
	if got != "ADS-005" {
		t.Fatalf("want ADS-005, got %q", got)
	}
}

func TestFilePathAndSlug(t *testing.T) {
	if Slugify("Task & Workflow: Center!") != "task-workflow-center" {
		t.Fatalf("slug: %q", Slugify("Task & Workflow: Center!"))
	}
	if FilePath("Music App", "MUSIC-002", "foo-bar") != "content/items/music-app/MUSIC-002-foo-bar.md" {
		t.Fatalf("path wrong: %s", FilePath("Music App", "MUSIC-002", "foo-bar"))
	}
	if FilePath("Core Platform & Data", "PLATFORM-001", "data-platform") != "content/items/core-platform-data/PLATFORM-001-data-platform.md" {
		t.Fatalf("data path wrong: %s", FilePath("Core Platform & Data", "PLATFORM-001", "data-platform"))
	}
	if FilePath("Ads Platform", "ADS-001", "rink-platform") != "content/items/ads-platform/ADS-001-rink-platform.md" {
		t.Fatalf("infra path wrong: %s", FilePath("Ads Platform", "ADS-001", "rink-platform"))
	}
}

func TestValidate(t *testing.T) {
	ok := map[string]string{"id": "TALK-001", "title": "T", "product": "Podcasts & Audiobooks", "horizon": "Now", "stage": "Building", "owner": "A"}
	if errs := ValidateFrontmatter(ok, "content/items/podcasts-audiobooks/TALK-001-x.md"); len(errs) != 0 {
		t.Fatalf("valid rejected: %v", errs)
	}
	data := map[string]string{"id": "PLATFORM-001", "title": "T", "product": "Core Platform & Data", "horizon": "Now", "stage": "Building", "owner": "A"}
	if errs := ValidateFrontmatter(data, "content/items/core-platform-data/PLATFORM-001-x.md"); len(errs) != 0 {
		t.Fatalf("valid data item rejected: %v", errs)
	}
	infra := map[string]string{"id": "ADS-001", "title": "T", "product": "Ads Platform", "horizon": "Now", "stage": "Building", "owner": "A"}
	if errs := ValidateFrontmatter(infra, "content/items/ads-platform/ADS-001-x.md"); len(errs) != 0 {
		t.Fatalf("valid infra item rejected: %v", errs)
	}
	bad := map[string]string{"id": "TALK-1", "title": "", "product": "Podcasts & Audiobooks", "horizon": "Soon", "stage": "Nope", "owner": ""}
	if errs := ValidateFrontmatter(bad, "content/items/music-app/TALK-1-x.md"); len(errs) < 4 {
		t.Fatalf("expected several errors, got %v", errs)
	}
}

func TestPlannedDateValidation(t *testing.T) {
	fm := map[string]string{"id": "TALK-001", "title": "Plan", "product": "Podcasts & Audiobooks", "horizon": "Next", "stage": "Discovery", "owner": "Alice"}
	for _, dates := range []struct {
		start, end string
		valid      bool
	}{
		{"", "", true}, {"2026-09-01", "", true}, {"", "2026-09-01", true},
		{"2026-09-01", "2026-09-01", true}, {"2026-09-02", "2026-09-01", false},
		{"2026-02-29", "2026-03-01", false}, {"2028-02-29", "2028-03-01", true},
	} {
		fm["startDate"], fm["endDate"] = dates.start, dates.end
		errs := ValidateFrontmatter(fm, "content/items/podcasts-audiobooks/TALK-001-plan.md")
		if (len(errs) == 0) != dates.valid {
			t.Fatalf("%+v: %v", dates, errs)
		}
	}
}

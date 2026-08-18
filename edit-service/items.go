package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

var ProductFolder = map[string]string{
	"Music App":             "music-app",
	"Podcasts & Audiobooks": "podcasts-audiobooks",
	"Spotify for Artists":   "spotify-for-artists",
	"Ads Platform":          "ads-platform",
	"Core Platform & Data":  "core-platform-data",
}
var ProductPrefix = map[string]string{
	"Music App":             "MUSIC",
	"Podcasts & Audiobooks": "TALK",
	"Spotify for Artists":   "ARTISTS",
	"Ads Platform":          "ADS",
	"Core Platform & Data":  "PLATFORM",
}
var Horizons = set("Candidates", "Now", "Next", "Later", "Completed")
var Stages = set("Discovery", "Validation", "Shaping", "Committed", "Building", "Pilot", "Shipped", "Parked")
var Levels = set("Low", "Medium", "High")
var Visibilities = set("Internal", "Public")

func set(xs ...string) map[string]bool {
	m := map[string]bool{}
	for _, x := range xs {
		m[x] = true
	}
	return m
}

var idRe = regexp.MustCompile(`^(MUSIC|TALK|ARTISTS|ADS|PLATFORM)-\d{3}$`)
var slugStrip = regexp.MustCompile(`[^a-z0-9]+`)

func Slugify(title string) string {
	s := slugStrip.ReplaceAllString(strings.ToLower(title), "-")
	return strings.Trim(s, "-")
}

func FilePath(product, id, slug string) string {
	return "content/items/" + ProductFolder[product] + "/" + id + "-" + slug + ".md"
}

func NextID(product string, existing []string) (string, error) {
	prefix, ok := ProductPrefix[product]
	if !ok {
		return "", fmt.Errorf("unknown product %q", product)
	}
	max := 0
	for _, id := range existing {
		if strings.HasPrefix(id, prefix+"-") {
			if n, err := strconv.Atoi(strings.TrimPrefix(id, prefix+"-")); err == nil && n > max {
				max = n
			}
		}
	}
	return fmt.Sprintf("%s-%03d", prefix, max+1), nil
}

func ValidateFrontmatter(fm map[string]string, path string) []string {
	var errs []string
	id, product := fm["id"], fm["product"]
	if !idRe.MatchString(id) {
		errs = append(errs, "id must match PREFIX-NNN, got "+id)
	}
	if _, ok := ProductFolder[product]; !ok {
		errs = append(errs, "product not in allowed set: "+product)
	} else {
		if !strings.HasPrefix(id, ProductPrefix[product]+"-") {
			errs = append(errs, "id prefix does not match product "+product)
		}
		if !strings.Contains(path, "/content/items/"+ProductFolder[product]+"/") && !strings.HasPrefix(path, "content/items/"+ProductFolder[product]+"/") {
			errs = append(errs, "file not in product folder "+ProductFolder[product])
		}
	}
	base := path[strings.LastIndex(path, "/")+1:]
	if !strings.HasPrefix(base, id+"-") {
		errs = append(errs, "filename must start with id "+id)
	}
	if strings.TrimSpace(fm["title"]) == "" {
		errs = append(errs, "title required")
	}
	if strings.TrimSpace(fm["owner"]) == "" {
		errs = append(errs, "owner required")
	}
	if !Horizons[fm["horizon"]] {
		errs = append(errs, "horizon not in allowed set: "+fm["horizon"])
	}
	if !Stages[fm["stage"]] {
		errs = append(errs, "stage not in allowed set: "+fm["stage"])
	}
	if v := fm["impact"]; v != "" && !Levels[v] {
		errs = append(errs, "impact not a level: "+v)
	}
	if v := fm["effort"]; v != "" && !Levels[v] {
		errs = append(errs, "effort not a level: "+v)
	}
	if v := fm["visibility"]; v != "" && !Visibilities[v] {
		errs = append(errs, "visibility not in allowed set: "+v)
	}
	return errs
}

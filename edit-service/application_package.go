package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var packageDigestPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

// Only explicit, authenticated CI promotion may write this pointer. Canvas
// descriptors select a release; they are never authority to install executable
// code. Install packages immutably and keep the pointer read-only to the service.
type approvedApplication struct {
	Directory     string `json:"directory"`
	Digest        string `json:"digest"`
	Source        string `json:"source"`
	Repo          string `json:"repo"`
	WorkflowRunID int64  `json:"workflowRunId"`
}

func readRegularBounded(path string, limit int64) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > limit {
		return nil, errors.New("invalid package file")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, limit+1))
	if int64(len(b)) > limit {
		return nil, errors.New("package file too large")
	}
	return b, err
}

func loadApprovedApplication(c localBuildConfig, repo string) (approvedApplication, error) {
	var app approvedApplication
	if !filepath.IsAbs(c.ApplicationPointer) {
		return app, errors.New("absolute application pointer required")
	}
	b, err := readRegularBounded(c.ApplicationPointer, 16*1024)
	if err != nil {
		return app, err
	}
	if err = json.Unmarshal(b, &app); err != nil {
		return app, err
	}
	if !filepath.IsAbs(app.Directory) || !packageDigestPattern.MatchString(app.Digest) || !gitSHA.MatchString(app.Source) || app.Repo != repo || app.WorkflowRunID <= 0 {
		return app, errors.New("invalid approved application provenance")
	}
	info, err := os.Lstat(app.Directory)
	if err != nil || !info.IsDir() {
		return app, errors.New("invalid application directory")
	}
	b, err = readRegularBounded(filepath.Join(app.Directory, "package.json"), 8*1024*1024)
	if err != nil {
		return app, err
	}
	hash := sha256.Sum256(b)
	if hex.EncodeToString(hash[:]) != app.Digest {
		return app, errors.New("application manifest checksum mismatch")
	}
	var manifest struct {
		Type             string       `json:"type"`
		Protocol         int          `json:"protocol"`
		Source           string       `json:"source"`
		NodeMajor        int          `json:"nodeMajor"`
		Base             string       `json:"base"`
		Audience         string       `json:"audience"`
		DependencyDigest string       `json:"dependencyDigest"`
		Profile          buildProfile `json:"profile"`
		Files            []struct {
			Path string `json:"path"`
			Hash string `json:"hash"`
			Size int64  `json:"size"`
		} `json:"files"`
	}
	if err = json.Unmarshal(b, &manifest); err != nil {
		return app, err
	}
	if manifest.Type != "module" || manifest.Protocol != 1 || manifest.Source != app.Source || manifest.NodeMajor != 24 || manifest.Profile != c.Profile || manifest.Base != c.Profile.Base || manifest.Audience != c.Profile.Audience || !packageDigestPattern.MatchString(manifest.DependencyDigest) || len(manifest.Files) > 20000 {
		return app, errors.New("incompatible application package")
	}
	seen, folded := map[string]bool{}, map[string]bool{}
	var total int64
	for _, file := range manifest.Files {
		if (!strings.HasPrefix(file.Path, "private/") && !strings.HasPrefix(file.Path, "public/")) || strings.ContainsAny(file.Path, "\\\x00\r\n") || folded[strings.ToLower(file.Path)] || file.Size < 0 || file.Size > 512*1024*1024 || !packageDigestPattern.MatchString(file.Hash) {
			return app, errors.New("invalid application inventory")
		}
		total += file.Size
		if total > 512*1024*1024 {
			return app, errors.New("application size budget exceeded")
		}
		path := app.Directory
		parts := strings.Split(file.Path, "/")
		for i, part := range parts {
			if part == "" || part == "." || part == ".." || strings.ContainsFunc(part, func(r rune) bool { return r < 32 }) {
				return app, errors.New("invalid application path")
			}
			path = filepath.Join(path, part)
			info, err := os.Lstat(path)
			if err != nil || (i < len(parts)-1 && !info.IsDir()) || (i == len(parts)-1 && !info.Mode().IsRegular()) {
				return app, errors.New("non-regular application path")
			}
		}
		// Hash through a bounded stream: verification does not allocate the whole
		// package in the editor's memory budget.
		f, err := os.Open(path)
		if err != nil {
			return app, err
		}
		h := sha256.New()
		n, copyErr := io.Copy(h, io.LimitReader(f, file.Size+1))
		closeErr := f.Close()
		if copyErr != nil || closeErr != nil || n != file.Size || hex.EncodeToString(h.Sum(nil)) != file.Hash {
			return app, errors.New("application file checksum mismatch")
		}
		seen[file.Path], folded[strings.ToLower(file.Path)] = true, true
	}
	for _, required := range []string{"private/renderer.mjs", "private/template.html", "private/template-docs.html", "public/.vite/manifest.json", "private/commands/prepare-content.mjs", "private/commands/coordinate.mjs", "private/commands/staged.mjs", "private/commands/application-package.mjs", "private/commands/client-assets.mjs", "private/commands/content-output.mjs", "private/commands/build-item-history.mjs", "private/commands/check-demo.mjs", "private/commands/check-document-links.mjs", "private/commands/check-item-history.mjs", "private/commands/validate_items.py"} {
		if !seen[required] {
			return app, errors.New("incomplete application package")
		}
	}
	err = filepath.WalkDir(app.Directory, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(app.Directory, path)
		if err != nil {
			return err
		}
		if !entry.Type().IsRegular() || (rel != "package.json" && !seen[filepath.ToSlash(rel)]) {
			return errors.New("unlisted application file")
		}
		return nil
	})
	return app, err
}

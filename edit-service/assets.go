package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const maxUploadBytes int64 = 25 << 20
const maxPublishBytes int64 = 100 << 20
const maxStagingBytes int64 = 250 << 20

type AssetFile struct {
	Path      string `json:"path"`
	MediaType string `json:"mediaType"`
	Bytes     int64  `json:"bytes"`
	SHA256    string `json:"sha256"`
}
type AssetRevision struct {
	ID        string    `json:"id"`
	Original  AssetFile `json:"original"`
	CreatedAt string    `json:"createdAt"`
	CreatedBy string    `json:"createdBy"`
}
type Asset struct {
	SchemaVersion int             `json:"schemaVersion"`
	ID            string          `json:"id"`
	Name          string          `json:"name"`
	Visibility    string          `json:"visibility"`
	Revisions     []AssetRevision `json:"revisions"`
	SHA           string          `json:"sha,omitempty"`
	Usages        []string        `json:"usages,omitempty"`
}
type Upload struct {
	ID        string        `json:"uploadId"`
	Login     string        `json:"owner"`
	AssetID   string        `json:"assetId"`
	Name      string        `json:"name"`
	Revision  AssetRevision `json:"revision"`
	RepoPath  string        `json:"repoPath"`
	ExpiresAt time.Time     `json:"expiresAt"`
	Published bool          `json:"published"`
}
type AssetAttachment struct {
	Name       string `json:"name,omitempty"`
	UploadID   string `json:"uploadId"`
	BaseSHA    string `json:"baseManifestSha,omitempty"`
	Visibility string `json:"visibility,omitempty"`
}
type AssetUpdate struct {
	ID         string  `json:"id"`
	BaseSHA    string  `json:"baseManifestSha"`
	Name       *string `json:"name,omitempty"`
	Visibility *string `json:"visibility,omitempty"`
	Remove     bool    `json:"remove,omitempty"`
}
type AssetChanges struct {
	Attach []AssetAttachment `json:"attach,omitempty"`
	Update []AssetUpdate     `json:"update,omitempty"`
}

func uploadDir(c Config, id string) string { return filepath.Join(c.StateDir, "uploads", id) }
func loadUpload(c Config, id, login string) (Upload, error) {
	var u Upload
	if !safeStateID(id) {
		return u, fmt.Errorf("invalid upload")
	}
	if err := readJSON(filepath.Join(uploadDir(c, id), "upload.json"), &u); err != nil {
		return u, err
	}
	if u.Login != login {
		return Upload{}, os.ErrNotExist
	}
	if time.Now().After(u.ExpiresAt) {
		return Upload{}, fmt.Errorf("upload expired; upload the file again")
	}
	return u, nil
}

func sanitizedFilename(name string) string {
	name = path.Base(strings.ReplaceAll(name, "\\", "/"))
	var b strings.Builder
	for _, c := range name {
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '.' || c == '_' || c == '-' {
			b.WriteRune(c)
		} else {
			b.WriteByte('-')
		}
	}
	name = strings.Trim(b.String(), ".-")
	if len(name) > 120 {
		ext := path.Ext(name)
		name = name[:100] + ext
	}
	return name
}

func detectedFileType(data []byte, name string) (string, error) {
	t := http.DetectContentType(data)
	ext := strings.ToLower(path.Ext(name))
	allowed := map[string]string{".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".pdf": "application/pdf", ".mp4": "video/mp4", ".webm": "video/webm"}
	if want, ok := allowed[ext]; ok && t == want {
		return t, nil
	}
	if (ext == ".txt" || ext == ".csv" || ext == ".md" || ext == ".json") && strings.HasPrefix(t, "text/plain") {
		return "text/plain; charset=utf-8", nil
	}
	if ext == ".docx" || ext == ".pptx" || ext == ".xlsx" || ext == ".zip" {
		z, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
		if err == nil && len(z.File) < 10000 {
			if ext == ".zip" {
				return "application/zip", nil
			}
			prefix := map[string]string{".docx": "word/", ".pptx": "ppt/", ".xlsx": "xl/"}[ext]
			for _, f := range z.File {
				if strings.HasPrefix(f.Name, prefix) {
					return map[string]string{".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}[ext], nil
				}
			}
		}
	}
	return "", fmt.Errorf("unsupported file format; use PNG, JPEG, GIF, WebP, PDF, MP4, WebM, Office, ZIP or text files")
}

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	login := s.requireWriter(w, r)
	if login == "" {
		return
	}
	name := sanitizedFilename(r.URL.Query().Get("name"))
	if name == "" {
		jsonResponse(w, 400, map[string]string{"error": "Choose a file with a name."})
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxUploadBytes))
	if err != nil || len(data) == 0 {
		jsonResponse(w, 413, map[string]string{"error": "Choose a non-empty file up to 25 MiB."})
		return
	}
	mediaType, err := detectedFileType(data, name)
	if err != nil {
		jsonResponse(w, 415, map[string]string{"error": err.Error()})
		return
	}
	s.publishMu.Lock()
	defer s.publishMu.Unlock()
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	h := sha256.Sum256(data)
	id := stateKey(s.cfg.Repo, login, r.URL.Query().Get("assetId"), name, hex.EncodeToString(h[:]))[:32]
	if existing, err := loadUpload(s.cfg, "upl_"+id, login); err == nil && !existing.Published {
		jsonResponse(w, 200, existing)
		return
	}
	// A published or removed upload can be uploaded as another resource later.
	if _, err := os.Stat(uploadDir(s.cfg, "upl_"+id)); err == nil {
		id, err = randHex(16)
		if err != nil {
			http.Error(w, "Could not create upload", 500)
			return
		}
	}
	entries, _ := os.ReadDir(filepath.Join(s.cfg.StateDir, "uploads"))
	var used int64
	for _, entry := range entries {
		var old Upload
		if readJSON(filepath.Join(s.cfg.StateDir, "uploads", entry.Name(), "upload.json"), &old) != nil {
			continue
		}
		if old.Published || time.Now().After(old.ExpiresAt) {
			_ = os.RemoveAll(uploadDir(s.cfg, entry.Name()))
			continue
		}
		if old.Login == login {
			used += old.Revision.Original.Bytes
		}
	}
	if used+int64(len(data)) > maxStagingBytes {
		jsonResponse(w, 413, map[string]string{"error": "Your upload storage is full. Remove unused draft files before uploading more."})
		return
	}
	assetID := r.URL.Query().Get("assetId")
	if assetID == "" {
		assetID = "ast_" + id
	} else if !safeStateID(assetID) || !strings.HasPrefix(assetID, "ast_") {
		jsonResponse(w, 400, map[string]string{"error": "Invalid file identity."})
		return
	}
	revisionID := "rev_" + id
	uploadID := "upl_" + id
	rel := revisionID + "/" + name
	u := Upload{ID: uploadID, Login: login, AssetID: assetID, Name: r.URL.Query().Get("name"), RepoPath: "content/assets/" + assetID + "/" + rel, ExpiresAt: time.Now().Add(30 * 24 * time.Hour), Revision: AssetRevision{ID: revisionID, CreatedAt: time.Now().UTC().Format(time.RFC3339), CreatedBy: login, Original: AssetFile{Path: rel, MediaType: mediaType, Bytes: int64(len(data)), SHA256: hex.EncodeToString(h[:])}}}
	dir := uploadDir(s.cfg, uploadID)
	if err = os.MkdirAll(dir, 0700); err == nil {
		var f *os.File
		f, err = os.OpenFile(filepath.Join(dir, "bytes"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err == nil {
			_, err = f.Write(data)
			if err == nil {
				err = f.Sync()
			}
			closeErr := f.Close()
			if err == nil {
				err = closeErr
			}
		}
	}
	if err == nil {
		err = writeJSONAtomic(filepath.Join(dir, "upload.json"), u)
	}
	if err != nil {
		_ = os.RemoveAll(dir)
		jsonResponse(w, 507, map[string]string{"error": "Could not store the upload. Try again."})
		return
	}
	jsonResponse(w, 201, u)
}

func (s *Server) authorizedUpload(w http.ResponseWriter, r *http.Request) (Upload, bool) {
	login := s.session(r)
	if login == "" {
		jsonResponse(w, 401, map[string]string{"error": "Sign in again."})
		return Upload{}, false
	}
	u, err := loadUpload(s.cfg, r.PathValue("id"), login)
	if err != nil {
		jsonResponse(w, 404, map[string]string{"error": "Upload unavailable or expired. Upload the file again."})
		return Upload{}, false
	}
	return u, true
}
func (s *Server) handleUploadStatus(w http.ResponseWriter, r *http.Request) {
	if u, ok := s.authorizedUpload(w, r); ok {
		jsonResponse(w, 200, u)
	}
}
func serveAsset(w http.ResponseWriter, r *http.Request, file AssetFile, data []byte) {
	w.Header().Set("Content-Type", file.MediaType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
	disposition := "attachment"
	if strings.HasPrefix(file.MediaType, "image/") || strings.HasPrefix(file.MediaType, "video/") {
		disposition = "inline"
	}
	w.Header().Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": path.Base(file.Path)}))
	http.ServeContent(w, r, path.Base(file.Path), time.Time{}, bytes.NewReader(data))
}
func (s *Server) handleUploadContent(w http.ResponseWriter, r *http.Request) {
	if u, ok := s.authorizedUpload(w, r); ok {
		data, err := os.ReadFile(filepath.Join(uploadDir(s.cfg, u.ID), "bytes"))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		serveAsset(w, r, u.Revision.Original, data)
	}
}
func (s *Server) handleUploadDelete(w http.ResponseWriter, r *http.Request) {
	s.publishMu.Lock()
	defer s.publishMu.Unlock()
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	if u, ok := s.authorizedUpload(w, r); ok {
		if u.Published {
			jsonResponse(w, 409, map[string]string{"error": "This file is published. Remove it through the resource manager."})
			return
		}
		if err := os.RemoveAll(uploadDir(s.cfg, u.ID)); err != nil {
			jsonResponse(w, 500, map[string]string{"error": "Could not remove upload."})
			return
		}
		w.WriteHeader(204)
	}
}

func assetPath(id string) string { return "content/assets/" + id + "/asset.json" }
func readAssets(root string) ([]Asset, error) {
	entries, err := os.ReadDir(filepath.Join(root, "content/assets"))
	if errors.Is(err, os.ErrNotExist) {
		return []Asset{}, nil
	}
	if err != nil {
		return nil, err
	}
	assets := []Asset{}
	for _, entry := range entries {
		if !entry.IsDir() || !safeStateID(entry.Name()) {
			continue
		}
		p, err := confinedPath(root, assetPath(entry.Name()))
		if err != nil {
			return nil, err
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return nil, err
		}
		var a Asset
		if err = json.Unmarshal(data, &a); err != nil {
			return nil, err
		}
		if a.ID != entry.Name() || a.SchemaVersion != 1 || !strings.HasPrefix(a.ID, "ast_") || (a.Visibility != "Public" && a.Visibility != "Internal") || strings.TrimSpace(a.Name) == "" || len(a.Name) > 250 || len(a.Revisions) == 0 {
			return nil, fmt.Errorf("invalid asset manifest: %s", entry.Name())
		}
		seen := map[string]bool{}
		for _, rev := range a.Revisions {
			f := rev.Original
			if !safeStateID(rev.ID) || !strings.HasPrefix(rev.ID, "rev_") || seen[rev.ID] || path.Dir(f.Path) != rev.ID || sanitizedFilename(path.Base(f.Path)) != path.Base(f.Path) || f.Bytes <= 0 || f.Bytes > maxUploadBytes {
				return nil, fmt.Errorf("invalid revision in %s", a.ID)
			}
			seen[rev.ID] = true
			file, err := confinedPath(root, "content/assets/"+a.ID+"/"+f.Path)
			if err != nil {
				return nil, err
			}
			bytes, err := os.ReadFile(file)
			if err != nil {
				return nil, err
			}
			hash := sha256.Sum256(bytes)
			if int64(len(bytes)) != f.Bytes || hex.EncodeToString(hash[:]) != f.SHA256 {
				return nil, fmt.Errorf("resource checksum mismatch: %s", a.Name)
			}
			mediaType, err := detectedFileType(bytes, path.Base(f.Path))
			if err != nil || mediaType != f.MediaType {
				return nil, fmt.Errorf("resource media type mismatch: %s", a.Name)
			}
		}
		a.SHA = gitBlobSha(data)
		assets = append(assets, a)
	}
	sort.Slice(assets, func(i, j int) bool { return assets[i].Name < assets[j].Name })
	return assets, nil
}

var assetReferenceRE = regexp.MustCompile(`(?:\.\./\.\./|content/|/)assets/(ast_[a-z0-9_-]+)/([a-zA-Z0-9_./-]+)`)

func assetReferences(body string) []string {
	refs := []string{}
	fence := ""
	for _, line := range strings.Split(body, "\n") {
		trim := strings.TrimSpace(line)
		marker := ""
		if len(trim) >= 3 && (trim[0] == '`' || trim[0] == '~') {
			n := 0
			for n < len(trim) && trim[n] == trim[0] {
				n++
			}
			if n >= 3 {
				marker = trim[:n]
			}
		}
		if fence != "" {
			if strings.HasPrefix(marker, fence) && strings.TrimSpace(trim[len(marker):]) == "" {
				fence = ""
			}
			continue
		}
		if marker != "" {
			fence = marker
			continue
		}
		// Inline code is documentation, not a resource placement. Match equal delimiters.
		var visible strings.Builder
		for pos := 0; pos < len(line); {
			if line[pos] != '`' {
				visible.WriteByte(line[pos])
				pos++
				continue
			}
			end := pos
			for end < len(line) && line[end] == '`' {
				end++
			}
			delimiter := line[pos:end]
			close := strings.Index(line[end:], delimiter)
			if close < 0 {
				visible.WriteString(delimiter)
				pos = end
			} else {
				pos = end + close + len(delimiter)
			}
		}
		for _, m := range assetReferenceRE.FindAllStringSubmatch(visible.String(), -1) {
			refs = append(refs, "content/assets/"+m[1]+"/"+m[2])
		}
	}
	return refs
}

func assetUsages(root string) (map[string][]string, error) {
	out := map[string][]string{}
	for _, directory := range []string{"content", "presentations"} {
		err := filepath.WalkDir(filepath.Join(root, directory), func(p string, d fs.DirEntry, err error) error {
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}
			if err != nil {
				return err
			}
			if d.IsDir() {
				if p == filepath.Join(root, "content", "assets") {
					return filepath.SkipDir
				}
				return nil
			}
			if d.Type()&os.ModeSymlink != 0 {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(p))
			if ext != ".md" && ext != ".html" && ext != ".js" && ext != ".json" && ext != ".css" {
				return nil
			}
			data, err := os.ReadFile(p)
			if err != nil {
				return err
			}
			rel, _ := filepath.Rel(root, p)
			refs := assetReferences(string(data))
			if ext != ".md" {
				refs = nil
				for _, m := range assetReferenceRE.FindAllStringSubmatch(string(data), -1) {
					refs = append(refs, "content/assets/"+m[1]+"/"+m[2])
				}
			}
			for _, ref := range refs {
				out[ref] = append(out[ref], filepath.ToSlash(rel))
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (g *GitHub) withRepository(ctx context.Context, fn func(string) error) error {
	token, err := g.installationToken(ctx)
	if err != nil {
		return err
	}
	g.repoMu.Lock()
	defer g.repoMu.Unlock()
	if err = g.fetchMainLocked(ctx, token); err != nil {
		return err
	}
	wt, err := g.addWorktreeLocked(ctx, token)
	if err != nil {
		return err
	}
	defer g.removeWorktree(context.Background(), token, wt)
	return fn(wt)
}
func (s *Server) handleAssets(w http.ResponseWriter, r *http.Request) {
	if s.session(r) == "" {
		jsonResponse(w, 401, map[string]string{"error": "Sign in again."})
		return
	}
	var assets []Asset
	err := s.gh.withRepository(r.Context(), func(root string) error {
		var err error
		assets, err = readAssets(root)
		if err != nil {
			return err
		}
		usages, err := assetUsages(root)
		if err != nil {
			return err
		}
		for i := range assets {
			seen := map[string]bool{}
			for _, rev := range assets[i].Revisions {
				for _, p := range usages["content/assets/"+assets[i].ID+"/"+rev.Original.Path] {
					if !seen[p] {
						assets[i].Usages = append(assets[i].Usages, p)
						seen[p] = true
					}
				}
			}
		}
		return nil
	})
	if err != nil {
		jsonResponse(w, 502, map[string]string{"error": "Could not load resources."})
		return
	}
	jsonResponse(w, 200, assets)
}
func (s *Server) handleAssetContent(w http.ResponseWriter, r *http.Request) {
	if s.session(r) == "" {
		http.Error(w, "unauthorized", 401)
		return
	}
	requested := r.URL.Query().Get("path")
	var data []byte
	var file AssetFile
	err := s.gh.withRepository(r.Context(), func(root string) error {
		assets, err := readAssets(root)
		if err != nil {
			return err
		}
		for _, a := range assets {
			for _, rev := range a.Revisions {
				if "content/assets/"+a.ID+"/"+rev.Original.Path == requested {
					p, err := confinedPath(root, requested)
					if err != nil {
						return err
					}
					data, err = os.ReadFile(p)
					file = rev.Original
					return err
				}
			}
		}
		return os.ErrNotExist
	})
	if err != nil {
		http.NotFound(w, r)
		return
	}
	serveAsset(w, r, file, data)
}

func (g *GitHub) applyAssets(root string, changes AssetChanges, login string) error {
	assets, err := readAssets(root)
	if err != nil {
		return err
	}
	byID := map[string]*Asset{}
	originalSHAs := map[string]string{}
	for i := range assets {
		byID[assets[i].ID] = &assets[i]
		originalSHAs[assets[i].ID] = assets[i].SHA
	}
	var total int64
	touched := map[string]bool{}
	for _, claim := range changes.Attach {
		u, err := loadUpload(g.cfg, claim.UploadID, login)
		if err != nil {
			return fmt.Errorf("upload unavailable: %s", claim.UploadID)
		}
		a := byID[u.AssetID]
		if a != nil && claim.BaseSHA != originalSHAs[u.AssetID] {
			return fmt.Errorf("resource changed: %s; reload resources before replacing it", a.Name)
		}
		if a == nil {
			a = &Asset{SchemaVersion: 1, ID: u.AssetID, Name: u.Name, Visibility: "Internal"}
			byID[a.ID] = a
		}
		if claim.Name != "" {
			if len(claim.Name) > 250 {
				return fmt.Errorf("resource name is too long")
			}
			a.Name = strings.TrimSpace(claim.Name)
		}
		if claim.Visibility == "Public" {
			a.Visibility = "Public"
		} else if claim.Visibility != "" && claim.Visibility != "Internal" {
			return fmt.Errorf("invalid file visibility")
		}
		total += u.Revision.Original.Bytes
		if total > maxPublishBytes {
			return fmt.Errorf("publish up to 100 MiB of files at a time")
		}
		data, err := os.ReadFile(filepath.Join(uploadDir(g.cfg, u.ID), "bytes"))
		if err != nil {
			return err
		}
		h := sha256.Sum256(data)
		if hex.EncodeToString(h[:]) != u.Revision.Original.SHA256 || int64(len(data)) != u.Revision.Original.Bytes {
			return fmt.Errorf("upload checksum mismatch: %s", u.Name)
		}
		if err = writeConfined(root, u.RepoPath, data); err != nil {
			return err
		}
		found := false
		for _, v := range a.Revisions {
			if v.ID == u.Revision.ID {
				found = true
			}
		}
		if !found {
			a.Revisions = append(a.Revisions, u.Revision)
		}
		touched[a.ID] = true
	}
	usages, err := assetUsages(root)
	if err != nil {
		return err
	}
	for _, change := range changes.Update {
		a := byID[change.ID]
		if a == nil || change.BaseSHA != originalSHAs[change.ID] {
			return fmt.Errorf("resource changed; reload resources before editing it")
		}
		if change.Remove {
			for _, rev := range a.Revisions {
				if len(usages["content/assets/"+a.ID+"/"+rev.Original.Path]) > 0 {
					return fmt.Errorf("%s is still used; remove its references first", a.Name)
				}
			}
			for _, rev := range a.Revisions {
				p, err := confinedPath(root, "content/assets/"+a.ID+"/"+rev.Original.Path)
				if err != nil {
					return err
				}
				if err = os.Remove(p); err != nil {
					return err
				}
			}
			p, err := confinedPath(root, assetPath(a.ID))
			if err != nil {
				return err
			}
			if err = os.Remove(p); err != nil {
				return err
			}
			delete(byID, a.ID)
			delete(touched, a.ID)
			continue
		}
		if change.Name != nil {
			a.Name = strings.TrimSpace(*change.Name)
			if a.Name == "" || len(a.Name) > 250 {
				return fmt.Errorf("resource name must contain 1–250 characters")
			}
		}
		if change.Visibility != nil {
			if *change.Visibility != "Public" && *change.Visibility != "Internal" {
				return fmt.Errorf("invalid visibility")
			}
			a.Visibility = *change.Visibility
		}
		touched[a.ID] = true
	}
	for id := range touched {
		a := *byID[id]
		a.SHA = ""
		a.Usages = nil
		data, err := json.MarshalIndent(a, "", "  ")
		if err != nil {
			return err
		}
		if err = writeConfined(root, assetPath(id), append(data, '\n')); err != nil {
			return err
		}
	}
	// Validate references against the resulting tree, including unchanged documents.
	for ref, uses := range usages {
		parts := strings.Split(ref, "/")
		if len(parts) < 5 {
			return fmt.Errorf("invalid asset reference")
		}
		a := byID[parts[2]]
		found := false
		if a != nil {
			for _, rev := range a.Revisions {
				if "content/assets/"+a.ID+"/"+rev.Original.Path == ref {
					found = true
				}
			}
		}
		if !found {
			return fmt.Errorf("missing file referenced by %s", uses[0])
		}
		for _, use := range uses {
			data, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(use)))
			if err != nil {
				return err
			}
			if ParseDoc(string(data)).FM["visibility"] == "Public" && a.Visibility != "Public" {
				return fmt.Errorf("%s is public but its file %s is Internal; change the file visibility or remove the reference", use, a.Name)
			}
		}
	}
	return nil
}

func confinedPath(root, rel string) (string, error) {
	if path.Clean(rel) != rel || strings.HasPrefix(rel, "/") || strings.HasPrefix(rel, "../") || strings.Contains(rel, "\\") {
		return "", fmt.Errorf("unsafe repository path")
	}
	p := root
	for _, part := range strings.Split(rel, "/") {
		p = filepath.Join(p, part)
		info, err := os.Lstat(p)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return "", err
		}
		if err == nil && info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("symbolic links are not editable")
		}
	}
	return p, nil
}
func writeConfined(root, rel string, data []byte) error {
	p, err := confinedPath(root, rel)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		return err
	}
	return os.WriteFile(p, data, 0644)
}

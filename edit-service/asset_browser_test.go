package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// Opt-in, loopback-only browser harness. Uses the actual Go routes, signed fixture
// sessions, local Git objects and staged files. No production tokens or writes.
// Run: ROADMAP_PREVIEW_BROWSER=1 go test -run TestPreviewBrowserHarness -v
func TestPreviewBrowserHarness(t *testing.T) {
	if os.Getenv("ROADMAP_PREVIEW_BROWSER") != "1" {
		t.Skip("manual browser proof")
	}
	g, u, _ := assetRepository(t)
	img := image.NewRGBA(image.Rect(0, 0, 96, 96))
	for y := 0; y < 96; y++ {
		for x := 0; x < 96; x++ {
			img.Set(x, y, color.RGBA{uint8(x*11 + y), uint8(y*7 + x), uint8(x * y), 255})
		}
	}
	var data bytes.Buffer
	if err := png.Encode(&data, img); err != nil {
		t.Fatal(err)
	}
	u.Revision.Original = AssetFile{Path: "rev_testing123/preview.png", MediaType: "image/png", Bytes: int64(data.Len()), SHA256: fmt.Sprintf("%x", sha256.Sum256(data.Bytes()))}
	u.RepoPath = "content/assets/" + u.AssetID + "/" + u.Revision.Original.Path
	if err := os.WriteFile(filepath.Join(uploadDir(g.cfg, u.ID), "bytes"), data.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	if err := writeJSONAtomic(filepath.Join(uploadDir(g.cfg, u.ID), "upload.json"), u); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(g.repoRoot(), u.RepoPath), data.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	a := Asset{SchemaVersion: 1, ID: u.AssetID, Name: u.Name, Visibility: "Internal", Revisions: []AssetRevision{u.Revision}}
	if err := writeJSONAtomic(filepath.Join(g.repoRoot(), assetPath(u.AssetID)), a); err != nil {
		t.Fatal(err)
	}
	gitTest(t, g.repoRoot(), "add", "-A")
	gitTest(t, g.repoRoot(), "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "Browser image fixture")
	gitTest(t, g.repoRoot(), "push", "origin", "main")
	s := testServer()
	s.gh = g
	s.cfg.StateDir = g.cfg.StateDir
	s.routes()
	var mu sync.Mutex
	events := []map[string]any{}
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		recorded := &previewRecordingWriter{ResponseWriter: w, status: 200}
		s.ServeHTTP(recorded, r)
		mu.Lock()
		defer mu.Unlock()
		events = append(events, map[string]any{"method": r.Method, "path": r.URL.Path, "conditional": r.Header.Get("If-None-Match"), "account": s.session(r), "status": recorded.status, "bodyBytes": recorded.bytes, "cache": w.Header().Get("Cache-Control"), "vary": w.Header().Values("Vary"), "origin": w.Header().Get("Access-Control-Allow-Origin")})
	}))
	defer api.Close()
	done := make(chan struct{})
	var stop sync.Once
	front := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.URL.Path == "/events" {
			mu.Lock()
			defer mu.Unlock()
			json.NewEncoder(w).Encode(events)
			return
		}
		if r.URL.Path == "/stop" && r.Method == "POST" {
			stop.Do(func() { close(done) })
			w.WriteHeader(204)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintf(w, `<!doctype html><title>Go preview HTTP revalidation proof</title>
<h1>Real HTTP image previews</h1><p>Fixture-only sessions. Each open fetches again; no in-memory preview reuse.</p>
<button id="alice">Sign in Alice</button><button id="bob">Switch to Bob</button><button id="logout">Log out</button>
<button id="committed">Open committed preview</button><button id="upload">Open draft preview</button>
<p id="status" role="status"></p><img id="preview" alt="Authorized fixture preview"><script>
const api=%q, tokens={alice:%q,bob:%q}; let objectURL;
const status=document.querySelector('#status'), preview=document.querySelector('#preview');
function account(name){sessionStorage.setItem('account',name);status.textContent=name||'Logged out';preview.removeAttribute('src');if(objectURL)URL.revokeObjectURL(objectURL)}
for(const name of ['alice','bob'])document.getElementById(name).onclick=()=>account(name);
document.getElementById('logout').onclick=()=>account('');
async function open(path){const token=tokens[sessionStorage.getItem('account')];const response=await fetch(api+path,{headers:token?{Authorization:'Bearer '+token}:{}}); if(!response.ok){status.textContent='Denied '+response.status;preview.removeAttribute('src');return}if(objectURL)URL.revokeObjectURL(objectURL);const blob=await response.blob();objectURL=URL.createObjectURL(blob);preview.src=objectURL;status.textContent='Loaded '+blob.size+' bytes; HTTP cache may have revalidated';}
document.querySelector('#committed').onclick=()=>open('/api/assets/content?path='+encodeURIComponent(%q));
document.querySelector('#upload').onclick=()=>open(%q);
account(sessionStorage.getItem('account')||'');</script>`, api.URL, mintSession(s.cfg.SessionSecret, "alice", time.Now()), mintSession(s.cfg.SessionSecret, "bob", time.Now()), u.RepoPath, "/api/uploads/"+u.ID+"/content")
	}))
	defer front.Close()
	s.cfg.AllowedOrigin = front.URL
	t.Logf("PREVIEW_BROWSER url=%s bytes=%d", front.URL, data.Len())
	select {
	case <-done:
	case <-time.After(15 * time.Minute):
		t.Fatal("browser harness timed out")
	}
}

type previewRecordingWriter struct {
	http.ResponseWriter
	status, bytes int
}

func (w *previewRecordingWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *previewRecordingWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}
func (w *previewRecordingWriter) Write(p []byte) (int, error) {
	n, err := w.ResponseWriter.Write(p)
	w.bytes += n
	return n, err
}

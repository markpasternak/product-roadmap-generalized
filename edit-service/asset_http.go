package main

import (
	"net/http"
	"strings"
)

func assetETag(file AssetFile) string { return `"` + file.SHA256 + `"` }

func addVary(header http.Header, field string) {
	for _, line := range header.Values("Vary") {
		for _, existing := range strings.Split(line, ",") {
			if strings.EqualFold(strings.TrimSpace(existing), field) || strings.TrimSpace(existing) == "*" {
				return
			}
		}
	}
	header.Add("Vary", field)
}

// Apply the failure policy before authentication, and again when any handler
// (including ServeContent's Range/precondition handling) emits an error.
type assetResponseWriter struct{ http.ResponseWriter }

func privateAssetResponse(w http.ResponseWriter) http.ResponseWriter {
	w.Header().Set("Cache-Control", "private, no-store")
	addVary(w.Header(), "Authorization")
	return &assetResponseWriter{w}
}

func (w *assetResponseWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *assetResponseWriter) WriteHeader(status int) {
	if status >= 400 {
		w.Header().Set("Cache-Control", "private, no-store")
		w.Header().Del("ETag")
		w.Header().Del("Last-Modified")
	}
	w.ResponseWriter.WriteHeader(status)
}

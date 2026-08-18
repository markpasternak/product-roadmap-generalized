package main

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"strings"
	"testing"
	"time"
)

func TestAppJWT(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	tok, err := appJWT("4223213", key, time.Unix(1_700_000_000, 0))
	if err != nil {
		t.Fatal(err)
	}
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		t.Fatalf("want 3 JWT segments, got %d", len(parts))
	}
	hdr, _ := base64.RawURLEncoding.DecodeString(parts[0])
	if !strings.Contains(string(hdr), "RS256") {
		t.Fatalf("header not RS256: %s", hdr)
	}
	pl, _ := base64.RawURLEncoding.DecodeString(parts[1])
	if !strings.Contains(string(pl), `"iss":"4223213"`) {
		t.Fatalf("payload missing iss: %s", pl)
	}
}

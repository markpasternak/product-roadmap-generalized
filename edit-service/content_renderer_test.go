package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestNewHintCancelsOnlyVerifiedSupersededPreparation(t *testing.T) {
	hints := make(chan time.Time, 4)
	ctx := context.WithValue(context.Background(), buildWakeKey{}, (<-chan time.Time)(hints))
	var changed atomic.Bool
	read := make(chan struct{}, 4)
	prep, stop := monitorContentHead(ctx, "old", func(context.Context) (string, error) {
		defer func() { read <- struct{}{} }()
		if changed.Load() {
			return "new", nil
		}
		return "old", nil
	})
	hints <- time.Now()
	<-read
	if prep.Err() != nil {
		t.Fatal("duplicate hint cancelled preparation")
	}
	changed.Store(true)
	hints <- time.Now()
	select {
	case <-prep.Done():
	case <-time.After(time.Second):
		t.Fatal("new head did not cancel")
	}
	if !stop() {
		t.Fatal("missing supersession outcome")
	}
}
func TestUnverifiedHintCannotCancelPreparation(t *testing.T) {
	hints := make(chan time.Time, 1)
	ctx := context.WithValue(context.Background(), buildWakeKey{}, (<-chan time.Time)(hints))
	read := make(chan struct{})
	prep, stop := monitorContentHead(ctx, "old", func(context.Context) (string, error) { defer close(read); return "", errors.New("unavailable") })
	hints <- time.Now()
	<-read
	if prep.Err() != nil {
		t.Fatal("unverified hint cancelled")
	}
	if stop() {
		t.Fatal("unverified hint superseded")
	}
}
func TestWarmRendererReusesProcessAndRestartsAfterCancellation(t *testing.T) {
	root := t.TempDir()
	script := filepath.Join(root, "prepare-content.mjs")
	code := `import {createInterface} from 'node:readline';import {writeFile} from 'node:fs/promises';
if(process.env.GH_TOKEN||process.env.CANVAS_DROP_TOKEN)process.exit(2);
for await(const line of createInterface({input:process.stdin})){const r=JSON.parse(line);if(r.checkout==='wait')await new Promise(()=>{});await writeFile(r.output,String(process.pid));console.log(JSON.stringify({ok:true}));}`
	if err := os.WriteFile(script, []byte(code), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "content-cache.mjs"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	r := contentRenderer{}
	defer r.close()
	env := (buildProfile{}).environment("")
	args := []string{"node", script, root, "source", filepath.Join(root, "one"), strings.Repeat("a", 64), root}
	if err := r.run(context.Background(), root, env, args); err != nil {
		t.Fatal(err)
	}
	first, _ := os.ReadFile(args[4])
	args[4] = filepath.Join(root, "two")
	if err := r.run(context.Background(), root, env, args); err != nil {
		t.Fatal(err)
	}
	second, _ := os.ReadFile(args[4])
	if string(first) != string(second) {
		t.Fatal("process not reused")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	args[3] = "wait"
	if !errors.Is(r.run(ctx, root, env, args), context.DeadlineExceeded) {
		t.Fatal("cancellation failed")
	}
	args[3] = "source"
	args[4] = filepath.Join(root, "three")
	if err := r.run(context.Background(), root, env, args); err != nil {
		t.Fatal(err)
	}
	third, _ := os.ReadFile(args[4])
	if string(first) == string(third) {
		t.Fatal("cancelled process reused")
	}
}

func TestRendererSupportsPreviousApplicationPackage(t *testing.T) {
	root := t.TempDir()
	script := filepath.Join(root, "prepare-content.mjs")
	if err := os.WriteFile(script, []byte(`if(process.argv[2]==='--worker')process.exit(1);`), 0600); err != nil {
		t.Fatal(err)
	}
	r := contentRenderer{}
	defer r.close()
	args := []string{"node", script, root, root, root, strings.Repeat("a", 64), root}
	if err := r.run(context.Background(), root, (buildProfile{}).environment(""), args); err != nil {
		t.Fatal(err)
	}
	if r.cmd != nil {
		t.Fatal("old package started a worker")
	}
}

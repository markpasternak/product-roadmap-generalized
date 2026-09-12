package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func captureBuildTimings(t *testing.T) *bytes.Buffer {
	t.Helper()
	var logs bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(previous) })
	return &logs
}

func TestLocalBuildTimingNpmChildren(t *testing.T) {
	root := t.TempDir()
	logs := captureBuildTimings(t)
	ctx, trace, _ := ensureBuildTiming(context.Background())
	trace.installProbe(root)
	packageJSON := `{"scripts":{"prebuild":"node sync-presentations.mjs && node gen-version.mjs && node build-item-history.mjs","build":"node astro.mjs"}}`
	if err := writeConfined(root, "site/package.json", []byte(packageJSON)); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"sync-presentations.mjs", "gen-version.mjs", "build-item-history.mjs", "astro.mjs"} {
		if err := writeConfined(root, "site/"+name, []byte("console.log('PRIVATE_CONTENT_DO_NOT_LOG')")); err != nil {
			t.Fatal(err)
		}
	}
	err := runBuildCommand(ctx, root, (buildProfile{}).environment(""), []string{"npm", "--prefix", "site", "run", "build"})
	trace.finish(ctx, err)
	if err != nil {
		t.Fatal(err)
	}
	stages := map[string]int{}
	for _, record := range timingRecords(t, logs) {
		if record["outcome"] == "success" {
			stages[record["stage"].(string)]++
		}
	}
	for _, stage := range []string{"npm_build", "sync_presentations", "generate_version", "item_history", "astro_build"} {
		if stages[stage] != 1 {
			t.Errorf("expected one completed %s, got %d", stage, stages[stage])
		}
	}
	if strings.Contains(logs.String(), "PRIVATE_CONTENT") {
		t.Fatal("subprocess output leaked")
	}
}

func TestLocalBuildTimingHTTPObservations(t *testing.T) {
	for _, status := range []int{200, 409} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			requests := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests++
				if r.Header.Get("Authorization") != "Bearer PRIVATE_TOKEN" {
					t.Error("probe altered authorization")
				}
				w.WriteHeader(status)
				w.Write([]byte(`{"secret":"PRIVATE_RESPONSE"}`))
			}))
			defer server.Close()
			root := t.TempDir()
			logs := captureBuildTimings(t)
			ctx, trace, _ := ensureBuildTiming(context.Background())
			trace.installProbe(root)
			code := `const response = await fetch(process.env.TEST_URL + '/v1/canvases/test/deploy?expectedPublicationToken=PRIVATE_QUERY', {method:'PUT',headers:{Authorization:'Bearer PRIVATE_TOKEN'},body:'PRIVATE_UPLOAD'}); console.error(await response.json());`
			if err := writeConfined(root, "coordinate.mjs", []byte(code)); err != nil {
				t.Fatal(err)
			}
			env := append((buildProfile{}).environment(""), "TEST_URL="+server.URL)
			if err := runBuildCommand(ctx, root, env, []string{"node", "coordinate.mjs"}); err != nil {
				t.Fatal(err)
			}
			if requests != 1 {
				t.Fatal("probe changed request count")
			}
			found := false
			for _, record := range timingRecords(t, logs) {
				if record["stage"] == "canvas_upload" {
					found = true
					want := "success"
					if status == 409 {
						want = "conflict"
					}
					if record["status"] != float64(status) || record["outcome"] != want {
						t.Fatalf("incorrect HTTP timing: %v", record)
					}
				}
			}
			if !found {
				t.Fatal("missing complete-response timing")
			}
			if strings.Contains(logs.String(), "PRIVATE_") {
				t.Fatal("credential or payload leaked")
			}
		})
	}
}

func TestLocalBuildTimingRejectsUnsafeRecords(t *testing.T) {
	logs := captureBuildTimings(t)
	_, trace, _ := ensureBuildTiming(context.Background())
	output := buildOutput{trace: trace}
	for _, line := range []string{
		`ROADMAP_BUILD_TIMING {"stage":"SECRET_STAGE","outcome":"success"}`,
		`ROADMAP_BUILD_TIMING {"stage":"astro_build","outcome":"SECRET_OUTCOME"}`,
		`ROADMAP_BUILD_TIMING {"stage":"astro_build","outcome":"success","duration_ms":-1}`,
		`ROADMAP_BUILD_TIMING {"stage":"astro_build","outcome":"success","duration_ms":1e99}`,
		strings.Repeat("SECRET", 1000),
	} {
		output.Write([]byte(line + "\n"))
	}
	valid := `ROADMAP_BUILD_TIMING {"stage":"astro_build","outcome":"success","duration_ms":12,"cache":"SECRET_CACHE","commit":"SECRET_COMMIT","arbitrary":"SECRET_EXTRA"}` + "\n"
	// Exercise arbitrary pipe chunk boundaries without forwarding unknown keys.
	for _, value := range []byte(valid) {
		output.Write([]byte{value})
	}
	records := timingRecords(t, logs)
	if len(records) != 2 || records[1]["stage"] != "astro_build" {
		t.Fatalf("unexpected telemetry: %v", records)
	}
	if strings.Contains(logs.String(), "SECRET") {
		t.Fatal("untrusted telemetry leaked")
	}
}

func TestLocalBuildTimingRecordLimit(t *testing.T) {
	logs := captureBuildTimings(t)
	_, trace, _ := ensureBuildTiming(context.Background())
	output := buildOutput{trace: trace}
	line := "ROADMAP_BUILD_TIMING {\"stage\":\"astro_build\",\"outcome\":\"success\",\"duration_ms\":1}\n"
	output.Write([]byte(strings.Repeat(line, 300)))
	if got := len(timingRecords(t, logs)); got != 257 {
		t.Fatalf("unbounded telemetry: got %d records", got)
	}
	if len(output.data) > 16<<10 || len(output.line) > 2048 {
		t.Fatal("diagnostic buffers exceeded bounds")
	}
}

func TestLocalBuildTimingQueueWait(t *testing.T) {
	logs := captureBuildTimings(t)
	finished := make(chan struct{})
	w := newLocalBuildWorker(func(ctx context.Context) {
		ctx, trace, _ := ensureBuildTiming(ctx)
		trace.finish(ctx, nil)
		close(finished)
	})
	w.enqueue()
	<-finished
	w.close()
	found := false
	for _, record := range timingRecords(t, logs) {
		if record["stage"] == "queue wait" {
			found = true
			if record["duration_ms"].(float64) < 0 {
				t.Fatal("negative queue delay")
			}
		}
	}
	if !found {
		t.Fatal("missing queue timing")
	}
}

func TestLocalBuildTimingDependencyCache(t *testing.T) {
	g, _ := buildFixture(t)
	logs := captureBuildTimings(t)
	ctx, _, _ := ensureBuildTiming(context.Background())
	cache := filepath.Join(t.TempDir(), "dependencies")
	root := t.TempDir()
	for _, name := range []string{"package.json", "package-lock.json"} {
		if err := writeConfined(root, "site/"+name, []byte("{}")); err != nil {
			t.Fatal(err)
		}
	}
	for range 2 {
		restore, err := prepareBuildDependencies(ctx, root, g.cfg.LocalBuild.DependenciesDir, cache)
		if err != nil {
			t.Fatal(err)
		}
		if err := restore(); err != nil {
			t.Fatal(err)
		}
	}
	var states []string
	for _, record := range timingRecords(t, logs) {
		if record["stage"] == "dependency cache" {
			states = append(states, record["cache"].(string))
		}
	}
	if strings.Join(states, ",") != "miss,hit" {
		t.Fatalf("wrong cache events: %v", states)
	}
}

func TestLocalBuildTimingDeadline(t *testing.T) {
	root := t.TempDir()
	logs := captureBuildTimings(t)
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	ctx, trace, _ := ensureBuildTiming(ctx)
	trace.installProbe(root)
	if err := writeConfined(root, "astro.mjs", []byte("setInterval(() => {}, 1000)")); err != nil {
		t.Fatal(err)
	}
	err := runBuildCommand(ctx, root, (buildProfile{}).environment(""), []string{"node", "astro.mjs"})
	trace.finish(ctx, err)
	if err == nil {
		t.Fatal("child was not cancelled")
	}
	records := timingRecords(t, logs)
	if records[len(records)-1]["outcome"] != "timed_out" {
		t.Fatal("missing deadline outcome")
	}
	for _, record := range records {
		if record["stage"] == "astro_build" && record["outcome"] == "success" {
			t.Fatal("killed process reported success")
		}
	}
}

func timingRecords(t *testing.T, logs *bytes.Buffer) []map[string]any {
	t.Helper()
	var records []map[string]any
	for _, line := range strings.Split(logs.String(), "\n") {
		start := strings.Index(line, `{"event":"local_build_timing"`)
		if start < 0 {
			continue
		}
		var record map[string]any
		if err := json.Unmarshal([]byte(line[start:]), &record); err != nil {
			t.Fatal(err)
		}
		records = append(records, record)
	}
	return records
}

func TestLocalBuildTimingPreparation(t *testing.T) {
	for _, scenario := range []string{"prepared", "failed", "cancelled", "superseded"} {
		t.Run(scenario, func(t *testing.T) {
			g, head := buildFixture(t)
			logs := captureBuildTimings(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			reads := 0
			latest := func(context.Context) (string, error) {
				reads++
				if scenario == "superseded" && reads > 1 {
					return strings.Repeat("b", 40), nil
				}
				return head, nil
			}
			run := func(ctx context.Context, root string, env []string) error {
				if scenario == "failed" {
					return errors.New("DO_NOT_LOG_CREDENTIAL_OR_CONTENT")
				}
				if scenario == "cancelled" {
					cancel()
					return ctx.Err()
				}
				if err := writeConfined(root, "site/dist/index.html", []byte("fixture")); err != nil {
					return err
				}
				return writeJSONAtomic(filepath.Join(root, "site/dist/version.json"), map[string]string{"commit": head})
			}
			err := g.prepareBuild(ctx, latest, run)
			if (err == nil) != (scenario == "prepared") {
				t.Fatalf("unexpected preparation result: %v", err)
			}
			records := timingRecords(t, logs)
			var terminal map[string]any
			stages := map[string]bool{}
			for _, record := range records {
				stages[record["stage"].(string)] = true
				if record["stage"] == "attempt" && record["outcome"] != "started" {
					terminal = record
				}
				if record["duration_ms"].(float64) < 0 {
					t.Fatal("negative duration")
				}
			}
			if terminal == nil {
				t.Fatal("missing terminal timing record")
			}
			if terminal["outcome"] != scenario || terminal["commit"] != head {
				t.Fatalf("incorrect terminal event: %v", terminal)
			}
			for _, stage := range []string{"latest-main lookup", "approved content baseline", "immutable checkout", "warm dependencies", "cleanup dependencies", "cleanup worktree", "cleanup attempt"} {
				if !stages[stage] {
					t.Errorf("missing stage %q", stage)
				}
			}
			if strings.Contains(logs.String(), "DO_NOT_LOG") {
				t.Fatal("raw diagnostic leaked")
			}
			if _, err := os.Stat(filepath.Join(g.cfg.StateDir, "local-build")); err != nil {
				t.Fatal(err)
			}
		})
	}
}

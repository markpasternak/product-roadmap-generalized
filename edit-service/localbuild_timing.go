package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Embedded in the editor so a locally deployed binary can measure an unchanged
// GitHub source snapshot. No instrumentation file enters the site or its ZIP.
//
//go:embed build-timing.mjs
var nodeBuildTiming []byte

type buildTimingKey struct{}
type buildQueuedAtKey struct{}

type buildTimingRecord struct {
	Event          string  `json:"event"`
	Attempt        string  `json:"attempt"`
	EditorRevision string  `json:"editor_revision"`
	Commit         string  `json:"commit,omitempty"`
	Stage          string  `json:"stage"`
	Parent         string  `json:"parent,omitempty"`
	Outcome        string  `json:"outcome"`
	DurationMS     float64 `json:"duration_ms"`
	OffsetMS       float64 `json:"offset_ms"`
	Cache          string  `json:"cache,omitempty"`
	PID            int     `json:"pid,omitempty"`
	Status         int     `json:"status,omitempty"`
	UserMS         float64 `json:"user_ms,omitempty"`
	SystemMS       float64 `json:"system_ms,omitempty"`
	MaxRSSKiB      int64   `json:"max_rss_kib,omitempty"`
}

type buildTiming struct {
	started                         time.Time
	attempt, commit, outcome, phase string
	phaseStarted                    time.Time
	probe                           string
}

func ensureBuildTiming(ctx context.Context) (context.Context, *buildTiming, bool) {
	if trace, ok := ctx.Value(buildTimingKey{}).(*buildTiming); ok {
		return ctx, trace, false
	}
	now := time.Now()
	trace := &buildTiming{started: now, attempt: fmt.Sprintf("%d-%d", os.Getpid(), now.UnixNano()), outcome: "prepared"}
	trace.emit(buildTimingRecord{Stage: "attempt", Outcome: "started"})
	if queued, ok := ctx.Value(buildQueuedAtKey{}).(time.Time); ok {
		trace.emit(buildTimingRecord{Stage: "queue wait", Outcome: "success", DurationMS: float64(now.Sub(queued)) / float64(time.Millisecond)})
	}
	return context.WithValue(ctx, buildTimingKey{}, trace), trace, true
}

func buildTimingFrom(ctx context.Context) *buildTiming {
	trace, _ := ctx.Value(buildTimingKey{}).(*buildTiming)
	return trace
}

func (b *buildTiming) emit(record buildTimingRecord) {
	if b == nil {
		return
	}
	record.Event, record.Attempt, record.EditorRevision, record.Commit = "local_build_timing", b.attempt, version, b.commit
	record.OffsetMS = float64(time.Since(b.started)) / float64(time.Millisecond)
	data, err := json.Marshal(record)
	if err == nil {
		log.Print(string(data))
	}
}

func timingOutcome(ctx context.Context, err error) string {
	if err == nil {
		return "success"
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return "timed_out"
	}
	if errors.Is(err, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
		return "cancelled"
	}
	return "failed"
}

func (b *buildTiming) step(ctx context.Context, stage string) func(error) {
	started := time.Now()
	parent := ""
	if b != nil {
		parent = b.phase
	}
	b.emit(buildTimingRecord{Stage: stage, Parent: parent, Outcome: "started"})
	return func(err error) {
		b.emit(buildTimingRecord{Stage: stage, Parent: parent, Outcome: timingOutcome(ctx, err), DurationMS: float64(time.Since(started)) / float64(time.Millisecond)})
	}
}

func (b *buildTiming) endPhase(ctx context.Context, err error) {
	if b.phase == "" {
		return
	}
	b.emit(buildTimingRecord{Stage: b.phase, Outcome: timingOutcome(ctx, err), DurationMS: float64(time.Since(b.phaseStarted)) / float64(time.Millisecond)})
	b.phase = ""
}

func (b *buildTiming) nextPhase(ctx context.Context, stage string) {
	b.endPhase(ctx, nil)
	b.phase, b.phaseStarted = stage, time.Now()
	b.emit(buildTimingRecord{Stage: stage, Outcome: "started"})
}

func (b *buildTiming) finish(ctx context.Context, err error) {
	b.endPhase(ctx, err)
	outcome := b.outcome
	if err != nil && outcome != "superseded" {
		outcome = timingOutcome(ctx, err)
	}
	b.emit(buildTimingRecord{Stage: "attempt", Outcome: outcome, DurationMS: float64(time.Since(b.started)) / float64(time.Millisecond)})
}

func (b *buildTiming) installProbe(job string) {
	path := filepath.Join(job, "build-timing.mjs")
	if err := os.WriteFile(path, nodeBuildTiming, 0600); err != nil {
		// Diagnostics must never prevent a valid publication.
		b.emit(buildTimingRecord{Stage: "node instrumentation", Outcome: "unavailable"})
		return
	}
	b.probe = (&url.URL{Scheme: "file", Path: path}).String()
}

// Treat subprocess telemetry as untrusted. Only bounded, typed numeric fields
// and fixed labels may reach the journal; never forward arbitrary JSON/output.
func (b *buildTiming) nodeRecord(line []byte, parent string) {
	const prefix = "ROADMAP_BUILD_TIMING "
	if b == nil || !strings.HasPrefix(string(line), prefix) || len(line) > 2048 {
		return
	}
	var record buildTimingRecord
	if json.Unmarshal(line[len(prefix):], &record) != nil {
		return
	}
	switch record.Stage {
	case "npm_build", "astro_build", "sync_presentations", "generate_version", "item_history", "document_links", "item_dates", "demo_check", "coordinator", "github_latest", "canvas_status", "canvas_manifest", "canvas_version", "canvas_upload", "prepare_content", "canvas_begin", "canvas_blob", "canvas_finalize":
	default:
		return
	}
	switch record.Outcome {
	case "started", "success", "failed", "conflict":
	default:
		return
	}
	if math.IsNaN(record.DurationMS) || math.IsInf(record.DurationMS, 0) || record.DurationMS < 0 || record.DurationMS > 300000 || record.PID < 0 || record.Status < 0 || record.Status > 599 || record.UserMS < 0 || record.UserMS > 300000 || record.SystemMS < 0 || record.SystemMS > 300000 || record.MaxRSSKiB < 0 || record.MaxRSSKiB > 1<<40 {
		return
	}
	b.emit(buildTimingRecord{Stage: record.Stage, Parent: parent, Outcome: record.Outcome, DurationMS: record.DurationMS, PID: record.PID, Status: record.Status, UserMS: record.UserMS, SystemMS: record.SystemMS, MaxRSSKiB: record.MaxRSSKiB})
}

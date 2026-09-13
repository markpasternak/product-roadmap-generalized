package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

// One credential-free renderer, reused for a short burst. Each request still
// verifies its package and owns a separate immutable checkout/output directory.
type contentRenderer struct {
	mu     sync.Mutex
	cmd    *exec.Cmd
	input  io.WriteCloser
	output *bufio.Reader
	done   chan struct{}
	key    string
}

func (r *contentRenderer) stopLocked() {
	if r.cmd != nil {
		select {
		case <-r.done:
		default:
			_ = syscall.Kill(-r.cmd.Process.Pid, syscall.SIGKILL)
		}
		_ = r.input.Close()
		<-r.done
		r.cmd = nil
	}
}
func (r *contentRenderer) close() { r.mu.Lock(); defer r.mu.Unlock(); r.stopLocked() }
func (r *contentRenderer) run(ctx context.Context, root string, env, args []string) error {
	if len(args) < 7 || filepath.Base(args[1]) != "prepare-content.mjs" {
		return runBuildCommand(ctx, root, env, args)
	}
	// Older approved packages predate the worker protocol. Keep upgrades and
	// rollbacks compatible with their ordinary one-shot command.
	if info, err := os.Stat(filepath.Join(filepath.Dir(args[1]), "content-cache.mjs")); err != nil || !info.Mode().IsRegular() {
		return runBuildCommand(ctx, root, env, args)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	key := args[2] + ":" + args[5] + ":" + args[6]
	if r.cmd != nil {
		select {
		case <-r.done:
			r.stopLocked()
		default:
		}
	}
	if r.cmd != nil && r.key != key {
		r.stopLocked()
	}
	warm := r.cmd != nil
	if !warm {
		cmd := exec.Command(args[0], args[1], "--worker", args[2], args[5], args[6])
		cmd.Dir, cmd.Env = filepath.Dir(args[1]), env // Never inherit GitHub/Canvas credentials.
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
		input, err := cmd.StdinPipe()
		if err != nil {
			return err
		}
		output, err := cmd.StdoutPipe()
		if err != nil {
			input.Close()
			return err
		}
		cmd.Stderr = io.Discard
		if err = cmd.Start(); err != nil {
			input.Close()
			output.Close()
			return err
		}
		r.cmd, r.input, r.output, r.key, r.done = cmd, input, bufio.NewReaderSize(output, 65536), key, make(chan struct{})
		done := r.done
		go func() { _ = cmd.Wait(); close(done) }()
	}
	trace := buildTimingFrom(ctx)
	cache := "cold"
	if warm {
		cache = "warm"
	}
	if trace != nil {
		trace.emit(buildTimingRecord{Stage: "renderer process", Outcome: "success", Cache: cache})
	}
	request, _ := json.Marshal(map[string]string{"checkout": args[3], "output": args[4]})
	completed := make(chan error, 1)
	go func() {
		if _, err := r.input.Write(append(request, '\n')); err != nil {
			completed <- err
			return
		}
		line, err := r.output.ReadSlice('\n')
		if err != nil {
			completed <- err
			return
		}
		var response struct {
			OK     bool `json:"ok"`
			Result struct {
				RenderedPages int                        `json:"renderedPages"`
				Cache         struct{ Hits, Misses int } `json:"cache"`
			} `json:"result"`
		}
		if json.Unmarshal(line, &response) != nil || !response.OK {
			completed <- errors.New("renderer rejected preparation")
			return
		}
		if trace != nil {
			trace.emit(buildTimingRecord{Stage: "render cache", Outcome: "success", Cache: fmt.Sprintf("pages=%d hits=%d misses=%d", response.Result.RenderedPages, response.Result.Cache.Hits, response.Result.Cache.Misses)})
		}
		completed <- nil
	}()
	select {
	case err := <-completed:
		if err != nil {
			r.stopLocked()
		}
		return err
	case <-ctx.Done():
		r.stopLocked()
		<-completed
		return ctx.Err()
	case <-time.After(2 * time.Minute):
		r.stopLocked()
		<-completed
		return errors.New("renderer preparation deadline")
	}
}

type buildWakeKey struct{}

// Hints cannot authorize cancellation. Resolve authoritative main and cancel
// only preparation; drain this monitor before entering publication/finalization.
func monitorContentHead(ctx context.Context, head string, latest func(context.Context) (string, error)) (context.Context, func() bool) {
	hints, _ := ctx.Value(buildWakeKey{}).(chan time.Time)
	preparation, cancel := context.WithCancel(ctx)
	stopped, done := make(chan struct{}), make(chan struct{})
	superseded := false
	var unresolved time.Time
	go func() {
		defer close(done)
		for {
			select {
			case <-stopped:
				return
			case <-ctx.Done():
				return
			case hint := <-hints:
				unresolved = hint
				current, err := latest(preparation)
				if err == nil {
					unresolved = time.Time{}
				}
				if err == nil && current != head {
					superseded = true
					cancel()
					return
				}
			}
		}
	}()
	return preparation, func() bool {
		close(stopped)
		cancel()
		<-done
		// A lookup interrupted by the preparation boundary has not consumed the
		// hint's obligation. Give it back to the worker for immediate reconciliation.
		if !superseded && !unresolved.IsZero() {
			select {
			case hints <- unresolved:
			default:
			}
		}
		return superseded
	}
}

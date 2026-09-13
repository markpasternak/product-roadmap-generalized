package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestContentRaceBarrier(t *testing.T) {
	for _, scenario := range []string{"unarmed", "release", "timeout", "cancel", "symlink", "public", "stale"} {
		t.Run(scenario, func(t *testing.T) {
			root, commit := t.TempDir(), strings.Repeat("a", 40)
			arm := filepath.Join(root, "race-arm-"+commit)
			waiting := filepath.Join(root, "race-waiting-"+commit)
			if scenario != "unarmed" {
				if err := os.WriteFile(arm, nil, 0600); err != nil {
					t.Fatal(err)
				}
			}
			if scenario == "symlink" {
				os.Remove(arm)
				os.Symlink(filepath.Join(root, "absent"), arm)
			}
			if scenario == "public" {
				os.Chmod(arm, 0644)
			}
			if scenario == "stale" {
				os.WriteFile(waiting, nil, 0600)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if scenario == "cancel" {
				cancel()
			}
			done := make(chan error, 1)
			go func() { done <- waitContentRaceBarrier(ctx, root, commit, 300*time.Millisecond) }()
			if scenario == "release" {
				deadline := time.Now().Add(time.Second)
				for {
					if _, err := os.Stat(waiting); err == nil {
						break
					}
					if time.Now().After(deadline) {
						t.Fatal("gate never reached")
					}
					time.Sleep(time.Millisecond)
				}
				if err := os.Remove(waiting); err != nil {
					t.Fatal(err)
				}
			}
			err := <-done
			if scenario == "unarmed" || scenario == "release" {
				if err != nil {
					t.Fatal(err)
				}
			} else if err == nil {
				t.Fatal("unsafe gate accepted")
			}
			if scenario == "timeout" && !errors.Is(err, context.DeadlineExceeded) {
				t.Fatal(err)
			}
			if scenario == "cancel" && !errors.Is(err, context.Canceled) {
				t.Fatal(err)
			}
			if scenario == "release" || scenario == "timeout" || scenario == "cancel" {
				if _, err := os.Lstat(arm); !os.IsNotExist(err) {
					t.Fatal("arm not consumed")
				}
				if _, err := os.Lstat(waiting); !os.IsNotExist(err) {
					t.Fatal("waiting gate leaked")
				}
				if err := waitContentRaceBarrier(context.Background(), root, commit, time.Millisecond); err != nil {
					t.Fatal("gate was not one shot", err)
				}
			}
		})
	}
}

package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"time"
)

// Operator-only, one-shot gate in the private service state directory. Arm it
// with an empty race-arm-<commit> file; remove race-waiting-<commit> to release.
// It is reachable only when explicitly enabled in protected configuration.
// A timeout or shutdown aborts this attempt; freshness is checked after release.
func waitContentRaceBarrier(ctx context.Context, root, commit string, timeout time.Duration) error {
	if !gitSHA.MatchString(commit) {
		return errors.New("invalid race barrier commit")
	}
	arm := filepath.Join(root, "race-arm-"+commit)
	waiting := filepath.Join(root, "race-waiting-"+commit)
	info, err := os.Lstat(arm)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() != 0 || info.Mode().Perm()&0077 != 0 {
		return errors.New("race barrier requires an empty private regular file")
	}
	// An exclusive waiting file also makes a stale gate fail closed after restart.
	f, err := os.OpenFile(waiting, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	defer os.Remove(waiting)
	if err := os.Remove(arm); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			info, err := os.Lstat(waiting)
			if os.IsNotExist(err) {
				return ctx.Err()
			}
			if err != nil {
				return err
			}
			if !info.Mode().IsRegular() || info.Size() != 0 {
				return errors.New("race barrier changed unexpectedly")
			}
		}
	}
}

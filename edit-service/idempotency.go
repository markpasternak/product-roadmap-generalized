package main

import (
	"sync"
	"time"
)

// syncCacheResult is what handleSync caches per (login, requestId) so a
// retried request can be answered without re-committing (R3/KTD3).
type syncCacheResult struct {
	SHA             string
	NoChanges       bool
	SkippedReorders []string
}

type syncDedupEntry struct {
	result  syncCacheResult
	expires time.Time
}

// syncDedup is handleSync's in-memory (login, requestId) -> result cache.
// It's a fast-path only, not the correctness guarantee (KTD3): the
// repo-state itself (buildFiles' no-op-write behavior) is the durable safety
// net for a cache miss caused by TTL expiry or a process restart. Single
// instance, not persisted — bounded by ttl and a max-entries cap so a stream
// of distinct request ids can't grow it without bound.
type syncDedup struct {
	mu      sync.Mutex
	ttl     time.Duration
	max     int
	entries map[string]syncDedupEntry
	now     func() time.Time // overridable in tests for deterministic TTL behavior
}

func newSyncDedup(ttl time.Duration, max int) *syncDedup {
	return &syncDedup{ttl: ttl, max: max, entries: map[string]syncDedupEntry{}, now: time.Now}
}

func syncDedupKey(login, requestID string) string { return login + "\x00" + requestID }

// get returns the cached result for (login, requestId), if present and not
// expired. An empty requestId always misses — dedup is opt-in per request.
func (d *syncDedup) get(login, requestID string) (syncCacheResult, bool) {
	if requestID == "" {
		return syncCacheResult{}, false
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	now := d.now()
	d.evictExpiredLocked(now)
	e, ok := d.entries[syncDedupKey(login, requestID)]
	if !ok {
		return syncCacheResult{}, false
	}
	return e.result, true
}

// put stores result for (login, requestId), first evicting anything expired
// and then, if still at the cap, the single oldest-expiring entry — bounding
// memory without needing a full LRU.
func (d *syncDedup) put(login, requestID string, result syncCacheResult) {
	if requestID == "" {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	now := d.now()
	d.evictExpiredLocked(now)
	if len(d.entries) >= d.max {
		d.evictOldestLocked()
	}
	d.entries[syncDedupKey(login, requestID)] = syncDedupEntry{result: result, expires: now.Add(d.ttl)}
}

func (d *syncDedup) evictExpiredLocked(now time.Time) {
	for k, e := range d.entries {
		if now.After(e.expires) {
			delete(d.entries, k)
		}
	}
}

func (d *syncDedup) evictOldestLocked() {
	var oldestKey string
	var oldestExp time.Time
	first := true
	for k, e := range d.entries {
		if first || e.expires.Before(oldestExp) {
			oldestKey, oldestExp, first = k, e.expires, false
		}
	}
	if oldestKey != "" {
		delete(d.entries, oldestKey)
	}
}

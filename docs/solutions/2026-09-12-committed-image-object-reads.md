# Committed image reads without per-request worktrees

Seven fallback image requests previously serialized Git fetch, checkout and full
asset scans. The authenticated baseline on 12 September 2026 was 20 bursts of the
same seven originals: median full-burst completion 4,414.7 ms, request p50 TTFB
2,517.5 ms and p95 TTFB 4,434.9 ms. All responses were 200 and their SHA-256 values
were recorded without session credentials. Post-deployment measurements belong in
Canvas Drop tracking issue #121 alongside the deployed binary revision.

The new reader shares a five-second committed metadata snapshot and reads the
requested original by object ID. Publication and receipt recovery invalidate the
latest pointer. Retained commits are pinned in a private Git ref namespace, so a
force-push and pruning cannot destroy an active response. There are at most eight
snapshots including active readers, an 8 MiB metadata budget, and four original
responses held through completion. No authorization or staged-upload data is cached.

A bounded writer must not embed `bytes.Buffer`: its promoted `ReadFrom` method lets
`io.Copy` bypass the wrapper's `Write` limit. Use a named buffer field. The Git-output
regression test failed before that correction and passes with it.

Tests use local bare repositories and controlled cancellation/refresh barriers.
They cover one fetch for concurrent cold reads, no warm fetch/worktree, expiry and
failure, publication/recovery invalidation, leased commit eviction, force-push/prune,
metadata overflow, original corruption, HTTP range/HEAD and slow writer capacity.
The independent review added a 60-second response write deadline, verified release
on write failure, and a production fetch/clone test with token-failure coverage.
Size, SHA-256 and MIME validation precede the existing private, no-store response.

Release the Go binary independently of the static frontend. Preserve existing
production-only instrumentation in an isolated local release composition if it has
not reached origin/main; do not publish unrelated local work in the performance PR.
Record the composed source revision and binary hash and preserve the previous binary.

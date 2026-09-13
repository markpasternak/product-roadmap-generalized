# Content renderer proof checkpoint

Scope: SeenThis only, local development worktree. No push, deployment, production timing or release approval is represented by this report.

## Observed

- One precompiled application package rendered two real Git revisions of a temporary clone. Only the second clone revision changed the STUDIO-001 title; no actual roadmap item was edited.
- Both candidates contained the board, 88 full item pages, five document pages and eight referenced managed files. All 309 public application files in those two candidates had identical SHA-256 hashes.
- Local content preparation took 1.418 and 1.460 seconds. These are two exploratory samples, not the paired same-server performance gate or deployment latency. The command used the compiled renderer and Git history, without an Astro/Vite build or install.
- Route-specific initial seeds reduced candidate disk usage from 137 MB to 30 MB. A representative item HTML file fell from 1,264,422 to 67,250 bytes. Full content remains available in a separate snapshot; live snapshot replacement is not implemented at this checkpoint.
- Browser proof: item and document hydration, document headings, initial HTML, no console errors. A missing stylesheet insertion marker was found visually and fixed; a fresh item screenshot confirms its typography and status layout. CSS is linked in initial HTML, including route-specific lazy component CSS.
- Route-specific new application JS totals (gzip, excluding existing Astro shell scripts): item 108,881 bytes; document 63,642; board 277,436. Item/document requests do not include the Board component. The existing shell still has a separate Vue runtime, to be removed during integration.
- Automated checks: 1,029 frontend tests passed; five package/client-assets/history tooling tests passed. Typecheck found a redundant test-fixture field, which was removed; the follow-up check passed with zero errors/warnings and nine pre-existing hints. No separate lint command is configured.

## Safety and scope

The new package verifier requires a separately supplied approved digest before importing executable renderer files. It checks protocol, runtime, profile, dependency digest, inventory, bytes, paths and symlinks. These local development packages are not trusted CI artifacts and have not been promoted to any server.

The existing delivery path remains active. Remaining work includes complete route/static-file ownership, public resource fixtures, browser update/draft protection, staged Canvas coordination, Go reconciliation, CI provenance/promotion, and the release verification gates in the plan. Initial-page hydration is not evidence for no-refresh live updates.

## Simplification checkpoint

Applied the three ce-simplify-code rubrics inline per repository instructions. Reuse: shared SHA-256 helper (one finding). Quality: clarified invocation-scoped history reader formatting (one finding). Efficiency: indexed available asset paths once instead of nested scans per reference (one finding). Deliberate legacy/new route duplication was retained for parity proof as required by the migration plan. No safety checks were removed.

## U3 complete-output checkpoint

- The candidate writer now owns every emitted path, enforces Canvas file/count/byte limits and rejects duplicate/case-colliding paths. Its private receipt stays outside the public directory. Current HTML, content-addressed snapshot, version descriptor, sitemap and resource catalog are generated from one revision; application-owned help/shares/presentations/branding remain reusable.
- All current content routes are rendered: board and six products, item/document pages, document index, themes, changelog and activity page. The current corpus produced 104 content routes.
- Controlled Git fixtures passed for an internal root deployment and public `/roadmap/` deployment: new resources, cover replacement, item/document deletion, empty public output, private/unused resource exclusion and corrupted resource checksum rejection. Fixture attachment bytes prove manifest/URL handling, not media decoding or playback.
- Semantic comparisons passed for all 88 item pages and five full document pages against the existing Astro output. This checks content fields/sections, dates, links, covers, document headings/paragraphs/code/tables/backlinks, not pixel equivalence of every route.
- Existing full-build fallback passed: 107 pages, 66 document links and 88 item-history records checked. The full frontend suite passed 1,033 tests; typecheck had zero errors/warnings and nine existing hints. The subsequent HTML-allowlist regression suite passed four tests.
- A warm-history local preparation sample took 0.674 seconds, including the complete candidate manifest. This remains a single workstation preparation sample, not activation latency or the ten-pair same-server performance gate.

The application package build uses empty content loaders and does not package roadmap Markdown into the reusable shell. Document HTML now has an explicit element/attribute allowlist; raw managed attachment/media links receive the same deployment base as images. Initial item dates are deterministic UTC through hydration, then localize on mount.

Legacy/new route duplication is intentional until final parity and release checks pass. Browser refresh/draft protection, staged coordinator, Go/CI integration, provenance and rollout gates remain unfinished at this checkpoint. No migration code has been pushed or deployed.
# Same-release preview revalidation checkpoint (2026-09-13)

U9 implemented on the existing feature worktree, with U4 edits preserved. New tests
first failed on the old no-store/no-ETag behavior and missing staged-byte integrity
checks. After implementation, `go test -race ./...` passed (20.132 s) and `go vet
./...` passed. Existing object integrity, snapshot invalidation, HEAD/Range, slow
writer capacity and deadline tests remain in the suite. Added coverage exercises
weak/list/star validators, nonmatches, precondition precedence, invalid/expired
sessions, wrong-account uploads, missing/expired/corrupt files, removed/changed
committed assets, refresh failures, and metadata-only immutable-object validation.

Actual Chromium proof used `TestPreviewBrowserHarness`, real Go routes and local
Git/staged PNG files; page/API origins were distinct loopback ports. No browser
network interception, manual conditional headers or in-memory preview cache:

| Scenario | Committed original | Account-owned upload |
| --- | --- | --- |
| Alice initial open | 200, 4,260 body bytes | 200, 4,260 body bytes |
| Alice reopen | 304, 0 body bytes | 304, 0 body bytes |
| Page reload then reopen | 304, 0 body bytes | 304, 0 body bytes |
| Switch to Bob | Not needed (committed resources remain session-readable) | 404, error JSON only, no success ETag |
| Log out then reopen | 401, error text only, no success ETag | 401, error JSON only, no success ETag |

The browser automatically sent the original SHA-256 validator after reload, and
even on Bob's denied draft request. CORS preflights passed, success/304 carried
`private, no-cache` and both Vary fields; errors carried `private, no-store`.
The fixture image decoded in Chromium. Browser snapshots are under ignored
`.playwright-cli/page-2026-09-13T09-42-*` / `09-43-*`; the reproducible opt-in harness
is tracked. This is HTTP-cache proof, not production-deployment or live OAuth proof.
Already downloaded files/page-memory images cannot be revoked by revalidation.

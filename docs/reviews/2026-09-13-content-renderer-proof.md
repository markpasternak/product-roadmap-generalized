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

## U4 / U10 local implementation checkpoint (2026-09-13)

- The compiled browser now polls a small descriptor while visible, validates the complete candidate's identity/hash/size/audience/shape, and applies compatible content in place. Incompatible application/schema/profile changes offer a guarded reload. Offline/errors retain the last accepted model. Deferred candidates are rechecked after a long interaction.
- Shared guards cover initial workspace recovery, unsaved drafts, publication receipts/conflicts, active editors, resource transfer, drag/rename/swipe and composition. Accepted content refreshes the clean editor base from that exact Git commit; activity, document metadata and image viewing follow the accepted revision. Focus restoration now follows the integrated card's opening button rather than the superseded button-shaped card.
- Share preview and baking use the accepted snapshot's resource catalog rather than fetching a potentially newer catalog. Matching original bytes are checked before inclusion, and the published base commit is recorded in metadata. Existing full-Astro callers still use the catalog fallback until U11 removes legacy rendering; draft sharing retains its existing semantics.
- Cards use one surface, full-width title/summary, optional internal theme/tag links, and a compact bottom row. The product badge leads that row only when multiple products need distinguishing. View → Show labels is off by default, stored in `rm-card-labels`, and not exported into URLs or shares. Presentation and baked cards always omit taxonomy; opened external items expose themes but no owner or ordinary tags.
- Test-first evidence: the new default/opt-in/layout/presentation/share assertions initially failed on the attached-footer implementation. Strengthening the focus assertion to compare the actual focused element exposed the changed selector; fixing it restored keyboard focus. A malformed snapshot-pinned catalog test failed before adding its validation.
- Current automated checks: **92 frontend files / 1,073 tests pass**; typecheck has **0 errors, 0 warnings, 9 existing hints**. Four package verification / initial-CSS tooling tests pass. No separate lint command is configured; `git diff --check` passes.
- Actual Chromium checks: desktop light/dark and 390px mobile cards; theme click filters without opening the initiative; presentation has zero card labels with the personal preference still `1`; no mobile document overflow. The local dev URL remains `http://127.0.0.1:4335/`. Its Astro development-toolbar dependency still returns an Outdated Optimize Dep 504; the card application works. This is not present in the compiled proof.
- Fresh compiled package `a7fb0d39d805ce5dc5f33c01609123d8bb81382b7862a5b094519844f8134307` produced 104 routes from the controlled clone, hydrated 71 visible cards with compact product badges and no browser errors. Preparation took 1.556 seconds locally (single exploratory sample, not deployment latency or the release performance gate). This is a development package from uncommitted source, not a promoted CI artifact.
- The actual share renderer/projector was exercised with the same real content model and bundled brand/font files in a local-only harness: 88 cards, zero card taxonomy controls, 88 bottom product badges, no old square product marks, no browser errors. Opening an item exposed its theme; clicking it closed the item and filtered to three matching cards. Browser screenshots are in ignored `output/playwright/cards-integrated-*.png` and `cards-baked-share.png`. No share was published.
- ce-simplify-code review used all three rubrics inline per repository instructions: reuse **0**, quality **2** (remove obsolete baked-card wrapper/CSS and rename product helper to match badge semantics), efficiency **0**. The optional resource catalog fallback was retained because current full-Astro callers still need it. This checkpoint is not the final ce-code-review or shipping gate.

U4 and U10 now have locally verified implementations; live release acceptance remains pending. U11 legacy renderer removal, U5 staged coordination, U6 Go/CI trust and reconciliation, U7 Actions integration, and U8 performance/race/rollout gates remain. All work stays on the existing SeenThis branch; generalized is unchanged. Nothing in this checkpoint has been pushed or deployed.

## U10 View / Filter refinement checkpoint (2026-09-13)

- View is now a full-height modal drawer, using the same global drawer palette, width, header/footer styles and transition rules as Filter. Both honor reduced motion. Matching action buttons use bookmark/funnel icons and no menu chevron. Settings and saved views scroll together; the header and Done action remain visible. Existing noncompact saved-view usage retains its popover behavior.
- Layout, Show horizons and Card details are explicit groups. Horizon options use a single ordered column, reversed only when horizon lanes are reversed; product-grouped boards and timelines keep canonical order. Counts, hidden options, persistence and share settings retain their prior semantics. Internal labels remain excluded from presentations and baked shares.
- Regression tests first failed for the missing groups, drawer semantics, trigger styling and non-scrolling focus restoration. New tests cover canonical/reversed/product/timeline ordering, modal focus/scroll restoration and fixed-heading versus scrolling-body structure. The full suite passes **91 files / 1,077 tests**; typecheck reports **0 errors, 0 warnings, 9 pre-existing hints**. `git diff --check` passes.
- Chromium checks cover desktop dark, 390×650 mobile, scrolling to labels, keyboard wrap, Escape and focus return. Computed View and Filter widths, background/text colors, header padding and footer colors matched. Shared transition rules are 200ms opacity / 250ms transform; reduced-motion disables both. Screenshots are under ignored `output/playwright/view-drawer-*` and `filter-drawer-desktop-dark.png`.
- Closing jump: a controlled comparison temporarily restored the old unqualified focus call for the Filter opener. Closing moved the page from **250 to 197.5px**. With `preventScroll`, opening and closing retained **250px**. The override was removed after the comparison. Root scrollbar gutter is stable to avoid width changes on classic-scrollbar systems; the available Chromium uses overlay scrollbars, so that platform-specific benefit is CSS-reviewed, not visually proven here.
- Shared focus cleanup now also releases the Filter lock when its board unmounts. Preview restart removed stale server/client markup warnings. The existing Astro development-toolbar optimized-dependency 504 remains a development-only limitation; the interactive application checks passed.
- Inline cleanup followed the ce-simplify-code reuse/quality/efficiency rubrics: shared drawer CSS replaces two divergent style/motion definitions; obsolete compact-popover positioning state was removed; no extra computation or dependencies were introduced. Final release review and production acceptance remain pending. This is a local same-release checkpoint, not a deployment.

## U11 unified full-build checkpoint (2026-09-13)

- Full builds now compile an application package and then call the same content renderer used by content publication. Astro builds only the layout templates and application-owned pages. Development uses injected routes backed by the same model/presentation components and resource policy.
- Removed the nine old content route implementations, Astro content collections and board/document adapters, old Markdown wrapper, repository-root adapter and standalone version generator. These source deletions are recoverable from Git. The standalone content writer now owns resources/catalog/sitemap/version metadata for both build paths; no second HTML scanner/copy hook is retained.
- The fresh full build generated **104 content routes / 88 items / 5 documents / 8 resources**, verified **66 document links** and **88 item histories**. Application package `caa390f859a698af9679846d5e9a5d32ab963cd1826ba88f61d86e55bccf53d4` contains **647 files**. Content preparation took **0.534 seconds** locally, not a server activation measurement.
- Non-vacuous compiled integration fixtures pass for internal root and public `/roadmap/` packages, including resource creation/replacement/deletion, omitted stale routes, byte hashes and private sentinel exclusion. Public package digest: `eb8ff83a1222d6654bee32cab1ae199113eb6c28ad84db8d8bacf1f0e46ed285`. These are local proof packages, not trusted CI artifacts.
- The generated `dist` is replaced only after candidate checks; tests preserve prior output on missing candidates and reject symlinked destinations. The latter test was strengthened to supply a valid candidate, ensuring it actually exercises destination validation.
- Cleanup review applied inline: reuse **1** (one resource policy), quality **1** (obsolete adapter references), efficiency **1** (one candidate stat read); safety checks retained. The full frontend suite and typecheck passed in the adjacent UI checkpoint. Tooling contracts passed **32 tests**, plus the explicitly enabled internal/public integration cases. No lint command is configured.

U11 implementation is complete locally; final application/publication integration review remains part of U5–U8. No migration push or deployment has occurred.

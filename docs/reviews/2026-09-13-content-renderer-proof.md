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

# Optional local builds and coordinated publication

The editor can prepare a site ZIP or publish it directly through Canvas Drop's
deployment API. Both modes are opt-in. No mode or no token leaves publishing to
GitHub Actions. A failed fast-path attempt never changes the successful save
response, disables Actions, or marks a publication live.

## Flow and concurrency

1. Both `/api/publish` and legacy `/api/sync` notify one background worker after
   a real successful push. No-op saves, conflicts and failed pushes do not.
2. Saves retain their Git lock; builds run outside it. One active build and one
   coalesced pending notification fetch latest `main`, not a queue of old SHAs.
3. The fetched SHA must descend from an explicitly approved application baseline
   and differ only in CI's content allowlist. Content symlinks, executable files,
   submodules and new application code reject the local attempt.
4. A detached worktree freezes that SHA. In deploy mode, the shared Node helper
   checks GitHub's current `main`, reads Canvas, and captures its publication
   token **before building**. A verified matching live release skips the build.
5. Otherwise, validation, the full Astro build, source links and item dates must
   pass. The generalized demo additionally runs its fictional-content check and
   a local full-history gitleaks scan before upload.
6. `version.json` must match the selected SHA. The worker packages regular,
   non-dotfiles and re-fetches `main`. The helper rechecks GitHub immediately
   before its conditional API call.
7. Successful activation gets authenticated readback. The browser's existing
   deployed-version check can then observe it; no new UI success state is invented.

Concurrent editor saves are serialized as before. Builds are coalesced, not
serialized with saves. Other content sources are included whenever the worker
fetches them; external-only pushes still trigger Actions, not a new local watcher.
A restart drops pending notifications. Actions remains the durable fallback.

## Exact Canvas contract

`tooling/deploy/coordinate.mjs` is used by both the Go worker and Actions.
It uses the per-canvas Bearer key, never a filesystem copy into Canvas storage.

- `GET /v1/canvases/{id}`: read `publicationToken`, `publicationState` and
  `currentVersion.{id,number,releaseId}`.
- `PUT /v1/canvases/{id}/deploy?releaseId=...&expectedPublicationToken=...`:
  upload a raw site-root ZIP with **both** coordination fields.
- HTTP 200 `published` / `already_current`: verify live readback before success.
- HTTP 409 `PUBLICATION_CHANGED` / `RELEASE_NOT_CURRENT`: stop. Do not fetch a
  new token and retry, reactivate an old release, or invent a new release ID.
- An uncertain network result permits readback only, never a second PUT.
- An old server without coordination readback fails closed. There is no
  unconditional deployment fallback inside the new client.

The shared release identity is `roadmap-v1-` plus SHA-256 of NUL-separated
schema version, repository, full Git SHA, and five explicit profile values:
`SITE_URL`, `SITE_BASE`, `SITE_AUDIENCE`, `PUBLIC_EDIT_API`,
`PUBLIC_CANVAS_BACKEND`. Both callers use the same helper and profile. It is
opaque, not sortable; a ZIP checksum is not the release identity.

Canvas atomically guards its live pointer and deduplicates matching releases.
It does **not** know Git ordering. A new commit can arrive between the final GitHub
read and activation; the newer commit's Actions run still reconciles the site.
Manual rollback/unpublish changes the token and cannot be overwritten using the
old captured token. A later, genuinely new build may publish from a new observation.

## Verification and Actions

For a new upload, readback compares every local output's SHA-256 and size with the
authenticated live manifest and checks the live `version.json` commit. Before and
after status reads must have the same version ID and publication token.

If this exact release is already live, Actions can skip dependency installation,
build, checks of that artifact and ZIP creation. Without a local artifact there is
no local-file comparison: the report explicitly says `release-identity`, proving
the authenticated current release, commit and version-file hash. A fresh upload
reports `all-local-files`. Release identity assumes trusted publishers use the
same inputs; it is not independent proof of a byte-identical reproducible build.

Application-code gates stay in Actions. The generalized repository keeps its
mandatory CI security gate, including when its artifact is already live; local
new-artifact deployment also requires the same full-history scan. Conflicted,
stale or unverified workflow runs fail instead of becoming a false successful
deployment baseline for change classification.

## Host configuration and rollout order

First deploy Canvas Drop's coordination migration/API (`0043`; PostgreSQL
requires version 13+). Then roll out the coordinated roadmap Actions helper and
verify a normal Actions deployment. Only then enable the editor's fast path.

Server-only settings, with public profile values copied exactly from deploy.yml:

```dotenv
ROADMAP_LOCAL_BUILD_MODE=deploy
CANVAS_DROP_TOKEN=<per-canvas key>
CANVAS_API_URL=https://your-roadmap.canvas-drop.com/v1/canvases/<canvas-id>
ROADMAP_LOCAL_BUILD_BASE_SHA=<full approved 40-character application SHA>
ROADMAP_LOCAL_BUILD_DEPENDENCIES=/absolute/path/to/trusted-checkout/site
SITE_URL=https://your-roadmap.canvas-drop.com
SITE_BASE=/
SITE_AUDIENCE=internal
PUBLIC_EDIT_API=https://your-editor.example.com
PUBLIC_CANVAS_BACKEND=true
```

Use `prepare` mode for offline preparation only: no Canvas or GitHub API calls
from the deployment helper, no upload and no live claim. It still fetches Git
through the editor's existing installation credential. A placeholder Canvas token
can satisfy its presence gate for isolated tests.

An empty mode/token disables the worker; incomplete optional settings log a
disabled reason without preventing editor startup. No deployment is enabled by
merely installing the new binary. Keep Actions enabled in all modes.

Choose the approved baseline from a revision with verified checks and deployment,
including this helper. Never automatically approve latest main or a dirty working
tree. New application changes deliberately fall back to Actions until the baseline
and trusted dependency checkout are reviewed and advanced.

Provision Node 24/npm, Python and validator dependencies, Git and `cp`.
For the generalized demo also provision trusted `gitleaks` v8.30.1, matching CI,
on PATH: missing tooling or a failed `gitleaks git . --redact=100 --log-opts=--all`
stops local publication. No network package install runs inside the worker.

Provision `site/node_modules` in a trusted checkout with matching package and lock
files. The first build copies dependencies privately; later builds move that
private cache in and out of the worktree. The source checkout is never modified.
The helper alone receives Canvas and GitHub credentials; build commands receive
only an explicit public environment. This is **not an OS sandbox**: trusted build
scripts still have the service user's filesystem permissions. Review service
account isolation, resource limits and disk capacity before enablement.

On the current Ubuntu host, Node 24 cannot start with
`MemoryDenyWriteExecute=yes`. Astro's presentation-copy step also needs
`fchown`, which the existing `~@privileged` syscall filter denies.
An isolated real-build test retained the other editor restrictions while
setting `MemoryDenyWriteExecute=no` and adding a final
`SystemCallFilter=fchown` allowance after the existing filters.
Apply only these scoped compatibility changes after validating the actual unit;
do not remove the syscall filter or run the editor as root.
Set explicit resource limits and check both editors building together on this
shared host before claiming simultaneous-load safety.

## Private state and recovery

One service instance owns each state/cache directory, outside served content.
Only one prepared ZIP and one dependency cache are retained. Abandoned owned
attempt directories are cleaned on the next attempt, not replayed.

- `local-build/prepared/site.zip`: last retained regular-file artifact.
- `local-build/prepared/receipt.json`: preparation metadata and ZIP checksum;
  state is `prepared-not-deployed` or `deployment-verified`.
- `local-build/last-deployment.json`: last successful live readback, including
  release identity, version ID, token and verification level.

These are historical receipts, not durable claims that the site is still current.
A rollback, new deployment or failed subsequent attempt can leave them outdated.
Deploy mode always consults Canvas; it never skips based on a cached local receipt.
Graceful shutdown drains accepted HTTP requests, then cancels the worker and its
subprocess group. The next push or Actions handles missed work.

## Local verification

From the repository root:

```sh
node --test tooling/ci/*.test.mjs site/scripts/build-item-history.test.mjs
cd edit-service
go test -race ./...
go vet ./...
ROADMAP_TEST_REAL_BUILD=1 go test ./... -run '^TestLocalBuildRealAstro$' -count=1 -v
```

Contract tests use a local HTTP server. The Go integration test crosses the real
worktree, helper, ZIP upload and authenticated hash-readback boundaries with a
fixture GitHub ref. No test publishes to a real Canvas. The opt-in Astro test
builds the current committed site twice (cold/warm private dependencies), without
fetching, pushing or uploading.

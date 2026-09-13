# SeenThis content-publication release and operations

This release changes only product-roadmap. Do not change generalized, Canvas
Drop, neighboring services, or branch protection. Preserve later Git publications.

## Package and publisher contract

- One complete Canvas version contains application files, current HTML/data and
  referenced managed originals. The private renderer and executable commands are
  never in its public manifest. Removed paths disappear from the new manifest.
- `roadmap-v2` release identity includes repository, target Git commit, the five
  build-profile values and the canonical application's source/digest. Both
  publishers use `coordinate.mjs`, missing-hash staged uploads, original-token
  conditional finalize and authenticated complete-manifest/snapshot verification.
- A successful exact-main `deploy.yml` run stores
  `roadmap-application-<package-digest>` as a private GitHub artifact. Reuse verifies
  repository/head repository, workflow identity/path, source/ref, successful run,
  artifact archive SHA-256, package SHA-256, profile and every inventory file.
  PR artifacts, failed runs, expired packages and symlinks cannot authorize code.
- A missing or invalid artifact triggers Actions' full build. That replacement
  becomes the new canonical application. The server refuses to overwrite it with
  its older approved package. The separate application-sync operator verifies and
  promotes the successful Actions artifact automatically before local reuse resumes.
  Unexpected reuse fallback emits a credential-safe Actions warning and records
  `fallbackReason` in the verification receipt (`fallback_reason` step output).

## Initial installation order

1. Finish local tests, compiled-browser parity, ten paired isolated same-host
   preparation samples under the existing 1,000 MiB limit, and code review.
   Record preparation separately from activation; do not call it end-to-end proof.
2. Fetch main and preserve intervening publications. Push this existing branch,
   open/update its PR and wait for the normal required checks. No admin override.
3. Land the reviewed PR through the normal merge path. Actions performs the first
   full application release, creates the private artifact and verifies Canvas.
   Keep the old local mode disabled during the application cutover.
4. Verify the exact live source/application/package and authenticated file hashes.
   Save the previous binary, environment and approved package for rollback.
5. Install the reviewed editor binary with its commit embedded. Verify local and
   remote SHA-256, health/capabilities and the running binary. Restart only SeenThis.
6. Explicitly download/promote the successful canonical artifact, then configure
   shadow mode. Verify a real immutable snapshot can prepare without activation.
7. Configure and verify the GitHub push webhook below. Enable `content` mode only
   after the shadow/identity checks. Verify startup reconciliation and duplicate
   suppression, then perform user-assisted acceptance tests.

For subsequent application releases, leave content mode enabled: eligibility
rejects code changes until Actions finishes and the automatic handover below
approves its package. A manual mode change or editor restart is unnecessary.

## Manual recovery promotion

Run the reviewed command with `GITHUB_REPOSITORY`, `GH_TOKEN` (Actions read) and
the exact `SITE_URL`, `SITE_BASE`, `SITE_AUDIENCE`, `PUBLIC_EDIT_API`,
`PUBLIC_CANVAS_BACKEND` from deploy.yml. Never obtain executable code from Canvas.

```sh
node tooling/deploy/application-artifact.mjs promote \
  <approved-application-source> <approved-package-digest> \
  <new-private-package-directory> <approved-pointer.json>
```

The directory must not exist. Extraction is confined; promotion changes the
pointer atomically only after authenticated provenance and all hashes pass.
Install packages and the pointer root-owned/read-only to the editor account;
grant that account read/traverse permissions. Keep the previous package until
release acceptance. Node 24 and Python 3 are required, but no npm installation.
Do not print tokens or signed artifact URLs in logs, PRs or evidence.

Server environment (in its existing private environment file):

```dotenv
ROADMAP_LOCAL_BUILD_MODE=content
ROADMAP_APPLICATION_POINTER=/absolute/private/path/approved-pointer.json
GITHUB_WEBHOOK_SECRET=<separate random webhook secret>
CANVAS_DROP_TOKEN=<existing per-canvas deployment token>
CANVAS_API_URL=https://seenthisroadmap.canvas-drop.com/v1/canvases/019f2c0f-d0a0-7488-aeec-204f5d803c22
```

Keep the five existing profile variables exactly matching Actions. Empty/disabled
mode or missing Canvas credentials disables publication. `shadow` prepares and
checks but never invokes the Canvas coordinator. A failure cannot change save
success or mark a publication live. Startup and a 60-second timer reconcile latest
main; failures back off up to five minutes, while new push hints can wake it sooner.
Content jobs have a 17-minute outer deadline, allowing preparation plus the staged
session's 15-minute budget; individual HTTP calls remain bounded. Shadow and legacy
jobs retain a two-minute deadline. Superseded preparation requests its next run
through the worker itself, including on startup.

## Webhook setup and proof (part of this release)

- Repository: `seenthis-ab/product-roadmap`, push events only. Prepare inactive;
  save/activate only once the matching server secret and handler are installed.
- URL: `https://seenthisapi.roadmapvisualizer.com/webhooks/github`.
- JSON body; TLS verification enabled; a dedicated random secret matching
  `GITHUB_WEBHOOK_SECRET`. Do not reuse the Canvas key or editor-session secret.
- Verify endpoint/proxy reachability and GitHub delivery status after installation.
  The handler checks the raw-body HMAC, repository and main ref, acknowledges 202
  and queues a hint. It never executes a payload command or trusts its target SHA.
- Redeliver the same valid event and confirm coalescing/skip behavior. Bad signatures,
  wrong repositories, non-main refs and oversized bodies must not trigger builds.
- An outside-UI main edit must wake the worker without a browser open. Temporarily
  disabling the webhook must still allow the timer to find latest main; Actions
  remains the fallback if the worker is disabled or unhealthy.

## Live acceptance with Mark

Browser verification uses the browser automation MCP, including its supported
network/navigation inspection. The repeatable procedure is in
[the browser release checks](../../docs/reviews/content-publication-browser-checks.md).
Do not substitute a development server or a separate browser-driver script.

- UI horizon/wording edit: identify local content publication, identical application
  hashes, exact live source, and a second tab updating without document reload.
- Outside-UI edit: webhook-driven local content publication. Then disable the local
  worker and make another outside-UI edit to prove Actions content fallback.
- Upload/replace a cover and attachment: snapshot/references/original byte hashes
  activate together; a viewer without an editor session sees the files.
- Race: pause the local attempt before activation, merge a compatible newer change,
  resume and confirm old output is discarded, then both edits appear in latest main.
- Dirty editor plus viewer: retain the draft/filter/scroll/focus while compatible
  content refreshes; incompatible application updates offer a normal guarded reload.
- Measure source-commit-to-verified-activation separately from browser observation;
  ten comparable samples per old/new path, median/range/max, same memory limit.
  Required median improvement is at least 50%; below ten seconds is a stretch goal.

## Pause, rollback and limits

For the controlled local race only, set `ROADMAP_CONTENT_RACE_BARRIER=true` in
protected SeenThis service configuration and restart that service. In its private
`local-build` state directory, create an empty mode-0600 file named
`race-arm-<exact-target-commit>` owned by the service account. After preparation,
the worker consumes it and creates `race-waiting-<exact-target-commit>`. Make the
independent newer Git edit, then remove that waiting file to release the attempt.
The next step rechecks authoritative main before entering staged publication.
Timeout after 90 seconds or service shutdown aborts that attempt; the arm is
one-shot and ordinary reconciliation can retry later. A stale waiting file fails
closed when rearmed. Disable the flag and remove only the test's exact files
afterward. There is no HTTP control endpoint and no content-supplied path.

Before manual rollback/unpublish, disable the server worker and set the repository
variable `ROADMAP_PUBLICATION_PAUSED=true`; cancel active deployment runs and wait
for local work to stop. Canvas rotates its token, invalidating in-flight attempts,
but a later fresh reconciliation could otherwise republish main. Restore a known
complete Canvas release and compatible approved package/binary as needed. Resume
only after verifying source/app/profile alignment; never refresh a conflicted token.

`local-build/last-deployment.json` is historical proof, not a permanent live claim.
Git and Canvas are not one transaction: a push after the last freshness read can
briefly race activation; post-activation verification and reconciliation converge.
HTTP preview revalidation controls future browser-cache reuse; it cannot erase
downloaded files or images already held in page memory.

## Automatic handover after Actions application releases

SeenThis now runs `roadmap-application-sync.timer` every 20 seconds. Its separate
root-owned operator code reads the authenticated active application identity,
then independently authenticates the exact successful main Actions workflow,
private artifact/archive digest, package digest, profile and complete file
inventory. It never executes downloaded package code during approval. Packages
and the atomic pointer remain root-owned and read-only to the editor account.
A final active-application read prevents promotion if that application changed
or the site was unpublished during download. The previous pointer/package stays
available for recovery. Errors leave the pointer unchanged and the next timer
run retries. The timer does nothing while local mode is disabled or in shadow.

The operator uses the existing GitHub App credential to mint a repository-scoped
installation token with Actions/contents read permissions; no additional SSH,
GitHub personal-access token or webhook secret is needed. The existing push-only
webhook remains active with its dedicated HMAC secret and TLS verification.
Code or mixed commits are refused by the local content eligibility check and
are fully built and deployed by normal Actions. After that run succeeds, the
operator automatically prepares the new baseline for subsequent content edits.
It does not restart the editor or interrupt drafts/publications.

Install the reviewed operator files preserving their repository-relative paths
under `/opt/roadmap-operator`: `tooling/deploy/{reconcile-application,application-artifact,coordinate,staged}.mjs`,
`tooling/deploy/extract-application.py` and `site/scripts/application-package.mjs`.
Keep that directory root-owned and not writable by the editor. Install the two
units from `tooling/deploy/systemd/`, then enable the timer. Systemd permits
writes only to `/opt/roadmap-applications` and private temporary storage; the
GitHub App key is supplied through a systemd credential. Explicit `promote`
remains available for recovery. When pausing for rollback/unpublish, stop the
sync timer too, in addition to both publication paths, and restart it only after
restoring the intended active application.

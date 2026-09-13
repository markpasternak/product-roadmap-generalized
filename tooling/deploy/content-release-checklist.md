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
  its older approved package; explicit promotion is required to resume local reuse.

## Release order

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

## Explicit application promotion

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

## Webhook setup and proof (part of this release)

- Repository: `seenthis-ab/product-roadmap`, push events only, active.
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

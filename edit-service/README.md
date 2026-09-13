# Roadmap editing service

The service authenticates roadmap editors with GitHub and publishes to `REPO` on `main`. Published Markdown, original uploaded files and resource metadata all live in Git. A fresh checkout can rebuild the site without the editing service or upload staging.

## Working storage

Set `ROADMAP_STATE_DIR` to a durable private directory, or use systemd's `StateDirectory=roadmap-demo-editor` (exposed as `STATE_DIRECTORY`). Back up this directory to preserve unpublished account drafts and staged uploads. The fallback under the system temporary directory is for development only. Keep the Git checkout cache separate; it can be rebuilt.

Records use atomic writes, private permissions, and per-repository/account keys. One service instance owns this directory. Do not run multiple writable instances against the same records; the compare-and-swap and publication locks are process-local.

## Draft and publication API

GitHub sign-in issues a roadmap session lasting seven days from sign-in, without automatic renewal. Existing sessions retain their original expiry. The GitHub token is used to verify identity at sign-in; subsequent editing uses the roadmap session.

All editing routes use the existing Bearer session token. Upload and publication operations also verify current GitHub write permission.

- `GET /api/capabilities`: service version, feature availability and upload limit.
- `GET /api/draft`: `{ revision, data, updatedAt }` for the signed-in account.
- `PUT /api/draft`: `{ revision, data }`. Revision must match; a 409 returns the competing version. Limit: 4 MiB.
- `POST /api/publish`: item changes, resource operations, original item `baseShas`/`baseContents`, and one durable `requestId`.
- `GET /api/publications/:requestId`: recover a publication result after a lost response or restart.
- `GET /api/items?at=<commit>`: exact committed content and blob SHAs; commit must belong to this roadmap.
- `GET /api/status?commit=<commit>&deployed=<commit>`: build status plus Git ancestry evidence for the requested publication. A completed Actions run alone does not prove the site is live.

The older `/api/sync` endpoint remains compatible for existing clients. New clients use `/api/publish` for durable idempotency. A publication writes items, assets and `.roadmap/publications/<hashed-actor-and-request>.json` in one commit. The receipt binds the actor, payload digest and temporary-to-final item IDs. Repeating that same request recovers the original commit; changing its payload is rejected. No-op requests do not create commits.

Independent changes to item fields can merge using authenticated original blob content. Overlapping fields or body edits require a user decision. Never replace a saved base SHA merely to bypass a conflict.

Successful publications can return an `items` array containing the exact committed changed items, plus `deletedIds`. Clients apply this delta without fetching the whole roadmap again. When `items` is absent or null (including older or recovered receipts), read `/api/items?at=<sha>` before advancing editing bases. An empty array is a valid delta, not a missing snapshot.

Item snapshots are cached by immutable commit SHA, with at most eight snapshots per service instance. Returned maps and history slices are copied so callers cannot mutate the cache. Publication history is read only for changed items; repository transaction duration is logged without draft content.

The UI bounds JSON requests to 15 seconds, retains a timed-out publication's request ID, and automatically checks its receipt before offering a safe retry. Reopening while a build is pending restores the exact committed snapshot before reconciling newer local edits. Account drafts retain independent edits when users resolve individual overlapping fields, with recovery copies available on that device.

## Original files in Git

```text
content/assets/ast_<identity>/
  asset.json
  rev_<identity>/original-filename.png
  rev_<next-identity>/original-filename.png
```

`asset.json` has `schemaVersion: 1`, a stable `id`, display `name`, `visibility` (`Internal` or `Public`) and `revisions`. Each revision has an `id`, `createdAt`, `createdBy` and `original: { path, mediaType, bytes, sha256 }`. Paths are relative to the asset folder. The manifest's blob SHA is the concurrency token for replacement, rename, visibility changes and deletion.

An item references a specific revision using portable Markdown:

```md
![Description of the image](../../assets/ast_example/rev_example/diagram.png)

## Resources

- [Supporting evidence](../../assets/ast_example/rev_example/evidence.pdf)
```

Replacement adds a revision; other items keep their pinned originals. Removing a Markdown placement keeps the asset. Removing an unused asset deletes its current folder on publication; previous revisions remain in Git history. References in Markdown and presentation HTML/JS/JSON/CSS prevent deletion. Public Markdown cannot reference Internal assets. Static builds validate checksums and copy referenced originals only; public builds reject Internal references.

## Upload API and limits

- `POST /api/uploads?name=<filename>&assetId=<optional-existing-id>`: raw file body. Returns `uploadId`, `assetId`, `repoPath`, `revision`, `expiresAt` and `published`.
- `GET /api/uploads/:id` and `/content`: account-owned staging metadata and original bytes.
- `DELETE /api/uploads/:id`: remove unpublished staging.
- `GET /api/assets`: manifests with blob SHAs and repository usages.
- `GET /api/assets/content?path=<repository-path>`: authenticated original bytes from Git, including files not yet in the built site.

Publish claims files through `assets.attach: [{ uploadId, baseManifestSha?, name?, visibility? }]`. Metadata edits/deletion use `assets.update: [{ id, baseManifestSha, name?, visibility?, remove? }]`. The service checks the original bytes, type, hash, ownership, references and current manifest SHA before committing.

Limits: 25 MiB per file, 100 MiB of uploads per publication, 250 MiB of staged files per account, 30 days of staging retention. Supported originals: PNG, JPEG, GIF, WebP, PDF, MP4, WebM, DOCX, PPTX, XLSX, ZIP, TXT, CSV, Markdown and JSON. HTML and SVG uploads are not accepted. Office files are downloads; previews and transcoding are not generated. External URLs remain links; the service does not download arbitrary URLs.

## Verify and release

Run `go test -race ./...` and `go vet ./...`. Tests include an actual local bare Git repository to verify atomic asset/item/receipt commits and recovery after a simulated restart. Build the production binary with `-X main.version=<git-sha>`. Preserve the previous binary, deploy the service before the frontend, then verify `/health`, `/api/capabilities`, systemd health, the frontend workflow and the deployed `version.json`.

## Committed image reads

`GET /api/assets/content` authenticates each request, then reads the declared original
from a pinned Git commit without creating a worktree. Concurrent requests share a
refresh; a warm snapshot is reused for five seconds. Service publication invalidates
it before returning success. External pushes are discovered at the next refresh;
refresh failure returns an error rather than stale content.

The cache holds at most eight commit snapshots and an 8 MiB metadata budget. Four
responses may hold original buffers at once (25 MiB each); capacity remains held
through the HTTP response, including slow clients. A 60-second write deadline
prevents stalled downloads from holding that capacity indefinitely. Git refs under
`refs/roadmap-asset-cache/` keep cached commits reachable and are cleaned on eviction
or service restart. Cached metadata never includes permission decisions or staged
uploads. Originals pass size, SHA-256 and MIME checks before serving.

Both original-preview endpoints (`/api/assets/content?path=…` and
`/api/uploads/:id/content`) use `Cache-Control: private, no-cache`, a strong quoted
SHA-256 ETag and additive `Vary: Authorization, Origin`. Browsers may store bytes,
but must revalidate before reuse. Every request rechecks the session and resource
membership; staged files also recheck account ownership, expiry and actual bytes.
Denied, missing, invalid and HTTP-precondition/range error responses are non-storable
and have no success validator. HEAD, Range and other HTTP preconditions continue
through Go's `http.ServeContent`.

Within a pinned snapshot, a previously checksum/MIME-validated immutable Git object
can answer a matching single-validator request without reading the body again.
New snapshots must validate their own object/manifest combination. This does not
extend the five-second snapshot freshness window or cache authorization decisions.
Staged files are mutable local state and therefore retain per-request byte validation.
Published images still load from Canvas first, and in-page preview reuse is unchanged.
Revalidation controls future HTTP cache reuse: it cannot erase downloaded files or
images already retained in page memory.

For isolated browser proof, run `ROADMAP_PREVIEW_BROWSER=1 go test -run
TestPreviewBrowserHarness -v` here. The printed loopback page uses real Go endpoints
and fixture-only signed sessions on a separate API origin. Every preview open issues
a fetch; `/events` records server-observed 200/304/error status and body-byte counts.
POST `/stop` on the page origin stops the harness. No production data is involved.

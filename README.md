# Product Portfolio Roadmap

A Git-backed roadmap with an interactive board, in-app editing, supporting files and shareable snapshots.

**Live demo:** [roadmapdemo.canvas-drop.com](https://roadmapdemo.canvas-drop.com)

This is a demonstration instance. All 60 roadmap items, owner names and four supporting documents are fictional. The five products—Music App, Podcasts & Audiobooks, Spotify for Artists, Ads Platform, and Core Platform & Data—illustrate a portfolio; they are not anyone's real plan. This project is not affiliated with or endorsed by Spotify.

## What you can do

- Browse Now / Next / Later, with Candidates for intake and Completed for shipped work.
- Search and filter by product, horizon, stage, visibility and roadmap hygiene. Save, update, rename and remove named views.
- Change layouts separately from filters; use the focused presentation view for a discussion.
- Open an item to read its rationale, scope, evidence and supporting resources.
- Edit fields or write in structured sections and a full Markdown editor with live preview.
- Upload files, paste images, reuse resources, replace revisions, change labels, remove placements and delete unused originals.
- Insert images from a thumbnail picker or an external URL using `![alt text](url)`.
- Save drafts automatically, review changes and explicitly publish them to Git.
- Share a read-only snapshot with selected files and links. New snapshots use the same typography, teal identity and graphite dark mode as the app.

Supporting documents remain accessible from relevant items and the footer's **Source documents** link.

## Saving and publishing

Markdown files and published attachments in Git are the source of truth. Drafts are working copies until you publish.

1. Sign in with GitHub. Editing requires write access to this repository.
2. Edit an item. The browser saves a recovery copy locally and synchronizes the draft to your account.
3. Use **Review** to inspect unpublished changes.
4. **Publish changes** commits the items, original files and resource metadata together.
5. The status distinguishes a successful Git commit from the update actually being live after the site rebuild.

Independent field changes can merge. Overlapping edits have a comparison flow; interrupted requests can retry without duplicating a publication. Each tab keeps its own recovery state, and edits made during publication remain a draft.

Direct commits, pull requests and **Edit on GitHub** remain supported. A push to `main` rebuilds the demo through GitHub Actions.

## Files and images

Use **Add resource** to upload a file, add a link or choose an existing file or source document. Uploaded images have thumbnail previews. The image button in either editor inserts a resource or external image at your cursor, with editable alt text.

```markdown
![A useful diagram](../../assets/ast_example/rev_example/diagram.png)

## Resources

- [Supporting notes](../../assets/ast_example/rev_example/notes.pdf)
```

Original bytes are committed to `content/assets/ast_<id>/rev_<id>/filename.ext`. Each asset's `asset.json` records its stable identity, name, visibility, revisions, size, type and SHA-256. Replacing a file creates a new revision; other items retain the revisions they reference.

Removing a placement keeps the file available. Deleting an unused file removes it from the current tree when published; earlier Git commits and existing snapshots can still contain it.

Limits: 25 MiB per file, 100 MiB of uploads per publication, 250 MiB staged per account, and 30 days of retention for unpublished uploads. Supported originals include common raster images, PDF, video, Office documents, ZIP and text formats. See [the editing service documentation](edit-service/README.md) for details. External image URLs remain hosted externally; uploading stores an original in this repository.

## Sharing

A shared roadmap is a frozen snapshot. Changes to the main board do not alter an existing share until you explicitly update it.

- Review the selected items, scope and audience before publishing.
- Files and links are included only when explicitly selected. Uploaded files must be published first.
- Selected originals are copied and verified for the snapshot. Owner names and internal editing details are excluded.
- Restricted access, organization access, public links, passwords and expiration are separate from whether an item is marked Internal or Public.
- Existing deployment access settings remain unchanged by a code release.

Canvas Drop's optional backend powers sharing, AI assistance and presence. GitHub controls permission to edit repository content.

## Development

Use Node.js 22+ and Go 1.26.4+.

```sh
npm --prefix site ci
npm --prefix site run dev
```

The frontend's public API URL is configured in `site/.env`. The editing service is a separate process; its secrets and operational files are excluded from Git.

```sh
npm --prefix site test
npm --prefix site run check
npm --prefix site run build
node site/scripts/check-demo.mjs
python3 tooling/validate_items.py
(cd edit-service && go test -race ./... && go vet ./...)
```

Set `SITE_AUDIENCE=public` for a build containing only Public items and documents, with owners and internal sections removed. The showcase uses the full fictional portfolio. `SITE_BASE` supports deployment under a path prefix.

## Repository layout

| Path | Purpose |
| --- | --- |
| `content/items/` | Fictional roadmap items, one Markdown file per item |
| `content/prds/`, `content/technical-design/`, `content/research/` | Fictional supporting documents |
| `content/assets/` | Published original files and version manifests |
| `site/` | Astro/Vue application, tests and build scripts |
| `edit-service/` | Go API for GitHub authentication, drafts, uploads and publication |
| `tooling/` | Content validation and repository utilities |
| `.github/workflows/` | Validation and showcase deployment |

Item IDs use MUSIC, TALK, ARTISTS, ADS or PLATFORM followed by three digits. Required metadata: `id`, `title`, `product`, `horizon`, `stage`, `owner`. Optional fields include visibility, impact, effort, tags, order, commercial driver, target and confidence. The enforced schema is in `site/src/lib/schema.ts`.

## Deployment

The existing workflow deploys to the demo's own Canvas Drop canvas. The existing `CANVAS_DROP_TOKEN` secret remains scoped to that canvas. The demo editor has its own GitHub App configuration, systemd service, repository cache and persistent state directory.

Deploy the editor before the frontend when backend capabilities change. Preserve the prior binary for rollback. The frontend workflow scans source and output for non-demo references and verifies the deployed commit plus every file's size and hash through authenticated readback. Its `deployment-verification` artifact records the result.

Do not merge corporate content or Git history into this repository. Application upgrades must retain the fictional portfolio, generic artwork and demo-specific endpoints.

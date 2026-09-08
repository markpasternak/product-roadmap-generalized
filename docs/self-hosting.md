# Self-hosting

## Static roadmap

The board and timeline work without the editing service or Canvas Drop.

1. Clone this repository and install dependencies with `npm --prefix site ci`.
2. Copy `site/.env.example` to `site/.env` if you need custom configuration.
3. Set `SITE_URL` to your own production URL. Use `SITE_BASE` only for a path prefix.
4. Keep `PUBLIC_EDIT_API` empty and `PUBLIC_CANVAS_BACKEND=false` for a static-only site.
5. Build with `npm --prefix site run build`; deploy only `site/dist/`.

`SITE_AUDIENCE=public` produces a subset containing Public items/documents and removes owners and internal sections from the rendered site. This does not remove those files from your Git repository. Use a private repository for any confidential source content.

## GitHub-backed editing

Requires Go **1.26.4 or later**, a GitHub App installed on your own repository, and an HTTPS host for the editing service.

1. Create a GitHub App with repository **Contents: read/write**, **Metadata: read**, and **Actions: read**. Limit installation to your roadmap repository.
2. Enable the App's user authorization flow. Set its callback URL to `https://YOUR-API/auth/callback`.
3. Copy `edit-service/.env.example` to a private server configuration. Supply the App ID, client ID/secret, installation ID and path to the downloaded App private key. Set `REPO=owner/repository`.
4. Generate a long random `SESSION_SECRET`, for example with `openssl rand -hex 32`. Never commit it.
5. Set `ALLOWED_ORIGIN` to the exact site origin and `API_ORIGIN` to the API origin. Set `LISTEN_ADDR`, a durable private `ROADMAP_STATE_DIR` and a separate `REPO_CACHE_DIR`.
6. Load those values into the service process environment. From `edit-service/`, build with `go build -o roadmap-editor .` and run the binary behind an HTTPS reverse proxy. The service does not automatically load `.env` files.
7. Set the frontend's `PUBLIC_EDIT_API` to your API origin and rebuild.

For local development, the example uses `http://localhost:4321` and `http://localhost:8787`. Use the same hostname consistently; origins are exact. A publicly reachable HTTPS callback or development tunnel may be needed for your GitHub App setup.

Back up private service state for unpublished drafts and staged uploads. One service instance owns a state directory. Git is authoritative for published data. See [the service contract](../edit-service/README.md) for limits, routes and recovery behavior.

## Canvas Drop

Optional hosted snapshots, AI assistance and presence use the Canvas Drop browser SDK. Provision your own canvas and the capabilities you need, then set `PUBLIC_CANVAS_BACKEND=true`. The SDK is served by the host at `/sdk/v1.js`; it is not bundled with the static app.

The checked-in `.github/workflows/deploy.yml` targets the maintained showcase. Forks must replace `CANVAS_ID`, `CANVAS_HOST` and the build's `PUBLIC_EDIT_API` with their own values, and add a **canvas-scoped** `CANVAS_DROP_TOKEN` Actions secret. It cannot configure your GitHub App for you.

When deploying elsewhere, replace the deployment workflow with your static host's deployment step. Do not copy the source tree, environment files, private keys or service state into the published directory.

## Verify

Run the checks in the README. Confirm that anonymous visitors can only browse, that permitted GitHub editors can publish, and that `version.json` matches the expected commit after the rebuild. Test resource access separately from repository visibility.

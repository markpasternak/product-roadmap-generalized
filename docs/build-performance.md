# Build and publication performance

## Check application

Runs on every push to `main`, on pull requests (opened, reopened or updated), and
on manual dispatch. It validates the application; it does not publish the site.

Known content-only pushes to `main` keep the dependency audit and CI-tool tests
in application checks. The deploy job alone runs content/schema and managed-asset
validation, the production Astro build, document-link checks and published-date
checks. PRs and manual checks still build and validate their own artifacts; they
cannot rely on a deployment. There is no separate `Validate roadmap items` workflow.
The fictional-content check remains mandatory on every build, and the full
Git-history secret scan still runs on every change. Application changes
additionally run frontend tests, type checks and Go race
tests/vet in parallel jobs. The final `check` job requires every applicable job
to succeed; an unexpected skip fails the check.

Classification depends on changed paths, not the editor, actor or commit message.
UI publications and direct file edits therefore use the same rules. Pushes are
compared with the latest successful deployment, not only the preceding push. A
later content edit cannot hide code from an earlier failed or cancelled release.
Missing baselines, uncertain ancestry, unknown paths and manual runs use full checks.
Pull requests are compared with their merge base.

The application build job starts alongside the change-classification job. It
classifies locally to decide whether artifact work is needed, without waiting for
another runner. Only an explicit content-only `main` push can omit that work;
missing output falls back to building. Auditing and CI-tool tests always run.
The `build` job can therefore pass before publication finishes: the deployment
workflow and its verification receipt remain the authority for whether it is live.

The deploy workflow builds and validates its actual production configuration.
All demo releases wait for successful application checks on the exact commit before
uploading, including the secret-history scan on content-only releases. Missing, failed, cancelled or timed-out checks cannot unlock deployment.
For a manual release, run Check application on the same main commit if it has no
successful check. Deployment still verifies the authenticated remote manifest,
every file hash and the release commit. No checkout-history or verification steps
were removed.

## Caches and live confirmation

- Installed dependencies are cached by OS, architecture, Node version and lockfile.
  npm's download cache is restored only when installation is necessary.
- `npm run build` prepares `site/.cache/item-history.json`. A warm build refreshes
  Git logs only for items touched since the cached ancestor, including intermediate
  edits/reverts and merges. Renames retain `git log --follow` semantics. Invalid or
  divergent caches are rebuilt. Rendering rejects snapshots from a different HEAD.
- Regular Vitest threads retain per-file isolation. VM threads were rejected after
  a resource-byte comparison failed; assertions were not weakened.
- During publication, the UI checks the live version every four seconds after the
  preceding response. Requests have a three-second timeout, failure backoff and a
  hidden-tab pause. Actions status uses a slower schedule. Check again restarts
  observation of the existing commit; it never creates a commit or reruns a build.

## Astro incremental pages

Astro 7.3.2 supports experimental incremental static pages, but it is not enabled
here. The per-release `__BUILD_COMMIT__` configuration invalidates the page cache.
Safe adoption also needs keys covering item history, previous/next navigation,
linked document titles, backlinks and public/internal visibility. The shared
build timestamp and stale-version detection need a compatible versioning design.
Persisting a directory alone does not provide safe changed-page-only builds.

See [Astro's incremental build documentation](https://docs.astro.build/en/reference/experimental-flags/incremental-build/).

## Validation and rollout

Local samples on 2026-09-12: collecting 60 demo item histories took 602ms cold and
29ms warm. In the primary repository, 88 histories took 937ms cold and 28ms warm. The same 992-test suite took 9.45s with forks and 6.48s with regular threads.
These are local samples, not a CI speed guarantee; concurrent test runs are slower.

After an authorized rollout, compare several content-only and application runs:
dependency restore/install, history refresh count, build duration, total duration
and save-to-live confirmation. Also check a content push following a cancelled code
release. It must still run full checks. Stop rollout if dates, links, visibility,
release hashes or check gating regress. Disabling the fast classifier (always
returning `contentOnly: false`) restores full checks without weakening verification.
No remote rollout or CI timing verification was performed for these local changes.

// Detects when a newer build of the roadmap has been deployed (after an editor Syncs, the
// site rebuilds/redeploys behind CI). BUILD_COMMIT is the commit this bundle was built from,
// injected at build time via vite `define` in astro.config.mjs (the typeof guard covers
// vitest, matching the pattern in ../audience.ts). scripts/gen-version.mjs writes the same
// commit to public/version.json at build time; polling that file lets a running tab notice
// its bundle is stale.
declare const __BUILD_COMMIT__: string | undefined;

export const BUILD_COMMIT: string = typeof __BUILD_COMMIT__ !== 'undefined' ? __BUILD_COMMIT__ : 'dev';

/** Fetches the commit currently deployed, bypassing caches. Null on any failure. */
export async function fetchDeployedCommit(): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
    const res = await fetch(base + '/version.json?t=' + Date.now(), { cache: 'no-store', signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.commit === 'string' ? data.commit : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Pure decision extracted from isNewerVersionLive so the 'dev' short-circuit (this bundle
// wasn't built with a real commit, e.g. local dev) is testable without touching the
// module-level BUILD_COMMIT constant.
export function computeIsNewer(deployedCommit: string | null, buildCommit: string): boolean {
  return !!deployedCommit && buildCommit !== 'dev' && deployedCommit !== buildCommit;
}

/** True if the currently deployed build differs from the one this bundle was built from. */
export async function isNewerVersionLive(): Promise<boolean> {
  const deployed = await fetchDeployedCommit();
  return computeIsNewer(deployed, BUILD_COMMIT);
}

/**
 * Polls for a newer deployed build, calling `onNewer` once and stopping as soon as one is
 * found. Returns a stop function that halts polling (e.g. on component unmount).
 */
export function watchForNewVersion(onNewer: () => void, intervalMs = 15000): () => void {
  let stopped = false;
  let inFlight = false;

  const id = setInterval(() => {
    if (stopped || inFlight) return;
    // A backgrounded tab has nothing to gain from polling every 15s (nobody's watching for
    // the reload prompt) and every poll is a wasted request — skip it; the next visible tick
    // picks up right where this left off (nothing is latched by skipping).
    if (typeof document !== 'undefined' && document.hidden) return;
    inFlight = true;
    isNewerVersionLive()
      .then((newer) => {
        inFlight = false;
        if (stopped) return;
        if (newer) {
          stopped = true;
          clearInterval(id);
          onNewer();
        }
      })
      .catch(() => {
        inFlight = false;
      });
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(id);
  };
}

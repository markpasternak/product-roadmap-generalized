// Browser client for the Go edit-service (GitHub-gated in-app editing).
export const EDIT_API = import.meta.env.PUBLIC_EDIT_API as string;
const KEY = 'rm-edit-token';

export function saveToken(t: string) {
  localStorage.setItem(KEY, t);
}
export function getToken(): string | null {
  return localStorage.getItem(KEY);
}
export function clearToken() {
  localStorage.removeItem(KEY);
}

/** Consume the OAuth callback hash (#roadmap_edit_token=… / #roadmap_edit=denied). */
export function readTokenFromHash(): string | null {
  const h = location.hash;
  const m = /[#&]roadmap_edit_token=([^&]+)/.exec(h);
  if (m) {
    const tok = decodeURIComponent(m[1]!);
    saveToken(tok);
    history.replaceState(null, '', location.pathname + location.search);
    return tok;
  }
  if (/roadmap_edit=denied/.test(h)) history.replaceState(null, '', location.pathname + location.search);
  return null;
}

export function loginUrl(): string {
  return `${EDIT_API}/auth/login?return=${encodeURIComponent(location.origin + location.pathname)}`;
}

async function authed(path: string, init: RequestInit = {}) {
  const tok = getToken();
  return fetch(EDIT_API + path, {
    ...init,
    headers: { ...(init.headers || {}), ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
  });
}
export const authedRequest = authed;

export async function me(): Promise<{ editor: boolean; login: string }> {
  try {
    const r = await authed('/api/me');
    return r.ok ? r.json() : { editor: false, login: '' };
  } catch {
    return { editor: false, login: '' };
  }
}
/** An item as returned by /api/items — `sha` (U1/KTD1) is the item file's git blob sha,
 * the server-computed "base version" the client threads back on Sync so a per-item conflict
 * (R1) can be detected. Optional on the type only because older/degraded responses might omit
 * it; the client treats a missing sha the same as a not-yet-loaded base-version map. `path`
 * and `frontmatter` (also returned by `handleItems`) back the post-sync base refresh —
 * `itemsFromApi` (liveItems.ts) maps the full response into board `ItemVM`s. */
export type ApiItem = {
  id: string;
  path?: string;
  sha?: string;
  git?: {
    created?: string;
    updated?: string;
    createdAt?: string;
    updatedAt?: string;
    createdBy?: string;
    updatedBy?: string;
    createdCommit?: string;
    updatedCommit?: string;
    createdSubject?: string;
    updatedSubject?: string;
  };
  frontmatter?: Record<string, string>;
  body: string;
  content?: string;
};

export async function fetchItems(at?: string): Promise<ApiItem[]> {
  const r = await authed('/api/items' + (at ? `?at=${encodeURIComponent(at)}` : ''));
  if (!r.ok) throw new Error('items');
  return r.json();
}
export type SyncResult = {
  ok: boolean;
  createdIds?: Record<string, string>;
  state?: string;
  sha?: string;
  /** Set (with an empty `sha`) when the server determined the sent changeset produces no
   * actual diff against the repo — a true no-op. The caller should treat this as a clean
   * resolve (not a commit that needs a deploy poll), rather than getting stuck showing
   * "Publishing…" for a build that will never happen. */
  noChanges?: boolean;
  errors?: string[];
  /** Set when the request failed because the session is gone (401) — the token has
   * already been cleared, and the caller should offer a way to sign in again rather than
   * treating this like an ordinary validation/network failure. */
  authError?: boolean;
  /** U2/R1/R2: present on a 422 whose base-version check failed — the ids of the items whose
   * server-side blob sha no longer matches the client's captured base (someone else changed
   * them since). Additive to the plain-`errors` fast-forward path already handled below;
   * the caller shows the same "reload, then re-sync" recovery shape either way. */
  conflict?: string[];
  /** U8/R9: present on a successful sync when one or more reorder ops referenced an item the
   * server couldn't place (it moved lanes or was deleted upstream) — the server tolerates and
   * skips those instead of aborting the whole sync (KTD2's deliberate exception), and reports
   * their ids here so the client can surface a notice rather than silently dropping them. */
  skippedReorders?: string[];
};

/** U4/KTD4: the latest `deploy.yml` run on `main`, as reported by the session-gated
 * `GET /api/status` (mirrors `handleItems`/`handleSync` — 401s without a session). A commit
 * that only touched path-filtered files can trigger NO run at all — the server reflects that
 * as a zero-value response (`headSha: ''`), not an error; Board.vue treats an empty `headSha`
 * as "no run yet," distinct from any real run's status/conclusion. */
export type DeployStatus = {
  status: string;
  conclusion: string;
  headSha: string;
  htmlUrl: string;
  includesCommit?: boolean;
  live?: boolean;
};

/** Fetches the latest deploy run. Degrades to `null` on any failure (network error, non-2xx,
 * a session that's gone, or the endpoint simply not existing e.g. local dev without the
 * edit-service) — callers show no progression rather than an error for what is, from the
 * user's point of view, just an unavailable nice-to-have (R4/R5's "degrade-friendly" rule). */
export async function deployStatus(commit?: string, deployed?: string | null): Promise<DeployStatus | null> {
  try {
    const params = new URLSearchParams();
    if (commit) params.set('commit', commit);
    if (deployed) params.set('deployed', deployed);
    const r = await authed('/api/status' + (params.size ? `?${params}` : ''));
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export async function sync(changeset: unknown): Promise<SyncResult> {
  const r = await authed('/api/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changeset),
  });
  // An expired/revoked session comes back as a bare 401 (often a plain-text or empty
  // body, not JSON) — parsing it with `r.json()` would throw and surface as the generic
  // "network issue" catch in Board's doSync. Clear the now-useless token immediately so
  // the next authed() call doesn't keep sending it, and let the caller drive the re-auth
  // prompt (the draft itself lives in localStorage/the edit store, untouched).
  if (r.status === 401) {
    clearToken();
    return { ok: false, authError: true, errors: ['Your session expired'] };
  }
  const result = await r.json();
  return !r.ok && result.error
    ? { ok: false, errors: [result.error], state: r.status === 403 ? 'invalid' : undefined }
    : result;
}

export async function publicationStatus(id: string): Promise<SyncResult> {
  const res = await authed(`/api/publications/${encodeURIComponent(id)}`);
  return res.json();
}

import type { PublishedContent } from './model';

export interface PublishedRelease {
  commit: string;
  applicationCommit: string;
  applicationPackage: string;
  profile: string;
  contentSchema: number;
  committedAt: string;
  content: { path: string; hash: string; size: number };
}
export type RefreshStatus = 'current' | 'deferred' | 'offline' | 'error' | 'application';
export interface PublishedCandidate { release: PublishedRelease; model: PublishedContent }

const hash = /^[a-f\d]{64}$/;
const commit = /^[a-f\d]{40}$/;
const maxSnapshot = 25 * 1024 * 1024;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function parseIdentity(value: unknown): Pick<PublishedRelease, 'commit' | 'applicationCommit' | 'applicationPackage' | 'profile' | 'contentSchema'> {
  if (!record(value) || !['commit', 'applicationCommit', 'applicationPackage', 'profile'].every(key => typeof value[key] === 'string')
    || !commit.test(value.commit as string) || !commit.test(value.applicationCommit as string)
    || !hash.test(value.applicationPackage as string) || !hash.test(value.profile as string)
    || !Number.isSafeInteger(value.contentSchema) || Number(value.contentSchema) < 1) throw new Error('Invalid release identity');
  return value as unknown as PublishedRelease;
}
export function parseRelease(value: unknown): PublishedRelease {
  parseIdentity(value);
  if (!record(value) || typeof value.committedAt !== 'string' || !Number.isFinite(Date.parse(value.committedAt))
    || !record(value.content) || !hash.test(String(value.content.hash)) || value.content.path !== `content/${value.content.hash}.json`
    || !Number.isSafeInteger(value.content.size) || Number(value.content.size) < 1 || Number(value.content.size) > maxSnapshot) throw new Error('Invalid published release');
  return value as unknown as PublishedRelease;
}

/** The package owns the model contract; reject malformed data before exposing it to Vue. */
export function parseSnapshot(value: unknown, audience: PublishedContent['audience']): PublishedContent {
  if (!record(value) || value.audience !== audience || !Array.isArray(value.items) || !Array.isArray(value.boardItems)
    || !Array.isArray(value.documents) || !record(value.documentHtml)) throw new Error('Invalid content snapshot');
  const strings = (row: Record<string, unknown>, keys: string[]) => keys.every(key => typeof row[key] === 'string');
  if (value.resourceCatalog !== undefined) {
    if (!record(value.resourceCatalog) || !Array.isArray(value.resourceCatalog.assets)) throw new Error('Invalid resource catalog');
    for (const asset of value.resourceCatalog.assets) {
      if (!record(asset) || typeof asset.id !== 'string' || !/^ast_[a-zA-Z0-9_-]+$/.test(asset.id)
        || !Array.isArray(asset.revisions)) throw new Error('Invalid resource asset');
      for (const revision of asset.revisions) {
        const original = record(revision) ? revision.original : null;
        if (!record(original) || !strings(original, ['path', 'mediaType', 'sha256'])
          || !/^rev_[a-zA-Z0-9_-]+\/[^/\\]+$/.test(String(original.path))
          || /[?#%\u0000-\u001f]/.test(String(original.path)) || !hash.test(String(original.sha256))
          || !Number.isSafeInteger(original.bytes) || Number(original.bytes) < 1) throw new Error('Invalid resource original');
      }
    }
  }
  const ids = new Set<string>();
  for (const item of value.boardItems) {
    if (!record(item) || !strings(item, ['id', 'title', 'product', 'horizon', 'stage', 'owner', 'visibility', 'oneliner', 'outcome', 'text', 'href'])
      || !Number.isFinite(item.order) || !Array.isArray(item.tags) || !item.tags.every(tag => typeof tag === 'string')
      || !Array.isArray(item.themes) || !item.themes.every(theme => typeof theme === 'string')
      || !Array.isArray(item.sections) || !item.sections.every(section => record(section) && strings(section, ['heading', 'text']))
      || !Array.isArray(item.links) || !item.links.every(link => record(link) && strings(link, ['label', 'kind', 'href', 'target']))
      || ids.has(String(item.id)) || (audience === 'public' && (item.visibility !== 'Public' || item.owner))) throw new Error('Invalid published item');
    ids.add(String(item.id));
  }
  for (const item of value.items) if (!record(item) || typeof item.body !== 'string' || !record(item.data)
    || !strings(item.data, ['id', 'title', 'product', 'horizon']) || !ids.has(String(item.data.id))) throw new Error('Invalid item source');
  for (const doc of value.documents) {
    if (!record(doc) || !strings(doc, ['id', 'href', 'body', 'coll']) || !record(doc.data)
      || !Array.isArray(doc.backlinks) || !doc.backlinks.every(link => record(link) && strings(link, ['id', 'title', 'href']))
      || (audience === 'public' && doc.data.visibility !== 'Public')) throw new Error('Invalid published document');
    const rendered = value.documentHtml[String(doc.href)];
    if (!record(rendered) || typeof rendered.html !== 'string' || !Array.isArray(rendered.headings)
      || !rendered.headings.every(heading => record(heading) && strings(heading, ['slug', 'text']) && Number.isInteger(heading.depth))) throw new Error('Invalid rendered document');
  }
  return value as unknown as PublishedContent;
}

async function boundedBytes(response: Response, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.ok || response.redirected || Number(response.headers.get('content-length')) > limit || !response.body) throw new Error('Content unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('Content exceeds limit');
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export function watchPublishedContent(options: {
  initial: PublishedRelease;
  audience: PublishedContent['audience'];
  base: string;
  blocked: () => boolean;
  apply: (candidate: PublishedCandidate) => void;
  status: (status: RefreshStatus) => void;
  fetch?: typeof fetch;
  digest?: (bytes: Uint8Array<ArrayBuffer>) => Promise<string>;
  document?: Document;
  window?: Window;
}) {
  const doc = options.document ?? document;
  const win = options.window ?? window;
  const request = options.fetch ?? fetch;
  const digest = options.digest ?? (async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join(''));
  const base = new URL(options.base, win.location.href);
  if (base.origin !== win.location.origin || !/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base.pathname)) throw new Error('Invalid content origin');
  let current = parseRelease(options.initial);
  let pending: PublishedCandidate | undefined;
  let stopped = false;
  let inFlight = false;
  let failures = 0;
  let checkedAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const available = () => !doc.hidden && win.navigator.onLine !== false;
  const status = (value: RefreshStatus) => { if (!stopped) options.status(win.navigator.onLine === false ? 'offline' : value); };
  const schedule = () => {
    clearTimeout(timer);
    if (!stopped && available()) timer = setTimeout(check, failures ? Math.min(3000 * 2 ** failures, 30000) : 1000);
  };
  function flush() {
    if (stopped || !pending || inFlight || !available()) return;
    // A deferred candidate can become obsolete while someone edits. Revalidate
    // the descriptor before using it after a long interaction.
    if (failures || Date.now() - checkedAt >= 3000) { void check(); return; }
    if (options.blocked()) { status('deferred'); return; }
    const candidate = pending;
    options.apply(candidate);
    current = candidate.release;
    pending = undefined;
    status('current');
  }
  async function check() {
    if (stopped || inFlight) return;
    clearTimeout(timer);
    if (!available()) { if (win.navigator.onLine === false) status('offline'); return; }
    inFlight = true;
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 8000);
    try {
      // One retry handles a snapshot removed by a newer complete Canvas version.
      for (let attempt = 0; attempt < 2; attempt++) {
        const releaseBytes = await boundedBytes(await request(new URL('version.json', base), { cache: 'no-store', credentials: 'same-origin', redirect: 'error', signal: controller.signal }), 8192);
        const value: unknown = JSON.parse(new TextDecoder().decode(releaseBytes));
        const identity = parseIdentity(value);
        if (stopped) return;
        checkedAt = Date.now();
        // A future application's snapshot format need not be understood by this
        // application. Check its envelope before decoding the current schema.
        if (identity.applicationPackage !== current.applicationPackage || identity.applicationCommit !== current.applicationCommit
          || identity.profile !== current.profile || identity.contentSchema !== current.contentSchema || identity.contentSchema !== 1) {
          pending = undefined; status('application'); break;
        }
        const release = parseRelease(value);
        if (release.commit === current.commit && release.content.hash === current.content.hash) { pending = undefined; status('current'); break; }
        if (pending?.release.content.hash === release.content.hash) { pending.release = release; break; }
        pending = undefined;
        const response = await request(new URL(release.content.path, base), { credentials: 'same-origin', redirect: 'error', signal: controller.signal });
        if ((response.status === 404 || response.status === 410) && attempt === 0) continue;
        const bytes = await boundedBytes(response, release.content.size);
        if (bytes.length !== release.content.size || await digest(bytes) !== release.content.hash) throw new Error('Content checksum mismatch');
        const model = parseSnapshot(JSON.parse(new TextDecoder().decode(bytes)), options.audience);
        if (!stopped) pending = { release, model };
        break;
      }
      failures = 0;
    } catch {
      failures = Math.min(failures + 1, 4);
      status(win.navigator.onLine === false ? 'offline' : 'error');
    } finally {
      clearTimeout(timeout);
      inFlight = false;
      // Only a successfully checked complete candidate may replace the view.
      if (!failures) flush();
      schedule();
    }
  }
  const wake = () => { if (!available()) { clearTimeout(timer); if (win.navigator.onLine === false) status('offline'); } else void check(); };
  doc.addEventListener('visibilitychange', wake);
  for (const event of ['focus', 'online', 'offline']) win.addEventListener(event, wake);
  void check();
  return {
    check, flush,
    stop() {
      stopped = true; pending = undefined; controller?.abort(); clearTimeout(timer);
      doc.removeEventListener('visibilitychange', wake);
      for (const event of ['focus', 'online', 'offline']) win.removeEventListener(event, wake);
    },
  };
}

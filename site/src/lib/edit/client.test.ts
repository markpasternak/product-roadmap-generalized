import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveToken, getToken, clearToken, readTokenFromHash, sync, deployStatus, me, authedRequest, rememberSignInLocation } from './client';

beforeEach(() => {
  clearToken();
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('keeps an unconfigured checkout read-only without contacting an editing service', async () => {
  vi.stubEnv('PUBLIC_EDIT_API', '');
  vi.resetModules();
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const standaloneClient = await import('./client');
  expect(await standaloneClient.me()).toEqual({ editor: false, login: '' });
  expect(fetch).not.toHaveBeenCalled();
});

describe('edit token', () => {
  it('returns a recoverable auth error for an expired publication receipt session', async () => {
    const { publicationStatus } = await import('./client');
    saveToken('expired');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Unauthorized', { status: 401 })));
    expect(await publicationStatus('request-id')).toEqual({ ok: false, authError: true, errors: ['Your session expired'] });
    expect(getToken()).toBeNull();
  });
  it('stores and clears', () => {
    saveToken('abc');
    expect(getToken()).toBe('abc');
    clearToken();
    expect(getToken()).toBeNull();
  });
  it('reads token from the callback hash and strips it', () => {
    location.hash = '#roadmap_edit_token=' + encodeURIComponent('tok123');
    expect(readTokenFromHash()).toBe('tok123');
    expect(getToken()).toBe('tok123');
    expect(location.hash).toBe('');
  });
});

describe('sync() (fix #2 — session expiry)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns a distinct authError result and clears the token on a 401, without parsing the body as JSON', async () => {
    saveToken('stale-token');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('Unauthorized', { status: 401 }))),
    );

    const res = await sync({ some: 'changeset' });

    expect(res).toEqual({ ok: false, authError: true, errors: ['Your session expired'] });
    expect(getToken()).toBeNull();
  });

  it('keeps a valid session when publishing permission is denied', async () => {
    saveToken('stale-token');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({error:'You no longer have editing access.'}), { status: 403 }))),
    );

    const res = await sync({});

    expect(res.ok).toBe(false);
    expect(res.authError).toBeUndefined();
    expect(res.errors).toEqual(['You no longer have editing access.']);
    expect(getToken()).toBe('stale-token');
  });

  it('parses the JSON body as before for a normal (non-auth) response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true, sha: 'abc123' }), { status: 200 }))),
    );

    const res = await sync({});

    expect(res).toEqual({ ok: true, sha: 'abc123' });
  });

  it('parses a clean, non-OK JSON error response as before (no authError)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: false, errors: ['stage: invalid'] }), { status: 422 }))),
    );

    const res = await sync({});

    expect(res).toEqual({ ok: false, errors: ['stage: invalid'] });
  });

  it('passes through a NoChanges (no-op) sync response as-is, with an empty sha', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true, noChanges: true, sha: '' }), { status: 200 }))),
    );

    const res = await sync({});

    expect(res).toEqual({ ok: true, noChanges: true, sha: '' });
  });

  it('passes through a 422 base-version conflict body (U2/R1/R2) with the conflicting ids', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: false, conflict: ['TALK-1', 'TALK-2'] }), { status: 422 }),
        ),
      ),
    );

    const res = await sync({});

    expect(res).toEqual({ ok: false, conflict: ['TALK-1', 'TALK-2'] });
  });
});

describe('deployStatus() (U4/R4/R5/KTD4)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps a successful, well-formed /api/status response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ status: 'completed', conclusion: 'success', headSha: 'abc123', htmlUrl: 'https://github.com/x/run/1' }),
            { status: 200 },
          ),
        ),
      ),
    );

    expect(await deployStatus()).toEqual({
      status: 'completed',
      conclusion: 'success',
      headSha: 'abc123',
      htmlUrl: 'https://github.com/x/run/1',
    });
  });

  it('degrades to null on a non-OK response (e.g. an unauthenticated 401)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('', { status: 401 }))));
    expect(await deployStatus()).toBeNull();
  });

  it('degrades to null on a network/transport failure, without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down'))),
    );
    await expect(deployStatus()).resolves.toBeNull();
  });

  it('passes through the zero-value "no run yet" response as-is (empty headSha, not an error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ status: '', conclusion: '', headSha: '', htmlUrl: '' }), { status: 200 })),
      ),
    );

    expect(await deployStatus()).toEqual({ status: '', conclusion: '', headSha: '', htmlUrl: '' });
  });
});


describe('GitHub session recovery', () => {
  it('keeps this page bound to its original account when another tab signs in', async () => {
    saveToken('alice-token');
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ editor: true, login: 'alice' })))
      .mockResolvedValueOnce(new Response('{}'));
    vi.stubGlobal('fetch', fetcher);
    await me();
    localStorage.setItem('rm-edit-token', 'bob-token');
    await authedRequest('/api/draft', { method: 'PUT', body: '{}' });
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Bearer alice-token');
    clearToken();
    expect(localStorage.getItem('rm-edit-token')).toBe('bob-token');
    expect(getToken()).toBeNull();
  });
  it('binds the token that was verified even if storage changes during the identity check', async () => {
    saveToken('alice-token');
    let finish!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(r => { finish = r; })));
    const checking = me();
    localStorage.setItem('rm-edit-token', 'bob-token');
    finish(new Response(JSON.stringify({ editor: true, login: 'alice' })));
    await checking;
    expect(getToken()).toBe('alice-token');
  });
  it('restores the current card and filters after the OAuth callback', () => {
    history.replaceState(null, '', '/?item=TEST-1&sort=updated&activity=updated&days=7');
    rememberSignInLocation();
    history.replaceState(null, '', '/#roadmap_edit_token=new-session');
    readTokenFromHash();
    expect(location.search).toBe('?item=TEST-1&sort=updated&activity=updated&days=7');
    expect(location.hash).toBe('');
    expect(sessionStorage.getItem('rm-edit-return')).toBeNull();
  });
  it('ignores an off-site return location', () => {
    sessionStorage.setItem('rm-edit-return', 'https://other.example/');
    location.hash = '#roadmap_edit_token=new-session';
    readTokenFromHash();
    expect(location.pathname).toBe('/');
  });
  it('can authenticate in memory when browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    saveToken('memory-session');
    expect(getToken()).toBe('memory-session');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ editor: true, login: 'alice' }))));
    await expect(me()).resolves.toEqual({ editor: true, login: 'alice' });
    clearToken();
    expect(getToken()).toBeNull();
  });
  it('treats the backend permission-denied response as definitive, so the draft unlocks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, errors: ['Access removed'] }), { status: 403 })));
    expect(await sync({})).toEqual({ ok: false, state: 'invalid', errors: ['Access removed'] });
  });
});

it('returns to the actual support page after signing in there', () => {
  history.replaceState(null, '', '/docs?section=overview');
  rememberSignInLocation();
  history.replaceState(null, '', '/#roadmap_edit_token=new-session');
  const navigate = vi.spyOn(location, 'replace').mockImplementation(() => {});
  readTokenFromHash();
  expect(navigate).toHaveBeenCalledWith('/docs?section=overview#roadmap_edit_token=new-session');
});

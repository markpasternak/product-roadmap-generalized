import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveToken, getToken, clearToken, readTokenFromHash, sync, deployStatus } from './client';

beforeEach(() => localStorage.clear());

describe('edit token', () => {
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

  it('treats a 403 the same way as a 401', async () => {
    saveToken('stale-token');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 403 }))),
    );

    const res = await sync({});

    expect(res.ok).toBe(false);
    expect(res.authError).toBe(true);
    expect(getToken()).toBeNull();
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

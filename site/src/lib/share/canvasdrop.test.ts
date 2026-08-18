import { describe, it, expect, afterEach, vi } from 'vitest';
import { getCanvasdrop, canAuthor, updateAuthoredCanvas, type AuthoredCanvas } from './canvasdrop';

afterEach(() => {
  delete (globalThis as any).canvasdrop;
  (window as any).happyDOM?.setURL?.('http://localhost:3000/');
  vi.restoreAllMocks();
});

const share = (over: Partial<AuthoredCanvas> = {}): AuthoredCanvas => ({
  id: 'S1',
  url: 'https://example.com/s1',
  title: 'Share',
  tags: [],
  access: 'public_link',
  status: 'live',
  createdAt: 1,
  updatedAt: 2,
  expiresAt: null,
  revokedAt: null,
  createdBy: 'u1',
  version: 'v1',
  bundleUpdatedAt: 2,
  sourceApp: 'product-roadmap',
  sourceKind: 'roadmap-share',
  metadata: {},
  ...over,
});

describe('getCanvasdrop', () => {
  it('returns null when the SDK is absent', () => {
    expect(getCanvasdrop()).toBeNull();
  });
  it('returns the global when present', () => {
    const stub = { me: async () => ({ id: '1', email: 'a', name: 'A' }), canvases: {} };
    (globalThis as any).canvasdrop = stub;
    expect(getCanvasdrop()).toBe(stub);
  });
});

describe('canAuthor', () => {
  it('is false without the SDK', async () => {
    expect(await canAuthor()).toBe(false);
  });
  it('is false when me() rejects (guest)', async () => {
    (globalThis as any).canvasdrop = { me: async () => { throw new Error('401'); }, canvases: {} };
    expect(await canAuthor()).toBe(false);
  });
  it('is true when me() resolves', async () => {
    (globalThis as any).canvasdrop = { me: async () => ({ id: '1', email: 'a', name: 'A' }), canvases: {} };
    expect(await canAuthor()).toBe(true);
  });
});

describe('updateAuthoredCanvas', () => {
  it('uses the SDK update method when the loaded SDK has it', async () => {
    const update = vi.fn(async () => share({ title: 'Updated' }));
    const cd = { me: async () => ({ id: '1', email: 'a', name: 'A' }), canvases: { update, publish: vi.fn(), list: vi.fn(), revoke: vi.fn() } };
    const out = await updateAuthoredCanvas(cd, 'S1', { title: 'Updated' });
    expect(out.title).toBe('Updated');
    expect(update).toHaveBeenCalledWith('S1', { title: 'Updated' });
  });

  it('uses a same-origin authoring update on canvas-drop subdomains to avoid PUT preflight CORS', async () => {
    (window as any).happyDOM?.setURL?.('https://roadmapdemo.canvas-drop.com/');
    const update = vi.fn(async () => share({ title: 'SDK update' }));
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(share({ title: 'Same-origin update' })), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const cd = { me: async () => ({ id: '1', email: 'a', name: 'A' }), canvases: { update, publish: vi.fn(), list: vi.fn(), revoke: vi.fn() } };

    const out = await updateAuthoredCanvas(cd, 'S1', { title: 'Updated', bundle: new Blob(['zip']) });

    expect(out.title).toBe('Same-origin update');
    expect(update).not.toHaveBeenCalled();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://roadmapdemo.canvas-drop.com/v1/c/roadmapdemo/authoring/S1');
    expect(init?.method).toBe('PUT');
    expect(init?.credentials).toBe('include');
  });

  it('falls back to the authoring endpoint when the loaded SDK is older', async () => {
    history.replaceState(null, '', '/c/roadmap/');
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(share({ title: 'Updated' })), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const cd = { me: async () => ({ id: '1', email: 'a', name: 'A' }), canvases: { publish: vi.fn(), list: vi.fn(), revoke: vi.fn() } };

    const out = await updateAuthoredCanvas(cd, 'S1', { title: 'Updated', bundle: new Blob(['zip']) });

    expect(out.title).toBe('Updated');
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('http://localhost:3000/v1/c/roadmap/authoring/S1');
    expect(init?.method).toBe('PUT');
    expect(init?.credentials).toBe('include');
    expect(init?.body).toBeInstanceOf(FormData);
  });
});

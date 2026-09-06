import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchShareAssets, inlinePreviewAssets, previewAssetUrls, SHARE_ASSET_PATHS } from './assets';

afterEach(() => vi.unstubAllGlobals());

describe('snapshot design assets', () => {
  it('inlines preview fonts and artwork so the isolated iframe needs no cross-origin font requests', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(new Uint8Array([1, 2, 3]))));
    const assets = await inlinePreviewAssets();
    expect(assets.serif).toBe('data:font/ttf;base64,AQID');
    expect(assets.inter).toBe('data:font/woff2;base64,AQID');
    expect(assets.logo).toBe('data:image/svg+xml;base64,AQID');
  });
  it('uses base-aware preview assets and packages every required file', async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetch);
    const assets = await fetchShareAssets('/roadmap/');
    expect(Object.keys(assets).sort()).toEqual(Object.values(SHARE_ASSET_PATHS).sort());
    expect(fetch).toHaveBeenCalledWith('/roadmap/brand/roadmap-logo.svg');
    expect(previewAssetUrls('/roadmap/').logo).toBe('/roadmap/brand/roadmap-logo.svg');
  });
  it.each([new Response('missing', { status: 404 }), new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } })])('blocks publication when an asset is missing or is a login page', async (response) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => response.clone()));
    await expect(fetchShareAssets('/')).rejects.toThrow('design assets');
  });
});

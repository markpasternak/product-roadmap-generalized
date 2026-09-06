import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildShareBundle } from './render';
import { SHARE_ASSET_PATHS } from './assets';

describe('buildShareBundle', () => {
  it('carries every design asset on the share origin, preserving its bytes', async () => {
    const assets = Object.fromEntries(Object.values(SHARE_ASSET_PATHS).map((path, i) => [path, new Uint8Array([i, 12, 34])]));
    const files = unzipSync(new Uint8Array(await buildShareBundle('<title>Share</title>', undefined, assets).arrayBuffer()));
    for (const [path, bytes] of Object.entries(assets)) expect(files[path]).toEqual(bytes);
    expect(strFromU8(files['index.html']!)).toBe('<title>Share</title>');
  });
  it('produces a zip Blob whose only entry is index.html with the html', async () => {
    const blob = buildShareBundle('<!doctype html><title>x</title>');
    expect(blob.type).toBe('application/zip');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const files = unzipSync(bytes);
    expect(Object.keys(files)).toEqual(['index.html']);
    expect(strFromU8(files['index.html']!)).toContain('<!doctype html>');
  });

  it('bundles the OG card alongside index.html when provided', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const blob = buildShareBundle('<!doctype html><title>x</title>', png);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(['index.html', 'og-card.png']);
    expect(files['og-card.png']).toEqual(png);
  });
});

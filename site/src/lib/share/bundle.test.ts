import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { buildShareBundle } from './render';

describe('buildShareBundle', () => {
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

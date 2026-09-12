import { describe, it, expect } from 'vitest';
import { docSchema, itemSchema, EXTERNAL_VISIBILITIES } from './schema';
import { parseTags, byHorizonThenOrder } from './items';

const base = {
  id: 'TALK-001',
  title: 'Media plan import',
  product: 'Podcasts & Audiobooks',
  horizon: 'Now',
  stage: 'Building',
  owner: 'Madeleine',
};

describe('itemSchema', () => {
  it('accepts a valid item and defaults order to 999', () => {
    const r = itemSchema.parse(base);
    expect(r.order).toBe(999);
    expect(r.visibility).toBe('Internal');
    expect(r.product).toBe('Podcasts & Audiobooks');
  });

  it('accepts public visibility', () => {
    expect(itemSchema.parse({ ...base, visibility: 'Public' }).visibility).toBe('Public');
  });

  it('accepts Data as a product track', () => {
    expect(itemSchema.parse({ ...base, id: 'PLATFORM-001', product: 'Core Platform & Data' }).product).toBe('Core Platform & Data');
  });

  it('accepts Ads Platform as a product track', () => {
    expect(itemSchema.parse({ ...base, id: 'ADS-001', product: 'Ads Platform' }).product).toBe('Ads Platform');
  });

  it('rejects an invalid horizon', () => {
    expect(() => itemSchema.parse({ ...base, horizon: 'Someday' })).toThrow();
  });

  it('rejects an invalid impact level', () => {
    expect(() => itemSchema.parse({ ...base, impact: 'Huge' })).toThrow();
  });

  it('rejects an invalid visibility', () => {
    expect(() => itemSchema.parse({ ...base, visibility: 'External' })).toThrow();
  });

  it('coerces a string order to a number', () => {
    expect(itemSchema.parse({ ...base, order: '3' }).order).toBe(3);
  });

  it('accepts managed card covers and rejects external or malformed cover metadata', () => {
    const cover = '../../assets/ast_one/rev_one/cover.png';
    expect(itemSchema.parse({ ...base, cover, coverPosition: '35% 70%' })).toMatchObject({ cover, coverPosition: '35% 70%' });
    expect(() => itemSchema.parse({ ...base, cover: 'https://example.com/cover.png' })).toThrow();
    expect(() => itemSchema.parse({ ...base, cover, coverPosition: 'left top' })).toThrow();
    expect(() => itemSchema.parse({ ...base, coverPosition: '50% 50%' })).toThrow();
  });
});

describe('docSchema', () => {
  it('defaults visibility to Internal', () => {
    expect(docSchema.parse({ title: 'Research note' }).visibility).toBe('Internal');
  });

  it('accepts public visibility', () => {
    expect(docSchema.parse({ title: 'Research note', visibility: 'Public' }).visibility).toBe('Public');
  });
});

describe('parseTags', () => {
  it('splits plain tags from theme tags', () => {
    const r = parseTags('media-plan, import, theme:setup-speed');
    expect(r.tags).toEqual(['media-plan', 'import']);
    expect(r.themes).toEqual(['setup-speed']);
  });

  it('handles empty/undefined', () => {
    expect(parseTags(undefined)).toEqual({ tags: [], themes: [] });
    expect(parseTags('')).toEqual({ tags: [], themes: [] });
  });
});

describe('byHorizonThenOrder', () => {
  const mk = (horizon: string, order: number, id: string) => ({ ...base, horizon, order, id }) as never;
  it('orders by lane, then order, then id', () => {
    const sorted = [mk('Later', 1, 'B'), mk('Now', 2, 'A'), mk('Now', 1, 'C')].sort(byHorizonThenOrder);
    expect(sorted.map((i: { id: string }) => i.id)).toEqual(['C', 'A', 'B']);
  });
});

describe('external_visibility', () => {
  it('defaults to "Internal only" when absent', () => {
    const parsed = itemSchema.parse({
      id: 'X-1', title: 'T', product: 'Music App', horizon: 'Now',
      stage: 'Building', owner: 'A',
    });
    expect(parsed.external_visibility).toBe('Internal only');
  });

  it('accepts the allowed values and rejects others', () => {
    for (const v of EXTERNAL_VISIBILITIES) {
      expect(itemSchema.parse({
        id: 'X', title: 'T', product: 'Music App', horizon: 'Now',
        stage: 'Building', owner: 'A', external_visibility: v,
      }).external_visibility).toBe(v);
    }
    expect(() => itemSchema.parse({
      id: 'X', title: 'T', product: 'Music App', horizon: 'Now',
      stage: 'Building', owner: 'A', external_visibility: 'nope',
    })).toThrow();
  });
});

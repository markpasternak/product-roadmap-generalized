import { describe, it, expect } from 'vitest';
import {
  ANY_ASSET_KEY,
  activeFilterCount,
  assetKey,
  assetOptionsForFilters,
  assetOptionsForItems,
  buildSearchText,
  filterItems,
  groupItems,
  levelOptionsForItems,
  matchesTag,
  matchesHygiene,
  emptyFilters,
  stageOptionsForItems,
  tagOptionsForFilters,
  tagOptionsForItems,
  type ItemVM,
} from './filters';

const mk = (over: Partial<ItemVM>): ItemVM => ({
  id: 'X',
  title: 'Title',
  product: 'Music App',
  horizon: 'Now',
  stage: 'Building',
  owner: 'A',
  impact: null,
  effort: null,
  visibility: 'Internal',
  order: 1,
  updated: '',
  tags: [],
  themes: [],
  oneliner: '',
  outcome: '',
  sections: [],
  editUrl: null,
  links: [],
  text: 'title',
  href: '#',
  ...over,
}) as ItemVM;

const items: ItemVM[] = [
  mk({ id: 'S1', product: 'Music App', horizon: 'Now', tags: ['ai'], themes: ['speed'], text: 'music-app ai now' }),
  mk({ id: 'C1', product: 'Podcasts & Audiobooks', horizon: 'Next', tags: ['ai', 'import'], text: 'cm import' }),
  mk({
    id: 'S2',
    product: 'Music App',
    horizon: 'Later',
    stage: 'Discovery',
    impact: 'High',
    effort: 'Medium',
    text: 'music-app later impact',
    links: [
      { label: 'Research microsite', kind: 'presentation', href: '/p/music-app-global-templates/', target: '/p/music-app-global-templates/', title: 'Music App Global Templates' },
      { label: 'Proposal deck', kind: 'presentation', href: '/p/music-app-global-templates-deck/', target: '/p/music-app-global-templates-deck/', title: 'Music App Global Templates Deck' },
    ],
  }),
];

describe('filterItems', () => {
  it('returns all with empty filters', () => {
    expect(filterItems(items, emptyFilters())).toHaveLength(3);
  });
  it('narrows by product', () => {
    expect(filterItems(items, { ...emptyFilters(), product: 'Music App' }).map((i) => i.id)).toEqual(['S1', 'S2']);
  });
  it('ANDs multiple tags', () => {
    expect(filterItems(items, { ...emptyFilters(), tags: ['ai', 'import'] }).map((i) => i.id)).toEqual(['C1']);
  });
  it('matches a theme tag against themes', () => {
    expect(filterItems(items, { ...emptyFilters(), tags: ['theme:speed'] }).map((i) => i.id)).toEqual(['S1']);
  });
  it('searches the text haystack', () => {
    expect(filterItems(items, { ...emptyFilters(), q: 'import' }).map((i) => i.id)).toEqual(['C1']);
  });
  it('searches item IDs exactly and case-insensitively', () => {
    const pool = [
      mk({ id: 'TALK-001', title: 'Alpha', text: 'alpha' }),
      mk({ id: 'TALK-002', title: 'Beta', text: 'beta' }),
    ];
    expect(filterItems(pool, { ...emptyFilters(), q: 'TALK-001' }).map((i) => i.id)).toEqual(['TALK-001']);
    expect(filterItems(pool, { ...emptyFilters(), q: 'talk-001' }).map((i) => i.id)).toEqual(['TALK-001']);
  });
  it('searches owners on internal item view-models', () => {
    const pool = [
      mk({ id: 'A', owner: 'Madeleine Andersson', text: 'alpha' }),
      mk({ id: 'B', owner: 'Jonas Larsson', text: 'beta' }),
    ];
    expect(filterItems(pool, { ...emptyFilters(), q: 'madeleine' }).map((i) => i.id)).toEqual(['A']);
  });
  it('can build a public search haystack without owner text', () => {
    const text = buildSearchText(
      {
        id: 'TALK-001',
        title: 'Planning',
        oneliner: '',
        bodyText: '',
        tags: [],
        themes: [],
        owner: 'Madeleine Andersson',
      },
      false,
    );
    expect(text).toContain('talk-001');
    expect(text).toContain('planning');
    expect(text).not.toContain('madeleine');
    expect(text).not.toContain('andersson');
  });
  it('searches through small typos', () => {
    expect(filterItems(items, { ...emptyFilters(), q: 'improt' }).map((i) => i.id)).toEqual(['C1']);
  });
  it('matches multi-word query terms with words between them', () => {
    expect(
      filterItems(
        [mk({ id: 'TALK-001', text: 'parser 2.5 in production plus a media-plan template' })],
        { ...emptyFilters(), q: 'Parser in production' },
      ).map((i) => i.id),
    ).toEqual(['TALK-001']);
  });
  it('ranks title matches before body-only matches', () => {
    const rankedItems = [
      mk({ id: 'BODY', title: 'Media planning', text: 'media planning import' }),
      mk({ id: 'TITLE', title: 'Import campaigns', text: 'campaign creation' }),
    ];
    expect(filterItems(rankedItems, { ...emptyFilters(), q: 'import' }).map((i) => i.id)).toEqual([
      'TITLE',
      'BODY',
    ]);
  });
  it('filters by impact', () => {
    expect(filterItems(items, { ...emptyFilters(), impact: ['High'] }).map((i) => i.id)).toEqual(['S2']);
  });
  it('ORs values inside stage, impact, and effort filters', () => {
    const pool = [
      mk({ id: 'A', stage: 'Discovery', impact: 'Low', effort: 'Low' }),
      mk({ id: 'B', stage: 'Building', impact: 'Medium', effort: 'High' }),
      mk({ id: 'C', stage: 'Shipped', impact: 'High', effort: 'Medium' }),
    ];
    expect(filterItems(pool, { ...emptyFilters(), stage: ['Discovery', 'Shipped'] }).map((i) => i.id)).toEqual(['A', 'C']);
    expect(filterItems(pool, { ...emptyFilters(), impact: ['Low', 'High'] }).map((i) => i.id)).toEqual(['A', 'C']);
    expect(filterItems(pool, { ...emptyFilters(), effort: ['Low', 'Medium'] }).map((i) => i.id)).toEqual(['A', 'C']);
  });
  it('filters by linked resource type', () => {
    expect(filterItems(items, { ...emptyFilters(), assets: ['research-microsite'] }).map((i) => i.id)).toEqual(['S2']);
    expect(filterItems(items, { ...emptyFilters(), assets: ['research-microsite', 'proposal-deck'] }).map((i) => i.id)).toEqual(['S2']);
    expect(filterItems(items, { ...emptyFilters(), assets: ['research-microsite', 'prd'] }).map((i) => i.id)).toEqual([]);
    expect(filterItems(items, { ...emptyFilters(), assets: [ANY_ASSET_KEY] }).map((i) => i.id)).toEqual(['S2']);
  });
  it('builds resource filter options with counts and selected fallbacks', () => {
    expect(assetKey('Research microsite')).toBe('research-microsite');
    expect(assetOptionsForItems(items, ['prd'])).toEqual([
      { key: ANY_ASSET_KEY, label: 'Any resource', count: 1 },
      { key: 'proposal-deck', label: 'Proposal deck', count: 1 },
      { key: 'research-microsite', label: 'Research microsite', count: 1 },
      { key: 'prd', label: 'PRD', count: 0 },
    ]);
  });
  it('builds stage facets in canonical stage order', () => {
    expect(stageOptionsForItems(items, ['Shipped'])).toEqual([
      { value: 'Discovery', count: 1 },
      { value: 'Building', count: 2 },
      { value: 'Shipped', count: 0 },
    ]);
  });
  it('builds level facets with counts for every level', () => {
    expect(levelOptionsForItems(items, 'impact')).toEqual([
      { value: 'High', count: 1 },
    ]);
    expect(levelOptionsForItems(items, 'effort')).toEqual([
      { value: 'Medium', count: 1 },
    ]);
    expect(levelOptionsForItems(items, 'impact', ['Low'])).toEqual([
      { value: 'Low', count: 0 },
      { value: 'High', count: 1 },
    ]);
  });
  it('builds tag facets with theme counts first and selected fallbacks', () => {
    expect(tagOptionsForItems(items, ['missing'])).toEqual([
      { token: 'theme:speed', label: 'speed', theme: true, count: 1 },
      { token: 'ai', label: 'ai', theme: false, count: 2 },
      { token: 'import', label: 'import', theme: false, count: 1 },
      { token: 'missing', label: 'missing', theme: false, count: 0 },
    ]);
  });
  it('builds resource facets against current filters and hides zero-count additions', () => {
    expect(assetOptionsForFilters(items, { ...emptyFilters(), assets: ['research-microsite'] })).toEqual([
      { key: 'proposal-deck', label: 'Proposal deck', count: 1 },
      { key: 'research-microsite', label: 'Research microsite', count: 1 },
    ]);
  });
  it('builds tag facets as AND additions against current filters', () => {
    expect(tagOptionsForFilters(items, { ...emptyFilters(), tags: ['ai'] })).toEqual([
      { token: 'theme:speed', label: 'speed', theme: true, count: 1 },
      { token: 'ai', label: 'ai', theme: false, count: 2 },
      { token: 'import', label: 'import', theme: false, count: 1 },
    ]);
    expect(tagOptionsForFilters(items, { ...emptyFilters(), tags: ['ai', 'import'] })).toEqual([
      { token: 'ai', label: 'ai', theme: false, count: 1 },
      { token: 'import', label: 'import', theme: false, count: 1 },
    ]);
  });
  it('filters by visibility', () => {
    const visibilityItems = [
      mk({ id: 'INTERNAL', visibility: 'Internal' }),
      mk({ id: 'PUBLIC', visibility: 'Public' }),
    ];
    expect(filterItems(visibilityItems, { ...emptyFilters(), visibility: 'Public' }).map((i) => i.id)).toEqual([
      'PUBLIC',
    ]);
  });
  it('ignores an unknown query gracefully (no matches)', () => {
    expect(filterItems(items, { ...emptyFilters(), q: 'zzz' })).toHaveLength(0);
  });
});

describe('groupItems', () => {
  it('groups by horizon with empty lanes preserved', () => {
    const g = groupItems(items, ['Candidates', 'Now', 'Next', 'Later', 'Completed'], (i) => i.horizon);
    expect(g.Candidates).toEqual([]);
    expect(g.Now.map((i) => i.id)).toEqual(['S1']);
    expect(g.Completed).toEqual([]);
  });
});

describe('matchesTag', () => {
  it('distinguishes plain tags from theme tags', () => {
    const it = mk({ tags: ['ai'], themes: ['speed'] });
    expect(matchesTag(it, 'ai')).toBe(true);
    expect(matchesTag(it, 'theme:speed')).toBe(true);
    expect(matchesTag(it, 'theme:ai')).toBe(false);
  });
});

describe('activeFilterCount', () => {
  it('counts visibility as an active filter', () => {
    expect(activeFilterCount({ ...emptyFilters(), visibility: 'Internal' })).toBe(1);
  });
  it('counts a hygiene preset as an active filter', () => {
    expect(activeFilterCount({ ...emptyFilters(), hygiene: 'no-owner' })).toBe(1);
  });
  it('counts each selected checkbox value as active', () => {
    expect(activeFilterCount({ ...emptyFilters(), stage: ['Discovery'], impact: ['High'], assets: [ANY_ASSET_KEY] })).toBe(3);
  });
});

describe('matchesHygiene', () => {
  const cutoff = '2026-04-01';
  it('flags missing or placeholder owners', () => {
    expect(matchesHygiene(mk({ owner: '' }), 'no-owner', cutoff)).toBe(true);
    expect(matchesHygiene(mk({ owner: 'Unassigned' }), 'no-owner', cutoff)).toBe(true);
    expect(matchesHygiene(mk({ owner: 'Madeleine' }), 'no-owner', cutoff)).toBe(false);
  });
  it('flags Now items still in early stages', () => {
    expect(matchesHygiene(mk({ horizon: 'Now', stage: 'Discovery' }), 'now-early', cutoff)).toBe(true);
    expect(matchesHygiene(mk({ horizon: 'Now', stage: 'Building' }), 'now-early', cutoff)).toBe(false);
    expect(matchesHygiene(mk({ horizon: 'Later', stage: 'Discovery' }), 'now-early', cutoff)).toBe(false);
  });
  it('flags Later items not updated since the cutoff', () => {
    expect(matchesHygiene(mk({ horizon: 'Later', updated: '2026-01-01' }), 'stale-later', cutoff)).toBe(true);
    expect(matchesHygiene(mk({ horizon: 'Later', updated: '' }), 'stale-later', cutoff)).toBe(true);
    expect(matchesHygiene(mk({ horizon: 'Later', updated: '2026-06-01' }), 'stale-later', cutoff)).toBe(false);
    expect(matchesHygiene(mk({ horizon: 'Now', updated: '2026-01-01' }), 'stale-later', cutoff)).toBe(false);
  });
  it('applies through filterItems', () => {
    const pool = [
      mk({ id: 'A', horizon: 'Now', stage: 'Discovery' }),
      mk({ id: 'B', horizon: 'Now', stage: 'Building' }),
    ];
    expect(filterItems(pool, { ...emptyFilters(), hygiene: 'now-early' }).map((i) => i.id)).toEqual(['A']);
  });
});

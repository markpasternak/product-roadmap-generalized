// Pure filter / search / group logic for the board. No DOM, fully unit-tested.
import Fuse, { type IFuseOptions } from 'fuse.js';
import { LEVELS, STAGES } from './schema';
import type { ItemHistory } from './itemHistory';

export interface ItemLinkVM {
  image?: boolean;
  label: string;
  kind: string;
  href: string;
  target: string;
  /** Resolved document title (doc links only; null when unresolvable). */
  title: string | null;
}

export interface ItemVM extends ItemHistory {
  id: string;
  title: string;
  product: string;
  horizon: string;
  stage: string;
  owner: string;
  impact: string | null;
  effort: string | null;
  visibility: string;
  order: number;
  tags: string[];
  themes: string[];
  oneliner: string;
  outcome: string;
  /** Body sections for the drawer (plain text, line breaks preserved), placeholders excluded. */
  sections: { heading: string; text: string; markdown?: string }[];
  /** GitHub edit link for the source markdown (null on public builds). */
  editUrl: string | null;
  links: ItemLinkVM[];
  /** Precomputed lowercase search haystack (id + item markdown + backing docs + tags + internal owner). */
  text: string;
  href: string;
}

export type SortKey = 'manual' | 'impact' | 'effort' | 'updated' | 'title';
export const ANY_ASSET_KEY = 'asset:any';

export interface AssetFilterOption {
  key: string;
  label: string;
  count: number;
}

export interface StageFilterOption {
  value: string;
  count: number;
}

export interface LevelFilterOption {
  value: string;
  count: number;
}

export interface TagFilterOption {
  token: string;
  label: string;
  count: number;
  theme: boolean;
}

const LEVEL_RANK: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

/** Sort a copy of items by the chosen key (falls back to manual board order). */
export function sortItems(items: ItemVM[], key: SortKey): ItemVM[] {
  const byOrder = (a: ItemVM, b: ItemVM) => a.order - b.order || a.id.localeCompare(b.id);
  const arr = [...items];
  switch (key) {
    case 'impact':
      return arr.sort((a, b) => (LEVEL_RANK[b.impact ?? ''] ?? 0) - (LEVEL_RANK[a.impact ?? ''] ?? 0) || byOrder(a, b));
    case 'effort':
      return arr.sort((a, b) => (LEVEL_RANK[a.effort ?? ''] ?? 9) - (LEVEL_RANK[b.effort ?? ''] ?? 9) || byOrder(a, b));
    case 'updated':
      return arr.sort((a, b) => (b.updated || '').localeCompare(a.updated || '') || byOrder(a, b));
    case 'title':
      return arr.sort((a, b) => a.title.localeCompare(b.title));
    case 'manual':
    default:
      return arr.sort(byOrder);
  }
}

/** Hygiene presets — the README's weekly scan, as filters (internal builds only). */
export type HygieneKey = 'no-owner' | 'now-early' | 'stale-later';
export const HYGIENE_PRESETS: { key: HygieneKey; label: string }[] = [
  { key: 'no-owner', label: 'No owner' },
  { key: 'now-early', label: 'Now, but still early stage' },
  { key: 'stale-later', label: 'Stale Later (90+ days)' },
];
const EARLY_STAGES = new Set(['Discovery', 'Validation', 'Shaping']);

/** `staleCutoff` is an ISO date (yyyy-mm-dd); items not updated since count as stale. */
export function matchesHygiene(it: ItemVM, key: HygieneKey, staleCutoff: string): boolean {
  switch (key) {
    case 'no-owner':
      return !it.owner || /^(unassigned|tbd|\?+)$/i.test(it.owner.trim());
    case 'now-early':
      return it.horizon === 'Now' && EARLY_STAGES.has(it.stage);
    case 'stale-later':
      return it.horizon === 'Later' && (!it.updated || it.updated < staleCutoff);
  }
}

export interface FilterState {
  q: string;
  owner?: string | null;
  product: string | null;
  stage: string[];
  impact: string[];
  effort: string[];
  assets: string[];
  visibility: string | null;
  hygiene: HygieneKey | null;
  tags: string[];
  group: 'horizon' | 'product';
}

export type ActiveFilterChipKind =
  | 'q'
  | 'owner'
  | 'product'
  | 'stage'
  | 'impact'
  | 'effort'
  | 'asset'
  | 'visibility'
  | 'hygiene'
  | 'tag';

export interface ActiveFilterChip {
  key: string;
  kind: ActiveFilterChipKind;
  value: string;
  label: string;
}

export const emptyFilters = (): FilterState => ({
  q: '',
  owner: null,
  product: null,
  stage: [],
  impact: [],
  effort: [],
  assets: [],
  visibility: null,
  hygiene: null,
  tags: [],
  group: 'horizon',
});

const searchOptions: IFuseOptions<ItemVM> = {
  includeScore: true,
  ignoreLocation: true,
  threshold: 0.35,
  keys: [
    { name: 'id', weight: 5 },
    { name: 'title', weight: 4 },
    { name: 'oneliner', weight: 3 },
    { name: 'tags', weight: 2 },
    { name: 'themes', weight: 2 },
    { name: 'owner', weight: 1 },
    { name: 'text', weight: 1 },
  ],
};
const maxSearchScore = 0.4;
const stopWords = new Set(['a', 'an', 'and', 'for', 'in', 'is', 'of', 'on', 'or', 'the', 'to', 'with']);

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function searchTerms(q: string): string[] {
  const rawTerms = normalizeSearchText(q).split(/\s+/).filter(Boolean);
  const meaningfulTerms = rawTerms.filter((term) => !stopWords.has(term));
  return [...new Set(meaningfulTerms.length ? meaningfulTerms : rawTerms)];
}

export function buildSearchText(parts: {
  id: string;
  title: string;
  oneliner: string;
  bodyText: string;
  backingText?: readonly string[];
  tags: readonly string[];
  themes: readonly string[];
  owner?: string;
}, includeOwner = true): string {
  return [
    parts.id,
    parts.title,
    parts.oneliner,
    parts.bodyText,
    ...(parts.backingText ?? []),
    parts.tags.join(' '),
    parts.themes.join(' '),
    includeOwner ? (parts.owner ?? '') : '',
  ].join(' ').toLowerCase();
}

/** A tag token; `theme:x` matches an item's themes, otherwise its plain tags. */
export function matchesTag(it: ItemVM, tag: string): boolean {
  return tag.startsWith('theme:') ? it.themes.includes(tag.slice(6)) : it.tags.includes(tag);
}

export function assetKey(label: string): string {
  return label
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'resource';
}

export function assetLabelFromKey(key: string): string {
  if (key === ANY_ASSET_KEY) return 'Any resource';
  return key
    .split('-')
    .filter(Boolean)
    .map((part) => (part === 'prd' ? 'PRD' : part[0]!.toUpperCase() + part.slice(1)))
    .join(' ');
}

export function itemAssetKeys(it: Pick<ItemVM, 'links'>): string[] {
  return [...new Set(it.links.map((ln) => assetKey(ln.label)))];
}

export function assetOptionsForItems(items: ItemVM[], selected: readonly string[] = []): AssetFilterOption[] {
  const counts = new Map<string, { label: string; count: number }>();
  let anyCount = 0;
  for (const it of items) {
    if (it.links.length) anyCount += 1;
    for (const ln of it.links) {
      const key = assetKey(ln.label);
      const current = counts.get(key);
      counts.set(key, { label: current?.label ?? ln.label, count: (current?.count ?? 0) + 1 });
    }
  }
  for (const key of selected) {
    if (key !== ANY_ASSET_KEY && !counts.has(key)) counts.set(key, { label: assetLabelFromKey(key), count: 0 });
  }

  const options = [...counts.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return anyCount || selected.includes(ANY_ASSET_KEY)
    ? [{ key: ANY_ASSET_KEY, label: 'Any resource', count: anyCount }, ...options]
    : options;
}

export function assetOptionsForFilters(items: ItemVM[], f: FilterState, search?: SearchContext): AssetFilterOption[] {
  const base = filterItems(items, { ...f, assets: [] }, search);
  const counts = new Map<string, { label: string; count: number }>();
  let anyCount = 0;
  for (const it of base) {
    if (it.links.length) anyCount += 1;
    for (const ln of it.links) {
      const key = assetKey(ln.label);
      const current = counts.get(key);
      counts.set(key, { label: current?.label ?? ln.label, count: 0 });
    }
  }
  for (const key of f.assets) {
    if (key !== ANY_ASSET_KEY && !counts.has(key)) counts.set(key, { label: assetLabelFromKey(key), count: 0 });
  }

  const selectedSpecific = f.assets.filter((asset) => asset !== ANY_ASSET_KEY);
  const selectedCount = f.assets.length ? filterItems(items, f, search).length : 0;
  for (const [key, option] of counts) {
    option.count = f.assets.includes(key)
      ? selectedCount
      : filterItems(items, { ...f, assets: [...selectedSpecific, key] }, search).length;
  }

  const options = [...counts.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .filter((option) => option.count > 0 || f.assets.includes(option.key))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const showAny = f.assets.includes(ANY_ASSET_KEY) || (!selectedSpecific.length && anyCount > 0);
  const anyOption = showAny
    ? [{
        key: ANY_ASSET_KEY,
          label: 'Any resource',
          count: f.assets.includes(ANY_ASSET_KEY)
          ? selectedCount
          : filterItems(items, { ...f, assets: [ANY_ASSET_KEY] }, search).length,
      }]
    : [];
  return [...anyOption, ...options];
}

export function stageOptionsForItems(items: ItemVM[], selected: readonly string[] = []): StageFilterOption[] {
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.stage, (counts.get(it.stage) ?? 0) + 1);
  for (const stage of selected) if (!counts.has(stage)) counts.set(stage, 0);
  return (STAGES as readonly string[])
    .filter((stage) => counts.has(stage))
    .map((stage) => ({ value: stage, count: counts.get(stage) ?? 0 }));
}

export function levelOptionsForItems(
  items: ItemVM[],
  key: 'impact' | 'effort',
  selected: readonly string[] = [],
): LevelFilterOption[] {
  const counts = new Map<string, number>();
  for (const it of items) {
    const value = it[key];
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  for (const value of selected) if (!counts.has(value)) counts.set(value, 0);
  return (LEVELS as readonly string[])
    .map((value) => ({ value, count: counts.get(value) ?? 0 }))
    .filter((option) => option.count > 0 || selected.includes(option.value));
}

export function tagOptionsForItems(items: ItemVM[], selected: readonly string[] = []): TagFilterOption[] {
  const counts = new Map<string, { label: string; count: number; theme: boolean }>();
  for (const it of items) {
    for (const theme of it.themes) {
      const token = `theme:${theme}`;
      const current = counts.get(token);
      counts.set(token, { label: theme, theme: true, count: (current?.count ?? 0) + 1 });
    }
    for (const tag of it.tags) {
      const current = counts.get(tag);
      counts.set(tag, { label: tag, theme: false, count: (current?.count ?? 0) + 1 });
    }
  }
  for (const token of selected) {
    if (counts.has(token)) continue;
    counts.set(token, {
      label: token.startsWith('theme:') ? token.slice(6) : token,
      theme: token.startsWith('theme:'),
      count: 0,
    });
  }

  return [...counts.entries()]
    .map(([token, option]) => ({ token, ...option }))
    .sort((a, b) => Number(b.theme) - Number(a.theme) || b.count - a.count || a.label.localeCompare(b.label));
}

export function tagOptionsForFilters(items: ItemVM[], f: FilterState, search?: SearchContext): TagFilterOption[] {
  const base = filterItems(items, { ...f, tags: [] }, search);
  const candidates = new Map<string, { label: string; count: number; theme: boolean }>();
  for (const it of base) {
    for (const theme of it.themes) candidates.set(`theme:${theme}`, { label: theme, theme: true, count: 0 });
    for (const tag of it.tags) candidates.set(tag, { label: tag, theme: false, count: 0 });
  }
  for (const token of f.tags) {
    if (candidates.has(token)) continue;
    candidates.set(token, {
      label: token.startsWith('theme:') ? token.slice(6) : token,
      theme: token.startsWith('theme:'),
      count: 0,
    });
  }

  const selectedCount = f.tags.length ? filterItems(items, f, search).length : 0;
  for (const [token, option] of candidates) {
    option.count = f.tags.includes(token)
      ? selectedCount
      : filterItems(items, { ...f, tags: [...f.tags, token] }, search).length;
  }

  return [...candidates.entries()]
    .map(([token, option]) => ({ token, ...option }))
    .filter((option) => option.count > 0 || f.tags.includes(option.token))
    .sort((a, b) => Number(b.theme) - Number(a.theme) || b.count - a.count || a.label.localeCompare(b.label));
}

/** ISO date `days` ago — the default staleness cutoff. */
export function staleCutoff(days = 90, now = Date.now()): string {
  return new Date(now - days * 86_400_000).toISOString().slice(0, 10);
}

export function matchesStructuredFilters(it: ItemVM, f: FilterState, cutoff = staleCutoff()): boolean {
  if (f.owner && it.owner !== f.owner) return false;
  if (f.product && it.product !== f.product) return false;
  if (f.stage.length && !f.stage.includes(it.stage)) return false;
  if (f.impact.length && (!it.impact || !f.impact.includes(it.impact))) return false;
  if (f.effort.length && (!it.effort || !f.effort.includes(it.effort))) return false;
  if (f.assets.length) {
    const keys = itemAssetKeys(it);
    const specificAssets = f.assets.filter((asset) => asset !== ANY_ASSET_KEY);
    if (f.assets.includes(ANY_ASSET_KEY) && !it.links.length) return false;
    if (specificAssets.length && !specificAssets.every((asset) => keys.includes(asset))) return false;
  }
  if (f.visibility && it.visibility !== f.visibility) return false;
  if (f.hygiene && !matchesHygiene(it, f.hygiene, cutoff)) return false;
  for (const t of f.tags) if (!matchesTag(it, t)) return false;
  return true;
}

export interface SearchContext {
  query: string;
  terms: string[];
  items: ItemVM[];
  ids: Set<string> | null;
}

const normalizedTextCache = new WeakMap<ItemVM, string>();
const fuseCache = new WeakMap<ItemVM[], Fuse<ItemVM>>();

function normalizedItemText(it: ItemVM): string {
  const cached = normalizedTextCache.get(it);
  if (cached != null) return cached;
  const normalized = buildSearchText({
    id: it.id,
    title: it.title,
    oneliner: it.oneliner,
    bodyText: it.text,
    tags: it.tags,
    themes: it.themes,
    owner: it.owner,
  });
  normalizedTextCache.set(it, normalized);
  return normalized;
}

function fuseForItems(items: ItemVM[]): Fuse<ItemVM> {
  const cached = fuseCache.get(items);
  if (cached) return cached;
  const fuse = new Fuse(items, searchOptions);
  fuseCache.set(items, fuse);
  return fuse;
}

export function createSearchContext(items: ItemVM[], q: string): SearchContext {
  const query = q.trim();
  if (!query) return { query: '', terms: [], items, ids: null };
  const normalizedQuery = normalizeSearchText(query);
  const exactIdMatches = items.filter((it) => normalizeSearchText(it.id) === normalizedQuery);
  if (exactIdMatches.length) {
    return {
      query,
      terms: searchTerms(query),
      items: exactIdMatches,
      ids: new Set(exactIdMatches.map((it) => it.id)),
    };
  }

  const terms = searchTerms(query);
  const termMatches = new Set(
    terms.length
      ? items
          .filter((it) =>
            terms.every((term) => normalizedItemText(it).includes(term)),
          )
          .map((it) => it.id)
      : [],
  );
  const seen = new Set<string>();
  const ranked = fuseForItems(items)
    .search(query)
    .filter((r) => r.score == null || r.score <= maxSearchScore || termMatches.has(r.item.id))
    .map((r) => {
      seen.add(r.item.id);
      return r.item;
    });

  const result = [...ranked, ...items.filter((it) => termMatches.has(it.id) && !seen.has(it.id))];
  return { query, terms, items: result, ids: new Set(result.map((it) => it.id)) };
}

function narrowSearchContextToItems(search: SearchContext, items: ItemVM[]): ItemVM[] {
  if (!search.query) return items;
  if (search.items === items) return search.items;
  const allowed = new Set(items.map((it) => it.id));
  return search.items.filter((it) => allowed.has(it.id));
}

export function searchItems(items: ItemVM[], q: string, search?: SearchContext): ItemVM[] {
  const query = q.trim();
  if (!query) return items;
  const context = search && search.query === query ? search : createSearchContext(items, query);
  return narrowSearchContextToItems(context, items);
}

export function filterItems(items: ItemVM[], f: FilterState, search?: SearchContext): ItemVM[] {
  const query = f.q.trim();
  if (!query) return items.filter((it) => matchesStructuredFilters(it, f));
  const context = search && search.query === query ? search : createSearchContext(items, query);
  return narrowSearchContextToItems(context, items).filter((it) => matchesStructuredFilters(it, f));
}

/** Group into buckets keyed by `keys` (empty buckets preserved, in order). */
export function groupItems(
  items: ItemVM[],
  keys: readonly string[],
  keyFn: (it: ItemVM) => string,
): Record<string, ItemVM[]> {
  const out: Record<string, ItemVM[]> = {};
  for (const k of keys) out[k] = [];
  for (const it of items) (out[keyFn(it)] ??= []).push(it);
  return out;
}

export function activeFilterCount(f: FilterState): number {
  return (
    (f.owner ? 1 : 0) +
    (f.q ? 1 : 0) +
    (f.product ? 1 : 0) +
    f.stage.length +
    f.impact.length +
    f.effort.length +
    f.assets.length +
    (f.visibility ? 1 : 0) +
    (f.hygiene ? 1 : 0) +
    f.tags.length
  );
}

export function activeFilterChips(f: FilterState): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];
  if (f.owner) chips.push({ key: `owner:${f.owner}`, kind: 'owner', value: f.owner, label: `Owner: ${f.owner}` });
  const q = f.q.trim();
  if (q) chips.push({ key: `q:${q}`, kind: 'q', value: q, label: `“${q}”` });
  if (f.product) chips.push({ key: `product:${f.product}`, kind: 'product', value: f.product, label: `Product: ${f.product}` });
  for (const stage of f.stage) chips.push({ key: `stage:${stage}`, kind: 'stage', value: stage, label: `Stage: ${stage}` });
  for (const impact of f.impact) chips.push({ key: `impact:${impact}`, kind: 'impact', value: impact, label: `Impact: ${impact}` });
  for (const effort of f.effort) chips.push({ key: `effort:${effort}`, kind: 'effort', value: effort, label: `Effort: ${effort}` });
  for (const asset of f.assets) chips.push({ key: `asset:${asset}`, kind: 'asset', value: asset, label: `Resource: ${assetLabelFromKey(asset)}` });
  if (f.visibility) {
    chips.push({ key: `visibility:${f.visibility}`, kind: 'visibility', value: f.visibility, label: `Visibility: ${f.visibility}` });
  }
  if (f.hygiene) {
    const preset = HYGIENE_PRESETS.find((p) => p.key === f.hygiene);
    chips.push({ key: `hygiene:${f.hygiene}`, kind: 'hygiene', value: f.hygiene, label: preset?.label ?? f.hygiene });
  }
  for (const tag of f.tags) {
    chips.push({
      key: `tag:${tag}`,
      kind: 'tag',
      value: tag,
      label: tag.startsWith('theme:') ? `Theme: ${tag.slice(6)}` : tag,
    });
  }
  return chips;
}

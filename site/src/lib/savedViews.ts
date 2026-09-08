import { z } from 'zod';
import { timelineSettingsSchema, timelineSettings } from './timeline';
import { activityFilterSchema } from './activityFilter';
import { HORIZONS, PRODUCTS, STAGES, LEVELS, VISIBILITIES } from './schema';
import { emptyFilters, type FilterState, type SortKey } from './filters';

const viewSchema = z.object({
  name: z.string().trim().min(1).max(60),
  filters: z.object({
    layout: z.enum(['board', 'timeline']).optional().catch('board'),
    timeline: timelineSettingsSchema.optional().catch(undefined),
    activity: activityFilterSchema.nullable().optional().catch(null),
    q: z.string(), owner: z.string().nullable().optional(),
    product: z.enum(PRODUCTS).nullable(), stage: z.array(z.enum(STAGES)),
    impact: z.array(z.enum(LEVELS)), effort: z.array(z.enum(LEVELS)),
    assets: z.array(z.string()).default([]).transform(() => []), visibility: z.enum(VISIBILITIES).nullable(),
    hygiene: z.enum(['no-owner', 'now-early', 'stale-later']).nullable(),
    tags: z.array(z.string()), group: z.enum(['horizon', 'product']),
  }),
  horizons: z.array(z.enum(HORIZONS)),
  sort: z.enum(['manual', 'impact', 'effort', 'updated', 'title']),
});

export interface SavedView {
  name: string;
  filters: FilterState;
  horizons: string[];
  sort: SortKey;
}
export const SAVED_VIEWS_KEY = 'rm-saved-views-v1';

export function readSavedViews(raw: string | null): SavedView[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      const result = viewSchema.safeParse(entry);
      return result.success ? [result.data] : [];
    }).slice(0, 30);
  } catch { return []; }
}

export function snapshotView(name: string, filters: FilterState, horizons: readonly string[], sort: SortKey): SavedView {
  return viewSchema.parse({ name, filters, horizons: [...horizons], sort });
}

/** Selections are sets; toggling them in a different order does not modify a view. */
export function sameViewSelection(a: Pick<SavedView, 'filters' | 'horizons' | 'sort'>, b: Pick<SavedView, 'filters' | 'horizons' | 'sort'>): boolean {
  const set = (values: string[]) => [...new Set(values)].sort();
  const key = ({ filters: f, horizons, sort }: Pick<SavedView, 'filters' | 'horizons' | 'sort'>) => JSON.stringify([
    f.layout ?? 'board', timelineSettings(f.timeline),
    f.q, f.owner ?? null, f.product, set(f.stage), set(f.impact), set(f.effort),
    f.activity ?? null, f.visibility, f.hygiene, set(f.tags), f.group, set(horizons), sort,
  ]);
  return key(a) === key(b);
}

export const DEFAULT_VIEW: SavedView = {
  name: 'All priorities', filters: emptyFilters(), horizons: ['Now', 'Next', 'Later'], sort: 'manual',
};

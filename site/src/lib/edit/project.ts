// Pure projection: overlays a pending changeset onto published board items so the board
// can render the local working copy (unsynced edits/creates/deletes/reorders) without ever
// mutating the published content. No DOM, fully unit-tested.
import { sectionText, parseSections, parseLinks, inlineMdToText } from '../items';
import { isStoryHeading, sectionLabel } from '../sectionHeadings';
import type { ItemVM } from '../filters';
import { EMPTY_ITEM_HISTORY } from '../itemHistory';

export type ProjectedItem = ItemVM & { pending?: 'edited' | 'new' | 'deleted' };

export type BoardChangeset = {
  updated: { id: string; frontmatter: Record<string, string>; body: string; bodySet?: boolean }[];
  created: { id: string; product: string; title: string; frontmatter: Record<string, string>; body?: string }[];
  deletedIds: string[];
  reorder: Record<string, Record<string, string[]>>;
};

// Frontmatter keys that affect board rendering, mapped onto their ItemVM field (same name
// for all of these). `tags` and `order` need their own coercion (see below).
const BOARD_FIELDS = ['horizon', 'stage', 'title', 'owner', 'impact', 'effort', 'visibility', 'product', 'startDate', 'endDate'] as const;

// ItemEditor emits tags as a comma-joined string; split back into the array ItemVM expects.
function splitTags(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function applyUpdate(base: ItemVM, frontmatter: Record<string, string>): ItemVM {
  const next = { ...base };
  for (const key of BOARD_FIELDS) {
    if (frontmatter[key] !== undefined) (next as Record<string, unknown>)[key] = frontmatter[key];
  }
  if (frontmatter.tags !== undefined) next.tags = splitTags(frontmatter.tags);
  if (frontmatter.order !== undefined) {
    const n = Number(frontmatter.order);
    if (Number.isFinite(n)) next.order = n;
  }
  return next;
}

function applyBody(item: ItemVM, body: string): ItemVM {
  return {
    ...item,
    oneliner: sectionText(body, 'One-liner'),
    outcome: sectionText(body, 'Target outcome'),
    sections: parseSections(body)
      .filter((s) => isStoryHeading(s.heading))
      .map((s) => ({ heading: sectionLabel(s.heading), text: inlineMdToText(s.raw), markdown: s.raw })),
    links: parseLinks(body, import.meta.env.BASE_URL).map((l) => ({ ...l, title: null })),
  };
}

function newItemDefaults(entry: BoardChangeset['created'][number]): ProjectedItem {
  const fm = entry.frontmatter;
  return {
    id: entry.id,
    title: entry.title,
    product: entry.product,
    startDate: fm.startDate,
    endDate: fm.endDate,
    horizon: fm.horizon ?? 'Next',
    stage: fm.stage ?? 'Discovery',
    owner: fm.owner ?? '',
    impact: (fm.impact as ItemVM['impact']) ?? null,
    effort: (fm.effort as ItemVM['effort']) ?? null,
    visibility: fm.visibility ?? 'Internal',
    order: Number.MAX_SAFE_INTEGER,
    ...EMPTY_ITEM_HISTORY,
    tags: splitTags(fm.tags),
    themes: [],
    oneliner: '',
    outcome: '',
    sections: [],
    editUrl: null,
    links: [],
    text: '',
    href: '',
    pending: 'new',
  };
}

export function projectBoard(items: ItemVM[], cs: BoardChangeset): ProjectedItem[] {
  const updatedById = new Map(cs.updated.map((u) => [u.id, u]));
  const deleted = new Set(cs.deletedIds);

  const out: ProjectedItem[] = items.map((it) => {
    if (deleted.has(it.id)) return { ...it, pending: 'deleted' };
    const upd = updatedById.get(it.id);
    if (upd) {
      const next = applyUpdate(it, upd.frontmatter);
      return { ...(upd.bodySet || upd.body ? applyBody(next, upd.body) : next), pending: 'edited' };
    }
    return it;
  });

  // Reorder overrides whatever order step 1 landed on for listed lanes.
  const orderById = new Map<string, number>();
  for (const lanes of Object.values(cs.reorder)) {
    for (const orderedIds of Object.values(lanes)) {
      orderedIds.forEach((id, idx) => orderById.set(id, idx + 1));
    }
  }
  const reordered = orderById.size
    ? out.map((it) => (orderById.has(it.id) ? { ...it, order: orderById.get(it.id)! } : it))
    : out;

  const createdItems = cs.created.map((entry) => ({
    ...applyBody(newItemDefaults(entry), entry.body ?? ''),
    pending: 'new' as const,
  }));

  return [...reordered, ...createdItems];
}

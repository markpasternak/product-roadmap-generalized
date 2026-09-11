// Runtime counterpart to `lib/board.ts`'s `buildBoardItems` — that function is BUILD-TIME
// (uses `getCollection`), so it can't run in the browser. This maps the edit-service's
// `GET /api/items` response (git-fresh, read straight off the commit) into the same `ItemVM`
// shape the board renders, so Board.vue can refresh its base state right after a Sync lands
// instead of waiting on the ~1-min-stale deployed site (see Board.vue's `refreshLiveItems`).
import {
  parseTags,
  horizonRank,
  sectionText,
  extractSection,
  isPlaceholder,
  inlineMdToText,
  stripMd,
  parseLinks,
} from '../items';
import { IS_PUBLIC } from '../audience';
import { buildSearchText, type ItemVM } from '../filters';
import { normalizeItemHistory } from '../itemHistory';
import type { ApiItem } from './client';
import { STORY_HEADINGS, sectionLabel } from '../sectionHeadings';
import { resourcePlacements } from '../resources';

const REPO_EDIT_BASE = 'https://github.com/markpasternak/product-roadmap-generalized/edit/main';

/** Body sections for the drawer: plain text, one line per source line, bullets kept as
 * glyphs — mirrors `buildBoardItems`'s own `sectionBlock` exactly. */
function sectionBlock(body: string, heading: string): string {
  const rawSection = extractSection(body, heading);
  if (!rawSection || isPlaceholder(rawSection)) return '';
  return rawSection
    .split('\n')
    .map((l) => {
      const isBullet = /^\s*[-*]\s+/.test(l);
      const text = inlineMdToText(l);
      return text && isBullet ? `•  ${text}` : text;
    })
    .filter(Boolean)
    .join('\n');
}

/** Maps `/api/items` output into board `ItemVM`s — a runtime equivalent of `buildBoardItems`,
 * minus the backing-doc cross-referencing (doc titles aren't resolvable at runtime; doc links
 * still resolve, just with `title: null` — an acceptable degradation for this base-refresh
 * path, which only needs to unblock Sync's base-version/reconcile logic, not fully replicate
 * the drawer's doc-title lookups). Pure function — no DOM, no network. */
export function itemsFromApi(apiItems: ApiItem[], base: string): ItemVM[] {
  const raw = apiItems.map((item) => {
    const fm = item.frontmatter ?? {};
    const history = normalizeItemHistory(item.git);
    const body = item.body ?? '';
    const { tags, themes } = parseTags(fm.tags);
    const sections = STORY_HEADINGS
      .map((heading) => ({ heading: sectionLabel(heading), text: sectionBlock(body, heading), markdown: extractSection(body, heading) }))
      .filter((s) => s.text || resourcePlacements(s.markdown).some(placement => placement.image));
    const title = fm.title ?? '';
    const oneliner = sectionText(body, 'One-liner');
    const editUrl = !IS_PUBLIC && item.path ? `${REPO_EDIT_BASE}/${item.path}` : null;
    const searchText = buildSearchText(
      {
        id: item.id,
        title,
        oneliner,
        bodyText: stripMd(body),
        tags,
        themes,
        owner: fm.owner ?? '',
      },
      !IS_PUBLIC,
    );
    return {
      id: item.id,
      title,
      product: fm.product ?? '',
      startDate: fm.startDate,
      endDate: fm.endDate,
      horizon: fm.horizon ?? '',
      stage: fm.stage ?? '',
      owner: IS_PUBLIC ? '' : (fm.owner ?? ''),
      impact: fm.impact || null,
      effort: fm.effort || null,
      visibility: fm.visibility ?? '',
      order: Number(fm.order) || 0,
      ...history,
      tags,
      themes,
      oneliner,
      outcome: sectionText(body, 'Target outcome'),
      sections,
      editUrl,
      links: parseLinks(body, base).map((l) => ({ ...l, title: null })),
      text: searchText,
      href: `${base}item/${item.id}`,
    } satisfies ItemVM;
  });
  // Mirrors `byHorizonThenOrder`'s exact ordering (lane, then manual order, then id for
  // stability) — reimplemented against `ItemVM` directly rather than calling it, since that
  // helper is typed against the full (build-time, zod-validated) `ItemFrontmatter`, which
  // carries fields (like `external_visibility`) this runtime mapping never has.
  return raw.sort(
    (a, b) => horizonRank(a.horizon) - horizonRank(b.horizon) || a.order - b.order || a.id.localeCompare(b.id),
  );
}

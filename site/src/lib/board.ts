// Build the board's view-models from the content collections. Shared by the
// root board (`/`) and the per-product pages (`/music-app/` etc.) so both render
// identical data — the product pages just seed an initial product filter.
import { getCollection } from 'astro:content';
import {
  parseTags,
  byHorizonThenOrder,
  sectionText,
  extractSection,
  isPlaceholder,
  inlineMdToText,
  stripMd,
  parseLinks,
  docTargetKey,
} from './items';
import { IS_PUBLIC } from './audience';
import { getVisibleDocCollections } from './docs';
import { buildSearchText, type ItemVM } from './filters';
import { itemHistoryForPath } from './itemHistory.server';
import { STORY_HEADINGS, sectionLabel } from './sectionHeadings';
import { resourcePlacements } from './resources';

const REPO_EDIT_BASE = 'https://github.com/markpasternak/product-roadmap-generalized/edit/main';

export async function buildBoardItems(base: string): Promise<ItemVM[]> {
  // Public builds only ever see Public content — items, docs, and the search haystack.
  const forAudience = <T extends { data: { visibility: string } }>(entries: T[]): T[] =>
    IS_PUBLIC ? entries.filter((e) => e.data.visibility === 'Public') : entries;

  const raw = forAudience(await getCollection('items'));
  const docCollections = await getVisibleDocCollections();
  raw.sort((a, b) => byHorizonThenOrder(a.data, b.data));

  const docEntries = docCollections.flatMap(({ root, entries }) =>
    entries.map((entry) => ({
      root,
      entry,
      text: `${entry.data.id ?? ''} ${entry.data.title ?? ''} ${stripMd(entry.body ?? '')}`,
    })),
  );

  const docsByItem = new Map<string, string[]>();
  const docsByTarget = new Map<string, string>();
  const docTitleByTarget = new Map<string, string>();
  for (const doc of docEntries) {
    const key = `${doc.root}/${doc.entry.id}`.toLowerCase();
    docsByTarget.set(key, doc.text);
    if (doc.entry.data.title) docTitleByTarget.set(key, doc.entry.data.title);
    if (doc.entry.data.roadmap_item) {
      const docs = docsByItem.get(doc.entry.data.roadmap_item) ?? [];
      docs.push(doc.text);
      docsByItem.set(doc.entry.data.roadmap_item, docs);
    }
  }

  const backingDocText = (itemBody: string, itemId: string): string[] => {
    const docs = new Set(docsByItem.get(itemId) ?? []);
    for (const link of parseLinks(itemBody, base)) {
      if (link.kind !== 'doc') continue;
      const key = docTargetKey(link.target);
      const text = key ? docsByTarget.get(key) : undefined;
      if (text) docs.add(text);
    }
    return [...docs];
  };

  return raw.map((e) => {
    const { tags, themes } = parseTags(e.data.tags);
    const body = e.body ?? '';
    // Body sections for the drawer: plain text, one line per source line, bullets kept as glyphs.
    const sectionBlock = (heading: string): string => {
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
    };
    // The card/drawer is the fixed layer: headline + Target outcome + Why it matters +
    // What ships. Everything else in the body renders on the full item page only.
    const sections = STORY_HEADINGS
      .map((heading) => ({ heading: sectionLabel(heading), text: sectionBlock(heading), markdown: extractSection(body, heading) }))
      .filter((s) => s.text || resourcePlacements(s.markdown).some(placement => placement.image));
    const repoPath = e.filePath ? e.filePath.slice(e.filePath.indexOf('content/items/')) : null;
    const editUrl = !IS_PUBLIC && repoPath ? `${REPO_EDIT_BASE}/${repoPath}` : null;
    const history = itemHistoryForPath(repoPath);
    const title = e.data.title;
    const oneliner = sectionText(body, 'One-liner');
    const searchText = buildSearchText(
      {
        id: e.data.id,
        title,
        oneliner,
        bodyText: stripMd(body),
        backingText: backingDocText(body, e.data.id),
        tags,
        themes,
        owner: e.data.owner,
      },
      !IS_PUBLIC,
    );
    return {
      id: e.data.id,
      title,
      product: e.data.product,
      startDate: e.data.startDate,
      endDate: e.data.endDate,
      horizon: e.data.horizon,
      stage: e.data.stage,
      owner: IS_PUBLIC ? '' : e.data.owner,
      impact: e.data.impact ?? null,
      effort: e.data.effort ?? null,
      visibility: e.data.visibility,
      order: e.data.order,
      ...history,
      tags,
      themes,
      oneliner,
      outcome: sectionText(body, 'Target outcome'),
      sections,
      editUrl,
      links: parseLinks(body, base).map((l) => ({
        ...l,
        title:
          l.kind === 'doc'
            ? (docTitleByTarget.get(docTargetKey(l.target) ?? '') ?? null)
            : l.kind === 'presentation'
              ? (l.href.split('/').filter(Boolean).pop() ?? '').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
              : null,
      })),
      text: searchText,
      href: `${base}item/${e.data.id}`,
    } satisfies ItemVM;
  });
}

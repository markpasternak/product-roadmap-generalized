// The single source of truth for what may leave the building. A strict WHITELIST:
// every field on ProjectedItem is copied explicitly, so owner / editUrl / links /
// raw body / search text are physically absent from a share, not merely hidden.
import type { ItemVM } from '../filters';
import { inlineMdToText } from '../items';
import { repositoryAssetPath, resourcePlacements } from '../resources';
import { isStoryHeading, sectionLabel } from '../sectionHeadings';

export type ShareBlock = { text: string } | { image: { href: string; label: string } };
export type ShareSection = { heading: string; text: string; blocks?: ShareBlock[] };

/** Retain image positions without exporting raw Markdown or internal link targets. */
function sectionBlocks(markdown: string): ShareBlock[] {
  const blocks: ShareBlock[] = [];
  const addText = (source: string) => {
    const text = source.split('\n').map(line => {
      const value = inlineMdToText(line);
      return value && /^\s*[-*]\s+/.test(line) ? `• ${value}` : value;
    }).join('\n').trim();
    if (text) blocks.push({ text });
  };
  let cursor = 0;
  const placements = resourcePlacements(markdown);
  for (const placement of placements.filter(p => p.image)) {
    const enclosingLink = placements.find(parent => !parent.image && parent.start <= placement.start && parent.end >= placement.end);
    addText(markdown.slice(cursor, enclosingLink?.start ?? placement.start));
    if (repositoryAssetPath(placement.href) || /^https?:\/\//i.test(placement.href)) {
      blocks.push({ image: { href: placement.href, label: placement.label } });
    }
    cursor = enclosingLink?.end ?? placement.end;
  }
  addText(markdown.slice(cursor));
  return blocks;
}

export interface ProjectedItem {
  startDate?: string | null;
  endDate?: string | null;
  cover?: string | null;
  coverPosition?: string | null;
  coverFraming?: number | null;
  resources?: import('./resources').SharedResource[];
  id: string;
  title: string;
  oneliner: string;
  outcome: string;
  product: string;
  horizon: string;
  stage: string;
  tags: string[];
  themes: string[];
  sections: ShareSection[];
}

export function projectForShare(item: ItemVM): ProjectedItem {
  return {
    ...(item.startDate ? { startDate: item.startDate } : {}),
    ...(item.endDate ? { endDate: item.endDate } : {}),
    ...(item.cover ? { cover: item.cover, coverPosition: item.coverPosition || '50% 50%', coverFraming: item.coverFraming ?? 0 } : {}),
    id: item.id,
    title: item.title,
    oneliner: item.oneliner,
    outcome: item.outcome,
    product: item.product,
    horizon: item.horizon,
    stage: item.stage,
    tags: [...item.tags],
    themes: [...item.themes],
    sections: item.sections.filter(s => isStoryHeading(s.heading)).map((s) => {
      const blocks = s.markdown ? sectionBlocks(s.markdown) : undefined;
      return {
        heading: sectionLabel(s.heading),
        text: blocks ? blocks.flatMap(block => 'text' in block ? [block.text] : []).join('\n\n') : s.text,
        ...(blocks ? { blocks } : {}),
      };
    }),
  };
}

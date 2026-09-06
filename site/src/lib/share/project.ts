// The single source of truth for what may leave the building. A strict WHITELIST:
// every field on ProjectedItem is copied explicitly, so owner / editUrl / links /
// raw body / search text are physically absent from a share, not merely hidden.
import type { ItemVM } from '../filters';

export interface ProjectedItem {
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
  sections: { heading: string; text: string }[];
}

export function projectForShare(item: ItemVM): ProjectedItem {
  return {
    id: item.id,
    title: item.title,
    oneliner: item.oneliner,
    outcome: item.outcome,
    product: item.product,
    horizon: item.horizon,
    stage: item.stage,
    tags: [...item.tags],
    themes: [...item.themes],
    sections: item.sections.map((s) => ({ heading: s.heading, text: s.text })),
  };
}

import { parseSections as parseEditableSections } from './edit/sections';
import { resourcePlacements, repositoryAssetPath, resourceHref } from './resources';
import { HORIZONS } from './schema';
import type { ItemFrontmatter } from './schema';

/** Split a comma-separated `tags` frontmatter string into plain tags and `theme:` themes. */
export function parseTags(tags?: string): { tags: string[]; themes: string[] } {
  const all = (tags ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const themes = all
    .filter((t) => t.toLowerCase().startsWith('theme:'))
    .map((t) => t.slice(6).trim());
  const tagsPlain = all.filter((t) => !t.toLowerCase().startsWith('theme:'));
  return { tags: tagsPlain, themes };
}

export const horizonRank = (h: string): number => {
  const i = (HORIZONS as readonly string[]).indexOf(h);
  return i === -1 ? 99 : i;
};

/** Board ordering: lane, then manual order within lane, then id for stability. */
export function byHorizonThenOrder(a: ItemFrontmatter, b: ItemFrontmatter): number {
  return (
    horizonRank(a.horizon) - horizonRank(b.horizon) ||
    a.order - b.order ||
    a.id.localeCompare(b.id)
  );
}

/** True for template placeholder prose ("To fill in.", "_To fill in._", "- To fill in.") */
export function isPlaceholder(text: string): boolean {
  return /^to fill in\.?$/i.test(
    text
      .replace(/^[-*]\s+/gm, '')
      .replace(/[_*`]/g, '')
      .trim(),
  );
}

/** Inline markdown → display text: unwraps emphasis/links/code, keeps the words. */
export function inlineMdToText(md: string): string {
  return md
    .replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A section's display text: cleaned of markdown, empty if it's still the template placeholder. */
export function sectionText(body: string, heading: string): string {
  const raw = extractSection(body, heading);
  if (!raw || isPlaceholder(raw)) return '';
  return inlineMdToText(raw);
}

/** Every `## Heading` section of a body, in file order, placeholders excluded. */
export function parseSections(body: string): { heading: string; raw: string }[] {
  return parseEditableSections(body).sections.map(s => ({ heading: s.heading, raw: s.body.trim() })).filter(s => s.raw && !isPlaceholder(s.raw));
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Inline markdown → HTML: code, links (external open in a new tab), bold, italic. */
export function inlineMdToHtml(md: string): string {
  return escapeHtml(md)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, href) =>
      /^https?:\/\//i.test(href)
        ? `<a href="${href}" target="_blank" rel="noopener">${text}</a>`
        : `<a href="${href}">${text}</a>`,
    )
    .replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=$|[\s).,;:!?])/g, '$1<em>$2</em>');
}

/** Block-level markdown → HTML for a section body: paragraphs, bullet and numbered lists. */
export function mdToHtml(md: string): string {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let para: string[] = [];
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inlineMdToHtml).join('<br />')}</p>`);
    para = [];
  };
  for (const line of md.split('\n')) {
    const t = line.trim();
    const ul = t.match(/^[-*]\s+(.*)/);
    const ol = ul ? null : t.match(/^\d+[.)]\s+(.*)/);
    if (ul || ol) {
      flushPara();
      const kind = ul ? 'ul' : 'ol';
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inlineMdToHtml((ul ?? ol)![1])}</li>`);
    } else if (!t) {
      flushPara();
      closeList();
    } else {
      closeList();
      para.push(t);
    }
  }
  flushPara();
  closeList();
  return out.join('');
}

/** Pull a `## Heading` section's prose out of a rendered-markdown body. */
export function extractSection(body: string, heading: string): string {
  return parseEditableSections(body).sections.filter(s => s.heading === heading).map(s => s.body).join('\n').trim();
}

export interface ItemLink {
  label: string;
  kind: 'doc' | 'external' | 'presentation' | 'file';
  href: string;
  target: string;
  image?: boolean;
}

const DOC_ROUTE: Record<string, string> = {
  prds: 'prd',
  'technical-design': 'technical-design',
  research: 'research',
};

export function docTargetKey(target: string): string | null {
  const dm = target.replace(/\\/g, '/').match(/(?:^|\/)(prds|technical-design|research)\/(.+?)(?:\.md)?$/i);
  return dm ? `${dm[1].toLowerCase()}/${dm[2].toLowerCase()}` : null;
}

/** Parse an item's `## Links` section into resolved related documents / external links. */
export function parseLinks(body: string, base: string): ItemLink[] {
  const prefix = base.replace(/\/$/, '');
  const out: ItemLink[] = [];
  const placements = resourcePlacements(body).filter(p => ['Resources','Links'].includes(p.section));
  for (const placement of placements) {
    const label = placement.label.replace(/:/g, ' –').trim() || 'Image';
    const target = placement.href.trim();
    const image = placement.image ? { image: true } : {};
    if (repositoryAssetPath(target)) { out.push({ label, kind: 'file', href: resourceHref(target, base), target, ...image }); continue; }
    if (/^https?:\/\//i.test(target)) {
      out.push({ label, kind: 'external', href: target, target, ...image });
      continue;
    }
    // A hosted microsite/presentation: `/p/<slug>/`, `p/<slug>` or `presentations/<slug>`.
    const pm = target.match(/(?:^|\/)(?:p|presentations)\/([a-z0-9-]+)\/?$/i);
    if (pm) {
      out.push({ label, kind: 'presentation', href: `${prefix}/p/${pm[1].toLowerCase()}/`, target });
      continue;
    }
    const dm = target.match(/(?:^|\/)(prds|technical-design|research)\/(?:.*\/)?([^/]+)\.md$/);
    if (dm) {
      out.push({
        label,
        kind: 'doc',
        href: `${prefix}/docs/${DOC_ROUTE[dm[1]]}/${dm[2].toLowerCase()}`,
        target,
      });
    }
  }
  return out;
}

/** Rough markdown → plain text, for building a search haystack. */
export function stripMd(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

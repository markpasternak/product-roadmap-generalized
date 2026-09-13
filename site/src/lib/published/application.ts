import { formatDateTime } from '../dates';
import { escapeHtml } from '../utils';

export function escapeSeed(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function fillTemplate(template: string, input: { title: string; html: string; seed: unknown; description?: string; path?: string; client?: string; styles?: string[]; publishedAt?: string; ogType?: 'website' | 'article' }) {
  for (const marker of ['<!--ROADMAP_CONTENT-->', '<!--ROADMAP_STYLES-->', '__ROADMAP_SEED__', '__ROADMAP_CLIENT__']) {
    if (template.split(marker).length !== 2) throw new Error(`Invalid publication template: ${marker}`);
  }
  const replacements: Record<string, string> = {
    '<!--ROADMAP_CONTENT-->': input.html,
    '__ROADMAP_TITLE__': escapeHtml(input.title),
    '__ROADMAP_DESCRIPTION__': escapeHtml(input.description ?? ''),
    '__ROADMAP_PATH__': escapeHtml(input.path ?? ''),
    '__ROADMAP_SEED__': escapeSeed(input.seed),
    '__ROADMAP_CLIENT__': escapeHtml(input.client ?? ''),
    '__ROADMAP_OG_TYPE__': input.ogType ?? 'website',
    '__ROADMAP_PUBLISHED_AT__': escapeHtml(input.publishedAt ?? ''),
    '__ROADMAP_PUBLISHED_LABEL__': escapeHtml(formatDateTime(input.publishedAt, { timeZone: 'UTC', suffix: 'UTC' })),
    '<!--ROADMAP_STYLES-->': (input.styles ?? []).map(href => `<link rel="stylesheet" href="${escapeHtml(href)}">`).join(''),
  };
  // One pass: content can legitimately contain text that looks like a template marker.
  return template.replace(/<!--ROADMAP_(?:CONTENT|STYLES)-->|__ROADMAP_(?:TITLE|DESCRIPTION|PATH|SEED|CLIENT|OG_TYPE|PUBLISHED_AT|PUBLISHED_LABEL)__/g, marker => replacements[marker]);
}

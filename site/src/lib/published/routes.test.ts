import { expect, it } from 'vitest';
import { contentRoutes, pageKind } from './routes';
import type { PublishedContent } from './model';

it('owns every live content surface even when all collections are empty', () => {
  const model: PublishedContent = { items: [], boardItems: [], documents: [], documentHtml: {}, audience: 'internal' };
  const routes = contentRoutes(model, '/roadmap/');
  expect(routes.map(route => route.path)).toEqual(['', 'core-tech', 'infra', 'data', 'studio', 'creative-manager', 'revenue-ops', 'docs', 'themes', 'changelog', 'changes']);
  expect(new Set(routes.map(route => route.path)).size).toBe(routes.length);
  expect(routes.find(route => route.path === 'docs')).toMatchObject({ kind: 'documents', active: 'docs' });
  expect(pageKind('item/deleted')).toBe('item');
  expect(pageKind('docs/prd/deleted')).toBe('document');
  expect(pageKind('unknown-route')).toBe('unavailable');
});

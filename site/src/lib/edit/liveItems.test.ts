import { describe, expect, it } from 'vitest';
import { itemsFromApi } from './liveItems';
import type { ApiItem } from './client';

function apiItem(over: Partial<ApiItem> & { id: string }): ApiItem {
  return {
    path: `content/items/podcasts-audiobooks/${over.id}-title.md`,
    body: '',
    ...over,
  };
}

describe('itemsFromApi', () => {
  it('maps frontmatter + body into the board ItemVM shape', () => {
    const body = `## One-liner
Ships fast.

## Target outcome
Faster shipping.

## Why it matters
- Because reasons

## What ships
- The thing

## Links
- Notion PRD: content/prds/foo.md
- External: https://example.com/x
`;
    const [vm] = itemsFromApi(
      [
        apiItem({
          id: 'TALK-1',
          frontmatter: {
            title: 'Ship it',
            product: 'Podcasts & Audiobooks',
            horizon: 'Now',
            stage: 'Building',
            owner: 'mark@example.com',
            impact: 'High',
            effort: 'Low',
            visibility: 'Internal',
            order: '3',
            tags: 'workflow, theme:one-view',
          },
          git: {
            createdAt: '2026-07-01T09:00:00.000Z',
            updatedAt: '2026-07-02T10:30:00.000Z',
            createdBy: 'Mark',
            updatedBy: 'Roadmap Editor',
            createdCommit: 'abc123',
            updatedCommit: 'def456',
            createdSubject: 'seed item',
            updatedSubject: 'edit item',
          },
          body,
        }),
      ],
      '/',
    );

    expect(vm.id).toBe('TALK-1');
    expect(vm.title).toBe('Ship it');
    expect(vm.product).toBe('Podcasts & Audiobooks');
    expect(vm.horizon).toBe('Now');
    expect(vm.stage).toBe('Building');
    expect(vm.owner).toBe('mark@example.com');
    expect(vm.order).toBe(3);
    expect(vm.impact).toBe('High');
    expect(vm.effort).toBe('Low');
    expect(vm.visibility).toBe('Internal');
    expect(vm.created).toBe('2026-07-01');
    expect(vm.updated).toBe('2026-07-02');
    expect(vm.updatedBy).toBe('Roadmap Editor');
    expect(vm.updatedCommit).toBe('def456');
    expect(vm.tags).toEqual(['workflow']);
    expect(vm.themes).toEqual(['one-view']);
    expect(vm.oneliner).toBe('Ships fast.');
    expect(vm.outcome).toBe('Faster shipping.');
    expect(vm.sections.map((s) => s.heading)).toEqual(['Why it matters', 'Scope']);
    expect(vm.sections.find((s) => s.heading === 'Why it matters')?.text).toBe('•  Because reasons');
    expect(vm.href).toBe('/item/TALK-1');
  });

  it('defaults missing frontmatter fields, coerces a non-numeric order to 0, and sorts by owner-provided tags', () => {
    const [vm] = itemsFromApi([apiItem({ id: 'TALK-2', frontmatter: {} })], '/');
    expect(vm.title).toBe('');
    expect(vm.owner).toBe('');
    expect(vm.impact).toBeNull();
    expect(vm.effort).toBeNull();
    expect(vm.order).toBe(0);
    expect(vm.updated).toBe('');
    expect(vm.tags).toEqual([]);
    expect(vm.themes).toEqual([]);
  });

  it('resolves doc links with a null title (unresolvable at runtime) and external links normally', () => {
    const body = `## Links
- PRD: content/prds/foo.md
- External: https://example.com/x
`;
    const [vm] = itemsFromApi([apiItem({ id: 'TALK-3', frontmatter: {}, body })], '/');
    const doc = vm.links.find((l) => l.kind === 'doc');
    const external = vm.links.find((l) => l.kind === 'external');
    expect(doc?.title).toBeNull();
    expect(doc?.href).toBe('/docs/prd/foo');
    expect(external?.href).toBe('https://example.com/x');
  });

  it('sorts the result by horizon then manual order, like buildBoardItems', () => {
    const vms = itemsFromApi(
      [
        apiItem({ id: 'TALK-later', frontmatter: { horizon: 'Later', order: '1' } }),
        apiItem({ id: 'TALK-now-2', frontmatter: { horizon: 'Now', order: '2' } }),
        apiItem({ id: 'TALK-now-1', frontmatter: { horizon: 'Now', order: '1' } }),
      ],
      '/',
    );
    expect(vms.map((v) => v.id)).toEqual(['TALK-now-1', 'TALK-now-2', 'TALK-later']);
  });

  it('builds a lowercased search haystack from title, oneliner, body, tags and themes', () => {
    const [vm] = itemsFromApi(
      [
        apiItem({
          id: 'TALK-4',
          frontmatter: { title: 'Zebra Feature', tags: 'Workflow, theme:One-View' },
          body: '## One-liner\nMakes zebras happy.\n',
        }),
      ],
      '/',
    );
    expect(vm.text).toContain('zebra feature');
    expect(vm.text).toContain('makes zebras happy');
    expect(vm.text).toContain('workflow');
    expect(vm.text).toContain('one-view');
  });
});

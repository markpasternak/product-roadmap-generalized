// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderShareHtml } from './render';
import type { ProjectedItem } from './project';

const item: ProjectedItem = { id: 'A', title: 'First item', oneliner: 'First summary', outcome: 'Outcome', product: 'Studio', horizon: 'Now', stage: 'Building', tags: [], themes: [], sections: [] };

describe('shared horizon navigation', () => {
  it('navigates in visible lane order while preserving links to items in the original selection order', () => {
    const html = renderShareHtml({ title: 'Review', product: null, generatedAt: '2026-09-11' }, [
      { ...item, id: 'completed', horizon: 'Completed' },
      { ...item, id: 'next', horizon: 'Next' },
      { ...item, id: 'now', horizon: 'Now' },
      { ...item, id: 'now-second', horizon: 'Now' },
    ]);
    document.documentElement.innerHTML = html.replace(/<style>[\s\S]*?<\/style>/g, '');
    history.replaceState(null, '', '?item=next');
    localStorage.setItem('rm-item-reading-mode', 'expanded');
    window.eval(document.querySelector('script:not([type])')!.textContent!);
    try {
      expect(document.querySelector('[data-detail-shell]')?.classList.contains('is-expanded')).toBe(true);
      expect(document.getElementById('detail-count')?.textContent).toBe('3/4');
      document.querySelector<HTMLButtonElement>('[data-detail-prev]')!.click();
      expect(new URL(location.href).searchParams.get('item')).toBe('now-second');
      document.querySelector<HTMLButtonElement>('[data-detail-prev]')!.click();
      expect(new URL(location.href).searchParams.get('item')).toBe('now');
      expect(document.querySelector<HTMLButtonElement>('[data-detail-prev]')!.disabled).toBe(true);
      document.querySelector<HTMLButtonElement>('[data-card-index="0"]')!.click();
      expect(new URL(location.href).searchParams.get('item')).toBe('completed');
      expect(document.getElementById('detail-count')?.textContent).toBe('4/4');
      expect(document.querySelector<HTMLButtonElement>('[data-detail-next]')!.disabled).toBe(true);
    } finally { document.body.replaceChildren(); history.replaceState(null, '', '/'); localStorage.clear(); }
  });

});

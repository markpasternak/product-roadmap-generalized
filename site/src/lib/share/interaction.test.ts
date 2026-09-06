// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderShareHtml } from './render';
import type { ProjectedItem } from './project';

const item: ProjectedItem = { id: 'A', title: 'First item', oneliner: 'First summary', outcome: 'Outcome', product: 'Music App', horizon: 'Now', stage: 'Building', tags: [], themes: [], sections: [] };

describe('standalone share interaction', () => {
  it('contains focus, resets reading position, and returns to the opening card', async () => {
    // These checks exercise the exported script without loading fonts or other resources.
    const html = renderShareHtml({ title: 'Review', product: 'Music App', generatedAt: '2026-09-06' }, [item, { ...item, id: 'B', title: 'Second item' }]);
    document.documentElement.innerHTML = html.replace(/<style>[\s\S]*?<\/style>/g, '');
    window.eval(document.querySelector('script:not([type])')!.textContent!);
    try {
      const card = document.querySelector<HTMLButtonElement>('[data-card-index="0"]')!;
      card.focus();
      card.click();
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      expect(document.activeElement?.id).toBe('detail-title');
      const key = (value: string, shiftKey = false) => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }));
      key('Tab', true);
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Close');
      key('Tab');
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Next item');
      const scroller = document.querySelector<HTMLElement>('.drawer-scroll')!;
      scroller.scrollTop = 150;
      document.querySelector<HTMLButtonElement>('[data-detail-next]')!.click();
      expect(document.getElementById('detail-title')?.textContent).toBe('Second item');
      expect(scroller.scrollTop).toBe(0);
      key('Escape');
      expect(document.querySelector<HTMLElement>('[data-detail-shell]')!.hidden).toBe(true);
      expect(document.activeElement).toBe(card);
    } finally { document.body.replaceChildren(); }
  });
});

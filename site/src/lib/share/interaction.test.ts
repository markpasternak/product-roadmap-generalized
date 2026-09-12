// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderShareHtml } from './render';
import type { ProjectedItem } from './project';

const item: ProjectedItem = { id: 'A', title: 'First item', oneliner: 'First summary', outcome: 'Outcome', product: 'Music App', horizon: 'Now', stage: 'Building', tags: [], themes: [], sections: [] };

describe('standalone share interaction', () => {
  it('contains focus, resets reading position, and returns to the opening card', async () => {
    // These checks exercise the exported script without loading fonts or other resources.
    const html = renderShareHtml({ title: 'Review', product: 'Music App', generatedAt: '2026-09-06' }, [item, {
      ...item, id: 'B', title: 'Second item', horizon: 'Completed',
      sections: [{ heading: 'What shipped', text: 'Done', blocks: [{ text: 'Before' }, { image: { href: 'assets/ast_test/rev_one/image.png', label: 'Production screen' } }, { text: 'After' }] }, { heading: 'Bottom line', text: 'Complete.' }],
      resources: [{ label: 'Production screen', href: 'assets/ast_test/rev_one/image.png', image: true, inline: true }],
    }]);
    document.documentElement.innerHTML = html.replace(/<style>[\s\S]*?<\/style>/g, '');
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; };
    history.replaceState(null, '', '?item=B');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    window.eval(document.querySelector('script:not([type])')!.textContent!);
    try {
      expect(document.getElementById('detail-title')?.textContent).toBe('Second item');
      expect(document.querySelector<HTMLElement>('[data-detail-shell]')!.hidden).toBe(false);
      document.querySelector<HTMLButtonElement>('button[data-detail-close]')!.click();
      expect(location.search).toBe('');
      const card = document.querySelector<HTMLButtonElement>('[data-card-index="0"]')!;
      card.focus();
      card.click();
      expect(new URL(location.href).searchParams.get('item')).toBe('A');
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
      expect(new URL(location.href).searchParams.get('item')).toBe('B');
      expect(document.getElementById('detail-title')?.textContent).toBe('Second item');
      const detail = document.querySelector('[data-detail-panel]')!;
      expect(detail.textContent).toContain('Completed');
      expect(detail.textContent).not.toContain('Building');
      expect([...detail.querySelectorAll('h3')].map(heading => heading.textContent)).toEqual(['Target outcome', 'Scope', 'Bottom line']);
      expect(detail.querySelectorAll('.detail-sections img')).toHaveLength(1);
      expect(detail.querySelector('.detail-sections img')?.getAttribute('alt')).toBe('Production screen');
      expect(detail.querySelector('.shared-inline-image')?.previousElementSibling?.textContent).toBe('Before');
      expect(detail.querySelector('.shared-inline-image')?.nextElementSibling?.textContent).toBe('After');
      expect(scroller.scrollTop).toBe(0);
      document.querySelector<HTMLButtonElement>('[data-detail-expand]')!.click();
      expect(document.querySelector('[data-detail-shell]')?.classList.contains('is-expanded')).toBe(true);
      expect(document.querySelector('[data-detail-expand]')?.getAttribute('aria-label')).toBe('Collapse item');
      document.querySelector<HTMLButtonElement>('[data-detail-copy]')!.click();
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('?item=B'));
      expect(document.querySelector('[data-copy-status]')?.textContent).toBe('Item link copied.');
      document.querySelector<HTMLElement>('.shared-inline-image')!.click();
      expect(document.querySelector('dialog')?.open).toBe(true);
      expect(document.querySelector('[data-image-count]')?.textContent).toBe('1 / 1');
      key('ArrowRight');
      expect(document.getElementById('detail-title')?.textContent).toBe('Second item');
      key('Escape');
      expect(document.querySelector('dialog')?.open).toBe(false);
      expect(document.querySelector<HTMLElement>('[data-detail-shell]')!.hidden).toBe(false);
      key('Escape');
      expect(document.querySelector<HTMLElement>('[data-detail-shell]')!.hidden).toBe(true);
      expect(document.activeElement).toBe(card);
      history.replaceState(null, '', '?item=A');
      window.dispatchEvent(new PopStateEvent('popstate'));
      expect(document.getElementById('detail-title')?.textContent).toBe('First item');
      expect(document.querySelector('[data-detail-shell]')?.classList.contains('is-expanded')).toBe(true);
      expect(localStorage.getItem('rm-item-reading-mode')).toBe('expanded');
      document.querySelector<HTMLButtonElement>('[data-detail-expand]')!.click();
      expect(localStorage.getItem('rm-item-reading-mode')).toBe('compact');
      history.replaceState(null, '', '?item=removed');
      window.dispatchEvent(new PopStateEvent('popstate'));
      expect(document.querySelector<HTMLElement>('[data-detail-shell]')!.hidden).toBe(true);
      expect(document.querySelector<HTMLElement>('[data-item-link-notice]')!.hidden).toBe(false);
    } finally { document.body.replaceChildren(); history.replaceState(null, '', '/'); localStorage.clear(); }
  });
});

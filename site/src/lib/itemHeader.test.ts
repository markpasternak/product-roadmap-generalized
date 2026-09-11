// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { installItemHeader } from './itemHeader';

it('reveals the title only after the content heading leaves view, in either reading mode', async () => {
  document.body.innerHTML = '<div><aside><div class="item-toolbar"><span>Creative Manager</span><span data-header-title>Full initiative title</span></div><div data-reading-scroll><h2 data-reading-title>Full initiative title</h2></div></aside></div>';
  const panel = document.querySelector('aside')!;
  const scroll = panel.querySelector<HTMLElement>('[data-reading-scroll]')!;
  const heading = panel.querySelector('h2')!;
  vi.spyOn(scroll, 'getBoundingClientRect').mockReturnValue({ top: 60 } as DOMRect);
  vi.spyOn(heading, 'getBoundingClientRect').mockImplementation(() => ({ bottom: 160 - scroll.scrollTop } as DOMRect));
  const header = installItemHeader(panel);
  const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  await settle();
  expect(panel.querySelector('[data-header-title]')?.getAttribute('aria-hidden')).toBe('true');
  for (const expanded of [false, true]) {
    panel.parentElement!.classList.toggle('is-expanded', expanded);
    scroll.scrollTop = 120;
    scroll.dispatchEvent(new Event('scroll'));
    await settle();
    expect(panel.querySelector('.item-toolbar')?.classList.contains('item-title-revealed')).toBe(true);
    scroll.scrollTop = 0;
    scroll.dispatchEvent(new Event('scroll'));
    await settle();
    expect(panel.querySelector('[data-header-title]')?.getAttribute('aria-hidden')).toBe('true');
  }
  header.destroy();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

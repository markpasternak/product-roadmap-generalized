// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { installItemToc } from './itemToc';

let toc: ReturnType<typeof installItemToc> | undefined;
afterEach(() => { toc?.destroy(); document.body.replaceChildren(); vi.restoreAllMocks(); });

it('shows only for a wide expanded reader and jumps within the item without changing its URL', async () => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1400);
  document.body.innerHTML = '<div class="is-expanded"><aside><div data-reading-scroll><div data-reading-layout><div data-reading-body><h3 class="roadmap-section-heading">Why it matters</h3><h3 class="roadmap-section-heading">Scope</h3></div><nav data-item-toc hidden></nav></div></div></aside></div>';
  const panel = document.querySelector('aside')!;
  const scroller = panel.querySelector<HTMLElement>('[data-reading-scroll]')!;
  const headings = [...panel.querySelectorAll('h3')];
  vi.spyOn(scroller, 'getBoundingClientRect').mockImplementation(() => ({ top: 100 } as DOMRect));
  headings.forEach((heading, index) => vi.spyOn(heading, 'getBoundingClientRect').mockImplementation(() => ({ top: 140 + index * 460 - scroller.scrollTop } as DOMRect)));
  toc = installItemToc(panel);
  const nav = panel.querySelector<HTMLElement>('nav')!;
  expect(nav.hidden).toBe(false);
  const originalUrl = location.href;
  nav.querySelectorAll<HTMLAnchorElement>('a')[1].click();
  expect(scroller.scrollTop).toBe(484);
  expect(document.activeElement).toBe(headings[1]);
  expect(nav.querySelector('[aria-current]')?.textContent).toBe('Scope');
  expect(location.href).toBe(originalUrl);
  // A short final section cannot scroll to the top; reaching the end still selects it.
  Object.defineProperties(scroller, { scrollHeight: { value: 2000 }, clientHeight: { value: 1000 } });
  scroller.scrollTop = 1000;
  vi.spyOn(headings[1], 'getBoundingClientRect').mockReturnValue({ top: 600 } as DOMRect);
  scroller.dispatchEvent(new Event('scroll'));
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  expect(nav.querySelector('[aria-current]')?.textContent).toBe('Scope');
  const lastHeading = document.createElement('h3');
  lastHeading.className = 'roadmap-section-heading';
  lastHeading.textContent = 'Related resources';
  panel.querySelector('[data-reading-body]')!.append(lastHeading);
  vi.spyOn(lastHeading, 'getBoundingClientRect').mockReturnValue({ top: 800 } as DOMRect);
  await Promise.resolve();
  // Simulate a browser clamping the requested scroll at the end of the content.
  Object.defineProperty(scroller, 'scrollTop', { get: () => 1000, set: () => {} });
  nav.querySelectorAll<HTMLAnchorElement>('a')[1].click();
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  expect(nav.querySelector('[aria-current]')?.textContent).toBe('Scope');
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800);
  window.dispatchEvent(new Event('resize'));
  expect(nav.hidden).toBe(true);
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1400);
  panel.parentElement!.classList.remove('is-expanded');
  await Promise.resolve();
  expect(nav.hidden).toBe(true);
});

it('rebuilds from the next item and hides navigation when only one section remains', async () => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1400);
  document.body.innerHTML = '<div class="detail-expanded"><aside><div data-reading-scroll><div data-reading-layout><div data-reading-body><h3 class="roadmap-section-heading">Scope</h3><h3 class="roadmap-section-heading">Bottom line</h3></div><nav data-item-toc hidden></nav></div></div></aside></div>';
  const panel = document.querySelector('aside')!;
  toc = installItemToc(panel);
  panel.querySelector('[data-reading-body]')!.innerHTML = '<h3 class="roadmap-section-heading">Target outcome</h3>';
  await Promise.resolve();
  expect(panel.querySelector('nav')!.textContent).toBe('On this pageTarget outcome');
  expect(panel.querySelector('nav')!.hidden).toBe(true);
});

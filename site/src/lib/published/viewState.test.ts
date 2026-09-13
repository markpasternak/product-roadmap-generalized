import { afterEach, expect, it, vi } from 'vitest';
import { captureViewState } from './viewState';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
it('restores keyboard focus to the same card after it moves between lanes', () => {
  document.body.innerHTML = '<main><div id="root"><div data-item-id="CM-1"><div class="roadmap-card"><button class="roadmap-card-open">Card</button></div></div></div></main>';
  const root = document.getElementById('root')!;
  root.querySelector<HTMLElement>('button')!.focus();
  const restore = captureViewState(root);
  root.innerHTML = '<section><div data-item-id="CM-1"><div class="roadmap-card"><button class="roadmap-card-open">Moved card</button></div></div></section>';
  restore();
  expect(document.activeElement?.textContent).toBe('Moved card');
  expect(document.activeElement).toBe(root.querySelector('button'));
});
it('retains a reading anchor when a title grows, including native browser anchoring', () => {
  document.body.innerHTML = '<div id="root"><div data-reading-scroll><h3 id="section">Why it matters</h3></div></div>';
  const root = document.getElementById('root')!;
  const scroller = root.firstElementChild as HTMLElement;
  const heading = document.getElementById('section')!;
  let top = 150;
  vi.spyOn(scroller, 'getBoundingClientRect').mockImplementation(() => ({ top: 50, bottom: 500 } as DOMRect));
  vi.spyOn(heading, 'getBoundingClientRect').mockImplementation(() => ({ top, bottom: top + 30 } as DOMRect));
  scroller.scrollTop = 100;
  const restore = captureViewState(root);
  top = 180; // The browser did not automatically compensate for the larger title.
  restore(); expect(scroller.scrollTop).toBe(130);
  top = 150;
  const anchored = captureViewState(root);
  scroller.scrollTop = 160; // Native anchoring already retained the heading at y=150.
  anchored(); expect(scroller.scrollTop).toBe(160);
});
it('does not steal focus that the user moved elsewhere during the patch', () => {
  document.body.innerHTML = '<div id="root"><button id="old">Old</button></div><button id="other">Other</button>';
  const root = document.getElementById('root')!;
  document.getElementById('old')!.focus();
  const restore = captureViewState(root);
  root.innerHTML = '<button id="old">New</button>';
  document.getElementById('other')!.focus(); restore();
  expect(document.activeElement?.id).toBe('other');
});

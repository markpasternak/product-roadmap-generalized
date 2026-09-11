// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { installTitleTooltips } from './titleTooltips';

let remove: (() => void) | undefined;
afterEach(() => { remove?.(); document.body.replaceChildren(); });

function setup(clipped: boolean) {
  document.body.innerHTML = '<main><button class="roadmap-card"><h3 data-title-tooltip="Full initiative title">Full initiative title</h3></button></main>';
  const root = document.querySelector('main')!;
  const title = root.querySelector('h3')!;
  Object.defineProperties(title, { scrollHeight: { value: clipped ? 80 : 40 }, clientHeight: { value: 40 } });
  remove = installTitleTooltips(root);
  return { root, card: root.querySelector('button')!, tooltip: root.querySelector<HTMLElement>('[role="tooltip"]')! };
}

it('reveals clipped titles on keyboard focus and dismisses with Escape without opening an item', () => {
  const { root, card, tooltip } = setup(true);
  card.focus();
  expect(tooltip.hidden).toBe(false);
  expect(tooltip.textContent).toBe('Full initiative title');
  expect(card.getAttribute('aria-describedby')).toBe(tooltip.id);
  card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(tooltip.hidden).toBe(true);
  expect(card.hasAttribute('aria-describedby')).toBe(false);
  card.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  expect(tooltip.hidden).toBe(false);
  root.dispatchEvent(new Event('scroll'));
  expect(tooltip.hidden).toBe(true);
});

it('does not add a redundant tooltip when the title fits', () => {
  const { card, tooltip } = setup(false);
  card.focus();
  expect(tooltip.hidden).toBe(true);
});

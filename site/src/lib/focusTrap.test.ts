// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTopFocusTrap, trapFocus } from './focusTrap';

const releases: (() => void)[] = [];
function panel() {
  const element = document.createElement('section');
  element.tabIndex = -1;
  element.innerHTML = '<h2 tabindex="-1">Title</h2><button>Cancel</button><button>Confirm</button>';
  document.body.append(element);
  for (const button of element.querySelectorAll('button')) {
    vi.spyOn(button, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  }
  return element;
}
function tab(shiftKey = false) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true }));
}
afterEach(() => {
  releases.reverse().forEach((release) => release());
  releases.length = 0;
  document.body.replaceChildren();
  document.body.style.overflow = '';
  vi.restoreAllMocks();
});

describe('dialog focus', () => {
  it('wraps focus in both directions and redirects an attempted focus outside', () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const dialog = panel();
    releases.push(trapFocus(dialog));
    const [first, last] = dialog.querySelectorAll('button');
    expect(document.activeElement).toBe(first);
    tab(true);
    expect(document.activeElement).toBe(last);
    tab();
    expect(document.activeElement).toBe(first);
    outside.focus();
    expect(document.activeElement).toBe(first);
  });

  it('gives only the nested dialog focus and preserves the original scroll state', () => {
    document.body.style.overflow = 'auto';
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const parent = panel();
    const releaseParent = trapFocus(parent);
    releases.push(releaseParent);
    const child = panel();
    const releaseChild = trapFocus(child);
    releases.push(releaseChild);
    expect(isTopFocusTrap(parent)).toBe(false);
    expect(isTopFocusTrap(child)).toBe(true);
    tab(true);
    expect(document.activeElement).toBe(child.querySelectorAll('button')[1]);
    releaseChild();
    expect(document.activeElement).toBe(parent.querySelector('button'));
    expect(document.body.style.overflow).toBe('hidden');
    releaseParent();
    expect(document.body.style.overflow).toBe('auto');
    expect(document.activeElement).toBe(opener);
  });

  it('keeps the lock if a parent unmounts first and supports a heading as initial focus', () => {
    const parent = panel();
    const releaseParent = trapFocus(parent);
    releases.push(releaseParent);
    const child = panel();
    releases.push(trapFocus(child, { initialFocus: () => child.querySelector('h2') }));
    expect(document.activeElement).toBe(child.querySelector('h2'));
    tab(true);
    expect(document.activeElement).toBe(child.querySelectorAll('button')[1]);
    releaseParent();
    expect(isTopFocusTrap(child)).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('keeps an empty or disabled dialog focusable', () => {
    const dialog = panel();
    dialog.querySelectorAll('button').forEach((button) => button.disabled = true);
    releases.push(trapFocus(dialog));
    tab();
    expect(document.activeElement).toBe(dialog);
  });
});

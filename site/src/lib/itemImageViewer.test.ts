// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installItemImageViewer } from './itemImageViewer';

let viewer: ReturnType<typeof installItemImageViewer> | undefined;
afterEach(() => { viewer?.destroy(); document.body.replaceChildren(); vi.restoreAllMocks(); });

function setup() {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  document.body.innerHTML = `<section id="other"><div class="resource-markdown"><span><img src="/other.png" /></span></div></section>
    <section id="current"><div class="resource-markdown">
    <span><img src="/first.png" alt="First screenshot" /></span>
    <a href="/second.png"><img src="/second.png" alt="Second screenshot" /></a>
    <a href="/first.png"><img src="/first.png" alt="Repeated screenshot" /></a></div></section>`;
  const root = document.getElementById('current')!;
  viewer = installItemImageViewer(root);
  return root;
}

describe('initiative image viewer', () => {
  it('stays within the initiative, deduplicates images, resets zoom, and returns focus', () => {
    const root = setup();
    const opener = root.querySelector<HTMLElement>('[data-image-open]')!;
    opener.focus(); opener.click();
    const dialog = root.querySelector('dialog')!;
    const photo = dialog.querySelector('img')!;
    Object.defineProperties(photo, { naturalWidth: { value: 1600 }, naturalHeight: { value: 900 } });
    Object.defineProperties(dialog.querySelector('.image-viewer-viewport'), { clientWidth: { value: 1000 }, clientHeight: { value: 700 } });
    photo.dispatchEvent(new Event('load'));
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('[data-image-count]')?.textContent).toBe('1 / 2');
    expect(photo.getAttribute('src')).toContain('/first.png');
    const fitted = parseInt(photo.style.width);
    dialog.querySelector<HTMLButtonElement>('[data-image-in]')!.click();
    expect(parseInt(photo.style.width)).toBeGreaterThan(fitted);
    dialog.querySelector<HTMLButtonElement>('[data-image-next]')!.click();
    expect(photo.src).toContain('/second.png');
    expect(dialog.querySelector('[data-image-count]')?.textContent).toBe('2 / 2');
    expect(dialog.querySelector<HTMLButtonElement>('[data-image-next]')!.disabled).toBe(true);
    expect(dialog.querySelector<HTMLButtonElement>('[data-image-out]')!.disabled).toBe(true);
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    expect(photo.src).toContain('/first.png');
    const parentKey = vi.fn(); document.addEventListener('keydown', parentKey);
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    document.removeEventListener('keydown', parentKey);
    expect(parentKey).not.toHaveBeenCalled();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('opens inline images by keyboard and uses new initiative content after navigation', () => {
    const root = setup();
    const opener = root.querySelector<HTMLElement>('[data-image-open]')!;
    opener.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(root.querySelector('dialog')?.open).toBe(true);
    viewer!.close();
    root.querySelector('.resource-markdown')!.innerHTML = '<span><img src="/new.png" alt="New initiative image" /></span>';
    viewer!.refresh();
    root.querySelector<HTMLElement>('[data-image-open]')!.click();
    expect(root.querySelector('[data-image-count]')?.textContent).toBe('1 / 1');
    expect(root.querySelector('dialog img')?.getAttribute('src')).toContain('/new.png');
  });
});

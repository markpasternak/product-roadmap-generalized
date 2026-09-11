/** Self-contained so the same viewer can run in Vue and in the baked HTML. */
export function installItemImageViewer(root: HTMLElement) {
  const icon = (path: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
  const selector = '.item-reading-section img, .image-thumbnail img, .resource-markdown img, .shared-inline-image img, .shared-resource img';
  const dialog = document.createElement('dialog');
  dialog.className = 'item-image-viewer';
  dialog.setAttribute('aria-label', 'Initiative images');
  dialog.innerHTML = `<header class="image-viewer-toolbar">
    <span data-image-label></span>
    <nav aria-label="Image controls">
      <div class="image-control-group" role="group" aria-label="Image navigation">
        <button type="button" data-image-prev aria-label="Previous image" title="Previous image">${icon('m14 6-6 6 6 6')}</button>
        <span data-image-count aria-live="polite"></span>
        <button type="button" data-image-next aria-label="Next image" title="Next image">${icon('m10 6 6 6-6 6')}</button>
      </div>
      <div class="image-control-group" role="group" aria-label="Image zoom">
        <button type="button" data-image-out aria-label="Zoom out" title="Zoom out">${icon('M5 12h14')}</button>
        <button type="button" data-image-fit aria-label="Fit image to window" title="Reset zoom to fit">Fit</button>
        <button type="button" data-image-in aria-label="Zoom in" title="Zoom in">${icon('M5 12h14M12 5v14')}</button>
      </div>
      <button type="button" data-image-close aria-label="Close image viewer" title="Close image viewer (Esc)">${icon('m6 6 12 12M6 18 18 6')}</button>
    </nav>
  </header><div class="image-viewer-viewport" tabindex="0" aria-label="Image; scroll to pan when zoomed"><img alt="" draggable="false" /><p data-image-error hidden role="status">This image could not be loaded.</p></div>`;
  root.append(dialog);
  const get = <T extends HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  const photo = get<HTMLImageElement>('img');
  const viewport = get<HTMLElement>('.image-viewer-viewport');
  const previous = get<HTMLButtonElement>('[data-image-prev]');
  const next = get<HTMLButtonElement>('[data-image-next]');
  const zoomOut = get<HTMLButtonElement>('[data-image-out]');
  const zoomIn = get<HTMLButtonElement>('[data-image-in]');
  const fit = get<HTMLButtonElement>('[data-image-fit]');
  let images: { src: string; label: string }[] = [];
  let index = 0;
  let zoom = 1;
  let opener: HTMLElement | null = null;

  function collect() {
    const result: typeof images = [];
    for (const image of root.querySelectorAll<HTMLImageElement>(selector)) {
      if (dialog.contains(image)) continue;
      const src = image.currentSrc || image.src;
      if (!src || result.some(entry => entry.src === src)) continue;
      const link = image.closest('a');
      const label = image.alt || link?.textContent?.trim() || 'Image';
      result.push({ src, label });
    }
    return result;
  }

  function refresh() {
    for (const image of root.querySelectorAll<HTMLImageElement>(selector)) {
      if (dialog.contains(image)) continue;
      const trigger = image.closest<HTMLElement>('a, button') || image.parentElement!;
      trigger.dataset.imageOpen = '';
      trigger.setAttribute('aria-label', 'Open image: ' + (image.alt || trigger.textContent?.trim() || 'Image'));
      trigger.setAttribute('aria-haspopup', 'dialog');
      if (!trigger.matches('a, button')) { trigger.tabIndex = 0; trigger.setAttribute('role', 'button'); }
    }
  }

  function sizeImage() {
    if (!photo.naturalWidth || !photo.naturalHeight) return;
    const scale = Math.min(1, Math.max(1, viewport.clientWidth - 16) / photo.naturalWidth, Math.max(1, viewport.clientHeight - 16) / photo.naturalHeight);
    photo.style.width = Math.round(photo.naturalWidth * scale * zoom) + 'px';
    fit.textContent = zoom === 1 ? 'Fit' : Math.round(scale * zoom * 100) + '%';
    zoomOut.disabled = zoom <= 1;
    zoomIn.disabled = zoom >= 8;
  }

  function render() {
    const image = images[index];
    if (!image) return;
    zoom = 1;
    photo.style.width = '';
    photo.hidden = false;
    get('[data-image-error]').hidden = true;
    photo.alt = image.label;
    photo.src = image.src;
    get('[data-image-label]').textContent = image.label;
    get('[data-image-label]').title = image.label;
    get('[data-image-count]').textContent = (index + 1) + ' / ' + images.length;
    previous.disabled = index === 0;
    next.disabled = index === images.length - 1;
    fit.textContent = 'Fit';
    zoomOut.disabled = true;
    zoomIn.disabled = false;
    viewport.scrollTop = viewport.scrollLeft = 0;
    if (photo.complete) sizeImage();
  }

  function close() {
    if (!dialog.open) return;
    dialog.close();
    if (opener?.isConnected) opener.focus();
  }

  function open(trigger: HTMLElement) {
    const image = trigger.querySelector<HTMLImageElement>('img');
    if (!image) return;
    images = collect(); // Only this initiative, in reading order, without duplicates.
    index = images.findIndex(entry => entry.src === (image.currentSrc || image.src));
    if (index < 0) return;
    opener = trigger;
    dialog.showModal();
    render();
    get('[data-image-close]').focus();
  }

  function move(delta: number) {
    if (index + delta < 0 || index + delta >= images.length) return;
    index += delta;
    render();
    if (document.activeElement?.matches(':disabled')) viewport.focus();
  }

  function click(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const trigger = target.closest<HTMLElement>('[data-image-open]');
    if (trigger && root.contains(trigger)) { event.preventDefault(); event.stopPropagation(); open(trigger); }
    if (!dialog.contains(target)) return;
    if (target.closest('[data-image-close]')) close();
    if (target.closest('[data-image-prev]')) move(-1);
    if (target.closest('[data-image-next]')) move(1);
    if (target.closest('[data-image-in]')) { zoom = Math.min(8, zoom * 1.5); sizeImage(); }
    if (target.closest('[data-image-out]')) { zoom = Math.max(1, zoom / 1.5); sizeImage(); }
    if (target.closest('[data-image-fit]')) { zoom = 1; sizeImage(); viewport.scrollTop = viewport.scrollLeft = 0; }
  }

  function key(event: KeyboardEvent) {
    if (!dialog.open) {
      const trigger = (event.target as HTMLElement).closest<HTMLElement>('[data-image-open][role="button"]');
      if (trigger && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(trigger); }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(); return; }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation(); move(event.key === 'ArrowLeft' ? -1 : 1);
    }
    if (event.key === 'Tab') {
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]')];
      const current = controls.indexOf(document.activeElement as HTMLElement);
      const destination = (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
      event.preventDefault(); event.stopImmediatePropagation(); controls[destination]?.focus();
    }
  }
  photo.addEventListener('load', sizeImage);
  photo.addEventListener('error', () => { photo.hidden = true; get('[data-image-error]').hidden = false; });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  root.addEventListener('click', click);
  root.addEventListener('keydown', key, true);
  window.addEventListener('resize', sizeImage);
  const observer = new MutationObserver(records => {
    if (records.some(record => !dialog.contains(record.target))) refresh();
  });
  observer.observe(root, { childList: true, subtree: true });
  refresh();
  return {
    close,
    refresh,
    destroy() {
      close(); observer.disconnect(); dialog.remove();
      root.removeEventListener('click', click);
      root.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', sizeImage);
    },
  };
}

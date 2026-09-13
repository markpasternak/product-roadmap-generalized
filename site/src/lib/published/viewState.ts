/** Restore stable targets after Vue patches. Never steal focus changed by the user. */
export function captureViewState(root: HTMLElement) {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const identity = (node: HTMLElement) => node.id ? `#${CSS.escape(node.id)}`
    : node.dataset.itemId ? `[data-item-id="${CSS.escape(node.dataset.itemId)}"]` : null;
  const card = active?.closest<HTMLElement>('[data-item-id]');
  const focusKey = active && root.contains(active) ? identity(active)
    ?? (card && active.matches('button.roadmap-card-open') ? `${identity(card)} button.roadmap-card-open` : null)
    ?? (card && active.dataset.cardFilter ? `${identity(card)} [data-card-filter="${CSS.escape(active.dataset.cardFilter)}"]` : null)
    ?? (active.matches('a[href]') ? `a[href="${CSS.escape(active.getAttribute('href')!)}"]` : null) : null;
  const anchor = [...root.querySelectorAll<HTMLElement>('[data-item-id], h2[id], h3[id]')]
    .find(node => { const box = node.getBoundingClientRect(); return box.bottom > 80 && box.top < innerHeight && box.right > 0 && box.left < innerWidth; });
  const anchorKey = anchor ? identity(anchor) : null;
  const anchorTop = anchor?.getBoundingClientRect().top;
  const x = scrollX, y = scrollY;
  const scrollers = [...root.querySelectorAll<HTMLElement>('[data-lane-key], [data-reading-scroll]')]
    .map(node => {
      const bounds = node.getBoundingClientRect();
      const anchor = [...node.querySelectorAll<HTMLElement>('h2[id], h3[id], [data-item-id]')]
        .find(child => { const box = child.getBoundingClientRect(); return box.bottom > bounds.top && box.top < bounds.bottom; });
      return { node, x: node.scrollLeft, y: node.scrollTop, anchorKey: anchor ? identity(anchor) : null, top: anchor?.getBoundingClientRect().top };
    });
  return () => {
    // A user's scroll between capture and patch takes precedence over the anchor.
    if (scrollX === x && scrollY === y) {
      const replacement = anchorKey ? root.querySelector<HTMLElement>(anchorKey) : null;
      const delta = replacement && anchorTop !== undefined ? replacement.getBoundingClientRect().top - anchorTop : 0;
      if (delta) window.scrollTo({ left: x, top: y + delta, behavior: 'instant' });
    }
    for (const saved of scrollers) if (saved.node.isConnected) {
      const anchor = saved.anchorKey ? saved.node.querySelector<HTMLElement>(saved.anchorKey) : null;
      saved.node.scrollLeft = saved.x;
      if (anchor && saved.top !== undefined) saved.node.scrollTop += anchor.getBoundingClientRect().top - saved.top;
      else saved.node.scrollTop = saved.y;
    }
    if (active && document.activeElement === document.body && active !== document.body) {
      const target = active.isConnected ? active : focusKey ? root.querySelector<HTMLElement>(focusKey) : null;
      if (target) target.focus({ preventScroll: true });
      else {
        const heading = root.querySelector<HTMLElement>('main h1, .board-root');
        if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
      }
    }
  };
}

/** Section navigation for expanded item readers, including standalone shares. */
export function installItemToc(panel: HTMLElement) {
  const scroller = panel.querySelector<HTMLElement>('[data-reading-scroll]')!;
  const shell = panel.parentElement!;
  const prefix = 'item-section-' + Math.random().toString(36).slice(2);
  let nav: HTMLElement | null = null;
  let layout: HTMLElement | null = null;
  let headings: HTMLElement[] = [];
  let links: HTMLAnchorElement[] = [];
  let frame = 0;
  let requestedSection: number | null = null;
  let requestedScrollTop = 0;

  function updateActive() {
    if (!nav || nav.hidden || !headings.length) return;
    const top = scroller.getBoundingClientRect().top + 28;
    let active = 0;
    headings.forEach((heading, index) => { if (heading.getBoundingClientRect().top <= top) active = index; });
    if (scroller.scrollHeight > scroller.clientHeight && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) active = headings.length - 1;
    // Keep an explicitly selected section active when the scroll position is clamped.
    if (requestedSection !== null && Math.abs(scroller.scrollTop - requestedScrollTop) < 2) active = requestedSection;
    else requestedSection = null;
    links.forEach((link, index) => {
      if (index === active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(updateActive);
  }
  function visibility() {
    if (!nav || !layout) return;
    const visible = window.innerWidth >= 1200 && headings.length >= 2
      && (shell.classList.contains('is-expanded') || shell.classList.contains('detail-expanded'));
    nav.hidden = !visible;
    layout.classList.toggle('has-item-toc', visible);
    schedule();
  }
  function rebuild() {
    requestedSection = null;
    layout = panel.querySelector<HTMLElement>('[data-reading-layout]');
    nav = layout?.querySelector<HTMLElement>('[data-item-toc]') ?? null;
    if (!nav || !layout) return;
    headings = [...layout.querySelectorAll<HTMLElement>('[data-reading-body] h3.roadmap-section-heading, [data-reading-body] h3[data-toc-heading]')];
    const label = document.createElement('p');
    label.textContent = 'On this page';
    links = headings.map((heading, index) => {
      if (!heading.id) heading.id = prefix + '-' + index;
      const link = document.createElement('a');
      link.href = '#' + heading.id;
      link.textContent = heading.textContent;
      link.addEventListener('click', event => {
        event.preventDefault();
        scroller.scrollTop += heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16;
        requestedSection = index;
        requestedScrollTop = scroller.scrollTop;
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
        updateActive();
      });
      return link;
    });
    nav.replaceChildren(label, ...links);
    visibility();
  }
  const contentObserver = new MutationObserver(records => {
    if (records.some(record => record.target === scroller
      || (record.target instanceof Element && record.target.closest('[data-reading-body]')))) rebuild();
  });
  contentObserver.observe(scroller, { childList: true, subtree: true });
  const modeObserver = new MutationObserver(visibility);
  modeObserver.observe(shell, { attributes: true, attributeFilter: ['class'] });
  scroller.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', visibility);
  rebuild();
  return {
    refresh: rebuild,
    destroy() {
      cancelAnimationFrame(frame); contentObserver.disconnect(); modeObserver.disconnect();
      scroller.removeEventListener('scroll', schedule); window.removeEventListener('resize', visibility);
      nav?.replaceChildren(); layout?.classList.remove('has-item-toc');
    },
  };
}

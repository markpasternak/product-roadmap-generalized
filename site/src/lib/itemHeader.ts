/** Keep product context visible; reveal the initiative title after its heading leaves view. */
export function installItemHeader(panel: HTMLElement) {
  const scroller = panel.querySelector<HTMLElement>('[data-reading-scroll]')!;
  const toolbar = panel.querySelector<HTMLElement>('.item-toolbar')!;
  let frame = 0;
  function update() {
    const heading = scroller.querySelector<HTMLElement>('[data-reading-title]');
    const revealed = !!heading && scroller.scrollTop > 0
      && heading.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().top + 8;
    toolbar.classList.toggle('item-title-revealed', revealed);
    toolbar.querySelector('[data-header-title]')?.setAttribute('aria-hidden', String(!revealed));
  }
  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  }
  const content = new MutationObserver(schedule);
  content.observe(scroller, { childList: true, subtree: true });
  const mode = new MutationObserver(schedule);
  mode.observe(panel.parentElement!, { attributes: true, attributeFilter: ['class'] });
  scroller.addEventListener('scroll', schedule, { passive: true });
  scroller.addEventListener('load', schedule, true);
  window.addEventListener('resize', schedule);
  schedule();
  return {
    refresh: schedule,
    destroy() {
      cancelAnimationFrame(frame); content.disconnect(); mode.disconnect();
      scroller.removeEventListener('scroll', schedule);
      scroller.removeEventListener('load', schedule, true);
      window.removeEventListener('resize', schedule);
    },
  };
}

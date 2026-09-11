/** Shared by the interactive board and standalone exports. */
export function installTitleTooltips(root: HTMLElement) {
  const tooltip = document.createElement('div');
  tooltip.className = 'roadmap-title-tooltip';
  tooltip.id = `roadmap-title-tooltip-${Math.random().toString(36).slice(2)}`;
  tooltip.setAttribute('role', 'tooltip');
  const popover = typeof tooltip.showPopover === 'function';
  if (popover) tooltip.setAttribute('popover', 'manual');
  tooltip.hidden = true;
  root.append(tooltip);
  let trigger: HTMLElement | null = null;
  let previousDescription: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function hide() {
    clearTimeout(timer);
    if (popover && !tooltip.hidden) tooltip.hidePopover();
    tooltip.hidden = true;
    if (trigger) {
      if (previousDescription) trigger.setAttribute('aria-describedby', previousDescription);
      else trigger.removeAttribute('aria-describedby');
    }
    trigger = null;
  }
  function show(event: Event) {
    const target = event.target as Element;
    if (tooltip.contains(target)) { clearTimeout(timer); return; }
    const card = target.closest<HTMLElement>('.roadmap-card');
    const title = card?.querySelector<HTMLElement>('[data-title-tooltip]');
    if (!card || !title || title.scrollHeight <= title.clientHeight + 1) { hide(); return; }
    clearTimeout(timer);
    if (trigger === card) return;
    hide();
    trigger = card;
    previousDescription = card.getAttribute('aria-describedby');
    tooltip.textContent = title.dataset.titleTooltip || title.textContent;
    tooltip.hidden = false;
    if (popover) tooltip.showPopover();
    const rect = title.getBoundingClientRect();
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - tooltip.offsetWidth - 12));
    const top = rect.top >= tooltip.offsetHeight + 20 ? rect.top - tooltip.offsetHeight - 8 : rect.bottom + 8;
    tooltip.style.left = left + 'px';
    tooltip.style.top = Math.max(12, Math.min(top, window.innerHeight - tooltip.offsetHeight - 12)) + 'px';
    card.setAttribute('aria-describedby', [previousDescription, tooltip.id].filter(Boolean).join(' '));
  }
  function leave(event: Event) {
    const destination = (event as MouseEvent).relatedTarget as Node | null;
    if (destination && (tooltip.contains(destination) || trigger?.contains(destination))) return;
    timer = setTimeout(hide, 120);
  }
  function key(event: KeyboardEvent) {
    if (event.key === 'Escape' && trigger) { hide(); event.stopPropagation(); }
  }
  root.addEventListener('mouseover', show);
  root.addEventListener('focusin', show);
  root.addEventListener('mouseout', leave);
  root.addEventListener('focusout', leave);
  root.addEventListener('click', hide);
  root.addEventListener('keydown', key, true);
  root.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  return () => {
    hide(); tooltip.remove();
    root.removeEventListener('mouseover', show); root.removeEventListener('focusin', show);
    root.removeEventListener('mouseout', leave); root.removeEventListener('focusout', leave);
    root.removeEventListener('click', hide); root.removeEventListener('keydown', key, true);
    root.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide);
  };
}

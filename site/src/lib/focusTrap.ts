// Only the top dialog owns keyboard focus. Nested dialogs share the scroll lock.
const FOCUSABLE = 'a[href], button, summary, input, select, textarea, iframe, [contenteditable="true"], [tabindex]';
const stack: { panel: HTMLElement }[] = [];
let previousOverflow = '';

export function isTopFocusTrap(panel: HTMLElement | undefined): boolean {
  return !!panel && stack.at(-1)?.panel === panel;
}

export function trapFocus(panel: HTMLElement, options: { initialFocus?: () => HTMLElement | null | undefined } = {}): () => void {
  const opener = document.activeElement as HTMLElement | null;
  const entry = { panel };
  if (!stack.length) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  stack.push(entry);

  const focusables = () => [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) =>
    el.tabIndex >= 0 && !el.matches(':disabled, [type="hidden"]') && !el.closest('[hidden], [inert]') &&
    getComputedStyle(el).visibility !== 'hidden' && (el.offsetParent !== null || el.getClientRects().length > 0),
  );
  const focusStart = () => (focusables()[0] ?? panel).focus();
  const onKey = (event: KeyboardEvent) => {
    if (!isTopFocusTrap(panel) || event.key !== 'Tab' || event.defaultPrevented) return;
    const elements = focusables();
    const first = elements[0];
    const last = elements.at(-1);
    const active = document.activeElement;
    const hasTabStop = elements.includes(active as HTMLElement);
    if (!first || !last) {
      event.preventDefault();
      panel.focus();
    } else if (event.shiftKey && (active === first || !hasTabStop)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !hasTabStop)) {
      event.preventDefault();
      first.focus();
    }
  };
  const onFocus = (event: FocusEvent) => {
    if (isTopFocusTrap(panel) && event.target instanceof Node && !panel.contains(event.target)) focusStart();
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('focusin', onFocus);
  (options.initialFocus?.() ?? focusables()[0] ?? panel).focus();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const wasTop = isTopFocusTrap(panel);
    stack.splice(stack.indexOf(entry), 1);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('focusin', onFocus);
    if (!stack.length) document.body.style.overflow = previousOverflow;
    if (wasTop && opener?.isConnected && (!stack.length || stack.at(-1)!.panel.contains(opener))) opener.focus();
  };
}

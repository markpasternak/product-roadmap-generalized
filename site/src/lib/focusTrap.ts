// Minimal focus trap for the drawer/sheet dialogs: focus moves into the panel on
// open, Tab cycles within it, and focus returns to the opener on release.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function trapFocus(panel: HTMLElement): () => void {
  const opener = document.activeElement as HTMLElement | null;

  const focusables = () =>
    [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const els = focusables();
    if (!els.length) return;
    const first = els[0]!;
    const last = els[els.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      last.focus();
      e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === last) {
      first.focus();
      e.preventDefault();
    }
  };

  document.addEventListener('keydown', onKey);
  (focusables()[0] ?? panel).focus();

  return () => {
    document.removeEventListener('keydown', onKey);
    opener?.focus?.();
  };
}

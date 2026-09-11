/** Personal reading preference. Self-contained so standalone shares can embed it. */
export function createItemViewPreference() {
  const key = 'rm-item-reading-mode';
  let expanded = false;
  return {
    read(): boolean {
      try {
        const saved = window.localStorage.getItem(key);
        if (saved === 'expanded' || saved === 'compact') expanded = saved === 'expanded';
      } catch { /* Keep the choice for this visit when storage is unavailable. */ }
      return expanded;
    },
    write(value: boolean): void {
      expanded = value;
      try { window.localStorage.setItem(key, value ? 'expanded' : 'compact'); }
      catch { /* Reading and changing the view still work without storage. */ }
    },
  };
}

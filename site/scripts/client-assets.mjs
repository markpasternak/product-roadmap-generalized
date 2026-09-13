/** Follow eager imports only: unrelated routes and editor dialogs remain lazy. */
export function clientStyles(manifest, entries) {
  const visited = new Set(), styles = new Set();
  function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const entry = manifest[key];
    if (!entry) throw new Error(`Missing application client entry: ${key}`);
    for (const dependency of entry.imports ?? []) visit(dependency);
    for (const css of entry.css ?? []) styles.add(css);
  }
  entries.forEach(visit);
  return [...styles];
}

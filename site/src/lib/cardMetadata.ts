/** Shared card/detail/export metadata policy. Exports never gain internal labels. */
export function itemLabels(item: { tags: readonly string[]; themes: readonly string[] }, client = false) {
  return [
    ...[...new Set(item.themes.filter(value => value.trim()))]
      .map(label => ({ label, token: `theme:${label}`, kind: 'theme' as const })),
    ...(client ? [] : [...new Set(item.tags.filter(value => value.trim()))]
      .map(label => ({ label, token: label, kind: 'tag' as const }))),
  ];
}

export function namedOwner(owner?: string): string {
  const value = owner?.trim() ?? '';
  return value.toLowerCase() === 'unassigned' ? '' : value;
}

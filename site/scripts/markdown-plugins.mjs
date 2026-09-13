// Leave ```mermaid fenced blocks as <pre class="mermaid"> so the client island can render them.
// (Shiki is told to skip the mermaid language via markdown.syntaxHighlight.excludeLangs.)
export function rehypeMermaid() {
  /** @param {any} tree */
  return (tree) => {
    /** @param {any} node @param {any} parent */
    const walk = (node, parent) => {
      if (
        node.type === 'element' &&
        node.tagName === 'code' &&
        (node.properties?.className || []).includes('language-mermaid') &&
        parent?.tagName === 'pre'
      ) {
        const code = (node.children || []).map((/** @type {any} */ c) => c.value || '').join('');
        parent.properties = { className: ['mermaid'] };
        parent.children = [{ type: 'text', value: code }];
        return;
      }
      (node.children || []).forEach((/** @type {any} */ child) => walk(child, node));
    };
    walk(tree, null);
  };
}

// Rewrite in-body links to linked docs (../../content/prds/X.md → /docs/prd/X) and mark
// external links to open in a new tab.
export function rehypeLinks(base) {
  const typeRoute = { prds: 'prd', 'technical-design': 'technical-design', research: 'research' };
  const prefix = base.replace(/\/$/, '');
  /** @param {any} tree */
  return (tree) => {
    /** @param {any} node */
    const walk = (node) => {
      if (node.type === 'element' && node.tagName === 'img' && typeof node.properties?.src === 'string') node.properties.src = node.properties.src.replace(/^(?:\.\.\/\.\.\/|content\/|\/)assets\//, `${prefix}/assets/`);
      if (node.type === 'element' && node.tagName === 'a' && node.properties?.href) {
        const href = String(node.properties.href);
        const m = href.match(/(?:^|\/)(prds|technical-design|research)\/(?:.*\/)?([^/]+)\.md$/);
        if (m) {
          node.properties.href = `${prefix}/docs/${typeRoute[m[1]]}/${m[2].toLowerCase()}`;
        } else if (/^https?:\/\//i.test(href)) {
          node.properties.target = '_blank';
          node.properties.rel = 'noopener';
        }
      }
      (node.children || []).forEach(walk);
    };
    walk(tree);
  };
}

// Remove `## <heading>` sections from rendered bodies. `Links` is always stripped
// (item pages render a structured "Related documents" block from the same source);
// public builds also strip internal-only sections.
export function rehypeStripSections(headings) {
  /** @param {any} tree */
  return (tree) => {
    const kids = tree.children;
    if (!Array.isArray(kids)) return;
    for (const heading of headings) {
      let start = -1;
      let end = kids.length;
      for (let i = 0; i < kids.length; i++) {
        const n = kids[i];
        if (n.type === 'element' && n.tagName === 'h2') {
          const text = (n.children || []).map((/** @type {any} */ c) => c.value || '').join('').trim();
          if (start === -1 && text === heading) start = i;
          else if (start !== -1) {
            end = i;
            break;
          }
        }
      }
      if (start !== -1) kids.splice(start, end - start);
    }
  };
}

// Drop `## Section`s whose content is empty or still the template placeholder
// ("To fill in.") — placeholders must never render on a page.
export function rehypeStripPlaceholders() {
  /** @param {any} node @returns {string} */
  const textOf = (node) => (node.value || '') + (node.children || []).map(textOf).join('');
  /** @param {any} tree */
  return (tree) => {
    const kids = tree.children;
    if (!Array.isArray(kids)) return;
    for (let i = 0; i < kids.length; i++) {
      const n = kids[i];
      if (!(n.type === 'element' && n.tagName === 'h2')) continue;
      let end = i + 1;
      while (end < kids.length && !(kids[end].type === 'element' && kids[end].tagName === 'h2')) end++;
      const content = kids
        .slice(i + 1, end)
        .map(textOf)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (/^(to fill in\.?)?$/i.test(content)) {
        kids.splice(i, end - i);
        i--;
      }
    }
  };
}

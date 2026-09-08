// Validate rendered resource links after bundling, where source-relative paths
// are no longer reliable. Run after either the internal or public build.
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
const dist = resolve(import.meta.dirname, '../dist');
let checked = 0;
const failures = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) { await walk(file); continue; }
    if (!entry.name.endsWith('.html')) continue;
    const html = await readFile(file, 'utf8');
    for (const match of html.matchAll(/href="([^"#]*\/docs\/(?:prd|technical-design|research)\/[^"?#]+)[^\"]*"/g)) {
      const href = match[1];
      if (!href.startsWith('/')) continue;
      const path = decodeURIComponent(href.slice(href.indexOf('/docs/') + 1));
      const target = resolve(dist, path, 'index.html');
      if (!target.startsWith(`${dist}/`)) throw new Error(`Invalid document path: ${href}`);
      if (!(await stat(target).catch(() => null))?.isFile()) failures.push(`${relative(dist, file)} → ${href}`);
      checked++;
    }
  }
}
await walk(dist);
if (failures.length) throw new Error(`Broken document links:\n${[...new Set(failures)].join('\n')}`);
console.log(`Verified ${checked} rendered document links.`);

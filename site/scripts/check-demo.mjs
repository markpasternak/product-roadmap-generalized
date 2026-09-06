// Prevent an upstream application refresh from publishing corporate content.
import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const forbidden = /seenthis|seenthis-ab|\b(?:CM|CORE|INFRA|DATA|STUDIO)-\d{3}\b/i;
const products = new Set(['Music App', 'Podcasts & Audiobooks', 'Spotify for Artists', 'Ads Platform', 'Core Platform & Data']);
const textual = new Set(['.html', '.json', '.js', '.css', '.svg', '.md', '.ts', '.vue', '.astro']);
let checked = 0;
async function walk(directory) {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symlink: ${relative(root, path)}`);
    if (entry.isDirectory()) { await walk(path); continue; }
    if (!textual.has(extname(path))) continue;
    const text = await readFile(path, 'utf8');
    if (forbidden.test(text)) throw new Error(`Non-demo reference: ${relative(root, path)}`);
    checked++;
    if (path.startsWith(resolve(root, 'content/items') + '/')) {
      const product = /^product:\s*['"]?(.+?)['"]?\s*$/m.exec(text)?.[1];
      if (!products.has(product)) throw new Error(`Unexpected portfolio: ${relative(root, path)}`);
    }
  }
}
for (const dir of ['content', 'site/src', 'site/public', 'site/dist', 'presentations']) await walk(resolve(root, dir));
console.log(`Demo isolation verified across ${checked} source and published text files.`);

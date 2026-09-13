// Check the dates actually shipped to the browser, after Astro bundles server code.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const html = await readFile(process.argv[2] ? resolve(process.argv[2], 'index.html') : new URL('../dist/index.html', import.meta.url), 'utf8');
// The trusted page template emits exactly one JSON script and escapes '<' in
// its payload. Read that wire format without installing a DOM implementation.
const seeds = [...html.matchAll(/<script\b[^>]*\bid=["']published-seed["'][^>]*>([\s\S]*?)<\/script>/g)];
if (seeds.length !== 1) throw new Error('The built roadmap must have exactly one published content seed.');
const items = JSON.parse(seeds[0][1]).model.boardItems;
if (!Array.isArray(items)) throw new Error('Invalid published item collection');
const missing = items.filter(item =>
  !item.createdAt || !item.updatedAt || !item.activityDates?.length);
if (missing.length) {
  throw new Error(`Missing published date history for ${missing.length} roadmap items: ${missing.map(item => item.id).join(', ')}. Build from the Git checkout with full history.`);
}
console.log(`Verified created, updated and activity dates for ${items.length} rendered items.`);

// Check the dates actually shipped to the browser, after Astro bundles server code.
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { resolve } from 'node:path';

const html = await readFile(process.argv[2] ? resolve(process.argv[2], 'index.html') : new URL('../dist/index.html', import.meta.url), 'utf8');
const document = new JSDOM(html).window.document;
const seed = document.getElementById('published-seed');
if (!seed) throw new Error('The built roadmap has no published content seed to verify.');
const items = JSON.parse(seed.textContent).model.boardItems;
const missing = items.filter(item =>
  !item.createdAt || !item.updatedAt || !item.activityDates?.length);
if (missing.length) {
  throw new Error(`Missing published date history for ${missing.length} roadmap items: ${missing.map(item => item.id).join(', ')}. Build from the Git checkout with full history.`);
}
console.log(`Verified created, updated and activity dates for ${items.length} rendered items.`);

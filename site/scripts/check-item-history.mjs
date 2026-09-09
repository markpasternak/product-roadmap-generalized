// Check the dates actually shipped to the browser, after Astro bundles server code.
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const document = new JSDOM(html).window.document;
const board = [...document.querySelectorAll('astro-island')].find(island =>
  /\/Board\./.test(island.getAttribute('component-url') || ''));
if (!board) throw new Error('The built roadmap has no board data to verify.');
const props = JSON.parse(board.getAttribute('props'));
const items = props.items[1].map(([, item]) => item);
const missing = items.filter(item =>
  !item.createdAt?.[1] || !item.updatedAt?.[1] || !item.activityDates?.[1]?.length);
if (missing.length) {
  throw new Error(`Missing published date history for ${missing.length} roadmap items: ${missing.map(item => item.id[1]).join(', ')}. Build from the Git checkout with full history.`);
}
console.log(`Verified created, updated and activity dates for ${items.length} rendered items.`);

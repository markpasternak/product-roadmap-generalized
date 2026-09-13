// Compare content semantics, not framework serialization or host-local timestamp labels.
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { JSDOM } from 'jsdom';
import assert from 'node:assert/strict';

const [baselinePath, candidatePath] = process.argv.slice(2);
if (!baselinePath || !candidatePath) throw new Error('Usage: check-content-parity.mjs <legacy-dist> <candidate-directory>');
const candidate = JSON.parse(await readFile(join(resolve(candidatePath), 'candidate.json'), 'utf8'));
const text = element => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
function semantics(document, item) {
  const main = document.querySelector('main');
  if (!main) throw new Error('Missing initial page content');
  const common = { title: text(document.querySelector('title')), heading: text(main.querySelector('h1')) };
  if (item) return { ...common,
    summary: text(main.querySelector('.item-page-hero-copy p')),
    status: [...main.querySelectorAll('.item-page-status-summary > div')].map(row => [text(row.querySelector('dt')), text(row.querySelector('dd'))]),
    sections: [...main.querySelectorAll('.item-reading-section')].map(section => [text(section.querySelector('h2')), text(section.querySelector('.resource-markdown'))]),
    details: [...main.querySelectorAll('aside dt')].map(term => [text(term), term.nextElementSibling.querySelector('time')?.getAttribute('datetime') ?? text(term.nextElementSibling)]),
    resources: [...main.querySelectorAll('aside a')].map(link => link.getAttribute('href')),
    siblings: ['data-prev-href', 'data-next-href'].map(key => main.getAttribute(key)),
    covers: [...main.querySelectorAll('.item-page-cover img')].map(image => image.getAttribute('src')),
  };
  return { ...common,
    headings: [...main.querySelectorAll('article h2, article h3, article h4')].map(heading => [heading.id, text(heading)]),
    paragraphs: [...main.querySelectorAll('article p, article pre, article table')].map(text),
    backlinks: [...main.querySelectorAll('.document-disclosure li a')].map(link => [link.getAttribute('href'), text(link)]),
  };
}
let checked = 0;
const failures = [];
for (const { path } of candidate.manifest.filter(file => /^(?:item|docs)\/.+\/index.html$/.test(file.path))) {
  const documents = [];
  try {
    for (const directory of [resolve(baselinePath), join(resolve(candidatePath), 'public')]) {
      documents.push(new JSDOM(await readFile(join(directory, path), 'utf8')).window.document);
    }
    assert.deepEqual(semantics(documents[1], path.startsWith('item/')), semantics(documents[0], path.startsWith('item/')));
    checked++;
  } catch (error) { failures.push({ path, error: error.message }); }
  finally { documents.forEach(document => document.defaultView.close()); }
}
if (failures.length) throw new Error(JSON.stringify({ checked, failures }, null, 2));
console.log(`Verified initial content semantics on ${checked} item/document pages.`);

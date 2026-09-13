import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sha256 } from './application-package.mjs';

const app = process.env.CONTENT_TEST_APPLICATION;
const digest = process.env.CONTENT_TEST_PACKAGE_DIGEST;
test('compiled publication keeps references and bytes atomic through upload, replacement and deletion', { skip: !app || !digest }, async t => {
  const packagePath = resolve(app);
  const application = JSON.parse(await readFile(join(packagePath, 'package.json'), 'utf8'));
  const publicAudience = application.audience === 'public';
  const base = application.base;
  const root = await mkdtemp(join(tmpdir(), 'roadmap-content-integration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const checkout = join(root, 'source');
  await mkdir(checkout);
  const git = (...args) => execFileSync('git', args, { cwd: checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.name', 'PRIVATE AUTHOR'); git('config', 'user.email', 'fixture@example.test');
  const put = async (path, bytes) => { await mkdir(join(checkout, path, '..'), { recursive: true }); await writeFile(join(checkout, path), bytes); };
  const commit = message => { git('add', 'content'); git('commit', '-m', message); return git('rev-parse', 'HEAD'); };
  const asset = async (id, extension, mediaType, visibility = 'Public', revision = 'rev_one') => {
    const bytes = Buffer.from(`Fixture ${id} ${revision}`);
    const original = { path: `${revision}/file.${extension}`, mediaType, bytes: bytes.length, sha256: sha256(bytes) };
    await put(`content/assets/${id}/${original.path}`, bytes);
    await put(`content/assets/${id}/asset.json`, JSON.stringify({ schemaVersion: 1, id, name: id, visibility, revisions: [{ id: revision, original }] }));
    return `../../assets/${id}/${original.path}`;
  };
  const image = await asset('ast_image', 'png', 'image/png');
  const video = await asset('ast_video', 'mp4', 'video/mp4');
  const pdf = await asset('ast_pdf', 'pdf', 'application/pdf');
  const attachment = await asset('ast_attachment', 'zip', 'application/zip');
  const privateAsset = await asset('ast_private', 'txt', 'text/plain; charset=utf-8', 'Internal');
  await asset('ast_unused', 'txt', 'text/plain; charset=utf-8');
  const publicItem = cover => `---\nid: PUBLIC-1\ntitle: Public initiative\nproduct: Music App\nhorizon: Now\nstage: Pilot\nowner: PRIVATE OWNER\nvisibility: Public\ncover: ${cover}\ntags: theme:Delivery\n---\n## One-liner\nPublic summary.\n\n## Why it matters\nPublic explanation.\n\n## Current behavior\nPRIVATE SECTION\n\n## Links\n- PRD: content/prds/public-brief.md\n- Internal: content/prds/private-brief.md\n- Video: ${video}\n- PDF: ${pdf}\n- Download: ${attachment}\n`;
  await put('content/items/public.md', publicItem(image));
  await put('content/items/private.md', `---\nid: PRIVATE-1\ntitle: PRIVATE ITEM\nproduct: Music App\nhorizon: Now\nstage: Pilot\nowner: PRIVATE OWNER\nvisibility: Internal\n---\n## Links\n- Private: ${privateAsset}\n`);
  await put('content/prds/public-brief.md', `---\ntitle: Public brief\nvisibility: Public\nowner: PRIVATE DOC OWNER\nroadmap_item: PUBLIC-1\n---\n## Evidence\nPublic evidence.\n\n[PDF](${pdf})\n\n<video controls src="${video}"></video>\n\n## Open questions\nPRIVATE QUESTION\n`);
  await put('content/prds/private-brief.md', '---\ntitle: PRIVATE DOCUMENT\nvisibility: Internal\n---\nPRIVATE DOCUMENT BODY');
  const firstCommit = commit('PRIVATE COMMIT SUBJECT');
  async function prepare(name) {
    const output = join(root, name);
    const logs = execFileSync(process.execPath, [resolve(import.meta.dirname, 'prepare-content.mjs'), packagePath, checkout, output, digest], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const candidate = JSON.parse(await readFile(join(output, 'candidate.json'), 'utf8'));
    const files = new Map(candidate.manifest.map(file => [file.path, file]));
    const text = path => readFile(join(output, 'public', path), 'utf8');
    for (const file of candidate.manifest) {
      const bytes = await readFile(join(output, 'public', file.path));
      assert.equal(sha256(bytes), file.hash); assert.equal(bytes.length, file.size);
      assert(!file.path.startsWith('private/') && !file.path.startsWith('.'));
    }
    return { candidate, files, text, timings: JSON.parse(logs.trim().split('\n').at(-1)).timings };
  }
  const first = await prepare('first');
  assert.equal(first.candidate.release.commit, firstCommit);
  assert(first.files.has('item/PUBLIC-1/index.html'));
  assert(first.files.has('docs/prd/public-brief/index.html'));
  for (const id of ['image', 'video', 'pdf', 'attachment']) assert([...first.files.keys()].some(path => path.startsWith(`assets/ast_${id}/`)));
  assert(![...first.files.keys()].some(path => path.startsWith('assets/ast_unused/')));
  const doc = await first.text('docs/prd/public-brief/index.html');
  assert(doc.includes(`${base}assets/ast_pdf/rev_one/file.pdf`));
  assert(doc.includes(`${base}assets/ast_video/rev_one/file.mp4`));
  const snapshot = await first.text(first.candidate.release.content.path);
  const exposed = snapshot + await first.text('resources.json') + await first.text('sitemap-0.xml') + doc + await first.text('item/PUBLIC-1/index.html');
  if (publicAudience) {
    assert(!exposed.includes('PRIVATE'));
    assert(!first.files.has('item/PRIVATE-1/index.html'));
    assert(!first.files.has('docs/prd/private-brief/index.html'));
    assert(![...first.files.keys()].some(path => path.startsWith('assets/ast_private/')));
  } else assert(exposed.includes('PRIVATE OWNER'));
  for (const file of application.files.filter(file => file.path.startsWith('public/') && !file.path.startsWith('public/.'))) assert.equal(first.files.get(file.path.slice(7))?.hash, file.hash);

  const replacement = await asset('ast_image', 'png', 'image/png', 'Public', 'rev_two');
  await put('content/items/public.md', publicItem(replacement));
  commit('Replace cover');
  const second = await prepare('second');
  assert(second.files.has('assets/ast_image/rev_two/file.png'));
  assert(!second.files.has('assets/ast_image/rev_one/file.png'));
  assert(!second.files.has(first.candidate.release.content.path));
  assert((await second.text('item/PUBLIC-1/index.html')).includes(`${base}assets/ast_image/rev_two/file.png`));

  await rm(join(checkout, 'content/items/public.md'));
  await rm(join(checkout, 'content/prds/public-brief.md'));
  commit('Delete initiative and document');
  const third = await prepare('third');
  for (const path of ['item/PUBLIC-1/index.html', 'docs/prd/public-brief/index.html', 'assets/ast_image/rev_two/file.png']) assert(!third.files.has(path));
  assert(!(await third.text('sitemap-0.xml')).includes('/item/PUBLIC-1'));
  assert(!(await third.text('resources.json')).includes('ast_image'));
  for (const path of ['index.html', 'music-app/index.html', 'docs/index.html', 'themes/index.html', 'changes/index.html', 'changelog/index.html', 'help/index.html', 'shares/index.html']) assert(third.files.has(path));
  await put('content/assets/ast_pdf/rev_one/file.pdf', 'Corrupted fixture');
  commit('Corrupt asset fixture');
  await assert.rejects(prepare('invalid'), /checksum mismatch/);
  assert.equal(await readFile(join(checkout, 'content/assets/ast_pdf/rev_one/file.pdf'), 'utf8'), 'Corrupted fixture');
  t.diagnostic(JSON.stringify({ audience: application.audience, base, timings: [first.timings, second.timings, third.timings] }));
});

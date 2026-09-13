// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadContentSource } from './source';

const roots: string[] = [];
async function root() { const dir = await mkdtemp(join(tmpdir(), 'roadmap-content-source-')); roots.push(dir); return dir; }
afterEach(async () => { await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
const markdown = '---\nid: MUSIC-001\ntitle: "Title: quoted"\nproduct: Music App\nhorizon: Now\nstage: Pilot\nowner: Mark\n---\n## Scope\nA useful change\n';

it('loads real Markdown and multiline YAML with absent optional collections', async () => {
  const dir = await root();
  await mkdir(join(dir, 'content/items/music-app'), { recursive: true });
  await mkdir(join(dir, 'content/prds'), { recursive: true });
  await writeFile(join(dir, 'content/items/music-app/MUSIC-001-test.md'), markdown);
  await writeFile(join(dir, 'content/prds/Brief.md'), '---\ntitle: >-\n  A long\n  title\nvisibility: Public\n---\n# Body');
  const source = await loadContentSource(dir);
  expect(source.items[0]).toMatchObject({ id: 'music-app/music-001-test', data: { title: 'Title: quoted' }, body: '## Scope\nA useful change\n' });
  expect(source.documents[0].entries[0]).toMatchObject({ id: 'brief', data: { title: 'A long title' } });
  expect(source.documents[1].entries).toEqual([]);
});

it('rejects symlinked collection roots and Markdown files without following them', async () => {
  const dir = await root(); const outside = await root();
  await mkdir(join(dir, 'content'), { recursive: true });
  await symlink(outside, join(dir, 'content/items'));
  await expect(loadContentSource(dir)).rejects.toThrow(/symbolic/i);
});

it('rejects duplicate YAML keys and invalid schema before publishing', async () => {
  const dir = await root();
  await mkdir(join(dir, 'content/items'), { recursive: true });
  await writeFile(join(dir, 'content/items/test.md'), markdown.replace('id: MUSIC-001', 'id: MUSIC-001\nid: MUSIC-002'));
  await expect(loadContentSource(dir)).rejects.toThrow(/YAML/i);
});

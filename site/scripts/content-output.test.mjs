import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOutputWriter } from './content-output.mjs';

async function fixture(t, limits) {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-output-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, writer: createOutputWriter(root, limits) };
}
test('inventories exactly current files with hashes, including empty bytes', async t => {
  const { root, writer } = await fixture(t);
  await writer.add('index.html', 'Current content');
  await writer.add('assets/empty.txt', Buffer.alloc(0));
  assert.deepEqual(writer.manifest().map(file => file.path), ['assets/empty.txt', 'index.html']);
  assert.equal(writer.manifest()[0].hash, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(await readFile(join(root, 'index.html'), 'utf8'), 'Current content');
});
test('rejects collisions, unsafe paths and Canvas size/count limits', async t => {
  const { writer } = await fixture(t, { maxFileBytes: 10, maxTotalBytes: 15, maxFiles: 2 });
  for (const path of ['../outside', '/absolute', 'private/a', '.env', 'a/.git/file', 'a\\b', 'a//b']) await assert.rejects(writer.add(path, 'x'), /path/i);
  await assert.rejects(writer.add('large.txt', 'x'.repeat(11)), /file/i);
  await writer.add('index.html', '1234567890');
  await assert.rejects(writer.add('INDEX.html', 'x'), /collision/i);
  await assert.rejects(writer.add('second.txt', '123456'), /total/i);
  await writer.add('second.txt', '12345');
  await assert.rejects(writer.add('third.txt', ''), /count/i);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('standalone history check requires one valid seed and complete dates', async t => {
  const root = await mkdtemp(join(tmpdir(), 'roadmap-history-check-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = new URL('./check-item-history.mjs', import.meta.url);
  const seed = items => `<script type="application/json" id="published-seed">${JSON.stringify({model:{boardItems:items}})}</script>`;
  const item = { id:'A',createdAt:'2026-01-01',updatedAt:'2026-01-02',activityDates:['2026-01-02'] };
  const run = () => execFileSync(process.execPath, [script.pathname, root], { encoding:'utf8', stdio:['ignore','pipe','pipe'] });
  await writeFile(join(root,'index.html'),seed([item]));
  assert.match(run(), /1 rendered items/);
  for (const html of ['', seed([{...item,createdAt:null}]), seed([item])+seed([item])]) {
    await writeFile(join(root,'index.html'),html);
    assert.throws(run);
  }
});

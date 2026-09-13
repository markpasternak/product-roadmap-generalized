import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientStyles } from './client-assets.mjs';

test('collects only initial route CSS, including shared imports, before hydration', () => {
  const manifest = {
    client: { file: 'client.js', imports: ['shared'], dynamicImports: ['board', 'item'] },
    shared: { file: 'shared.js', css: ['shared.css'] },
    board: { file: 'board.js', css: ['board.css'] },
    item: { file: 'item.js', css: ['item.css'], imports: ['shared'] },
  };
  assert.deepEqual(clientStyles(manifest, ['client', 'item']), ['shared.css', 'item.css']);
  assert.throws(() => clientStyles(manifest, ['missing']), /missing/i);
});

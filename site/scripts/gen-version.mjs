// Write public/version.json = { commit } so the deployed site exposes its own build commit.
// The client (src/lib/edit/version.ts) polls this file and compares it against the commit
// baked into its own bundle (__BUILD_COMMIT__, same derivation) to detect a newer deploy.
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const commit =
  process.env.GITHUB_SHA ||
  (() => {
    try {
      return execSync('git rev-parse HEAD').toString().trim();
    } catch {
      return 'dev';
    }
  })();

const dest = fileURLToPath(new URL('../public/version.json', import.meta.url));

mkdirSync(fileURLToPath(new URL('../public', import.meta.url)), { recursive: true });
writeFileSync(dest, JSON.stringify({ commit }));
console.log(`gen-version: wrote ${dest} (commit=${commit})`);

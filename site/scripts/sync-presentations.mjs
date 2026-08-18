// Stage repo-root presentations/ into public/p/ so /p/<slug>/ resolves in dev
// and local builds, mirroring what the deploy workflow does in CI (README.md
// files excluded). public/p/ is gitignored — this is a build artifact.
import { cpSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../../presentations', import.meta.url));
const dest = fileURLToPath(new URL('../public/p', import.meta.url));

if (!existsSync(src)) {
  console.warn(`sync-presentations: ${src} not found, skipping`);
  process.exit(0);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, {
  recursive: true,
  filter: (from) => !/(^|\/)README\.md$/i.test(from),
});
console.log('sync-presentations: presentations/ -> public/p/');

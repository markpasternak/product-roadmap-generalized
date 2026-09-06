// Stage repo-root presentations/ into public/p/ so /p/<slug>/ resolves in dev
// and builds, including CI (README.md files excluded).
// public/p/ is gitignored — this is a build artifact.
import { cpSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../../presentations', import.meta.url));
const dest = fileURLToPath(new URL('../public/p', import.meta.url));

// Always clear the staging directory, including when this demo has no decks.
// A previous local build must never leak its old presentations into a new deploy.
rmSync(dest, { recursive: true, force: true });
if (!existsSync(src)) {
  console.warn(`sync-presentations: ${src} not found, skipping`);
  process.exit(0);
}

cpSync(src, dest, {
  recursive: true,
  filter: (from) => !/(^|\/)README\.md$/i.test(from),
});
console.log('sync-presentations: presentations/ -> public/p/');

// No compiler imports: execute only an installed, verified application package.
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { verifyApplicationPackage } from './application-package.mjs';
import { clientStyles } from './client-assets.mjs';

const [packagePath, checkoutPath, outputPath, packageDigest] = process.argv.slice(2);
if (!packagePath || !checkoutPath || !outputPath || !packageDigest) throw new Error('Usage: prepare-content.mjs <approved-package> <immutable-checkout> <new-output> <trusted-package-digest>');
const start = performance.now();
const app = resolve(packagePath), checkout = resolve(checkoutPath), output = resolve(outputPath);
const manifest = await verifyApplicationPackage(app, { digest: packageDigest });
const verified = performance.now();
const renderer = await import(pathToFileURL(join(app, 'private/renderer.mjs')).href);
const model = await renderer.prepareModel(checkout, manifest.base, manifest.audience);
// Check asset ancestors as well as manifests, including an empty symlinked root.
try { await renderer.confinedFile(checkout, 'content/assets'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const assets = (await renderer.assetCatalog(checkout)).filter(asset => manifest.audience !== 'public' || asset.visibility === 'Public');
const availableAssets = new Set(assets.flatMap(asset => asset.revisions.map(revision => `assets/${asset.id}/${revision.original.path}`)));
const refs = new Set([...JSON.stringify(model).matchAll(/assets\/(ast_[a-z0-9_-]+)\/(rev_[a-z0-9_-]+)\/([A-Za-z0-9_-][A-Za-z0-9_.-]*)/g)].map(match => match[0]));
for (const path of refs) {
  if (!availableAssets.has(path)) throw new Error('Missing or private referenced resource');
}
const prepared = performance.now();
const clientManifest = JSON.parse(await readFile(join(app, 'public/.vite/manifest.json'), 'utf8'));
const client = clientManifest['src/published-client.ts'];
const template = await readFile(join(app, 'private/template.html'), 'utf8');
// Fresh directory only; failures never damage a previous candidate or live release.
await mkdir(output, { recursive: false });
for (const file of manifest.files.filter(file => file.path.startsWith('public/') && !file.path.startsWith('public/.'))) {
  const target = join(output, file.path.slice('public/'.length));
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(app, file.path), target);
}
for (const path of refs) {
  const target = join(output, path);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(await renderer.confinedFile(checkout, `content/${path}`), target);
}
const routes = [
  { path: '', title: 'SeenThis Roadmap' },
  ...model.items.map(item => ({ path: `item/${item.data.id}`, title: `${item.data.title} · SeenThis Roadmap` })),
  ...model.documents.map(doc => ({ path: doc.href.slice(manifest.base.length), title: `${doc.data.title ?? doc.id} · Source documents` })),
];
for (const route of routes) {
  const component = route.path.startsWith('item/') ? 'published/ItemPage.vue'
    : route.path.startsWith('docs/') ? 'published/DocumentPage.vue' : 'board/Board.vue';
  const styles = clientStyles(clientManifest, ['src/published-client.ts', `src/components/${component}`]);
  const seed = renderer.pageSeed(model, manifest.base, route.path);
  const html = await renderer.renderPage(seed, manifest.base, route.path);
  const page = renderer.fillTemplate(template, { title: route.title, html, seed: { model: seed, base: manifest.base, route: route.path }, path: `${manifest.base.slice(1)}${route.path}`,
    client: `${manifest.base}${client.file}`, styles: styles.map(path => `${manifest.base}${path}`) });
  const file = join(output, route.path, 'index.html');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, page);
}
await writeFile(join(output, 'content.json'), JSON.stringify(model));
console.log(JSON.stringify({ output, items: model.items.length, documents: model.documents.length, resources: refs.size, pages: routes.length,
  timings: { verifyPackageMs: verified - start, prepareMs: prepared - verified, renderAndWriteMs: performance.now() - prepared, totalMs: performance.now() - start } }));

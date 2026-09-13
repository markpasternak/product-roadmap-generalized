// No compiler imports: execute only an installed, verified application package.
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { verifyApplicationPackage, sha256 } from './application-package.mjs';
import { clientStyles } from './client-assets.mjs';
import { createOutputWriter } from './content-output.mjs';
import { contentCache } from './content-cache.mjs';
import { createInterface } from 'node:readline';

export async function prepareContent(packagePath, checkoutPath, outputPath, packageDigest, options = {}) {
if (!packagePath || !checkoutPath || !outputPath || !packageDigest) throw new Error('Usage: prepare-content.mjs <approved-package> <immutable-checkout> <new-output> <trusted-package-digest>');
const start = performance.now();
const app = resolve(packagePath), checkout = resolve(checkoutPath), output = resolve(outputPath);
const manifest = await verifyApplicationPackage(app, { digest: packageDigest });
const git = args => execFileSync('git', args, { cwd: checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commit = git(['rev-parse', 'HEAD']);
if (!/^[a-f0-9]{40}$/.test(commit) || git(['status', '--porcelain', '--untracked-files=all', '--', 'content'])) throw new Error('Content checkout is not a clean immutable revision');
// Keep release bytes identical across Git versions' equivalent UTC spellings.
const committedAt = git(['show', '-s', '--format=%cI', commit]).replace(/\+00:00$/, 'Z');
const verified = performance.now();
const renderer = await import(pathToFileURL(join(app, 'private/renderer.mjs')).href);
const cache = await contentCache(options.cacheDirectory ?? join(checkout, 'site/.cache/content-output'), packageDigest, { disabled: options.noCache });
const model = await renderer.prepareModel(checkout, manifest.base, manifest.audience, options.noDocuments ? undefined : cache);
if (model.boardItems.some(item => !item.createdAt || !item.updatedAt || !item.activityDates?.length)) throw new Error('Missing published item history; prepare from a full Git checkout');
const { catalog: resources, originals } = await renderer.prepareResources(checkout, model, manifest.audience);
const prepared = performance.now();
const clientManifest = JSON.parse(await readFile(join(app, 'public/.vite/manifest.json'), 'utf8'));
const client = clientManifest['src/published-client.ts'];
const template = await readFile(join(app, 'private/template.html'), 'utf8');
const docsTemplate = await readFile(join(app, 'private/template-docs.html'), 'utf8');
// Fresh directory only; failures never damage a previous candidate or live release.
await mkdir(output, { recursive: false, mode: 0o700 });
const publicOutput = join(output, 'public');
await mkdir(publicOutput);
const writer = createOutputWriter(publicOutput);
for (const file of manifest.files.filter(file => file.path.startsWith('public/') && !file.path.startsWith('public/.'))) {
  await writer.add(file.path.slice('public/'.length), await readFile(join(app, file.path)));
}
for (const original of originals) {
  await writer.add(original.path, await readFile(original.source));
}
// Shares opened from this model must validate against this revision's originals,
// not a moving resources.json fetched after another publication becomes live.
model.resourceCatalog = resources;
const snapshot = Buffer.from(JSON.stringify(model));
const contentHash = sha256(snapshot);
const release = { commit, applicationCommit: manifest.source, applicationPackage: packageDigest,
  profile: sha256(JSON.stringify(manifest.profile)), contentSchema: 1, committedAt,
  content: { path: `content/${contentHash}.json`, hash: contentHash, size: snapshot.length } };
await writer.add(release.content.path, snapshot);
const routes = renderer.contentRoutes(model, manifest.base);
const application = { applicationCommit: manifest.source, applicationPackage: packageDigest, profile: release.profile, contentSchema: 1 };
let renderedPages = 0;
for (const route of routes) {
  const component = renderer.pageComponents[route.kind];
  const styles = clientStyles(clientManifest, ['src/published-client.ts', `src/components/${component}`]);
  const seed = renderer.pageSeed(model, manifest.base, route.path);
  const render = async () => {
    renderedPages++;
    const html = await renderer.renderPage(seed, manifest.base, route.path);
    return renderer.fillTemplate(route.active === 'docs' ? docsTemplate : template, { title: route.title, description: route.description, html, publishedAt: '', ogType: route.kind === 'item' ? 'article' : 'website', seed: { model: seed, application, base: manifest.base, route: route.path }, path: `${manifest.base.slice(1)}${route.path}`,
    client: `${manifest.base}${client.file}`, styles: styles.map(path => `${manifest.base}${path}`) });
  };
  // Aggregate routes include the whole board and change on every item edit.
  // Caching those large, short-lived pages costs more I/O than rendering them.
  const cacheable = route.kind === 'item' || route.kind === 'document';
  const page = options.noPages || !cacheable ? await render() : await cache.get('page', [route, seed, application], render);
  await writer.add(route.path ? `${route.path}/index.html` : 'index.html', page);
}
await writer.add('resources.json', JSON.stringify(resources));
await writer.add('version.json', JSON.stringify(release));
const escapeXml = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const sitemapPaths = [...routes.map(route => route.path), 'help', 'shares'];
await writer.add('sitemap-0.xml', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemapPaths.map(path => `<url><loc>${escapeXml(new URL(`${manifest.base}${path}`, manifest.profile.siteUrl).href)}</loc></url>`).join('')}</urlset>`);
await writer.add('sitemap-index.xml', `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${escapeXml(new URL(`${manifest.base}sitemap-0.xml`, manifest.profile.siteUrl).href)}</loc></sitemap></sitemapindex>`);
if (git(['rev-parse', 'HEAD']) !== commit || git(['status', '--porcelain', '--untracked-files=all', '--', 'content'])) throw new Error('Content checkout changed during preparation');
await writeFile(join(output, 'candidate.json'), JSON.stringify({ release, manifest: writer.manifest() }), { flag: 'wx', mode: 0o600 });
await cache.prune();
return { output, renderedPages, cache: cache.stats, items: model.items.length, documents: model.documents.length, resources: originals.length, pages: routes.length,
  timings: { verifyPackageMs: verified - start, prepareMs: prepared - verified, renderAndWriteMs: performance.now() - prepared, totalMs: performance.now() - start } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === await realpath(process.argv[1]).catch(() => null)) {
  const args = process.argv.slice(2);
  if (args[0] === '--worker') {
    const [, app, digest, cacheDirectory] = args;
    let idle;
    const arm = () => { clearTimeout(idle); idle = setTimeout(() => process.exit(0), 120000); };
    arm();
    for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
      clearTimeout(idle);
      try {
        const request = JSON.parse(line);
        const result = await prepareContent(app, request.checkout, request.output, digest, { cacheDirectory });
        process.stdout.write(JSON.stringify({ ok: true, result }) + '\n');
      } catch { process.stdout.write(JSON.stringify({ ok: false }) + '\n'); }
      arm();
    }
    clearTimeout(idle);
  } else console.log(JSON.stringify(await prepareContent(...args.slice(0, 4), { cacheDirectory: args[4] })));
}

// Application-time only. Content publication imports the resulting renderer,
// never Vite or uncompiled source from the candidate content checkout.
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { mkdir, readFile, writeFile, readdir, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { sha256 } from './application-package.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, process.argv[2] ?? '.cache/application');
// Refuse to overwrite a prior package or any broader directory.
await mkdir(output, { recursive: false, mode: 0o700 });
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const base = `${(process.env.SITE_BASE ?? '/').replace(/\/$/, '')}/`;
const audience = process.env.SITE_AUDIENCE === 'public' ? 'public' : 'internal';
const define = { __BUILD_COMMIT__: JSON.stringify(source), __SITE_AUDIENCE__: JSON.stringify(audience),
  'import.meta.env.PUBLIC_EDIT_API': JSON.stringify(process.env.PUBLIC_EDIT_API ?? ''),
  'import.meta.env.PUBLIC_CANVAS_BACKEND': JSON.stringify(process.env.PUBLIC_CANVAS_BACKEND ?? '') };
await build({ root, configFile: false, base, publicDir: false, plugins: [vue()], define, logLevel: 'warn',
  build: { outDir: join(output, 'public'), emptyOutDir: false, manifest: true,
    rollupOptions: { input: join(root, 'src/published-client.ts') } } });
await build({ root, configFile: false, base, publicDir: false, plugins: [vue()], define, logLevel: 'warn',
  ssr: { noExternal: true }, build: { ssr: join(root, 'src/published-renderer.ts'), outDir: join(output, 'private'), emptyOutDir: false,
    rollupOptions: { output: { entryFileNames: 'renderer.mjs' } } } });

// Astro owns the shell, navigation, CSS and its own documented island lifecycle.
const astroPackage = JSON.parse(await readFile(join(root, 'node_modules/astro/package.json'), 'utf8'));
execFileSync(process.execPath, [join(root, 'node_modules/astro', astroPackage.bin.astro), 'build'], { cwd: root, stdio: 'inherit',
  env: { ...process.env, CONTENT_APPLICATION_BUILD: '1', GITHUB_SHA: source } });
const template = await readFile(join(root, 'dist/_publication-template/index.html'), 'utf8');
for (const marker of ['<!--ROADMAP_CONTENT-->', '<!--ROADMAP_STYLES-->', '__ROADMAP_SEED__', '__ROADMAP_CLIENT__']) {
  if (template.split(marker).length !== 2) throw new Error(`Astro removed or duplicated the template insertion point: ${marker}`);
}
await writeFile(join(output, 'private/template.html'), template);
async function copyTree(from, to) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (entry.isDirectory()) await copyTree(join(from, entry.name), join(to, entry.name));
    else if (entry.isFile()) await copyFile(join(from, entry.name), join(to, entry.name));
    else throw new Error('Non-regular application input');
  }
}
await copyTree(join(root, 'dist/_astro'), join(output, 'public/_astro'));
await copyTree(join(root, 'dist/brand'), join(output, 'public/brand'));
const files = [];
async function inventory(dir) {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await inventory(path);
    else if (entry.isFile()) { const bytes = await readFile(path); files.push({ path: path.slice(output.length + 1), size: bytes.length, hash: sha256(bytes) }); }
    else throw new Error('Non-regular application output');
  }
}
await inventory(output);
const dependencyDigest = sha256(await readFile(join(root, 'package-lock.json')));
const profile = { siteUrl: process.env.SITE_URL ?? 'https://seenthisroadmap.canvas-drop.com', base, audience,
  editApi: process.env.PUBLIC_EDIT_API ?? '', canvasBackend: process.env.PUBLIC_CANVAS_BACKEND ?? '' };
const manifestBytes = JSON.stringify({ type: 'module', protocol: 1, source, base, audience, profile, dependencyDigest, nodeMajor: Number(process.versions.node.split('.')[0]), files }, null, 2);
await writeFile(join(output, 'package.json'), manifestBytes, { mode: 0o600 });
console.log(JSON.stringify({ applicationPackage: output, packageDigest: sha256(manifestBytes), files: files.length }));

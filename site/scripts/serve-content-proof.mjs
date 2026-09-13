// Local browser harness: atomically switch between already-prepared candidates.
// Never builds, publishes, accepts arbitrary paths, or binds a public interface.
import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, relative, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const candidates = await Promise.all(process.argv.slice(2).map(async path => {
  const root = await realpath(resolve(path, 'public'));
  const receipt = JSON.parse(await readFile(resolve(path, 'candidate.json'), 'utf8'));
  return { root, release: receipt.release };
}));
if (!candidates.length) throw new Error('Pass one or more prepared candidate directories');
let selected = 0;
const token = randomUUID();
const editorMock = process.env.CONTENT_PROOF_EDITOR === '1';
const base = process.env.CONTENT_PROOF_BASE ?? '/';
if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base)) throw new Error('Invalid proof base');
let draft = { revision: 0, data: null };
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.xml': 'application/xml', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.mp4': 'video/mp4' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (editorMock && url.pathname.startsWith('/editor/api/')) {
      let data;
      if (url.pathname === '/editor/api/me' && req.method === 'GET') data = { editor: true, login: 'proof-editor' };
      else if (url.pathname === '/editor/api/draft') {
        if (req.method === 'PUT') {
          const chunks = []; let size = 0;
          for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) { res.writeHead(413).end(); return; } chunks.push(chunk); }
          draft = { revision: draft.revision + 1, data: JSON.parse(Buffer.concat(chunks)).data, updatedAt: new Date().toISOString() };
        }
        data = draft;
      } else if (['/editor/api/assets', '/editor/api/activity'].includes(url.pathname) && req.method === 'GET') data = [];
      else if (url.pathname === '/editor/api/items' && req.method === 'GET') {
        const source = url.searchParams.has('at') ? candidates.find(candidate => candidate.release.commit === url.searchParams.get('at')) : candidates[selected];
        if (!source) { res.writeHead(404).end(); return; }
        const model = JSON.parse(await readFile(join(source.root, source.release.content.path), 'utf8'));
        data = model.items.map(item => ({ id: item.data.id, path: item.filePath, sha: 'a'.repeat(40), body: item.body,
          content: `---\ntitle: ${item.data.title}\n---\n${item.body}`,
          frontmatter: Object.fromEntries(Object.entries(item.data).map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : String(value)])) }));
      } else { res.writeHead(405).end(); return; } // In particular, this harness can never publish a Git commit.
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(data));
      return;
    }
    const activation = /^\/__proof\/activate\/(\d+)$/.exec(url.pathname);
    if (activation) {
      if (req.method !== 'POST' || req.headers['x-content-proof'] !== token) { res.writeHead(403).end(); return; }
      const next = Number(activation[1]);
      if (!candidates[next]) { res.writeHead(404).end(); return; }
      selected = next;
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ selected, release: candidates[selected].release }));
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    const root = candidates[selected].root;
    if (!url.pathname.startsWith(base)) { res.writeHead(404).end(); return; }
    const path = resolve(root, '.' + decodeURIComponent(url.pathname.slice(base.length - 1)));
    if (relative(root, path).startsWith('..')) { res.writeHead(404).end(); return; }
    let file = await realpath(path);
    if ((await stat(file)).isDirectory()) file = await realpath(join(file, 'index.html'));
    if (relative(root, file).startsWith('..')) { res.writeHead(404).end(); return; }
    const info = await stat(file);
    if (!info.isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': /\/(?:_astro|assets|content)\//.test(url.pathname) ? 'public, max-age=31536000, immutable' : 'no-store' });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch { if (!res.headersSent) res.writeHead(404); res.end(); }
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, token, editorMock, candidates: candidates.map(candidate => candidate.release.commit) })));

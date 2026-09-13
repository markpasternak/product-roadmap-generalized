import { readdir, readFile, lstat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import { slug } from 'github-slugger';
import { itemSchema, docSchema } from '../schema';
import { DOC_COLLECTIONS } from '../slugs';
import { docContentRoot } from './model';
import type { ContentSource } from './schema';

/** Read only an immutable, caller-owned checkout; never evaluate its source code. */
export async function loadContentSource(root: string): Promise<ContentSource> {
  root = resolve(root);
  async function markdownFiles(directory: string): Promise<string[]> {
    let status;
    try { status = await lstat(directory); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
    if (status.isSymbolicLink()) throw new Error('Symbolic content paths are not supported');
    if (!status.isDirectory()) throw new Error('Invalid content directory');
    const files: string[] = [];
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new Error('Symbolic content paths are not supported');
      if (entry.isDirectory()) files.push(...await markdownFiles(join(directory, entry.name)));
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(join(directory, entry.name));
    }
    return files;
  }
  // A symlinked content ancestor must be rejected even when its collections are empty.
  try { if ((await lstat(join(root, 'content'))).isSymbolicLink()) throw new Error('Symbolic content paths are not supported'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }

  async function entries(contentRoot: string) {
    const base = join(root, 'content', contentRoot);
    const out = [];
    for (const file of await markdownFiles(base)) {
      if ((await lstat(file)).size > 2 * 1024 * 1024) throw new Error('Content document exceeds size limit');
      const text = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
      let data: Record<string, unknown> = {};
      let body = text;
      if (text.startsWith('---\n')) {
        const match = /^---\n([\s\S]*?)\n(?:---|\.\.\.)(?:\n|$)/.exec(text);
        if (!match) throw new Error('Unterminated YAML frontmatter');
        const parsed = parseDocument(match[1]);
        if (parsed.errors.length) throw new Error(`Invalid YAML in ${relative(root, file)}`);
        const value: unknown = parsed.toJS({ maxAliasCount: 50 });
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('YAML frontmatter must be a mapping');
        data = value as Record<string, unknown>;
        body = text.slice(match[0].length);
      }
      const id = data.slug ? String(data.slug) : relative(base, file).replace(/\.md$/, '').split('/').map(segment => slug(segment)).join('/').replace(/\/index$/, '');
      out.push({ id, filePath: relative(root, file), data, body });
    }
    return out;
  }
  const items = (await entries('items')).map(entry => ({ ...entry, data: itemSchema.parse(entry.data) }));
  const documents = [];
  for (const coll of DOC_COLLECTIONS) documents.push({ coll, entries: (await entries(docContentRoot(coll))).map(entry => ({ ...entry, data: docSchema.parse(entry.data) })) });
  return { items, documents };
}

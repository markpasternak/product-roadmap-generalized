import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { sha256 } from './application-package.mjs';

/** Use only a freshly created, publisher-owned directory. Never inherit a live tree. */
export function createOutputWriter(root, { maxFileBytes = 25 * 1048576, maxTotalBytes = 100 * 1048576, maxFiles = 2000 } = {}) {
  const files = [], paths = new Set();
  let total = 0;
  return {
    async add(path, content) {
      if (typeof path !== 'string' || !path || path.startsWith('/') || path.includes('\\') || /[\u0000-\u001f]/.test(path) ||
          path.split('/').some(part => !part || part.startsWith('.')) || path.startsWith('private/')) throw new Error('Invalid public output path');
      if (paths.has(path.toLowerCase())) throw new Error(`Output path collision: ${path}`);
      const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
      if (bytes.length > maxFileBytes) throw new Error('Output file exceeds Canvas limit');
      if (total + bytes.length > maxTotalBytes) throw new Error('Output total exceeds Canvas limit');
      if (files.length >= maxFiles) throw new Error('Output file count exceeds Canvas limit');
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: 'wx' });
      total += bytes.length; paths.add(path.toLowerCase());
      files.push({ path, hash: sha256(bytes), size: bytes.length });
    },
    manifest: () => [...files].sort((a, b) => a.path.localeCompare(b.path)),
  };
}

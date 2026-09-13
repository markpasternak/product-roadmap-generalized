// Disposable data cache. Keys include the approved application and complete inputs.
// Corruption is a miss; cached output is never imported or executed as server code.
import { mkdir, readFile, writeFile, rename, lstat, readdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { sha256 } from './application-package.mjs';
let warmCache;
const memoryLimit = 32 * 1024 * 1024;
export async function contentCache(directory, namespace, { disabled = false } = {}) {
  const stats = { hits: 0, misses: 0 };
  if (!/^[a-f0-9]{64}$/.test(namespace)) throw Error('Invalid cache namespace');
  const root = join(directory, namespace);
  if (warmCache?.root !== root) warmCache = { root, entries: new Map(), bytes: 0 };
  const memory = warmCache;
  // Strings are immutable. Object results stay on disk to avoid sharing mutable
  // model objects across revisions. Bound retained HTML in the short-lived worker.
  const remember = (key, value) => {
    if (typeof value !== 'string' || memory.entries.has(key)) return;
    const size = Buffer.byteLength(value);
    if (memory.bytes + size <= memoryLimit) { memory.entries.set(key, { value, size }); memory.bytes += size; }
  };
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (!(await lstat(root)).isDirectory()) throw Error('Invalid cache directory');
  const used = new Set();
  return {
    stats,
    async get(kind, inputs, produce) {
      const key = sha256(JSON.stringify([kind, inputs])), path = join(root, key + '.json');
      used.add(key + '.json');
      if (!disabled && memory.entries.has(key)) { stats.hits++; return memory.entries.get(key).value; }
      if (!disabled) try {
        const info = await lstat(path);
        if (!info.isFile() || info.size > 32 * 1024 * 1024) throw Error('Invalid cache file');
        const entry = await readFile(path);
        const payload = entry.subarray(132);
        if (entry.subarray(0, 65).toString() === key + '\n' && sha256(payload) === entry.subarray(65, 129).toString()) {
          const value = entry.subarray(130, 132).toString() === 's\n' ? payload.toString() : JSON.parse(payload.toString());
          remember(key, value); stats.hits++; return value;
        }
      } catch { /* Recompute missing or damaged data. */ }
      stats.misses++;
      const value = await produce();
      if (!disabled) {
        const temporary = path + `.${randomUUID()}.tmp`;
        try {
          const payload = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
          const header = Buffer.from(`${key}\n${sha256(payload)}\n${typeof value === 'string' ? 's' : 'j'}\n`);
          await writeFile(temporary, Buffer.concat([header, payload]), { mode: 0o600, flag: 'wx' });
          await rename(temporary, path);
          remember(key, value);
        } finally { await rm(temporary, { force: true }); }
      }
      return value;
    },
    async prune() {
      for (const [key, entry] of memory.entries) if (!used.has(key + '.json')) { memory.entries.delete(key); memory.bytes -= entry.size; }
      // Keep only this completed model's entries, not a growing edit history.
      for (const entry of await readdir(root, { withFileTypes: true }))
        if (entry.isFile() && /^[a-f0-9]{64}\.json$/.test(entry.name) && !used.has(entry.name)) await rm(join(root, entry.name));
    },
  };
}

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const git = (root, ...args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
export const readHistoryLog = (root, path) =>
  git(
    root,
    'log',
    '--follow',
    '--format=%x1e%H%x1f%cI%x1f%an%x1f%s',
    '--patch',
    '--unified=0',
    '--no-ext-diff',
    '--',
    path,
  );
export function buildHistorySnapshot(root) {
  const head = git(root, 'rev-parse', 'HEAD').trim();
  const directory = join(root, 'site/.cache');
  const file = join(directory, 'item-history.json');
  let previous;
  try {
    previous = JSON.parse(readFileSync(file, 'utf8'));
    if (
      previous.version !== 1 ||
      !/^[a-f0-9]{40}$/.test(previous.head) ||
      !previous.logs ||
      Array.isArray(previous.logs)
    )
      throw Error('Invalid cache');
    git(root, 'merge-base', '--is-ancestor', previous.head, head);
  } catch {
    previous = null;
  }
  // Include intermediate changes even if their final contents were reverted.
  // -m and --no-renames expose both sides of renames and merged branch changes.
  const changed = previous
    ? new Set(
        git(
          root,
          'log',
          '--full-history',
          '-m',
          '--no-renames',
          '--format=',
          '--name-only',
          '-z',
          `${previous.head}..${head}`,
          '--',
          'content/items',
        )
          .split('\0')
          .map((p) => p.replace(/^\n+/, ''))
          .filter(Boolean),
      )
    : null;
  const paths = git(root, 'ls-files', '-z', 'content/items')
    .split('\0')
    .filter((p) => p.endsWith('.md'));
  const logs = {};
  let refreshed = 0;
  for (const path of paths) {
    if (
      changed &&
      !changed.has(path) &&
      typeof previous.logs[path] === 'string'
    )
      logs[path] = previous.logs[path];
    else {
      logs[path] = readHistoryLog(root, path);
      refreshed++;
    }
  }
  const snapshot = { version: 1, head, logs };
  mkdirSync(directory, { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(snapshot));
  renameSync(temporary, file);
  return { snapshot, refreshed };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const root = git(process.cwd(), 'rev-parse', '--show-toplevel').trim();
  const start = performance.now();
  const { snapshot, refreshed } = buildHistorySnapshot(root);
  console.log(
    `Item history: ${refreshed}/${Object.keys(snapshot.logs).length} refreshed in ${Math.round(performance.now() - start)}ms`,
  );
}

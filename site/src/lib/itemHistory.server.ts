import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EMPTY_ITEM_HISTORY, normalizeItemHistory, type ItemHistory } from './itemHistory';

// Astro relocates server modules when building. Resolve the checkout through Git,
// not the module's source location; commands may start in either site/ or the root.
let repoRoot: string | undefined;
const cache = new Map<string, ItemHistory>();
let snapshotLogs: Record<string,string> | undefined;

/** Read each patch together with its timestamp, including paths before a rename. */
export function historyFromLog(output: string): ItemHistory {
  const records = output.split('\x1e').filter(Boolean).flatMap(block => {
    const [header, ...patch] = block.trim().split('\n');
    const [sha, date, by, subject] = header.split('\x1f');
    if (!sha || !date) return [];
    const changes = patch.filter(line => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line));
    const meaningful = changes.some(line => !/^[+-]updated:\s*\d{4}-\d{2}-\d{2}\s*$/.test(line));
    return [{ sha, date, by, subject, meaningful }];
  });
  const published = records.filter(record => record.meaningful);
  const latest = published[0] ?? records[0];
  const created = records.at(-1);
  return normalizeItemHistory({
    activityDates: [...new Set(published.map(record => record.date))],
    createdAt: created?.date ?? '', updatedAt: latest?.date ?? '',
    createdBy: created?.by ?? '', updatedBy: latest?.by ?? '',
    createdCommit: created?.sha ?? '', updatedCommit: latest?.sha ?? '',
    createdSubject: created?.subject ?? '', updatedSubject: latest?.subject ?? '',
  });
}
export function itemHistoryForPath(repoPath: string | null | undefined): ItemHistory {
  if (!repoPath) return EMPTY_ITEM_HISTORY;
  const cached = cache.get(repoPath);
  if (cached) return cached;
  try {
    repoRoot ??= execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (!snapshotLogs) {
      snapshotLogs = {};
      try {
        const snapshot = JSON.parse(readFileSync(join(repoRoot, 'site/.cache/item-history.json'), 'utf8'));
        const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd:repoRoot,encoding:'utf8'}).trim();
        if (snapshot.version === 1 && snapshot.head === head && snapshot.logs && typeof snapshot.logs === 'object' && !Array.isArray(snapshot.logs)) snapshotLogs = snapshot.logs;
      } catch { /* Missing/stale build caches fall back to the authoritative Git log. */ }
    }
    const cachedLog = snapshotLogs?.[repoPath];
    if (typeof cachedLog === 'string') {
      const history = historyFromLog(cachedLog);
      cache.set(repoPath, history);
      return history;
    }
    const output = execFileSync('git', ['log', '--follow', '--format=%x1e%H%x1f%cI%x1f%an%x1f%s', '--patch', '--unified=0', '--no-ext-diff', '--', repoPath], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    const history = historyFromLog(output);
    cache.set(repoPath, history);
    return history;
  } catch { return EMPTY_ITEM_HISTORY; }
}

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EMPTY_ITEM_HISTORY, normalizeItemHistory, type ItemHistory } from './itemHistory';

type GitRecord = {
  sha: string;
  date: string;
  by: string;
  subject: string;
};

const FIELD_SEP = '\x1f';
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const cache = new Map<string, ItemHistory>();
const updatedLineOnlyCache = new Map<string, boolean>();

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function parseGitLog(output: string): GitRecord[] {
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha = '', date = '', by = '', subject = ''] = line.split(FIELD_SEP);
      return { sha, date, by, subject };
    })
    .filter((record) => record.sha && record.date);
}

function isOnlyUpdatedFrontmatterChange(sha: string, repoPath: string): boolean {
  const key = `${sha}:${repoPath}`;
  const cached = updatedLineOnlyCache.get(key);
  if (cached !== undefined) return cached;

  let patch = '';
  try {
    patch = git(['show', '--format=', '--unified=0', '--no-ext-diff', sha, '--', repoPath]);
  } catch {
    updatedLineOnlyCache.set(key, false);
    return false;
  }

  const changed = patch
    .split('\n')
    .filter((line) => (line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---'));
  const onlyUpdated = changed.length > 0 && changed.every((line) => /^[+-]updated:\s*\d{4}-\d{2}-\d{2}\s*$/.test(line));
  updatedLineOnlyCache.set(key, onlyUpdated);
  return onlyUpdated;
}

export function itemHistoryForPath(repoPath: string | null | undefined): ItemHistory {
  if (!repoPath) return EMPTY_ITEM_HISTORY;
  const cached = cache.get(repoPath);
  if (cached) return cached;

  let records: GitRecord[] = [];
  try {
    records = parseGitLog(git(['log', '--follow', `--format=%H%x1f%cI%x1f%an%x1f%s`, '--', repoPath]));
  } catch {
    const empty = normalizeItemHistory(null);
    cache.set(repoPath, empty);
    return empty;
  }

  const latest = records.find((record) => !isOnlyUpdatedFrontmatterChange(record.sha, repoPath)) ?? records[0];
  const created = records[records.length - 1];
  const history = normalizeItemHistory({
    createdAt: created?.date ?? '',
    updatedAt: latest?.date ?? '',
    createdBy: created?.by ?? '',
    updatedBy: latest?.by ?? '',
    createdCommit: created?.sha ?? '',
    updatedCommit: latest?.sha ?? '',
    createdSubject: created?.subject ?? '',
    updatedSubject: latest?.subject ?? '',
  });
  cache.set(repoPath, history);
  return history;
}

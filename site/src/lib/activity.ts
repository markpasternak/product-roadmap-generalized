// Client for the edit-service's activity feed (`GET /api/activity`) — the
// recent `content/items` commit history, parsed into a human summary.
//
// The edit-service returns raw commits verbatim (KTD4): the "who changed
// what" summary lives entirely in the rich Sync commit message, produced by
// `commitMessage()` in `edit-service/sync.go`:
//
//   roadmap: N updated, N created, N deleted, N reordered (via <login>)
//
//   Changed: <id1>, <id2>, …[, +N more]
//   Deleted: <id1>, <id2>, …[, +N more]
//   Co-authored-by: <login> <login@users.noreply.github.com>
//
// A manual (non-Sync) commit has none of this shape — its message is passed
// through as-is and this module falls back to the raw subject line.
import { EDIT_API, getToken } from './edit/client';
export { formatRelativeTime } from './dates';

/** Raw commit shape returned by `GET /api/activity`. */
export interface ActivityCommit {
  sha: string;
  htmlUrl: string;
  message: string;
  date: string;
}

/** A parsed activity entry — one row in the feed. */
export interface ParsedActivity {
  sha: string;
  htmlUrl: string;
  date: string;
  /** False when the commit message didn't match the `roadmap: …` shape
   * (a manual commit, e.g. someone edited a file directly on GitHub). */
  isManual: boolean;
  /** The human editor, from `(via <login>)` — never the raw commit author
   * (which is always the GitHub App bot; see U1). Null for a manual commit. */
  login: string | null;
  updated: number;
  created: number;
  deleted: number;
  reordered: number;
  /** Up to 10 changed item ids (the cap `commitMessage`'s `capList` applies). */
  changedIds: string[];
  /** How many additional changed ids exist beyond the capped `changedIds`
   * list (parsed from the literal `, +N more` suffix, never itself an id). */
  changedOverflow: number;
  deletedIds: string[];
  deletedOverflow: number;
  /** The commit message's first line — the human summary for a Sync commit,
   * or the whole fallback display text for a manual commit. */
  subject: string;
}

const HEADER_RE = /^roadmap: (\d+) updated, (\d+) created, (\d+) deleted, (\d+) reordered \(via ([^)]+)\)/;
const OVERFLOW_RE = /^\+(\d+) more$/;

/** Splits a `capList`-produced id list ("id1, id2, +N more") into the ids and
 * the overflow count. The overflow suffix is stripped and never treated as
 * an id. */
function parseIdList(line: string): { ids: string[]; overflow: number } {
  const parts = line
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const ids: string[] = [];
  let overflow = 0;
  for (const part of parts) {
    const m = OVERFLOW_RE.exec(part);
    if (m) overflow = Number(m[1]);
    else ids.push(part);
  }
  return { ids, overflow };
}

/** Parses one commit message into its summary fields. Never throws — a
 * message that doesn't match the `roadmap: …` shape falls back to
 * `isManual: true` with the raw subject line. */
export function parseCommitMessage(message: string): Omit<ParsedActivity, 'sha' | 'htmlUrl' | 'date'> {
  const lines = message.split('\n');
  const subject = (lines[0] ?? '').trim();
  const header = HEADER_RE.exec(subject);
  if (!header) {
    return {
      isManual: true,
      login: null,
      updated: 0,
      created: 0,
      deleted: 0,
      reordered: 0,
      changedIds: [],
      changedOverflow: 0,
      deletedIds: [],
      deletedOverflow: 0,
      subject,
    };
  }
  const [, updated, created, deleted, reordered, login] = header;
  let changedIds: string[] = [];
  let changedOverflow = 0;
  let deletedIds: string[] = [];
  let deletedOverflow = 0;
  for (const line of lines.slice(1)) {
    const changedM = /^Changed:\s*(.+)$/.exec(line);
    if (changedM) {
      const r = parseIdList(changedM[1]!);
      changedIds = r.ids;
      changedOverflow = r.overflow;
      continue;
    }
    const deletedM = /^Deleted:\s*(.+)$/.exec(line);
    if (deletedM) {
      const r = parseIdList(deletedM[1]!);
      deletedIds = r.ids;
      deletedOverflow = r.overflow;
    }
  }
  return {
    isManual: false,
    login: login!,
    updated: Number(updated),
    created: Number(created),
    deleted: Number(deleted),
    reordered: Number(reordered),
    changedIds,
    changedOverflow,
    deletedIds,
    deletedOverflow,
    subject,
  };
}

/** Parses a batch of raw commits into feed rows, preserving server order. */
export function parseActivity(commits: ActivityCommit[]): ParsedActivity[] {
  return commits.map((c) => ({ sha: c.sha, htmlUrl: c.htmlUrl, date: c.date, ...parseCommitMessage(c.message) }));
}

/** Fetches and parses the activity feed. Degrades to an empty list — never
 * throws — when there's no session token, the edit-service is unreachable,
 * or the request fails (R14: the surface should simply be absent). */
export async function fetchActivity(): Promise<ParsedActivity[]> {
  const tok = getToken();
  if (!tok) return [];
  try {
    const r = await fetch(`${EDIT_API}/api/activity`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    if (!r.ok) return [];
    const commits = (await r.json()) as ActivityCommit[];
    return parseActivity(commits);
  } catch {
    return [];
  }
}

/** Resolves changed/deleted item ids to titles against the currently-loaded
 * board items. An id no longer on the board (deleted, or from before a
 * rename) falls back to the raw id. */
export function resolveTitles(ids: string[], byId: Map<string, { title: string }>): string[] {
  return ids.map((id) => byId.get(id)?.title ?? id);
}

/** A concise "N updated, N created, …" clause, omitting any zero counts. */
export function countsSummary(p: ParsedActivity): string {
  const parts: string[] = [];
  if (p.updated) parts.push(`${p.updated} updated`);
  if (p.created) parts.push(`${p.created} created`);
  if (p.deleted) parts.push(`${p.deleted} deleted`);
  if (p.reordered) parts.push(`${p.reordered} reordered`);
  return parts.join(', ');
}

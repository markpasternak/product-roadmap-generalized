import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveToken, clearToken } from './edit/client';
import { countsSummary, fetchActivity, formatRelativeTime, parseActivity, parseCommitMessage, resolveTitles } from './activity';

afterEach(() => {
  clearToken();
  vi.unstubAllGlobals();
});

describe('parseCommitMessage', () => {
  it('parses a rich Sync message into counts, the (via <login>) author, and changed ids', () => {
    const message = [
      'roadmap: 2 updated, 1 created, 0 deleted, 0 reordered (via octocat)',
      '',
      'Changed: ITEM-1, ITEM-2, ITEM-3',
      'Co-authored-by: octocat <octocat@users.noreply.github.com>',
    ].join('\n');

    const parsed = parseCommitMessage(message);

    expect(parsed.isManual).toBe(false);
    expect(parsed.login).toBe('octocat');
    expect(parsed.updated).toBe(2);
    expect(parsed.created).toBe(1);
    expect(parsed.deleted).toBe(0);
    expect(parsed.reordered).toBe(0);
    expect(parsed.changedIds).toEqual(['ITEM-1', 'ITEM-2', 'ITEM-3']);
    expect(parsed.changedOverflow).toBe(0);
    expect(countsSummary({ ...parsed, sha: 's', htmlUrl: 'h', date: 'd' })).toBe('2 updated, 1 created');
  });

  it('strips the capList ", +N more" suffix, treating it as an overflow count rather than an id', () => {
    const message =
      'roadmap: 0 updated, 0 created, 0 deleted, 0 reordered (via hubot)\n\n' +
      'Changed: ITEM-1, ITEM-2, ITEM-3, ITEM-4, ITEM-5, ITEM-6, ITEM-7, ITEM-8, ITEM-9, ITEM-10, +5 more\n';

    const parsed = parseCommitMessage(message);

    expect(parsed.changedIds).toHaveLength(10);
    expect(parsed.changedIds).not.toContain('+5 more');
    expect(parsed.changedIds.every((id) => /^ITEM-\d+$/.test(id))).toBe(true);
    expect(parsed.changedOverflow).toBe(5);
  });

  it('parses an overflow-only Changed: line (just "+N more", no ids) to 0 ids + the overflow count', () => {
    const message =
      'roadmap: 0 updated, 0 created, 0 deleted, 0 reordered (via hubot)\n\n' +
      'Changed: +12 more\n';

    const parsed = parseCommitMessage(message);

    expect(parsed.changedIds).toEqual([]);
    expect(parsed.changedOverflow).toBe(12);
  });

  it('parses a Deleted: list the same way, including its own overflow', () => {
    const message =
      'roadmap: 0 updated, 0 created, 12 deleted, 0 reordered (via octocat)\n\n' +
      'Deleted: A-1, A-2, +10 more\n';

    const parsed = parseCommitMessage(message);

    expect(parsed.deletedIds).toEqual(['A-1', 'A-2']);
    expect(parsed.deletedOverflow).toBe(10);
  });

  it('falls back to the raw subject line for a manual (non-roadmap:) commit, without crashing', () => {
    const parsed = parseCommitMessage('Fix typo in PLATFORM-004.md');

    expect(parsed.isManual).toBe(true);
    expect(parsed.login).toBeNull();
    expect(parsed.subject).toBe('Fix typo in PLATFORM-004.md');
    expect(parsed.updated).toBe(0);
    expect(parsed.changedIds).toEqual([]);
  });
});

describe('resolveTitles', () => {
  it('resolves ids to titles from the board items, falling back to the raw id when unknown', () => {
    const byId = new Map([
      ['ITEM-1', { title: 'Faster onboarding' }],
      ['ITEM-2', { title: 'Bulk export' }],
    ]);

    expect(resolveTitles(['ITEM-1', 'ITEM-2', 'ITEM-404'], byId)).toEqual([
      'Faster onboarding',
      'Bulk export',
      'ITEM-404',
    ]);
  });
});

describe('parseActivity', () => {
  it('parses a batch of raw commits, preserving order', () => {
    const parsed = parseActivity([
      { sha: 'a1', htmlUrl: 'https://x/a1', date: '2026-07-01T00:00:00Z', message: 'roadmap: 1 updated, 0 created, 0 deleted, 0 reordered (via mp)\n\nChanged: X-1' },
      { sha: 'b2', htmlUrl: 'https://x/b2', date: '2026-06-30T00:00:00Z', message: 'Manual fix' },
    ]);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.sha).toBe('a1');
    expect(parsed[0]!.login).toBe('mp');
    expect(parsed[1]!.isManual).toBe(true);
  });
});

describe('fetchActivity', () => {
  it('returns [] when there is no session token (never calls fetch)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchActivity();

    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches through the edit API base with a bearer token and parses the response', async () => {
    saveToken('tok-123');
    const fetchSpy = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify([
            {
              sha: 'abc',
              htmlUrl: 'https://github.com/acme/roadmap/commit/abc',
              message: 'roadmap: 1 updated, 0 created, 0 deleted, 0 reordered (via octocat)\n\nChanged: ITEM-1',
              date: '2026-07-01T12:00:00Z',
            },
          ]),
          { status: 200 },
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchActivity();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain('/api/activity');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
    expect(result).toEqual([
      expect.objectContaining({ sha: 'abc', login: 'octocat', updated: 1, changedIds: ['ITEM-1'] }),
    ]);
  });

  it('degrades to an empty list — no throw — on a non-OK response or a network error', async () => {
    saveToken('tok-123');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('', { status: 401 }))),
    );
    await expect(fetchActivity()).resolves.toEqual([]);

    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('network down'))),
    );
    await expect(fetchActivity()).resolves.toEqual([]);
  });

  it('an empty feed parses to an empty list', async () => {
    saveToken('tok-123');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('[]', { status: 200 }))),
    );

    await expect(fetchActivity()).resolves.toEqual([]);
  });
});

describe('formatRelativeTime', () => {
  it('formats a range of offsets from a fixed "now"', () => {
    const now = new Date('2026-07-07T12:00:00Z').getTime();
    expect(formatRelativeTime(new Date(now - 10_000).toISOString(), now)).toBe('just now');
    expect(formatRelativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5m ago');
    expect(formatRelativeTime(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe('3h ago');
    expect(formatRelativeTime(new Date(now - 2 * 86_400_000).toISOString(), now)).toBe('2d ago');
  });
});

import { beforeEach, expect, it, vi } from 'vitest';

const { readFile, git } = vi.hoisted(() => ({
  readFile: vi.fn(),
  git: vi.fn(),
}));
vi.mock('node:fs', () => ({
  readFileSync: readFile,
  default: { readFileSync: readFile },
}));
vi.mock('node:child_process', () => ({
  execFileSync: git,
  default: { execFileSync: git },
}));

const log =
  '\x1eabc\x1f2026-09-12T12:00:00Z\x1fEditor\x1fMeaningful edit\n+title: Changed\n';
beforeEach(() => {
  vi.resetModules();
  readFile.mockReset();
  git.mockReset().mockImplementation((_cmd, args) => {
    if (args[0] === 'log') return log;
    return args[1] === 'HEAD' ? 'head' : '/checkout';
  });
});

it('uses a matching snapshot without launching an item Git log', async () => {
  readFile.mockReturnValue(
    JSON.stringify({
      version: 1,
      head: 'head',
      logs: { 'content/items/A.md': log },
    }),
  );
  const { itemHistoryForPath } = await import('./itemHistory.server');
  expect(itemHistoryForPath('content/items/A.md').updatedCommit).toBe('abc');
  expect(git.mock.calls.some(([, args]) => args[0] === 'log')).toBe(false);
});

it.each([
  '{broken',
  JSON.stringify({
    version: 1,
    head: 'stale',
    logs: { 'content/items/A.md': '' },
  }),
  JSON.stringify({ version: 1, head: 'head', logs: [] }),
  JSON.stringify({ version: 1, head: 'head', logs: {} }),
])(
  'falls back to Git for an invalid, stale or incomplete snapshot: %s',
  async (snapshot) => {
    readFile.mockReturnValue(snapshot);
    const { itemHistoryForPath } = await import('./itemHistory.server');
    expect(itemHistoryForPath('content/items/A.md').updatedCommit).toBe('abc');
    expect(git.mock.calls.filter(([, args]) => args[0] === 'log')).toHaveLength(
      1,
    );
    itemHistoryForPath('content/items/A.md');
    expect(git.mock.calls.filter(([, args]) => args[0] === 'log')).toHaveLength(
      1,
    );
  },
);

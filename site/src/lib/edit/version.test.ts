import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BUILD_COMMIT,
  fetchDeployedCommit,
  isNewerVersionLive,
  computeIsNewer,
  watchForNewVersion,
} from './version';

function mockFetchOnce(impl: () => Promise<Response> | never) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => impl())
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BUILD_COMMIT', () => {
  it('is stamped from the vitest define (never undefined/missing)', () => {
    expect(BUILD_COMMIT).toBe('vitest-build-commit');
  });
});

describe('fetchDeployedCommit', () => {
  it('aborts a stalled version request and clears its timer', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')));
      })));
      const result = fetchDeployedCommit();
      await vi.advanceTimersByTimeAsync(3000);
      await expect(result).resolves.toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('returns the deployed commit on a successful response', async () => {
    mockFetchOnce(() => Promise.resolve(new Response(JSON.stringify({ commit: 'abc123' }), { status: 200 })));
    await expect(fetchDeployedCommit()).resolves.toBe('abc123');
  });

  it('returns null on a non-ok response', async () => {
    mockFetchOnce(() => Promise.resolve(new Response('nope', { status: 500 })));
    await expect(fetchDeployedCommit()).resolves.toBeNull();
  });

  it('returns null when fetch rejects', async () => {
    mockFetchOnce(() => Promise.reject(new Error('network down')));
    await expect(fetchDeployedCommit()).resolves.toBeNull();
  });

  it('returns null when the body has no commit field', async () => {
    mockFetchOnce(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 })));
    await expect(fetchDeployedCommit()).resolves.toBeNull();
  });
});

describe('computeIsNewer (pure decision)', () => {
  it('is false when BUILD_COMMIT is "dev" (local/uninstrumented build), even if deployed differs', () => {
    expect(computeIsNewer('some-other-sha', 'dev')).toBe(false);
  });

  it('is false when there is no deployed commit', () => {
    expect(computeIsNewer(null, 'vitest-build-commit')).toBe(false);
  });

  it('is false when deployed matches the current build', () => {
    expect(computeIsNewer('vitest-build-commit', 'vitest-build-commit')).toBe(false);
  });

  it('is true when deployed differs from the current build', () => {
    expect(computeIsNewer('a-newer-sha', 'vitest-build-commit')).toBe(true);
  });
});

describe('isNewerVersionLive', () => {
  it('true when the deployed commit differs from this build', async () => {
    mockFetchOnce(() => Promise.resolve(new Response(JSON.stringify({ commit: 'a-newer-sha' }), { status: 200 })));
    await expect(isNewerVersionLive()).resolves.toBe(true);
  });

  it('false when the deployed commit matches this build', async () => {
    mockFetchOnce(() => Promise.resolve(new Response(JSON.stringify({ commit: BUILD_COMMIT }), { status: 200 })));
    await expect(isNewerVersionLive()).resolves.toBe(false);
  });

  it('false when the fetch fails', async () => {
    mockFetchOnce(() => Promise.reject(new Error('offline')));
    await expect(isNewerVersionLive()).resolves.toBe(false);
  });
});

describe('watchForNewVersion', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('calls onNewer once when a newer version appears, then stops polling', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        call++;
        // First two polls: same version. Third+: a newer one.
        const commit = call < 3 ? BUILD_COMMIT : 'a-newer-sha';
        return Promise.resolve(new Response(JSON.stringify({ commit }), { status: 200 }));
      })
    );

    const onNewer = vi.fn();
    watchForNewVersion(onNewer, 1000);

    // Poll 1: no change.
    await vi.advanceTimersByTimeAsync(1000);
    expect(onNewer).not.toHaveBeenCalled();

    // Poll 2: no change.
    await vi.advanceTimersByTimeAsync(1000);
    expect(onNewer).not.toHaveBeenCalled();

    // Poll 3: newer version -> callback fires once.
    await vi.advanceTimersByTimeAsync(1000);
    expect(onNewer).toHaveBeenCalledTimes(1);

    // Further ticks must not poll again (interval was cleared) or re-fire the callback.
    const callsBeforeMoreTicks = call;
    await vi.advanceTimersByTimeAsync(5000);
    expect(call).toBe(callsBeforeMoreTicks);
    expect(onNewer).toHaveBeenCalledTimes(1);
  });

  it('the returned stop function halts polling before any change is detected', async () => {
    mockFetchOnce(() => Promise.resolve(new Response(JSON.stringify({ commit: 'a-newer-sha' }), { status: 200 })));
    const onNewer = vi.fn();
    const stop = watchForNewVersion(onNewer, 1000);

    stop();
    await vi.advanceTimersByTimeAsync(10000);

    expect(onNewer).not.toHaveBeenCalled();
  });

  describe('pauses on a hidden tab (fix #7)', () => {
    const setHidden = (hidden: boolean) => {
      Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
    };
    afterEach(() => setHidden(false));

    it('skips the fetch entirely while the tab is hidden', async () => {
      setHidden(true);
      const fetchMock = vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ commit: 'a-newer-sha' }), { status: 200 })),
      );
      vi.stubGlobal('fetch', fetchMock);
      const onNewer = vi.fn();

      watchForNewVersion(onNewer, 1000);
      await vi.advanceTimersByTimeAsync(5000);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(onNewer).not.toHaveBeenCalled();
    });

    it('resumes polling (and can still detect a newer version) once the tab becomes visible again', async () => {
      setHidden(true);
      const fetchMock = vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ commit: 'a-newer-sha' }), { status: 200 })),
      );
      vi.stubGlobal('fetch', fetchMock);
      const onNewer = vi.fn();

      watchForNewVersion(onNewer, 1000);
      await vi.advanceTimersByTimeAsync(2000);
      expect(fetchMock).not.toHaveBeenCalled();

      setHidden(false);
      await vi.advanceTimersByTimeAsync(1000);

      expect(fetchMock).toHaveBeenCalled();
      expect(onNewer).toHaveBeenCalledTimes(1);
    });
  });
});

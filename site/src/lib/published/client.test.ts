import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { watchPublishedContent, parseRelease, parseSnapshot, type PublishedRelease, type RefreshStatus } from './client';

const model = { audience: 'internal', boardItems: [], items: [], documents: [], documentHtml: {} };
const bytes = JSON.stringify(model);
const hash = createHash('sha256').update(bytes).digest('hex');
const initial: PublishedRelease = { commit: 'a'.repeat(40), applicationCommit: 'b'.repeat(40), applicationPackage: 'c'.repeat(64), profile: 'd'.repeat(64), contentSchema: 1, committedAt: '2026-09-13T09:00:00Z', content: { path: `content/${hash}.json`, hash, size: Buffer.byteLength(bytes) } };
const latest = { ...initial, commit: 'e'.repeat(40) };
const digest = async (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const response = (value: unknown) => new Response(JSON.stringify(value));
let stops: (() => void)[];
function start(request = vi.fn<typeof fetch>().mockResolvedValue(response(initial)), blocked = () => false) {
  const apply = vi.fn();
  const status = vi.fn<(status: RefreshStatus) => void>();
  const watcher = watchPublishedContent({ initial, audience: 'internal', base: '/roadmap/', blocked, apply, status, fetch: request, digest });
  stops.push(watcher.stop);
  return { ...watcher, apply, status, request };
}
async function settle() { await vi.waitFor(() => expect(vi.getTimerCount()).toBeLessThanOrEqual(1)); }
beforeEach(() => {
  vi.useFakeTimers(); stops = [];
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
});
afterEach(() => { stops.forEach(stop => stop()); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('published content watcher', () => {
  it('applies a complete hash-checked revision and uses the deployment base', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response(latest)).mockResolvedValueOnce(new Response(bytes));
    const watcher = start(request);
    await vi.waitFor(() => expect(watcher.apply).toHaveBeenCalledOnce());
    expect(watcher.apply).toHaveBeenCalledWith({ release: latest, model });
    expect(String(request.mock.calls[0][0])).toContain('/roadmap/version.json');
    expect(request.mock.calls[0][1]).toMatchObject({ cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
    expect(String(request.mock.calls[1][0])).toContain(`/roadmap/content/${hash}.json`);
    expect(watcher.status).toHaveBeenLastCalledWith('current');
  });
  it('does not refetch the snapshot on unchanged revision polls', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => response(initial));
    const watcher = start(request);
    await settle(); await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenCalledTimes(2); expect(watcher.apply).not.toHaveBeenCalled();
  });
  it('keeps a checked candidate while blocked, then applies without a reload', async () => {
    let blocked = true;
    const watcher = start(vi.fn<typeof fetch>().mockResolvedValueOnce(response(latest)).mockResolvedValueOnce(new Response(bytes)), () => blocked);
    await vi.waitFor(() => expect(watcher.status).toHaveBeenCalledWith('deferred'));
    expect(watcher.apply).not.toHaveBeenCalled();
    blocked = false; watcher.flush();
    expect(watcher.apply).toHaveBeenCalledOnce();
  });
  it('revalidates an old deferred candidate rather than replaying it after editing', async () => {
    let blocked = true;
    const newer = { ...latest, commit: 'f'.repeat(40) };
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response(latest)).mockResolvedValueOnce(new Response(bytes)).mockResolvedValueOnce(response(newer));
    const watcher = start(request, () => blocked);
    await vi.waitFor(() => expect(watcher.status).toHaveBeenCalledWith('deferred'));
    vi.setSystemTime(Date.now() + 5000);
    blocked = false; watcher.flush();
    await vi.waitFor(() => expect(watcher.apply).toHaveBeenCalledOnce());
    expect(watcher.apply.mock.calls[0][0].release.commit).toBe(newer.commit);
  });
  it.each(['applicationPackage', 'applicationCommit', 'profile', 'contentSchema'] as const)('offers an application reload for incompatible %s without fetching content', async key => {
    const watcher = start(vi.fn<typeof fetch>().mockResolvedValue(response({ ...latest, [key]: key === 'contentSchema' ? 2 : 'f'.repeat(key === 'applicationCommit' ? 40 : 64) })));
    await vi.waitFor(() => expect(watcher.status).toHaveBeenCalledWith('application'));
    expect(watcher.request).toHaveBeenCalledOnce(); expect(watcher.apply).not.toHaveBeenCalled();
  });
  it('offers a reload for a future schema without interpreting its new snapshot layout', async () => {
    const watcher = start(vi.fn<typeof fetch>().mockResolvedValue(response({ ...latest, contentSchema: 2, content: { futureFormat: true } })));
    await vi.waitFor(() => expect(watcher.status).toHaveBeenCalledWith('application'));
    expect(watcher.apply).not.toHaveBeenCalled(); expect(watcher.request).toHaveBeenCalledOnce();
  });
  it.each(['checksum', 'size', 'json', 'shape', 'audience'])('retains the current model after a %s failure', async failure => {
    const invalid = failure === 'json' ? 'not JSON' : failure === 'shape' ? '{}' : failure === 'audience' ? JSON.stringify({ ...model, audience: 'public' }) : bytes;
    const validHash = createHash('sha256').update(invalid).digest('hex');
    const content = { path: `content/${validHash}.json`, hash: validHash, size: Buffer.byteLength(invalid) };
    if (failure === 'checksum') { content.hash = '0'.repeat(64); content.path = `content/${content.hash}.json`; }
    if (failure === 'size') content.size++;
    const watcher = start(vi.fn<typeof fetch>().mockResolvedValueOnce(response({ ...latest, content })).mockResolvedValueOnce(new Response(invalid)));
    await vi.waitFor(() => expect(watcher.status).toHaveBeenCalledWith('error'));
    expect(watcher.apply).not.toHaveBeenCalled();
  });
  it('refetches the descriptor once when an old snapshot has been removed', async () => {
    const newer = { ...latest, commit: 'f'.repeat(40) };
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response(latest)).mockResolvedValueOnce(new Response('', { status: 404 })).mockResolvedValueOnce(response(newer)).mockResolvedValueOnce(new Response(bytes));
    const watcher = start(request);
    await vi.waitFor(() => expect(watcher.apply).toHaveBeenCalledOnce());
    expect(request).toHaveBeenCalledTimes(4); expect(watcher.apply.mock.calls[0][0].release).toEqual(newer);
  });
  it('has one in-flight request and ignores a late reply after navigation/unmount', async () => {
    let resolve!: (value: Response) => void;
    const request = vi.fn<typeof fetch>().mockImplementation(() => new Promise(done => { resolve = done; }));
    const watcher = start(request);
    await watcher.check(); window.dispatchEvent(new Event('focus'));
    expect(request).toHaveBeenCalledOnce();
    watcher.stop(); resolve(response(latest));
    await settle();
    expect(request).toHaveBeenCalledOnce(); expect(watcher.apply).not.toHaveBeenCalled(); expect(watcher.status).not.toHaveBeenCalled();
  });
  it('suspends routine requests while hidden/offline and resumes once on focus/online', async () => {
    const watcher = start(vi.fn<typeof fetch>().mockImplementation(async () => response(initial)));
    await settle();
    Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(30000); expect(watcher.request).toHaveBeenCalledOnce();
    Object.defineProperty(document, 'hidden', { value: false, configurable: true }); window.dispatchEvent(new Event('focus'));
    await settle(); expect(watcher.request).toHaveBeenCalledTimes(2);
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true }); window.dispatchEvent(new Event('offline'));
    await vi.advanceTimersByTimeAsync(30000); expect(watcher.request).toHaveBeenCalledTimes(2); expect(watcher.status).toHaveBeenLastCalledWith('offline');
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true }); window.dispatchEvent(new Event('online'));
    await settle(); expect(watcher.request).toHaveBeenCalledTimes(3);
  });
  it('bounds error backoff and releases timers/listeners on stop', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('Offline'));
    const watcher = start(request); await settle();
    await vi.advanceTimersByTimeAsync(3000); expect(request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3000); expect(request).toHaveBeenCalledTimes(2);
    watcher.stop(); window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(60000); expect(request).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
});

it('rejects descriptor path escapes, oversized snapshots and malformed models', () => {
  expect(() => parseRelease({ ...initial, content: { ...initial.content, path: '../private/renderer.mjs' } })).toThrow();
  expect(() => parseRelease({ ...initial, content: { ...initial.content, size: 30 * 1024 * 1024 } })).toThrow();
  expect(() => parseSnapshot({ ...model, boardItems: [{ id: 'CM-1' }] }, 'internal')).toThrow();
});

it('validates the snapshot-pinned share catalog before accepting a revision', () => {
  const original = { path: 'rev_one/image.png', mediaType: 'image/png', bytes: 20, sha256: 'a'.repeat(64) };
  const snapshot = (entry: unknown) => ({ ...model, resourceCatalog: { assets: [{ id: 'ast_one', revisions: [{ original: entry }] }] } });
  expect(parseSnapshot(snapshot(original), 'internal').resourceCatalog?.assets).toHaveLength(1);
  for (const bad of [{ ...original, bytes: -1 }, { ...original, sha256: 'bad' }, { ...original, path: '../escape.png' }, null]) {
    expect(() => parseSnapshot(snapshot(bad), 'internal')).toThrow();
  }
  expect(() => parseSnapshot({ ...model, resourceCatalog: { assets: null } }, 'internal')).toThrow();
});

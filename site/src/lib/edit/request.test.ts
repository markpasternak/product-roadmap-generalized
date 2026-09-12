import { afterEach, expect, it, vi } from 'vitest';
import { requestWithTimeout } from './request';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('times out a stalled response body as well as a stalled connection', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(new ReadableStream()))));
  const result = requestWithTimeout('/test', {}, 100).catch(error => error);
  await vi.advanceTimersByTimeAsync(101);
  expect((await result).name).toBe('TimeoutError');
});
it('preserves successful responses and caller cancellation', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 201 })));
  const response = await requestWithTimeout('/test');
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ ok: true });
  const controller = new AbortController();
  controller.abort();
  await expect(requestWithTimeout('/test', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
});

import { describe, it, expect, afterEach, vi } from 'vitest';
import { chat, stream, AiQuotaError, AiUnavailableError, AiAbortedError, AI_MODEL } from './client';
import type { Canvasdrop } from '../share/canvasdrop';

afterEach(() => {
  delete (globalThis as any).canvasdrop;
  vi.restoreAllMocks();
});

function stubCanvasdrop(ai: Partial<NonNullable<Canvasdrop['ai']>>): void {
  (globalThis as any).canvasdrop = { me: async () => ({ id: '1', email: 'a', name: 'A' }), canvases: {}, ai };
}

describe('chat', () => {
  it('returns {text} from a mocked ai.chat, pinning the model', async () => {
    const mockChat = vi.fn(async () => ({ text: 'Hello draft', usage: { inputTokens: 10, outputTokens: 20 }, cost: 0.01 }));
    stubCanvasdrop({ chat: mockChat });

    const result = await chat([{ role: 'user', content: 'draft something' }], { system: 'You are helpful' });

    expect(result.text).toBe('Hello draft');
    expect(mockChat).toHaveBeenCalledWith(
      [{ role: 'user', content: 'draft something' }],
      { model: AI_MODEL, system: 'You are helpful', maxTokens: undefined },
    );
  });

  it('normalizes a QuotaExceededError (by name) into a friendly AiQuotaError, not the raw error', async () => {
    const err = new Error('raw quota message');
    err.name = 'QuotaExceededError';
    stubCanvasdrop({ chat: vi.fn(async () => { throw err; }) });

    try {
      await chat([{ role: 'user', content: 'hi' }], {});
      expect.unreachable('chat() should have thrown');
    } catch (thrown) {
      expect(thrown).toBeInstanceOf(AiQuotaError);
      expect((thrown as Error).message).not.toBe('raw quota message');
      expect((thrown as Error).message.length).toBeGreaterThan(0);
    }
  });

  it('normalizes a QUOTA_EXCEEDED / 429 error code into AiQuotaError', async () => {
    const err = Object.assign(new Error('nope'), { code: 'QUOTA_EXCEEDED', status: 429 });
    stubCanvasdrop({ chat: vi.fn(async () => { throw err; }) });

    await expect(chat([{ role: 'user', content: 'hi' }], {})).rejects.toBeInstanceOf(AiQuotaError);
  });

  it('normalizes MODEL_NOT_ALLOWED into AiUnavailableError', async () => {
    const err = Object.assign(new Error('nope'), { code: 'MODEL_NOT_ALLOWED' });
    stubCanvasdrop({ chat: vi.fn(async () => { throw err; }) });

    await expect(chat([{ role: 'user', content: 'hi' }], {})).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('throws AiUnavailableError when there is no ai accessor at all', async () => {
    (globalThis as any).canvasdrop = { me: async () => ({ id: '1', email: 'a', name: 'A' }), canvases: {} };

    await expect(chat([{ role: 'user', content: 'hi' }], {})).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('throws AiUnavailableError when canvasdrop itself is absent', async () => {
    await expect(chat([{ role: 'user', content: 'hi' }], {})).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('throws AiAbortedError instead of returning a result once the signal is aborted', async () => {
    const mockChat = vi.fn(async () => ({ text: 'Hello draft', usage: { inputTokens: 10, outputTokens: 20 }, cost: 0.01 }));
    stubCanvasdrop({ chat: mockChat });
    const controller = new AbortController();
    controller.abort();

    await expect(chat([{ role: 'user', content: 'hi' }], { signal: controller.signal })).rejects.toBeInstanceOf(
      AiAbortedError,
    );
  });
});

describe('stream', () => {
  it('yields deltas in order from a mocked async iterator', async () => {
    async function* fakeStream() {
      yield 'Hel';
      yield 'lo, ';
      yield 'world';
    }
    const mockStream = vi.fn(() => fakeStream());
    stubCanvasdrop({ stream: mockStream });

    const deltas: string[] = [];
    for await (const delta of stream([{ role: 'user', content: 'go' }], { maxTokens: 100 })) {
      deltas.push(delta);
    }

    expect(deltas).toEqual(['Hel', 'lo, ', 'world']);
    expect(mockStream).toHaveBeenCalledWith(
      [{ role: 'user', content: 'go' }],
      { model: AI_MODEL, system: undefined, maxTokens: 100 },
    );
  });

  it('throws AiUnavailableError when there is no ai accessor', async () => {
    (globalThis as any).canvasdrop = { me: async () => ({ id: '1', email: 'a', name: 'A' }), canvases: {} };

    const iterate = async () => {
      for await (const _delta of stream([{ role: 'user', content: 'go' }], {})) {
        // no-op
      }
    };
    await expect(iterate()).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('normalizes a quota error raised mid-stream', async () => {
    async function* fakeStream() {
      yield 'partial';
      const err = new Error('quota');
      err.name = 'QuotaExceededError';
      throw err;
    }
    stubCanvasdrop({ stream: vi.fn(() => fakeStream()) });

    const iterate = async () => {
      const deltas: string[] = [];
      for await (const delta of stream([{ role: 'user', content: 'go' }], {})) {
        deltas.push(delta);
      }
      return deltas;
    };
    await expect(iterate()).rejects.toBeInstanceOf(AiQuotaError);
  });

  it('stops yielding once the signal is aborted, without throwing', async () => {
    const controller = new AbortController();
    let returnCalled = false;
    async function* fakeStream() {
      try {
        yield 'Hel';
        yield 'lo, ';
        yield 'world';
      } finally {
        returnCalled = true;
      }
    }
    stubCanvasdrop({ stream: vi.fn(() => fakeStream()) });

    const deltas: string[] = [];
    for await (const delta of stream([{ role: 'user', content: 'go' }], { signal: controller.signal })) {
      deltas.push(delta);
      if (delta === 'Hel') controller.abort();
    }

    expect(deltas).toEqual(['Hel']);
    expect(returnCalled).toBe(true);
  });
});

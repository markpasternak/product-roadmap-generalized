import { describe, it, expect, afterEach } from 'vitest';
import { useBackend } from './useBackend';

afterEach(() => {
  delete (globalThis as any).canvasdrop;
});

describe('useBackend', () => {
  it('is unavailable for both when canvasdrop is entirely absent', () => {
    const { aiAvailable, realtimeAvailable } = useBackend();
    expect(aiAvailable.value).toBe(false);
    expect(realtimeAvailable.value).toBe(false);
  });

  it('aiAvailable is false when the ai accessor is absent, even if canvasdrop exists', () => {
    (globalThis as any).canvasdrop = { me: async () => ({ id: '1', email: 'a', name: 'A' }), canvases: {} };
    const { aiAvailable } = useBackend();
    expect(aiAvailable.value).toBe(false);
  });

  it('realtimeAvailable is false when the realtime accessor is absent, even if canvasdrop exists', () => {
    (globalThis as any).canvasdrop = { me: async () => ({ id: '1', email: 'a', name: 'A' }), canvases: {} };
    const { realtimeAvailable } = useBackend();
    expect(realtimeAvailable.value).toBe(false);
  });

  it('aiAvailable is true when the ai accessor is present', () => {
    (globalThis as any).canvasdrop = {
      me: async () => ({ id: '1', email: 'a', name: 'A' }),
      canvases: {},
      ai: { chat: async () => ({ text: '', usage: { inputTokens: 0, outputTokens: 0 }, cost: 0 }), stream: async function* () {} },
    };
    const { aiAvailable, realtimeAvailable } = useBackend();
    expect(aiAvailable.value).toBe(true);
    expect(realtimeAvailable.value).toBe(false);
  });

  it('realtimeAvailable is true when the realtime accessor is present', () => {
    (globalThis as any).canvasdrop = {
      me: async () => ({ id: '1', email: 'a', name: 'A' }),
      canvases: {},
      realtime: { channel: () => ({}) },
    };
    const { aiAvailable, realtimeAvailable } = useBackend();
    expect(aiAvailable.value).toBe(false);
    expect(realtimeAvailable.value).toBe(true);
  });
});

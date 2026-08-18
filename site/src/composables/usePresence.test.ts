import { afterEach, describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { usePresence, type UsePresenceApi } from './usePresence';
import type { RealtimeMessage, RealtimeUser } from '../lib/share/canvasdrop';

afterEach(() => {
  delete (globalThis as any).canvasdrop;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// A fake channel that captures publish/close calls and lets tests fire the
// on*/subscribe callbacks it was registered with, mirroring canvas-drop's real
// RealtimeChannel shape closely enough to exercise usePresence end to end.
function makeFakeChannel() {
  const calls = { publish: [] as { event: string; data: unknown }[], close: 0 };
  let presenceCb: ((u: RealtimeUser[]) => void) | null = null;
  let joinCb: ((u: RealtimeUser) => void) | null = null;
  let leaveCb: ((u: RealtimeUser) => void) | null = null;
  let subscribeCb: ((m: RealtimeMessage) => void) | null = null;
  const channel = {
    publish: vi.fn((event: string, data: unknown) => {
      calls.publish.push({ event, data });
    }),
    subscribe: vi.fn((cb: (m: RealtimeMessage) => void) => {
      subscribeCb = cb;
    }),
    unsubscribe: vi.fn(),
    presence: vi.fn(async () => [] as RealtimeUser[]),
    onPresence: vi.fn((cb: (u: RealtimeUser[]) => void) => {
      presenceCb = cb;
    }),
    onJoin: vi.fn((cb: (u: RealtimeUser) => void) => {
      joinCb = cb;
    }),
    onLeave: vi.fn((cb: (u: RealtimeUser) => void) => {
      leaveCb = cb;
    }),
    close: vi.fn(() => {
      calls.close += 1;
    }),
  };
  return {
    channel,
    calls,
    firePresence: (users: RealtimeUser[]) => presenceCb?.(users),
    fireJoin: (u: RealtimeUser) => joinCb?.(u),
    fireLeave: (u: RealtimeUser) => leaveCb?.(u),
    fireMessage: (m: RealtimeMessage) => subscribeCb?.(m),
  };
}

function installRealtime(opts: { me?: RealtimeUser } = {}) {
  const fake = makeFakeChannel();
  const channelFactory = vi.fn(() => fake.channel);
  const me = opts.me ? vi.fn(async () => ({ id: opts.me!.id, email: '', name: opts.me!.name })) : undefined;
  (globalThis as any).canvasdrop = { realtime: { channel: channelFactory }, me };
  return { ...fake, channelFactory };
}

// Host component: usePresence relies on onMounted/onUnmounted, so it has to run
// inside a real component instance rather than being called bare in a test. The
// returned api is captured via a closure (not `wrapper.vm`) so refs stay real
// Vue refs (`.value` access) rather than whatever the public-instance proxy's
// auto-unwrap semantics would otherwise produce.
let capturedApi: UsePresenceApi | null = null;
const Host = defineComponent({
  props: { channelName: { type: String, default: 'roadmap' } },
  setup(props) {
    capturedApi = usePresence(props.channelName);
    return () => h('div');
  },
});

function mountHost(channelName = 'roadmap'): UsePresenceApi {
  capturedApi = null;
  mount(Host, { props: { channelName } });
  if (!capturedApi) throw new Error('usePresence did not run during mount');
  return capturedApi;
}

describe('usePresence', () => {
  it('is a no-op when realtime is unavailable: empty state, no channel created', () => {
    const api = mountHost();
    expect(api.viewers.value).toEqual([]);
    expect(api.othersEditing.value).toEqual([]);
  });

  it('onJoin/onLeave update the viewer list and count', () => {
    const rt = installRealtime();
    const api = mountHost();

    rt.fireJoin({ id: 'u1', name: 'Alice' });
    expect(api.viewers.value).toEqual([{ id: 'u1', name: 'Alice' }]);
    rt.fireJoin({ id: 'u2', name: 'Bob' });
    expect(api.viewers.value).toHaveLength(2);

    rt.fireLeave({ id: 'u1', name: 'Alice' });
    expect(api.viewers.value).toEqual([{ id: 'u2', name: 'Bob' }]);
  });

  it('idles out after 10 minutes of no activity: channel.close() is called', () => {
    vi.useFakeTimers();
    const rt = installRealtime();
    mountHost();

    expect(rt.calls.close).toBe(0);
    vi.advanceTimersByTime(10 * 60 * 1000 - 1);
    expect(rt.calls.close).toBe(0);
    vi.advanceTimersByTime(2);
    expect(rt.calls.close).toBe(1);
  });

  it('activity before the 10-minute mark resets the idle clock (no close)', () => {
    vi.useFakeTimers();
    const rt = installRealtime();
    mountHost();

    vi.advanceTimersByTime(9 * 60 * 1000);
    document.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(9 * 60 * 1000);
    // Had activity not reset the clock, 18 minutes total would have idled out already.
    expect(rt.calls.close).toBe(0);
  });

  it('activity after an idle-out rejoins the channel', () => {
    vi.useFakeTimers();
    const rt = installRealtime();
    mountHost();

    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(rt.calls.close).toBe(1);
    expect(rt.channelFactory).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new Event('mousemove'));
    expect(rt.channelFactory).toHaveBeenCalledTimes(2);
  });

  it('othersEditing reflects another client publishing editing:true, and clears on editing:false', () => {
    const rt = installRealtime();
    const api = mountHost();

    const other: RealtimeUser = { id: 'u2', name: 'Bob' };
    rt.fireMessage({ event: 'editing', data: { editing: true }, from: other });
    expect(api.othersEditing.value).toEqual([other]);

    rt.fireMessage({ event: 'editing', data: { editing: false }, from: other });
    expect(api.othersEditing.value).toEqual([]);
  });

  it('a self-published editing message never appears in othersEditing (self-echo)', async () => {
    const self: RealtimeUser = { id: 'me1', name: 'Me' };
    const rt = installRealtime({ me: self });
    const api = mountHost();
    // Let the async `me()` identity lookup resolve before the channel delivers the
    // self-echoed message back.
    await Promise.resolve();
    await Promise.resolve();

    rt.fireMessage({ event: 'editing', data: { editing: true }, from: self });
    expect(api.othersEditing.value).toEqual([]);

    // A genuinely different client with a different id still shows up normally.
    const other: RealtimeUser = { id: 'u2', name: 'Bob' };
    rt.fireMessage({ event: 'editing', data: { editing: true }, from: other });
    expect(api.othersEditing.value).toEqual([other]);
  });

  it('setEditing publishes this client editing flag on the channel', () => {
    const rt = installRealtime();
    const api = mountHost();

    api.setEditing(true);
    expect(rt.calls.publish).toContainEqual({ event: 'editing', data: { editing: true } });

    api.setEditing(false);
    expect(rt.calls.publish).toContainEqual({ event: 'editing', data: { editing: false } });
  });

  it('!realtimeAvailable → setEditing/close no-op without throwing, indicators stay empty', () => {
    const api = mountHost();
    expect(() => api.setEditing(true)).not.toThrow();
    expect(() => api.close()).not.toThrow();
    expect(api.viewers.value).toEqual([]);
    expect(api.othersEditing.value).toEqual([]);
  });

  it('unmount closes the channel (no leak)', () => {
    const rt = installRealtime();
    capturedApi = null;
    const w = mount(Host, { props: { channelName: 'roadmap' } });
    expect(rt.calls.close).toBe(0);
    w.unmount();
    expect(rt.calls.close).toBe(1);
  });
});

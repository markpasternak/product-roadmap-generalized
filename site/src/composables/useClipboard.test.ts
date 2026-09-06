import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { useClipboard } from './useClipboard';

enableAutoUnmount(afterEach);
afterEach(() => vi.restoreAllMocks());
function clipboard(writeText: (value: string) => Promise<void>) {
  vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(writeText);
  let result!: ReturnType<typeof useClipboard>;
  const wrapper = mount(defineComponent({ setup() { result = useClipboard(); return () => null; } }));
  return { result, wrapper };
}
describe('clipboard feedback', () => {
  it('only reports success when the browser confirms the write', async () => {
    let resolve!: () => void;
    const { result } = clipboard(() => new Promise<void>((done) => resolve = done));
    const promise = result.copy('https://example.test/item');
    expect(result.copying.value).toBe(true);
    expect(result.copied.value).toBe(false);
    resolve();
    expect(await promise).toBe(true);
    expect(result.copied.value).toBe(true);
    expect(result.copying.value).toBe(false);
  });

  it('offers recovery after a rejected write and never shows a success', async () => {
    const { result } = clipboard(async () => { throw new Error('Permission denied'); });
    expect(await result.copy('https://example.test')).toBe(false);
    expect(result.copied.value).toBe(false);
    expect(result.copyError.value).toContain('try again');
  });

  it('ignores a stale completion after switching items or unmounting', async () => {
    let resolve!: () => void;
    const { result, wrapper } = clipboard(() => new Promise<void>((done) => resolve = done));
    const promise = result.copy('old item');
    result.resetCopy();
    wrapper.unmount();
    resolve();
    expect(await promise).toBe(false);
    expect(result.copied.value).toBe(false);
    expect(result.copyError.value).toBe('');
  });
});
